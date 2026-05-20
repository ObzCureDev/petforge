import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

let testHome: string;
let prevHome: string | undefined;

beforeEach(async () => {
  prevHome = process.env.PETFORGE_HOME;
  testHome = await fs.mkdtemp(path.join(os.tmpdir(), "pf-quota-d-"));
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
  const quota = await import("../../src/commands/quota.js");
  const state = await import("../../src/core/state.js");
  const schema = await import("../../src/core/schema.js");
  const pet = await import("../../src/core/pet-engine.js");
  const paths = await import("../../src/core/paths.js");
  return { ...quota, ...state, ...schema, ...pet, ...paths };
}

async function seedOptIn() {
  const { ensurePetforgeDir, STATE_FILE, createInitialState, generatePet, withStateLock } =
    await loadDeps();
  await ensurePetforgeDir();
  const pet = generatePet({ username: "ci", hostname: "ci" });
  await fs.writeFile(STATE_FILE, JSON.stringify(createInitialState(pet, 0)), "utf8");
  await withStateLock(async (s: import("../../src/core/schema.js").State) => {
    const q = s.counters.quota;
    if (!q) throw new Error();
    q.optIn = true;
  });
}

describe("runQuotaDaemon", () => {
  beforeEach(async () => {
    await seedOptIn();
  });

  it("probes once when JSONL gate passes", async () => {
    const { runQuotaDaemon, readState } = await loadDeps();
    const fetchImpl = vi.fn(
      async () =>
        new Response("{}", {
          status: 200,
          headers: {
            "anthropic-ratelimit-unified-5h-utilization": "42",
            "anthropic-ratelimit-unified-5h-reset": "1700000500",
            "anthropic-ratelimit-unified-5h-status": "allowed",
          },
        }),
    );
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pf-d-"));
    await fs.mkdir(path.join(tmp, "p"), { recursive: true });
    await fs.writeFile(path.join(tmp, "p", "conv.jsonl"), "", "utf8");

    const handle = await runQuotaDaemon({
      resolveToken: async () => ({ kind: "ok", token: "sk-x", source: "file" }),
      fetchImpl,
      projectsDir: tmp,
      probeIntervalMs: 30,
      probeGateMs: 60_000,
      now: () => Date.now(),
    });
    // Poll until at least one probe completes (state.json reflects it).
    const start = Date.now();
    let observedUtil: number | undefined;
    while (Date.now() - start < 5_000) {
      const s = await readState();
      observedUtil = s.counters.quota?.session5h?.utilization;
      if (observedUtil === 42) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    await handle.close();
    expect(fetchImpl).toHaveBeenCalled();
    expect(observedUtil).toBe(42);
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("does NOT probe when JSONL gate fails", async () => {
    const { runQuotaDaemon } = await loadDeps();
    const fetchImpl = vi.fn(async () => new Response("{}"));
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pf-d-"));
    // no jsonl files
    const handle = await runQuotaDaemon({
      resolveToken: async () => ({ kind: "ok", token: "sk-x", source: "file" }),
      fetchImpl,
      projectsDir: tmp,
      probeIntervalMs: 10,
      probeGateMs: 60_000,
      now: () => Date.now(),
    });
    await new Promise((r) => setTimeout(r, 50));
    await handle.close();
    expect(fetchImpl).not.toHaveBeenCalled();
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("stops probing when opt-out is flipped at runtime", async () => {
    const { runQuotaDaemon, withStateLock } = await loadDeps();
    const fetchImpl = vi.fn(
      async () =>
        new Response("{}", {
          status: 200,
          headers: {
            "anthropic-ratelimit-unified-5h-utilization": "1",
            "anthropic-ratelimit-unified-5h-reset": "1",
            "anthropic-ratelimit-unified-5h-status": "allowed",
          },
        }),
    );
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pf-d-"));
    await fs.mkdir(path.join(tmp, "p"), { recursive: true });
    await fs.writeFile(path.join(tmp, "p", "conv.jsonl"), "", "utf8");

    const handle = await runQuotaDaemon({
      resolveToken: async () => ({ kind: "ok", token: "sk-x", source: "file" }),
      fetchImpl,
      projectsDir: tmp,
      probeIntervalMs: 30,
      probeGateMs: 60_000,
      now: () => Date.now(),
    });
    // Wait until at least one probe has fired, with timeout.
    const start = Date.now();
    while (fetchImpl.mock.calls.length === 0 && Date.now() - start < 2_000) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(fetchImpl).toHaveBeenCalled();
    // Flip opt-out and capture call count after a brief settle.
    await withStateLock(async (s: import("../../src/core/schema.js").State) => {
      const q = s.counters.quota;
      if (!q) throw new Error();
      q.optIn = false;
    });
    // Give any in-flight tick a chance to complete.
    await new Promise((r) => setTimeout(r, 100));
    const callsAfter = fetchImpl.mock.calls.length;
    // Wait for several intervals to confirm no new probes.
    await new Promise((r) => setTimeout(r, 200));
    const finalCalls = fetchImpl.mock.calls.length;
    await handle.close();
    expect(finalCalls).toBe(callsAfter);
    await fs.rm(tmp, { recursive: true, force: true });
  });
});
