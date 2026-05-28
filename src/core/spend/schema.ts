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
