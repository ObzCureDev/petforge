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
import type { PersistedSpend, SpendSnapshot } from "./schema.js";

export interface ComputeSpendOptions {
  projectsDir?: string;
  /** Override "now" for deterministic tests. Defaults to Date.now(). */
  now?: number;
  /** Hard cap on JSONL files visited (passed through to the scanner). */
  maxFiles?: number;
  /**
   * V3.7.8 - epoch ms watermark from the previous scan's `newestTs`. When set,
   * the scan also accumulates messages with `ts > sinceTs` into a separate
   * bucket priced as `delta*` on the returned snapshot.
   */
  sinceTs?: number;
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

/**
 * V3.7.8 - delta scan result for the persistent additive lifetime.
 * `deltaCents` is the cost of messages observed in the current scan with
 * `ts > sinceTs`. Add to the persisted accumulator to get the new running
 * lifetime; advance the watermark to the snapshot's `newestTs`.
 */
export interface SpendDelta {
  deltaCents: number;
  deltaApiCents: number;
  deltaMessages: number;
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

/**
 * V3.7.8 - one-pass scan that computes BOTH the render-only snapshot AND
 * the delta of messages newer than `sinceTs`. The daemon calls this so
 * that the persisted-lifetime update can ride the same scan as the
 * web-view snapshot — there's no benefit to scanning twice.
 */
export async function computeSpendWithDelta(
  sinceTs: number,
  opts: ComputeSpendOptions = {},
): Promise<{ snapshot: SpendSnapshot; delta: SpendDelta }> {
  const now = opts.now ?? Date.now();
  const todayStartMs = localMidnightMs(now);

  const t0 = Date.now();
  const totals = await scanAllJsonl({
    projectsDir: opts.projectsDir,
    maxFiles: opts.maxFiles,
    todayStartMs,
    sinceTs,
  });
  const scanMs = Date.now() - t0;

  const lifetime = rollupCostByModel(totals.byModel);
  const today = rollupCostByModel(totals.todayByModel);
  const delta = rollupCostByModel(totals.sinceByModel);

  const snapshot: SpendSnapshot = {
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

  return {
    snapshot,
    delta: {
      deltaCents: delta.paidCents,
      deltaApiCents: delta.apiEquivCents,
      deltaMessages: totals.sinceMessageCount,
    },
  };
}

/**
 * Pure function: apply a scan delta to a (possibly missing) persisted block.
 * Bootstraps a fresh PersistedSpend when none exists (initializes the
 * watermark to the snapshot's newestTs so the very first scan contributes
 * its full lifetime, then subsequent scans only add new messages).
 *
 * Returns the next PersistedSpend state. Pure; the caller writes it via
 * `withStateLock`.
 */
export function applySpendDelta(
  prev: PersistedSpend | undefined,
  delta: SpendDelta,
  snapshotNewestTs: number,
  now: number,
): PersistedSpend {
  if (!prev) {
    // First-ever scan with no persisted state. Seed accumulated with the
    // delta (which equals the full lifetime when sinceTs was 0) and lock
    // the watermark in so subsequent scans don't double-count.
    return {
      accumulatedCents: delta.deltaCents,
      accumulatedApiCents: delta.deltaApiCents,
      baselineCents: 0,
      baselineApiCents: 0,
      accumulatedMessages: delta.deltaMessages,
      baselineMessages: 0,
      lastSeenNewestTs: snapshotNewestTs,
      firstScanTs: now,
      lastUpdatedTs: now,
    };
  }
  if (delta.deltaMessages === 0) {
    // Nothing new to integrate; still advance lastUpdatedTs so callers can
    // distinguish "stale daemon" from "nothing happened".
    return { ...prev, lastUpdatedTs: now };
  }
  return {
    ...prev,
    accumulatedCents: prev.accumulatedCents + delta.deltaCents,
    accumulatedApiCents: prev.accumulatedApiCents + delta.deltaApiCents,
    accumulatedMessages: prev.accumulatedMessages + delta.deltaMessages,
    // Only advance the watermark; never rewind (defensive against an
    // out-of-order scan reporting an older newestTs).
    lastSeenNewestTs: Math.max(prev.lastSeenNewestTs, snapshotNewestTs),
    lastUpdatedTs: now,
  };
}

/** True lifetime = baseline + accumulated. Convenience for renderers. */
export function persistedTotalCents(p: PersistedSpend): number {
  return p.baselineCents + p.accumulatedCents;
}

export function persistedTotalApiCents(p: PersistedSpend): number {
  return p.baselineApiCents + p.accumulatedApiCents;
}

export function persistedTotalMessages(p: PersistedSpend): number {
  return p.baselineMessages + p.accumulatedMessages;
}
