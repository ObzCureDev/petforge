/**
 * Spend snapshot schema — corrected lifetime + real "today" cost.
 *
 * Unlike every other counter, a SpendSnapshot is NEVER persisted to
 * state.json by hooks. It is computed in-process by `petforge serve`
 * (by scanning ~/.claude/projects JSONL) and injected into the streamed
 * state object so the web view can render it. Adding it here gives
 * `renderPage` a typed field and keeps the State schema tolerant if a
 * streamed object is ever re-validated.
 *
 * All cost figures are in integer cents. "Lifetime" mirrors
 * `petforge history` (full JSONL scan, cache-discounted + API-equivalent).
 * "Today" is the subset of messages timestamped at/after local midnight.
 */

import { z } from "zod";

export interface SpendSnapshot {
  /** Actual cache-discounted lifetime spend, cents. */
  lifetimeCents: number;
  /** Lifetime spend at the no-cache API rate, cents. */
  lifetimeApiCents: number;
  /** Actual cache-discounted spend since local midnight, cents. */
  todayCents: number;
  /** Today's spend at the no-cache API rate, cents. */
  todayApiCents: number;
  /** Local date the "today" figures cover, YYYY-MM-DD. */
  todayKey: string;
  /** Assistant messages counted into the lifetime figure. */
  lifetimeMessages: number;
  /** Assistant messages counted into the today figure. */
  todayMessages: number;
  /** Epoch ms of the earliest message seen. */
  oldestTs: number;
  /** Epoch ms of the latest message seen. */
  newestTs: number;
  /** Epoch ms the producing scan finished. */
  lastScanTs: number;
  /** Wall-clock duration of the producing scan, ms. */
  scanMs: number;
}

const nn = z.number().nonnegative();

export const SpendSnapshotSchema = z.object({
  lifetimeCents: nn,
  lifetimeApiCents: nn,
  todayCents: nn,
  todayApiCents: nn,
  todayKey: z.string(),
  lifetimeMessages: nn,
  todayMessages: nn,
  oldestTs: nn,
  newestTs: nn,
  lastScanTs: nn,
  scanMs: nn,
});

/**
 * V3.7.8 - additive persisted lifetime.
 *
 * The "lifetime" figure derived from a fresh `~/.claude/projects` scan
 * shrinks over time as Claude Code archives old JSONL files. This block
 * is the user's TRUE all-time spend tracked across scans: each scan
 * computes the delta of messages newer than `lastSeenNewestTs` and adds
 * that delta to the running totals here. Numbers only ever grow.
 *
 * `baselineCents` / `baselineApiCents` are an optional manual offset for
 * pre-V3.7.8 activity that's no longer on disk (set via
 * `petforge spend baseline`). The reported "true lifetime" is
 * `baseline + accumulated`.
 */
export interface PersistedSpend {
  /** Sum of message deltas observed across all scans, paid (cache-discounted). */
  accumulatedCents: number;
  /** Same, but at the no-cache API rate. */
  accumulatedApiCents: number;
  /** Manual one-shot offset for activity that disappeared before V3.7.8. */
  baselineCents: number;
  /** Manual offset at the API-equivalent rate. */
  baselineApiCents: number;
  /** Sum of message counts observed across deltas. */
  accumulatedMessages: number;
  /** Manual offset for message count. */
  baselineMessages: number;
  /**
   * Epoch ms of the newest assistant message observed in the most recent
   * scan. The next scan's `sinceTs` is set to this value so that only
   * strictly newer messages contribute to the delta.
   */
  lastSeenNewestTs: number;
  /** Epoch ms of the first scan that wrote into this block. Informational. */
  firstScanTs: number;
  /** Epoch ms of the most recent successful delta write. Informational. */
  lastUpdatedTs: number;
}

export const PersistedSpendSchema = z.object({
  accumulatedCents: nn,
  accumulatedApiCents: nn,
  baselineCents: nn,
  baselineApiCents: nn,
  accumulatedMessages: nn,
  baselineMessages: nn,
  lastSeenNewestTs: nn,
  firstScanTs: nn,
  lastUpdatedTs: nn,
});

export function createInitialPersistedSpend(now: number): PersistedSpend {
  return {
    accumulatedCents: 0,
    accumulatedApiCents: 0,
    baselineCents: 0,
    baselineApiCents: 0,
    accumulatedMessages: 0,
    baselineMessages: 0,
    lastSeenNewestTs: 0,
    firstScanTs: now,
    lastUpdatedTs: now,
  };
}
