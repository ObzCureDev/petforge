import { describe, expect, it } from "vitest";
import {
  createInitialQuota,
  QuotaStateSchema,
  type QuotaState,
} from "../../../src/core/quota/schema.js";

describe("quota/schema", () => {
  it("creates a valid initial quota state", () => {
    const q = createInitialQuota(1_700_000_000_000);
    expect(QuotaStateSchema.safeParse(q).success).toBe(true);
    expect(q.optIn).toBe(false);
    expect(q.session5h).toBeNull();
    expect(q.weekly7d).toBeNull();
    expect(q.consecutiveEfficient).toBe(0);
    expect(q.marathonCount).toBe(0);
    expect(q.lastObservedResetTs).toBe(0);
    expect(q.lastProbeTs).toBe(0);
    expect(q.lastProbeOk).toBe(false);
    expect(q.daemonStarted).toBe(1_700_000_000_000);
    expect(q.recentSamples).toEqual([]);
    expect(q.burnRatePctPerMin).toBe(0);
    expect(q.status).toBe("");
  });

  it("validates a populated quota state", () => {
    const q: QuotaState = {
      optIn: true,
      session5h: { utilization: 42, resetTs: 1_700_000_500 },
      weekly7d: { utilization: 20, resetTs: 1_700_600_000 },
      status: "allowed",
      burnRatePctPerMin: 0.3,
      recentSamples: [{ ts: 1, utilization: 40 }],
      lastProbeTs: 100,
      lastProbeOk: true,
      daemonStarted: 50,
      consecutiveEfficient: 3,
      marathonCount: 0,
      lastObservedResetTs: 1_700_000_500,
    };
    expect(QuotaStateSchema.safeParse(q).success).toBe(true);
  });

  it("rejects negative utilization", () => {
    const q = createInitialQuota(0);
    (q as unknown as { session5h: { utilization: number; resetTs: number } }).session5h = {
      utilization: -1,
      resetTs: 0,
    };
    expect(QuotaStateSchema.safeParse(q).success).toBe(false);
  });
});

import { readState, withStateLock } from "../../../src/core/state.js";
import { generatePet } from "../../../src/core/pet-engine.js";
import { createInitialState } from "../../../src/core/schema.js";
import { promises as fs } from "node:fs";
import { STATE_FILE } from "../../../src/core/paths.js";

describe("quota state round-trip", () => {
  it("legacy state without quota block parses and synthesizes one", async () => {
    const pet = generatePet({ username: "test", hostname: "ci" });
    const legacy = createInitialState(pet, 0);
    delete (legacy.counters as { quota?: unknown }).quota;
    await fs.writeFile(STATE_FILE, JSON.stringify(legacy), "utf8");
    const loaded = await readState();
    expect(loaded.counters.quota).toBeUndefined();
    await withStateLock(async (s) => {
      expect(s.counters.quota).toBeDefined();
      expect(s.counters.quota?.optIn).toBe(false);
    });
  });
});
