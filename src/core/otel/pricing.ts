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
 * snapshot, USD per million tokens). The current Opus generation
 * (4.5–4.8) bills its 1M-context window at the standard rate — there
 * is no long-context premium (the old [1m] 2x tier is retired).
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
  // Current Opus generation (4.5–4.8): $5 / $25 per MTok. The 1M-context
  // window is billed at this standard rate — no long-context premium.
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-opus-4-5": { input: 5, output: 25 },
  // Legacy Opus (4.0 / 4.1): still $15 / $75.
  "claude-opus-4-1": { input: 15, output: 75 },
  "claude-opus-4-20250514": { input: 15, output: 75 },
  // Sonnet 4.x
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  // Haiku 4.5
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/** Fallback when an unknown model arrives - assume the current Opus rate. */
const UNKNOWN_MODEL_PRICING: ModelPricing = { input: 5, output: 25 };

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
