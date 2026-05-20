/**
 * `petforge quota [enable | disable | --json]`
 *
 * Spec §"Surface - CLI". This file owns the one-shot CLI behaviors plus the
 * daemon entrypoint (Task 9). Long-running probe loop is exported as
 * `runQuotaDaemon` so `up.ts` can co-orchestrate it with collect + serve.
 */

import { applyProbeResult } from "../core/quota/apply.js";
import { checkQuotaAchievements } from "../core/quota/achievements.js";
import { resolveOAuthToken, type ResolveResult } from "../core/quota/credentials.js";
import { defaultProjectsDir, shouldProbe } from "../core/quota/jsonl-gate.js";
import { probe } from "../core/quota/probe.js";
import { createInitialQuota, type QuotaState } from "../core/quota/schema.js";
import { ensureQuotaCounters, withStateLock } from "../core/state.js";

export interface QuotaCliDeps {
  resolveToken?: () => Promise<ResolveResult>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  writeOut?: (s: string) => void;
  writeErr?: (s: string) => void;
}

const out = (deps: QuotaCliDeps) => deps.writeOut ?? ((s: string) => process.stdout.write(s));
const err = (deps: QuotaCliDeps) => deps.writeErr ?? ((s: string) => process.stderr.write(s));
const now = (deps: QuotaCliDeps) => deps.now ?? (() => Date.now());

export async function quotaCli(argv: string[], deps: QuotaCliDeps = {}): Promise<number> {
  const sub = argv[0];
  if (sub === "enable") return enableCmd(deps);
  if (sub === "disable") return disableCmd(deps);
  if (sub === "--help" || sub === "-h") {
    out(deps)(helpText());
    return 0;
  }
  // default: one-shot status (with optional --json)
  const json = argv.includes("--json");
  return statusCmd(deps, json);
}

function helpText(): string {
  return `Usage: petforge quota [enable | disable | --json]\n`;
}

async function enableCmd(deps: QuotaCliDeps): Promise<number> {
  const resolve = deps.resolveToken ?? resolveOAuthToken;
  const tok = await resolve();
  if (tok.kind !== "ok") {
    err(deps)(formatTokenError(tok));
    return 1;
  }
  const r = await probe(tok.token, { fetchImpl: deps.fetchImpl });
  if (r.kind !== "ok") {
    err(deps)(`probe failed: ${probeErrShort(r)}\n`);
    return 1;
  }
  await withStateLock(async (s) => {
    ensureQuotaCounters(s);
    const q = s.counters.quota;
    if (!q) throw new Error("quota init failed");
    q.optIn = true;
    q.daemonStarted = now(deps)();
    applyProbeResult(q, r, now(deps)());
    checkQuotaAchievements(s);
  });
  out(deps)("Quota tracking enabled.\n");
  out(deps)(`Source: ${tok.source}\n`);
  out(deps)(`Session (5h): ${r.session5h.utilization.toFixed(0)}%\n`);
  if (r.weekly7d) out(deps)(`Weekly (7d): ${r.weekly7d.utilization.toFixed(0)}%\n`);
  return 0;
}

async function disableCmd(deps: QuotaCliDeps): Promise<number> {
  await withStateLock(async (s) => {
    ensureQuotaCounters(s);
    const fresh = createInitialQuota(now(deps)());
    // Preserve daemonStarted=0 -> "never enabled" semantics
    fresh.daemonStarted = 0;
    s.counters.quota = fresh;
  });
  out(deps)("Quota tracking disabled.\n");
  return 0;
}

async function statusCmd(deps: QuotaCliDeps, json: boolean): Promise<number> {
  // Read current state without probe; if opt-out, instruct the user.
  let snapshot: QuotaState | undefined;
  let optIn = false;
  await withStateLock(async (s) => {
    ensureQuotaCounters(s);
    optIn = s.counters.quota?.optIn === true;
    snapshot = s.counters.quota;
  });
  if (!optIn) {
    err(deps)("Quota tracking is disabled. Enable with: petforge quota enable\n");
    return 1;
  }
  if (json) {
    out(deps)(`${JSON.stringify(snapshot, null, 2)}\n`);
    return 0;
  }
  if (snapshot) out(deps)(formatStatus(snapshot));
  return 0;
}

