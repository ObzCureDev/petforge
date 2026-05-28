import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInitialQuota,
  type QuotaState,
  QuotaStateSchema,
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
      opus7d: null,
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

  it("V3.7.1.2: accepts negative burnRatePctPerMin (5h reset window drop is legitimate)", () => {
    const q = createInitialQuota(0);
    q.burnRatePctPerMin = -0.42;
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

describe("quota state round-trip", () => {
  // Isolation is MANDATORY here: this test writes to STATE_FILE. Without a
  // temp PETFORGE_HOME, STATE_FILE resolves to the real ~/.petforge/state.json
  // and the fs.writeFile below overwrites the user's actual pet with a fresh
  // level-1 creature. That bug wiped a real pet repeatedly before this fix.
  // We set PETFORGE_HOME to a temp dir, create the .petforge subdir, and
  // re-import paths/state via vi.resetModules so STATE_FILE points at the temp.
  let testHome: string;
  let prevHome: string | undefined;

  beforeEach(async () => {
    prevHome = process.env.PETFORGE_HOME;
    testHome = await fs.mkdtemp(path.join(os.tmpdir(), "petforge-quota-schema-"));
    await fs.mkdir(path.join(testHome, ".petforge"), { recursive: true });
    process.env.PETFORGE_HOME = testHome;
    vi.resetModules();
  });

  afterEach(async () => {
    if (prevHome === undefined) {
      delete process.env.PETFORGE_HOME;
    } else {
      process.env.PETFORGE_HOME = prevHome;
    }
    try {
      await fs.rm(testHome, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  });

  it("legacy state without quota block parses and synthesizes one", async () => {
    const { STATE_FILE } = await import("../../../src/core/paths.js");
    const { generatePet } = await import("../../../src/core/pet-engine.js");
    const { createInitialState } = await import("../../../src/core/schema.js");
    const { readState, withStateLock } = await import("../../../src/core/state.js");

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
