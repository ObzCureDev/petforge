/**
 * OTel counters schema — types and Zod validators for the
 * `state.counters.otel` block introduced in V2.0.
 *
 * This block is independent of V1 hook counters. It is populated by the
 * `petforge collect` daemon (Task 6) from cumulative-delta aggregation
 * over Claude Code OTel metrics, and is gated on `lastUpdate > 0` for
 * achievement evaluation (Task 5).
 */

import { z } from "zod";

export interface ModelUsage {
  tokensIn: number;
  tokensOut: number;
  sessions: number;
}

export interface OtelCounters {
  linesAdded: number;
  linesRemoved: number;
  tokensIn: number;
  tokensOut: number;
  tokensCacheRead: number;
  tokensCacheCreation: number;
  costUsdCents: number;
  editsAccepted: number;
  editsRejected: number;
  toolDecisionsAccepted: number;
  toolDecisionsRejected: number;
  commitCount: number;
  prCount: number;
  apiErrorCount: number;
  modelUsage: Record<string, ModelUsage>;
  lastUpdate: number;
  ingesterStarted: number;
}

const nn = z.number().nonnegative();

export const ModelUsageSchema = z.object({
  tokensIn: nn,
  tokensOut: nn,
  sessions: nn,
});

export const OtelCountersSchema = z.object({
  linesAdded: nn,
  linesRemoved: nn,
  tokensIn: nn,
  tokensOut: nn,
  tokensCacheRead: nn,
  tokensCacheCreation: nn,
  costUsdCents: nn,
  editsAccepted: nn,
  editsRejected: nn,
  toolDecisionsAccepted: nn,
  toolDecisionsRejected: nn,
  commitCount: nn,
  prCount: nn,
  apiErrorCount: nn,
  modelUsage: z.record(z.string(), ModelUsageSchema),
  lastUpdate: nn,
  ingesterStarted: nn,
});

export function createInitialOtelCounters(): OtelCounters {
  return {
    linesAdded: 0,
    linesRemoved: 0,
    tokensIn: 0,
    tokensOut: 0,
    tokensCacheRead: 0,
    tokensCacheCreation: 0,
    costUsdCents: 0,
    editsAccepted: 0,
    editsRejected: 0,
    toolDecisionsAccepted: 0,
    toolDecisionsRejected: 0,
    commitCount: 0,
    prCount: 0,
    apiErrorCount: 0,
    modelUsage: {},
    lastUpdate: 0,
    ingesterStarted: 0,
  };
}
