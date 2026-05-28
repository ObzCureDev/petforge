/**
 * computeSpend — produce a SpendSnapshot from a full ~/.claude/projects scan.
 *
 * Read-only: scans JSONL, never touches state.json. Returns corrected
 * lifetime cost (matching `petforge history`) plus a "today" figure scoped
 * to messages timestamped at/after local midnight.
 *
 * The scan is the same one `petforge history` runs (~tens of seconds on
 * large installs), so callers should cache the result and refresh on an
 * interval rather than per request.
 */

import { rollupCostByModel } from "../history/cost.js";
import { scanAllJsonl } from "../history/scanner.js";
import type { SpendSnapshot } from "./schema.js";

export interface ComputeSpendOptions {
  projectsDir?: string;
  /** Override "now" for deterministic tests. Defaults to Date.now(). */
  now?: number;
  /** Hard cap on JSONL files visited (passed through to the scanner). */
  maxFiles?: number;
}

/** Local midnight (00:00 in the host's timezone) for the given epoch ms. */
export function localMidnightMs(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** YYYY-MM-DD in local time for the given epoch ms. */
export function localDateKey(now: number): string {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function computeSpend(opts: ComputeSpendOptions = {}): Promise<SpendSnapshot> {
  const now = opts.now ?? Date.now();
  const todayStartMs = localMidnightMs(now);

  const t0 = Date.now();
  const totals = await scanAllJsonl({
    projectsDir: opts.projectsDir,
    maxFiles: opts.maxFiles,
    todayStartMs,
  });
  const scanMs = Date.now() - t0;

  const lifetime = rollupCostByModel(totals.byModel);
  const today = rollupCostByModel(totals.todayByModel);

  return {
    lifetimeCents: lifetime.paidCents,
    lifetimeApiCents: lifetime.apiEquivCents,
    todayCents: today.paidCents,
    todayApiCents: today.apiEquivCents,
    todayKey: localDateKey(now),
    lifetimeMessages: totals.usageLinesScanned,
    todayMessages: totals.todayMessageCount,
    oldestTs: totals.oldestTs,
    newestTs: totals.newestTs,
    lastScanTs: now,
    scanMs,
  };
}
