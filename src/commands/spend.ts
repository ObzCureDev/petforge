/**
 * `petforge spend [baseline <usd>] [--json]`
 *
 * Surfaces and edits the additive persisted lifetime block written by the
 * serve spend daemon. The two subcommands:
 *
 *   petforge spend
 *     Prints the current persisted total + accumulated + baseline + the
 *     watermark timestamp. Read-only. Adds `--json` for machine output.
 *
 *   petforge spend baseline <usd> [--api=<usd>] [--messages=<N>] [--reset]
 *     One-shot manual offset for spend that occurred before V3.7.8 started
 *     tracking (or that Claude Code archived before PetForge could see it).
 *     The reported "true lifetime" is `baseline + accumulated`. `--reset`
 *     zeroes the baseline back out. Writes via `withStateLock`; the
 *     wipe-killer protects the pet.
 */

import {
  persistedTotalApiCents,
  persistedTotalCents,
  persistedTotalMessages,
} from "../core/spend/compute.js";
import { createInitialPersistedSpend, type PersistedSpend } from "../core/spend/schema.js";
import { withStateLock } from "../core/state.js";

export interface SpendCliDeps {
  writeOut?: (s: string) => void;
  writeErr?: (s: string) => void;
  now?: () => number;
}

const out = (deps: SpendCliDeps) => deps.writeOut ?? ((s: string) => process.stdout.write(s));
const err = (deps: SpendCliDeps) => deps.writeErr ?? ((s: string) => process.stderr.write(s));
const now = (deps: SpendCliDeps) => deps.now ?? (() => Date.now());

function helpText(): string {
  return (
    "Usage:\n" +
    "  petforge spend [--json]\n" +
    "      Show persisted-lifetime status (baseline + accumulated + total).\n" +
    "  petforge spend baseline <usd> [--api=<usd>] [--messages=<N>]\n" +
    "      Set the manual offset for pre-V3.7.8 / archived activity.\n" +
    "  petforge spend baseline --reset\n" +
    "      Zero the baseline back to 0.\n"
  );
}

function fmtUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function parseUsdToCents(raw: string): number | null {
  const cleaned = raw.replace(/[$,_\s]/g, "");
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function parseInt0(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function flag(args: string[], prefix: string): string | undefined {
  const hit = args.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

export async function spendCli(argv: string[], deps: SpendCliDeps = {}): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    out(deps)(helpText());
    return 0;
  }

  const sub = argv[0];

  if (sub === "baseline") {
    return await baselineCmd(argv.slice(1), deps);
  }

  // Default: status (read-only).
  return await statusCmd(argv, deps);
}

async function statusCmd(argv: string[], deps: SpendCliDeps): Promise<number> {
  const json = argv.includes("--json");
  let snapshot: PersistedSpend | undefined;
  await withStateLock(async (s) => {
    snapshot = s.counters.spendPersisted;
  });

  if (json) {
    out(deps)(`${JSON.stringify(snapshot ?? null, null, 2)}\n`);
    return 0;
  }

  if (!snapshot) {
    out(deps)("No persisted spend recorded yet.\n");
    out(deps)("Start `petforge up` or `petforge serve` and let one scan complete (~16s).\n");
    return 0;
  }

  const total = persistedTotalCents(snapshot);
  const totalApi = persistedTotalApiCents(snapshot);
  const totalMsg = persistedTotalMessages(snapshot);
  const watermark = snapshot.lastSeenNewestTs
    ? new Date(snapshot.lastSeenNewestTs).toISOString()
    : "(none yet)";
  const firstScan = snapshot.firstScanTs ? new Date(snapshot.firstScanTs).toISOString() : "(n/a)";

  const lines = [
    "=== Persisted lifetime spend ===",
    "",
    `  Total:          ${fmtUsd(total)}  (API-equiv ${fmtUsd(totalApi)})`,
    `  Total messages: ${totalMsg.toLocaleString()}`,
    "",
    `  Baseline:       ${fmtUsd(snapshot.baselineCents)}  (API ${fmtUsd(snapshot.baselineApiCents)})  msgs ${snapshot.baselineMessages.toLocaleString()}`,
    `  Accumulated:    ${fmtUsd(snapshot.accumulatedCents)}  (API ${fmtUsd(snapshot.accumulatedApiCents)})  msgs ${snapshot.accumulatedMessages.toLocaleString()}`,
    "",
    `  Watermark:      ${watermark}`,
    `  First scan:     ${firstScan}`,
    "",
  ];
  out(deps)(`${lines.join("\n")}`);
  return 0;
}

async function baselineCmd(argv: string[], deps: SpendCliDeps): Promise<number> {
  if (argv.includes("--reset")) {
    await withStateLock(async (s) => {
      const prev = s.counters.spendPersisted;
      const next = prev ?? createInitialPersistedSpend(now(deps)());
      next.baselineCents = 0;
      next.baselineApiCents = 0;
      next.baselineMessages = 0;
      next.lastUpdatedTs = now(deps)();
      s.counters.spendPersisted = next;
    });
    out(deps)("Baseline reset to $0.00.\n");
    return 0;
  }

  // First non-flag positional = required USD amount.
  const positional = argv.find((a) => !a.startsWith("-"));
  if (!positional) {
    err(deps)("Missing required <usd> amount.\n\n");
    err(deps)(helpText());
    return 2;
  }

  const baselineCents = parseUsdToCents(positional);
  if (baselineCents === null) {
    err(deps)(`Invalid USD amount: ${positional}\n`);
    return 2;
  }

  // Optional --api=<usd>. Defaults to the paid baseline (treats it as already
  // cache-discounted, no further inflation).
  const apiRaw = flag(argv, "--api=");
  let baselineApiCents = baselineCents;
  if (apiRaw !== undefined) {
    const parsed = parseUsdToCents(apiRaw);
    if (parsed === null) {
      err(deps)(`Invalid --api USD amount: ${apiRaw}\n`);
      return 2;
    }
    baselineApiCents = parsed;
  }

  // Optional --messages=<N>.
  const msgsRaw = flag(argv, "--messages=");
  let baselineMessages = 0;
  if (msgsRaw !== undefined) {
    const parsed = parseInt0(msgsRaw);
    if (parsed === null) {
      err(deps)(`Invalid --messages count: ${msgsRaw}\n`);
      return 2;
    }
    baselineMessages = parsed;
  }

  const ts = now(deps)();
  await withStateLock(async (s) => {
    const prev = s.counters.spendPersisted;
    const next = prev ?? createInitialPersistedSpend(ts);
    next.baselineCents = baselineCents;
    next.baselineApiCents = baselineApiCents;
    next.baselineMessages = baselineMessages;
    next.lastUpdatedTs = ts;
    s.counters.spendPersisted = next;
  });

  out(deps)(`Baseline set to ${fmtUsd(baselineCents)} (API ${fmtUsd(baselineApiCents)}).\n`);
  if (baselineMessages > 0) {
    out(deps)(`Baseline messages: ${baselineMessages.toLocaleString()}\n`);
  }
  return 0;
}
