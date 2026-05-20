/**
 * Pure function that folds a ProbeResult into a QuotaState.
 *
 * Handles: window snapshot, status, burn-rate derivation (rolling 3-sample
 * average of %/min increments between consecutive ok samples), counters
 * for `consecutiveEfficient` (incremented at session5h.resetTs rollover) and
 * `marathonCount` (incremented on 95%+ crossing edge).
 */

import type { ProbeResult } from "./probe.js";
import type { QuotaSample, QuotaState } from "./schema.js";

const SAMPLE_RING_SIZE = 3;
const EFFICIENT_THRESHOLD = 50;
const MARATHON_THRESHOLD = 95;

export function applyProbeResult(q: QuotaState, r: ProbeResult, now: number): void {
  q.lastProbeTs = now;
  if (r.kind !== "ok") {
    q.lastProbeOk = false;
    q.lastError = formatError(r);
    return;
  }
  delete q.lastError;
  q.lastProbeOk = true;

  // Window close detection (do this BEFORE overwriting session5h).
  const prevWindow = q.session5h;
  const prevReset = q.lastObservedResetTs;
  const newReset = r.session5h.resetTs;
  if (prevReset > 0 && newReset > prevReset && prevWindow !== null) {
    if (prevWindow.utilization < EFFICIENT_THRESHOLD) {
      q.consecutiveEfficient += 1;
    } else {
      q.consecutiveEfficient = 0;
    }
  }
  q.lastObservedResetTs = newReset;

  // Marathon edge detection: previous sample below threshold, new at/above.
  const prevUtil = prevWindow?.utilization ?? 0;
  if (prevUtil < MARATHON_THRESHOLD && r.session5h.utilization >= MARATHON_THRESHOLD) {
    q.marathonCount += 1;
  }

  // Commit window/status.
  q.session5h = r.session5h;
  q.weekly7d = r.weekly7d;
  q.status = r.status;

  // Push sample + recompute burn rate.
  q.recentSamples.push({ ts: now, utilization: r.session5h.utilization });
  while (q.recentSamples.length > SAMPLE_RING_SIZE) q.recentSamples.shift();
  q.burnRatePctPerMin = computeBurnRate(q.recentSamples);
}

function computeBurnRate(samples: QuotaSample[]): number {
  if (samples.length < 2) return 0;
  let totalPct = 0;
  let totalMin = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (!a || !b) continue;
    const dPct = b.utilization - a.utilization;
    const dMin = (b.ts - a.ts) / 60_000;
    if (dMin <= 0) continue;
    totalPct += dPct;
    totalMin += dMin;
  }
  if (totalMin <= 0) return 0;
  return totalPct / totalMin;
}

function formatError(r: Exclude<ProbeResult, { kind: "ok" }>): string {
  switch (r.kind) {
    case "auth-error":
      return `auth-error (HTTP ${r.httpStatus}) - credentials may have expired`;
    case "rate-limited":
      return r.retryAfterSec !== undefined
        ? `rate-limited - retry after ${r.retryAfterSec}s`
        : "rate-limited";
    case "server-error":
      return `server-error (HTTP ${r.httpStatus})`;
    case "network-error":
      return `network-error: ${r.cause}`;
  }
}
