/**
 * Pricing table + API-equivalent cost computation.
 *
 * The OTel `costUsdCents` counter tracks the ACTUAL cost Anthropic charged
 * (with prompt-cache discounts: cache reads cost 10% of input, cache writes
 * cost 125%). For users on Pro/Max subscription plans, this is the
 * notional metered cost - they pay a flat monthly fee instead.
 *
 * `computeApiEquivCostCents` returns the HYPOTHETICAL cost if every
 * single token had been billed at standard API rates with zero cache
 * discount: all input + cacheRead + cacheCreation tokens charged at the
 * input rate, output at the output rate. This is what Dan's IDE addon
 * shows under "Recent Sessions" and what most third-party usage trackers
 * call "API equivalent" or "raw spend."
 *
 * The delta (api_equiv - costUsdCents) is the cache savings: how much
 * the user "would have paid" without prompt caching. Useful as a
 * sanity-check on subscription value vs API direct.
 *
 * Pricing is sourced from Anthropic's public pricing page (2026-Q2
 * snapshot, USD per million tokens). The 1M-context Opus variants
 * carry a 2x premium per Anthropic's long-context tier.
 */

import type { OtelCounters } from "./schema.js";

export interface ModelPricing {
  /** USD per million input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
}

/**
 * Anthropic pricing snapshot (USD per MTok). Update when Anthropic
 * adjusts public rates. Keys match what arrives via OTel `gen_ai.request.model`.
 */
export const MODEL_PRICING_USD_PER_MTOK: Record<string, ModelPricing> = {
  // Opus 4.x family
  "claude-opus-4-7": { input: 15, output: 75 },
  "claude-opus-4-6": { input: 15, output: 75 },
  "claude-opus-4-5": { input: 15, output: 75 },
  // 1M-context Opus variants - 2x premium per Anthropic tier
  "claude-opus-4-7[1m]": { input: 30, output: 150 },
  "claude-opus-4-6[1m]": { input: 30, output: 150 },
  // Sonnet 4.x
  "claude-sonnet-4-7": { input: 3, output: 15 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  // Haiku 4.x
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
  "claude-haiku-4-5": { input: 0.8, output: 4 },
};

/** Fallback when an unknown model arrives - assume Opus (overcounts safely). */
const UNKNOWN_MODEL_PRICING: ModelPricing = { input: 15, output: 75 };

export function pricingFor(modelName: string): ModelPricing {
  return MODEL_PRICING_USD_PER_MTOK[modelName] ?? UNKNOWN_MODEL_PRICING;
}

/**
 * API-equivalent cost in cents.
 *
 * Cache reads and cache creations are redistributed across models
 * proportionally to each model's tokensIn share (we have no per-model
 * cache breakdown in the OTel feed - only globals + per-model in/out).
 * Each model then bills as if all its input + share-of-cache had been
 * regular input tokens at full rate.
 */
export function computeApiEquivCostCents(otel: OtelCounters): number {
  const models = otel.modelUsage ?? {};
  const totalInputAllModels = Object.values(models).reduce((acc, m) => acc + (m?.tokensIn ?? 0), 0);

  // Edge case: no per-model breakdown at all - assume Opus for everything.
  if (totalInputAllModels === 0) {
    const p = UNKNOWN_MODEL_PRICING;
    const inputAll = otel.tokensIn + otel.tokensCacheRead + otel.tokensCacheCreation;
    const usd = (inputAll * p.input) / 1_000_000 + (otel.tokensOut * p.output) / 1_000_000;
    return Math.round(usd * 100);
  }

  let usd = 0;
  for (const [name, usage] of Object.entries(models)) {
    if (!usage) continue;
    const p = pricingFor(name);
    const share = usage.tokensIn / totalInputAllModels;
    const cacheReadShare = otel.tokensCacheRead * share;
    const cacheCreationShare = otel.tokensCacheCreation * share;
    const apiInputTokens = usage.tokensIn + cacheReadShare + cacheCreationShare;
    usd += (apiInputTokens * p.input) / 1_000_000;
    usd += (usage.tokensOut * p.output) / 1_000_000;
  }
  return Math.round(usd * 100);
}
