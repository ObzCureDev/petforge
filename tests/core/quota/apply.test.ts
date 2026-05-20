import { describe, expect, it } from "vitest";
import { applyProbeResult } from "../../../src/core/quota/apply.js";
import type { ProbeResult } from "../../../src/core/quota/probe.js";
import { createInitialQuota } from "../../../src/core/quota/schema.js";

describe("quota/apply", () => {
  it("sets session/weekly + status + ts on success", () => {
    const q = createInitialQuota(0);
    q.optIn = true;
    const ok: ProbeResult = {
      kind: "ok",
      session5h: { utilization: 40, resetTs: 1_700_000_500 },
      weekly7d: { utilization: 20, resetTs: 1_700_600_000 },
      status: "allowed",
    };
    applyProbeResult(q, ok, 1_000_000);
    expect(q.session5h).toEqual(ok.session5h);
    expect(q.weekly7d).toEqual(ok.weekly7d);
    expect(q.status).toBe("allowed");
    expect(q.lastProbeOk).toBe(true);
    expect(q.lastProbeTs).toBe(1_000_000);
    expect(q.lastError).toBeUndefined();
    expect(q.recentSamples).toEqual([{ ts: 1_000_000, utilization: 40 }]);
  });

  it("flags lastProbeOk = false and stores lastError on auth-error", () => {
    const q = createInitialQuota(0);
    q.optIn = true;
    applyProbeResult(q, { kind: "auth-error", httpStatus: 401 }, 5);
    expect(q.lastProbeOk).toBe(false);
    expect(q.lastError).toContain("401");
    expect(q.lastProbeTs).toBe(5);
  });

  it("keeps prior session/weekly snapshot on failure (do not zero out)", () => {
    const q = createInitialQuota(0);
    q.optIn = true;
    q.session5h = { utilization: 50, resetTs: 1 };
    applyProbeResult(q, { kind: "server-error", httpStatus: 500 }, 5);
    expect(q.session5h).toEqual({ utilization: 50, resetTs: 1 });
  });

  it("computes burnRatePctPerMin from 3 samples", () => {
    const q = createInitialQuota(0);
    q.optIn = true;
    const t0 = 1_000_000;
    const sec = 1_000;
    applyProbeResult(q, mkOk(10, 100), t0);
    applyProbeResult(q, mkOk(15, 100), t0 + 60 * sec); // +5 pct / 1 min
    applyProbeResult(q, mkOk(25, 100), t0 + 120 * sec); // +10 pct / 1 min
    // avg of (5, 10) per minute step = 7.5
    expect(q.burnRatePctPerMin).toBeCloseTo(7.5, 1);
    expect(q.recentSamples).toHaveLength(3);
  });

  it("drops oldest sample beyond 3", () => {
    const q = createInitialQuota(0);
    q.optIn = true;
    for (let i = 0; i < 5; i++) {
      applyProbeResult(q, mkOk(i * 5, 100), i * 60_000);
    }
    expect(q.recentSamples).toHaveLength(3);
    expect(q.recentSamples[0]?.utilization).toBe(10); // 0,1 dropped
  });

  it("increments consecutiveEfficient when 5h window closes with util < 50", () => {
    const q = createInitialQuota(0);
    q.optIn = true;
    applyProbeResult(q, mkOk(30, 100), 1_000);
    // window not yet rolled
    expect(q.consecutiveEfficient).toBe(0);
    // resetTs advances -> window closed; previous util was 30 < 50 -> +1
    applyProbeResult(q, mkOk(0, 200), 2_000);
    expect(q.consecutiveEfficient).toBe(1);
  });

  it("resets consecutiveEfficient when window closes with util >= 50", () => {
    const q = createInitialQuota(0);
    q.optIn = true;
    q.consecutiveEfficient = 4;
    applyProbeResult(q, mkOk(80, 100), 1_000);
    applyProbeResult(q, mkOk(0, 200), 2_000);
    expect(q.consecutiveEfficient).toBe(0);
  });

  it("increments marathonCount once per probe that crosses 95%", () => {
    const q = createInitialQuota(0);
    q.optIn = true;
    applyProbeResult(q, mkOk(80, 100), 1_000);
    expect(q.marathonCount).toBe(0);
    applyProbeResult(q, mkOk(95, 100), 1_001);
    expect(q.marathonCount).toBe(1);
    // Stays at 1 while still above 95 in same window
    applyProbeResult(q, mkOk(97, 100), 1_002);
    expect(q.marathonCount).toBe(1);
    // Drops below, then crosses again -> +1
    applyProbeResult(q, mkOk(80, 100), 1_003);
    applyProbeResult(q, mkOk(96, 100), 1_004);
    expect(q.marathonCount).toBe(2);
  });
});

function mkOk(util: number, resetTs: number): ProbeResult {
  return {
    kind: "ok",
    session5h: { utilization: util, resetTs },
    weekly7d: null,
    status: "allowed",
  };
}
