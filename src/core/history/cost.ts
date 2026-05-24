/**
 * Cost rollup for HistoricalTotals.
 *
 * Two cents-denominated figures per model and overall:
 *   - paidCents:    actual cost the user would owe Anthropic via the API,
 *                   honoring prompt-cache discounts (cache_read at 10% of
 *                   input rate, cache_creation at 125%).
 *   - apiEquivCents: cost if there had been no cache discount at all -
 *                   every input + cache_read + cache_creation token billed
 *                   at the standard input rate. Output unchanged.
 *
 * delta = apiEquivCents - paidCents = the cache savings.
 */

import { pricingFor } from "../otel/pricing.js";
import type { HistoricalTotals, ModelUsage } from "./scanner.js";

/** Cache discounts vs the standard input rate. */
const CACHE_READ_RATIO = 0.1; // 10% of input price per Anthropic
const CACHE_CREATION_RATIO = 1.25; // 125% (premium for cache write)

export interface CostBreakdown {
  paidCents: number;
  apiEquivCents: number;
  savedCents: number;
  /** apiEquivCents / paidCents - useful sanity ratio. */
  multiplier: number;
}

export interface PerModelCost extends CostBreakdown {
  model: string;
  tokens: ModelUsage;
}

export interface HistoricalCostReport {
  total: CostBreakdown;
  byModel: PerModelCost[];
}

function costFor(model: string, u: ModelUsage): CostBreakdown {
  const p = pricingFor(model);
  // Standard API rate for everything (no cache discount).
  const apiInputTokens = u.tokensIn + u.cacheRead + u.cacheCreation;
  const apiEquivUsd =
    (apiInputTokens * p.input) / 1_000_000 + (u.tokensOut * p.output) / 1_000_000;

  // Real Anthropic billing with cache discount applied.
  const paidUsd =
    (u.tokensIn * p.input) / 1_000_000 +
    (u.cacheRead * p.input * CACHE_READ_RATIO) / 1_000_000 +
    (u.cacheCreation * p.input * CACHE_CREATION_RATIO) / 1_000_000 +
    (u.tokensOut * p.output) / 1_000_000;

  const paidCents = Math.round(paidUsd * 100);
  const apiEquivCents = Math.round(apiEquivUsd * 100);
  return {
    paidCents,
    apiEquivCents,
    savedCents: apiEquivCents - paidCents,
    multiplier: paidCents > 0 ? apiEquivCents / paidCents : 0,
  };
}

export function rollupCost(h: HistoricalTotals): HistoricalCostReport {
  const byModel: PerModelCost[] = Object.entries(h.byModel).map(([model, u]) => ({
    model,
    tokens: u,
    ...costFor(model, u),
  }));
  byModel.sort((a, b) => b.apiEquivCents - a.apiEquivCents);
  const total: CostBreakdown = byModel.reduce(
    (acc, m) => ({
      paidCents: acc.paidCents + m.paidCents,
      apiEquivCents: acc.apiEquivCents + m.apiEquivCents,
      savedCents: acc.savedCents + m.savedCents,
      multiplier: 0,
    }),
    { paidCents: 0, apiEquivCents: 0, savedCents: 0, multiplier: 0 },
  );
  total.multiplier = total.paidCents > 0 ? total.apiEquivCents / total.paidCents : 0;
  return { total, byModel };
}
