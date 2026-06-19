import { describe, expect, it } from "vitest";
import {
  computeApiEquivCostCents,
  MODEL_PRICING_USD_PER_MTOK,
  pricingFor,
} from "../../src/core/otel/pricing.js";
import { createInitialOtelCounters } from "../../src/core/otel/schema.js";

describe("otel/pricing", () => {
  it("current Opus generation is $5/$25; legacy Opus stays $15/$75", () => {
    expect(MODEL_PRICING_USD_PER_MTOK["claude-opus-4-8"]).toEqual({ input: 5, output: 25 });
    expect(MODEL_PRICING_USD_PER_MTOK["claude-opus-4-7"]).toEqual({ input: 5, output: 25 });
    expect(MODEL_PRICING_USD_PER_MTOK["claude-opus-4-1"]).toEqual({ input: 15, output: 75 });
  });

  it("pricingFor falls back to the current Opus rate for an unknown model", () => {
    const p = pricingFor("claude-future-9000");
    expect(p).toEqual({ input: 5, output: 25 });
  });

  it("computeApiEquivCostCents = 0 on a fresh OTel state", () => {
    expect(computeApiEquivCostCents(createInitialOtelCounters())).toBe(0);
  });

  it("distributes cache reads/creations proportionally to per-model tokensIn share", () => {
    const o = createInitialOtelCounters();
    o.tokensIn = 0; // all input arrived as cache - the global counter doesn't matter for this calc
    o.tokensOut = 1_000_000; // 1M output tokens
    o.tokensCacheRead = 10_000_000; // 10M cache reads
    o.tokensCacheCreation = 0;
    o.modelUsage = {
      "claude-opus-4-1": { tokensIn: 100_000, tokensOut: 1_000_000, sessions: 0 },
    };
    // Without cache: 10M cache reads + 0 native input = 10M tokens at input rate.
    // At legacy Opus $15/MTok input + $75/MTok output:
    //   in_cost  = (100_000 + 10_000_000) * 15 / 1_000_000 = 151.5 USD
    //   out_cost = 1_000_000 * 75 / 1_000_000           = 75   USD
    //   total    = 226.5 USD = 22 650 cents
    expect(computeApiEquivCostCents(o)).toBe(22_650);
  });

  it("V3.7.3: real-world Dan snapshot - heavy cache, mostly Opus, API equiv > actual cost", () => {
    const o = createInitialOtelCounters();
    o.tokensIn = 1_052_316;
    o.tokensOut = 9_545_370;
    o.tokensCacheRead = 143_439_621;
    o.tokensCacheCreation = 13_954_987;
    o.costUsdCents = 40_300; // ~$403 actual (cache-discounted, Opus $5/$25)
    o.modelUsage = {
      "claude-opus-4-8": { tokensIn: 1_052_316, tokensOut: 9_545_370, sessions: 0 },
    };
    const apiEquivCents = computeApiEquivCostCents(o);
    // The no-cache API-equivalent always exceeds the cache-discounted actual
    // cost — cache reads bill at 10% in `paid` but full rate in api-equiv.
    expect(apiEquivCents).toBeGreaterThan(o.costUsdCents);
    // And finite (not NaN from div-by-zero).
    expect(Number.isFinite(apiEquivCents)).toBe(true);
  });
});
