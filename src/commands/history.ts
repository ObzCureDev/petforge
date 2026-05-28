/**
 * `petforge history [--json] [--by-project]`
 *
 * Scans every JSONL file under ~/.claude/projects/ and reports per-model
 * + per-project token usage with two cost figures: actual paid (with
 * prompt-cache discount) and API-equivalent (no cache discount).
 *
 * Output is read-only and never touches state.json.
 */

import { rollupCost } from "../core/history/cost.js";
import {
  defaultProjectsDir,
  type HistoricalTotals,
  type ProjectUsage,
  scanAllJsonl,
} from "../core/history/scanner.js";
import { pricingFor } from "../core/otel/pricing.js";
import { ensureQuotaCounters, withStateLock } from "../core/state.js";

export interface HistoryCliDeps {
  projectsDir?: string;
  writeOut?: (s: string) => void;
}

const out = (deps: HistoryCliDeps) => deps.writeOut ?? ((s: string) => process.stdout.write(s));

export async function historyCli(argv: string[], deps: HistoryCliDeps = {}): Promise<number> {
  const json = argv.includes("--json");
  const byProject = argv.includes("--by-project");
  const syncOtel = argv.includes("--sync-otel");
  const help = argv.includes("--help") || argv.includes("-h");
  if (help) {
    out(deps)(
      "Usage: petforge history [--by-project] [--json] [--sync-otel]\n" +
        "  Walks ~/.claude/projects, computes lifetime spend.\n" +
        "  --by-project   Group by repo folder, sorted by recency.\n" +
        "  --json         Machine-readable output.\n" +
        "  --sync-otel    Replace state.counters.otel with the REAL lifetime\n" +
        "                 totals from the scan. Tokens, cost, cache reads all\n" +
        "                 become accurate. Achievements gated on OTel may\n" +
        "                 unlock retroactively on next hook event.\n",
    );
    return 0;
  }

  out(deps)("Scanning ~/.claude/projects ...\n");
  const t0 = Date.now();
  const totals = await scanAllJsonl({ projectsDir: deps.projectsDir });
  const elapsed = Date.now() - t0;

  if (totals.usageLinesScanned === 0) {
    out(deps)(`No assistant messages found in ${deps.projectsDir ?? defaultProjectsDir()}.\n`);
    return 0;
  }

  const cost = rollupCost(totals);

  if (syncOtel) {
    // Mutate state.counters.otel with the REAL totals from the scan.
    // Pet stats are NOT touched; the wipe-killer guard at writeStateAtomic
    // ensures the existing pet survives this update.
    await withStateLock((s) => {
      ensureQuotaCounters(s);
      const prev = s.counters.otel;
      const modelUsage: Record<string, { tokensIn: number; tokensOut: number; sessions: number }> =
        {};
      for (const [name, m] of Object.entries(totals.byModel)) {
        modelUsage[name] = { tokensIn: m.tokensIn, tokensOut: m.tokensOut, sessions: 0 };
      }
      s.counters.otel = {
        linesAdded: prev?.linesAdded ?? 0,
        linesRemoved: prev?.linesRemoved ?? 0,
        tokensIn: totals.total.tokensIn,
        tokensOut: totals.total.tokensOut,
        tokensCacheRead: totals.total.cacheRead,
        tokensCacheCreation: totals.total.cacheCreation,
        costUsdCents: cost.total.paidCents,
        editsAccepted: prev?.editsAccepted ?? 0,
        editsRejected: prev?.editsRejected ?? 0,
        toolDecisionsAccepted: prev?.toolDecisionsAccepted ?? 0,
        toolDecisionsRejected: prev?.toolDecisionsRejected ?? 0,
        commitCount: prev?.commitCount ?? 0,
        prCount: prev?.prCount ?? 0,
        apiErrorCount: prev?.apiErrorCount ?? 0,
        modelUsage,
        lastUpdate: Date.now(),
        ingesterStarted: prev?.ingesterStarted ?? totals.oldestTs,
      };
    });
    out(deps)(
      `\n  state.counters.otel synced with lifetime totals.\n` +
        `  Card / web view will now show $${(cost.total.paidCents / 100).toFixed(2)} ` +
        `(API $${(cost.total.apiEquivCents / 100).toFixed(2)}).\n`,
    );
  }

  if (json) {
    out(deps)(`${JSON.stringify({ totals, cost, elapsedMs: elapsed }, null, 2)}\n`);
    return 0;
  }

  out(deps)(formatHuman(totals, cost, elapsed, byProject));
  return 0;
}

function fmtCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
function fmtTok(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}
function fmtDate(ts: number): string {
  if (ts === 0) return "-";
  return new Date(ts).toISOString().slice(0, 10);
}

function formatHuman(
  totals: HistoricalTotals,
  cost: ReturnType<typeof rollupCost>,
  elapsedMs: number,
  byProject: boolean,
): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("=== Claude Code lifetime spend ===");
  lines.push("");
  lines.push(`  Activity span: ${fmtDate(totals.oldestTs)}  -  ${fmtDate(totals.newestTs)}`);
  lines.push(`  Messages:      ${totals.usageLinesScanned.toLocaleString()}`);
  lines.push(`  Files scanned: ${totals.filesScanned.toLocaleString()}`);
  lines.push("");
  lines.push(`  Tokens in:        ${fmtTok(totals.total.tokensIn)}`);
  lines.push(`  Tokens out:       ${fmtTok(totals.total.tokensOut)}`);
  lines.push(`  Cache read:       ${fmtTok(totals.total.cacheRead)}`);
  lines.push(`  Cache creation:   ${fmtTok(totals.total.cacheCreation)}`);
  lines.push("");
  lines.push(`  Actual cost (with cache discount): ${fmtCents(cost.total.paidCents)}`);
  lines.push(`  API-equivalent cost (no cache):    ${fmtCents(cost.total.apiEquivCents)}`);
  lines.push(
    `  Cache savings:                     ${fmtCents(cost.total.savedCents)} ` +
      `(${((1 - 1 / Math.max(cost.total.multiplier, 1)) * 100).toFixed(0)}% off)`,
  );
  lines.push("");
  lines.push("  Per model:");
  for (const m of cost.byModel) {
    const p = pricingFor(m.model);
    lines.push(
      `    ${m.model.padEnd(32)} ` +
        `paid ${fmtCents(m.paidCents).padStart(10)}  ` +
        `api-equiv ${fmtCents(m.apiEquivCents).padStart(10)}  ` +
        `(rate $${p.input}/$${p.output} per MTok)`,
    );
  }

  if (byProject) {
    lines.push("");
    lines.push("  Per project (most recent first):");
    for (const p of totals.byProject.slice(0, 50)) {
      const single = singleProjectCost(p);
      lines.push(
        `    ${fmtDate(p.newestTs)}  ${fmtCents(single.paidCents).padStart(8)} ` +
          `(api ${fmtCents(single.apiEquivCents).padStart(8)})  ${p.projectKey}`,
      );
    }
    if (totals.byProject.length > 50) {
      lines.push(`    ... and ${totals.byProject.length - 50} more`);
    }
  }

  lines.push("");
  lines.push(`(scan: ${elapsedMs} ms)`);
  lines.push("");
  return lines.join("\n");
}

function singleProjectCost(p: ProjectUsage): {
  paidCents: number;
  apiEquivCents: number;
} {
  // Use the same rollupCost helper by faking a HistoricalTotals.
  const fake: HistoricalTotals = {
    total: { ...p },
    byModel: p.byModel,
    byProject: [],
    todayByModel: {},
    todayMessageCount: 0,
    oldestTs: p.oldestTs,
    newestTs: p.newestTs,
    filesScanned: 0,
    linesScanned: 0,
    usageLinesScanned: p.messageCount,
  };
  const r = rollupCost(fake);
  return { paidCents: r.total.paidCents, apiEquivCents: r.total.apiEquivCents };
}
