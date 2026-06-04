/**
 * Pure-function tests for the additive lifetime accumulator. Touches no
 * filesystem, so it's safe to run regardless of PETFORGE_HOME isolation.
 */

import { describe, expect, it } from "vitest";
import {
  applySpendDelta,
  persistedTotalApiCents,
  persistedTotalCents,
  persistedTotalMessages,
  type SpendDelta,
} from "../../../src/core/spend/compute.js";
import { createInitialPersistedSpend } from "../../../src/core/spend/schema.js";

const DELTA_EMPTY: SpendDelta = { deltaCents: 0, deltaApiCents: 0, deltaMessages: 0 };

function delta(c: number, api: number, msgs: number): SpendDelta {
  return { deltaCents: c, deltaApiCents: api, deltaMessages: msgs };
}

describe("applySpendDelta", () => {
  const now1 = 1_700_000_000_000;
  const now2 = 1_700_086_400_000; // +1 day

  it("bootstraps from a missing PersistedSpend by seeding from the delta", () => {
    const next = applySpendDelta(undefined, delta(5000, 30000, 100), 1_700_000_500_000, now1);
    expect(next.accumulatedCents).toBe(5000);
    expect(next.accumulatedApiCents).toBe(30000);
    expect(next.accumulatedMessages).toBe(100);
    expect(next.baselineCents).toBe(0);
    expect(next.lastSeenNewestTs).toBe(1_700_000_500_000);
    expect(next.firstScanTs).toBe(now1);
    expect(next.lastUpdatedTs).toBe(now1);
  });

  it("adds non-empty deltas onto the existing accumulator", () => {
    const prev = applySpendDelta(undefined, delta(5000, 30000, 100), 100, now1);
    const next = applySpendDelta(prev, delta(1500, 9000, 30), 200, now2);
    expect(next.accumulatedCents).toBe(6500);
    expect(next.accumulatedApiCents).toBe(39000);
    expect(next.accumulatedMessages).toBe(130);
    expect(next.lastSeenNewestTs).toBe(200);
    expect(next.lastUpdatedTs).toBe(now2);
    // firstScanTs is preserved from the bootstrap call.
    expect(next.firstScanTs).toBe(now1);
  });

  it("treats a zero-message delta as a heartbeat (no accumulation, only lastUpdatedTs)", () => {
    const prev = applySpendDelta(undefined, delta(5000, 30000, 100), 100, now1);
    const next = applySpendDelta(prev, DELTA_EMPTY, 100, now2);
    expect(next.accumulatedCents).toBe(5000);
    expect(next.accumulatedMessages).toBe(100);
    expect(next.lastSeenNewestTs).toBe(100); // unchanged
    expect(next.lastUpdatedTs).toBe(now2);
  });

  it("never rewinds the watermark when a scan reports an older newestTs", () => {
    const prev = applySpendDelta(undefined, delta(5000, 30000, 100), 200, now1);
    // Simulated out-of-order scan with an older newestTs but a real delta
    // (could happen if the JSONL fs racing produces inconsistent reads).
    const next = applySpendDelta(prev, delta(100, 600, 1), 150, now2);
    expect(next.lastSeenNewestTs).toBe(200); // unchanged - watermark only grows
    expect(next.accumulatedCents).toBe(5100);
  });

  it("preserves baseline + firstScanTs through repeated updates", () => {
    const seeded = createInitialPersistedSpend(now1);
    seeded.baselineCents = 1_000_000;
    seeded.baselineApiCents = 5_000_000;
    seeded.baselineMessages = 50_000;
    const next = applySpendDelta(seeded, delta(200, 1200, 5), 100, now2);
    expect(next.baselineCents).toBe(1_000_000);
    expect(next.baselineApiCents).toBe(5_000_000);
    expect(next.baselineMessages).toBe(50_000);
    expect(next.firstScanTs).toBe(now1);
    expect(next.accumulatedCents).toBe(200);
  });
});

describe("persistedTotal helpers", () => {
  const seed = createInitialPersistedSpend(0);
  it("sums baseline + accumulated", () => {
    const p = { ...seed, baselineCents: 100, accumulatedCents: 50 };
    expect(persistedTotalCents(p)).toBe(150);
  });
  it("works for API and message totals too", () => {
    const p = {
      ...seed,
      baselineApiCents: 999,
      accumulatedApiCents: 1,
      baselineMessages: 7,
      accumulatedMessages: 3,
    };
    expect(persistedTotalApiCents(p)).toBe(1000);
    expect(persistedTotalMessages(p)).toBe(10);
  });
});
