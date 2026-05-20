/**
 * Isolation strategy: every test sets PETFORGE_HOME to a temp dir BEFORE
 * importing the quota CLI module (which transitively imports paths.ts and
 * captures HOME_DIR at load time). Uses vi.resetModules() + dynamic import,
 * mirroring tests/state.test.ts and tests/collect.test.ts.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

let testHome: string;
let prevHome: string | undefined;

beforeEach(async () => {
  prevHome = process.env.PETFORGE_HOME;
  testHome = await fs.mkdtemp(path.join(os.tmpdir(), "pf-quota-cli-"));
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
    // best-effort
  }
});

async function loadDeps() {
  const quotaMod = await import("../../src/commands/quota.js");
  const stateMod = await import("../../src/core/state.js");
  const schemaMod = await import("../../src/core/schema.js");
  const petMod = await import("../../src/core/pet-engine.js");
  const pathsMod = await import("../../src/core/paths.js");
  return { ...quotaMod, ...stateMod, ...schemaMod, ...petMod, ...pathsMod };
}

async function seedState() {
  const { ensurePetforgeDir, STATE_FILE, createInitialState, generatePet } = await loadDeps();
  await ensurePetforgeDir();
  const pet = generatePet({ username: "ci", hostname: "ci" });
  await fs.writeFile(STATE_FILE, JSON.stringify(createInitialState(pet, 0)), "utf8");
}

describe("petforge quota CLI", () => {
  beforeEach(async () => {
    await seedState();
  });

  it("enable: writes optIn=true after a successful probe", async () => {
    const { quotaCli, readState } = await loadDeps();
    const fetchImpl = vi.fn(
      async () =>
        new Response("{}", {
          status: 200,
          headers: {
            "anthropic-ratelimit-unified-5h-utilization": "10",
            "anthropic-ratelimit-unified-5h-reset": "1700000500",
            "anthropic-ratelimit-unified-5h-status": "allowed",
          },
        }),
    );
    const exit = await quotaCli(["enable"], {
      resolveToken: async () => ({ kind: "ok", token: "sk-x", source: "file" }),
      fetchImpl,
      now: () => 1_000,
    });
    expect(exit).toBe(0);
    const s = await readState();
    expect(s.counters.quota?.optIn).toBe(true);
    expect(s.counters.quota?.lastProbeOk).toBe(true);
    expect(s.counters.quota?.session5h?.utilization).toBe(10);
  });

  it("enable: does NOT flip optIn when probe fails", async () => {
    const { quotaCli, readState } = await loadDeps();
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 401 }));
    const exit = await quotaCli(["enable"], {
      resolveToken: async () => ({ kind: "ok", token: "sk-x", source: "file" }),
      fetchImpl,
      now: () => 1_000,
    });
    expect(exit).toBe(1);
    const s = await readState();
    expect(s.counters.quota?.optIn ?? false).toBe(false);
  });

  it("enable: errors with hint when credentials missing", async () => {
    const { quotaCli } = await loadDeps();
    const exit = await quotaCli(["enable"], {
      resolveToken: async () => ({ kind: "missing" }),
      fetchImpl: vi.fn(),
      now: () => 0,
    });
    expect(exit).toBe(1);
  });

  it("disable: flips optIn=false and zeroes samples/counters but keeps unlocks", async () => {
    const { quotaCli, readState, withStateLock } = await loadDeps();
    await withStateLock(async (s: import("../../src/core/schema.js").State) => {
      const q = s.counters.quota;
      if (!q) throw new Error();
      q.optIn = true;
      q.consecutiveEfficient = 3;
      q.marathonCount = 1;
      q.recentSamples = [{ ts: 1, utilization: 50 }];
      s.achievements.unlocked.push("quota_marathon_bronze");
    });
    const exit = await quotaCli(["disable"], { now: () => 0 });
    expect(exit).toBe(0);
    const s = await readState();
    expect(s.counters.quota?.optIn).toBe(false);
    expect(s.counters.quota?.consecutiveEfficient).toBe(0);
    expect(s.counters.quota?.marathonCount).toBe(0);
    expect(s.counters.quota?.recentSamples).toEqual([]);
    expect(s.achievements.unlocked).toContain("quota_marathon_bronze");
  });

  it("status (default): one-shot probe + print, requires opt-in", async () => {
    const { quotaCli } = await loadDeps();
    const out: string[] = [];
    const err: string[] = [];
    const exit = await quotaCli([], {
      resolveToken: async () => ({ kind: "ok", token: "sk-x", source: "file" }),
      fetchImpl: vi.fn(),
      now: () => 0,
      writeOut: (s) => out.push(s),
      writeErr: (s) => err.push(s),
    });
    expect(exit).toBe(1);
    expect(out.concat(err).join("")).toMatch(/petforge quota enable/);
  });

  it("--json: emits machine-readable quota snapshot", async () => {
    const { quotaCli, withStateLock } = await loadDeps();
    await withStateLock(async (s: import("../../src/core/schema.js").State) => {
      const q = s.counters.quota;
      if (!q) throw new Error();
      q.optIn = true;
      q.lastProbeTs = 1;
      q.session5h = { utilization: 33, resetTs: 1_700_000_500 };
      q.status = "allowed";
    });
    const out: string[] = [];
    const exit = await quotaCli(["--json"], {
      resolveToken: async () => ({ kind: "ok", token: "sk-x", source: "file" }),
      fetchImpl: vi.fn(),
      now: () => 0,
      writeOut: (s) => out.push(s),
    });
    expect(exit).toBe(0);
    const parsed = JSON.parse(out.join(""));
    expect(parsed.session5h.utilization).toBe(33);
  });
});
