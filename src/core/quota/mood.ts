/**
 * Map quota state to a 3-level mood label. Pure, unit-testable. The web view
 * and Ink card both consume this and the existing activity-derived mood,
 * preferring the quota mood iff it returns "stressed" or "panic" (spec
 * §"Mood derivation").
 */

import type { QuotaState } from "./schema.js";

export type QuotaMood = "calm" | "stressed" | "panic";

const STRESSED_PCT = 80;
const PANIC_PCT = 95;

export function deriveQuotaMood(q: QuotaState): QuotaMood {
  if (!q.optIn || !q.lastProbeOk || !q.session5h) return "calm";
  if (q.session5h.utilization >= PANIC_PCT || q.status === "denied") return "panic";
  if (q.session5h.utilization >= STRESSED_PCT || q.status === "allowed_warning") return "stressed";
  return "calm";
}
