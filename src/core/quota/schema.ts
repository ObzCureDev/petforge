/**
 * Quota tracking schema — V3.7.
 *
 * Mirrors spec §"QuotaState schema". Additive to state.counters.quota.
 * V3.6 state files parse unchanged (the parent schema marks `quota` optional);
 * `ensureQuotaCounters()` in state.ts synthesizes a fresh block when absent.
 */

import { z } from "zod";

export interface QuotaWindow {
  /** 0-100, from anthropic-ratelimit-unified-{5h|7d}-utilization. */
  utilization: number;
  /** Unix seconds, from anthropic-ratelimit-unified-{5h|7d}-reset. */
  resetTs: number;
}

export interface QuotaSample {
  /** epoch ms */
  ts: number;
  utilization: number;
}

export interface QuotaState {
  optIn: boolean;
  session5h: QuotaWindow | null;
  weekly7d: QuotaWindow | null;
  status: string;
  burnRatePctPerMin: number;
  recentSamples: QuotaSample[];
  lastProbeTs: number;
  lastProbeOk: boolean;
  lastError?: string;
  daemonStarted: number;
  consecutiveEfficient: number;
  marathonCount: number;
  lastObservedResetTs: number;
}

const nn = z.number().nonnegative();

export const QuotaWindowSchema = z.object({
  utilization: nn,
  resetTs: nn,
});

export const QuotaSampleSchema = z.object({
  ts: nn,
  utilization: nn,
});

export const QuotaStateSchema = z.object({
  optIn: z.boolean(),
  session5h: QuotaWindowSchema.nullable(),
  weekly7d: QuotaWindowSchema.nullable(),
  status: z.string(),
  burnRatePctPerMin: nn,
  recentSamples: z.array(QuotaSampleSchema),
  lastProbeTs: nn,
  lastProbeOk: z.boolean(),
  lastError: z.string().optional(),
  daemonStarted: nn,
  consecutiveEfficient: nn,
  marathonCount: nn,
  lastObservedResetTs: nn,
});

export function createInitialQuota(now: number = Date.now()): QuotaState {
  return {
    optIn: false,
    session5h: null,
    weekly7d: null,
    status: "",
    burnRatePctPerMin: 0,
    recentSamples: [],
    lastProbeTs: 0,
    lastProbeOk: false,
    daemonStarted: now,
    consecutiveEfficient: 0,
    marathonCount: 0,
    lastObservedResetTs: 0,
  };
}