function formatStatus(q: QuotaState): string {
  const lines: string[] = ["Quota status:"];
  if (q.session5h) {
    lines.push(`  Session (5h): ${q.session5h.utilization.toFixed(1)}%`);
  } else {
    lines.push("  Session (5h): no data yet");
  }
  if (q.weekly7d) {
    lines.push(`  Weekly  (7d): ${q.weekly7d.utilization.toFixed(1)}%`);
  }
  lines.push(`  Burn rate:    ${q.burnRatePctPerMin.toFixed(2)} %/min`);
  lines.push(`  Last probe:   ${q.lastProbeOk ? "ok" : `failed (${q.lastError ?? "?"})`}`);
  return `${lines.join("\n")}\n`;
}

function formatTokenError(r: Exclude<ResolveResult, { kind: "ok" }>): string {
  if (r.kind === "missing") {
    return "Claude Code credentials not found.\nLooked at: ~/.claude/.credentials.json (and macOS Keychain on darwin).\nLog into Claude Code first, then re-run.\n";
  }
  return `Credentials malformed: ${r.reason}\n`;
}

function probeErrShort(r: { kind: string; httpStatus?: number; cause?: string }): string {
  if (r.kind === "auth-error") return `HTTP ${r.httpStatus} - token rejected`;
  if (r.kind === "rate-limited") return "HTTP 429 - rate limited";
  if (r.kind === "server-error") return `HTTP ${r.httpStatus} - Anthropic server error`;
  if (r.kind === "network-error") return `network: ${r.cause}`;
  return r.kind;
}

// ---------- Daemon ----------

export interface QuotaDaemonOptions extends QuotaCliDeps {
  projectsDir?: string;
  probeIntervalMs?: number;
  probeGateMs?: number;
}

export interface QuotaDaemonHandle {
  close: () => Promise<void>;
}

const DEFAULT_PROBE_INTERVAL_MS = 5 * 60_000;
const DEFAULT_PROBE_GATE_MS = 10 * 60_000;

export async function runQuotaDaemon(opts: QuotaDaemonOptions = {}): Promise<QuotaDaemonHandle> {
  const resolve = opts.resolveToken ?? resolveOAuthToken;
  const projectsDir = opts.projectsDir ?? defaultProjectsDir();
  const interval = opts.probeIntervalMs ?? DEFAULT_PROBE_INTERVAL_MS;
  const gate = opts.probeGateMs ?? DEFAULT_PROBE_GATE_MS;
  const nowFn = opts.now ?? (() => Date.now());

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      // Re-read opt-in each tick - user may have disabled at runtime.
      let optIn = false;
      await withStateLock(async (s) => {
        ensureQuotaCounters(s);
        optIn = s.counters.quota?.optIn === true;
      });
      if (!optIn) return;

      const gateOk = await shouldProbe({
        projectsDir,
        now: nowFn(),
        gateMs: gate,
      });
      if (!gateOk) return;

      const tok = await resolve();
      if (tok.kind !== "ok") {
        await withStateLock(async (s) => {
          ensureQuotaCounters(s);
          const q = s.counters.quota;
          if (!q) return;
          q.lastProbeOk = false;
          q.lastError = tok.kind === "missing" ? "credentials missing" : "credentials malformed";
          q.lastProbeTs = nowFn();
        });
        return;
      }
      const r = await probe(tok.token, { fetchImpl: opts.fetchImpl });
      await withStateLock(async (s) => {
        ensureQuotaCounters(s);
        const q = s.counters.quota;
        if (!q) return;
        applyProbeResult(q, r, nowFn());
        checkQuotaAchievements(s);
      });
    } catch {
      // never throw out of the tick - the daemon must survive transient errors
    } finally {
      if (!stopped) timer = setTimeout(tick, interval);
    }
  };

  // First tick fires immediately so `up --quota` shows numbers fast.
  timer = setTimeout(tick, 0);

  return {
    close: async (): Promise<void> => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
