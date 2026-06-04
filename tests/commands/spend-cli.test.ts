/**
 * `petforge spend` / `petforge spend baseline` CLI tests.
 *
 * Isolated via PETFORGE_HOME + vi.resetModules + dynamic import - the exact
 * pattern that prevents the V3.7.5/V3.7.7-class wipe (no static STATE_FILE
 * frozen at file-module load).
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let testHome: string;
let prevHome: string | undefined;

beforeEach(async () => {
  prevHome = process.env.PETFORGE_HOME;
  testHome = await fs.mkdtemp(path.join(os.tmpdir(), "pf-spend-cli-"));
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

async function loadDeps() {
  const spend = await import("../../src/commands/spend.js");
  const state = await import("../../src/core/state.js");
  const schema = await import("../../src/core/schema.js");
  const pet = await import("../../src/core/pet-engine.js");
  const paths = await import("../../src/core/paths.js");
  return { ...spend, ...state, ...schema, ...pet, ...paths };
}

async function seedState(deps: Awaited<ReturnType<typeof loadDeps>>) {
  // Initial state has to be written to disk directly — withStateLock reads
  // before mutating and throws StateNotFoundError on an empty home.
  await deps.ensurePetforgeDir();
  const pet = deps.generatePet({ username: "ci", hostname: "ci" });
  const initial = deps.createInitialState(pet, 0);
  await fs.writeFile(deps.STATE_FILE, JSON.stringify(initial), "utf8");
}

describe("petforge spend baseline", () => {
  it("sets a positive baseline in cents from a USD argument", async () => {
    const deps = await loadDeps();
    await seedState(deps);

    const out: string[] = [];
    const code = await deps.spendCli(["baseline", "24517.42"], {
      writeOut: (s) => out.push(s),
    });
    expect(code).toBe(0);
    expect(out.join("")).toContain("$24517.42");

    await deps.withStateLock(async (s) => {
      const p = s.counters.spendPersisted;
      expect(p).toBeDefined();
      expect(p?.baselineCents).toBe(2_451_742);
      // API defaults to the paid baseline when --api not supplied.
      expect(p?.baselineApiCents).toBe(2_451_742);
      expect(p?.baselineMessages).toBe(0);
    });
  });

  it("accepts --api and --messages overrides", async () => {
    const deps = await loadDeps();
    await seedState(deps);

    const code = await deps.spendCli(["baseline", "28000", "--api=152402", "--messages=61151"], {
      writeOut: () => {},
    });
    expect(code).toBe(0);
    await deps.withStateLock(async (s) => {
      const p = s.counters.spendPersisted;
      expect(p?.baselineCents).toBe(2_800_000);
      expect(p?.baselineApiCents).toBe(15_240_200);
      expect(p?.baselineMessages).toBe(61151);
    });
  });

  it("rejects a non-numeric USD value with exit 2", async () => {
    const deps = await loadDeps();
    await seedState(deps);
    const errBuf: string[] = [];
    const code = await deps.spendCli(["baseline", "notanumber"], {
      writeOut: () => {},
      writeErr: (s) => errBuf.push(s),
    });
    expect(code).toBe(2);
    expect(errBuf.join("")).toMatch(/invalid/i);
  });

  it("--reset zeros the baseline without touching accumulated", async () => {
    const deps = await loadDeps();
    await seedState(deps);
    await deps.spendCli(["baseline", "100", "--messages=5"], { writeOut: () => {} });
    // Seed some accumulated state too.
    await deps.withStateLock(async (s) => {
      const p = s.counters.spendPersisted;
      if (p) {
        p.accumulatedCents = 7777;
        p.accumulatedMessages = 42;
      }
    });
    await deps.spendCli(["baseline", "--reset"], { writeOut: () => {} });
    await deps.withStateLock(async (s) => {
      const p = s.counters.spendPersisted;
      expect(p?.baselineCents).toBe(0);
      expect(p?.baselineApiCents).toBe(0);
      expect(p?.baselineMessages).toBe(0);
      // Accumulated is preserved.
      expect(p?.accumulatedCents).toBe(7777);
      expect(p?.accumulatedMessages).toBe(42);
    });
  });

  it("missing positional <usd> errors with help text", async () => {
    const deps = await loadDeps();
    await seedState(deps);
    const errBuf: string[] = [];
    const code = await deps.spendCli(["baseline"], {
      writeOut: () => {},
      writeErr: (s) => errBuf.push(s),
    });
    expect(code).toBe(2);
    expect(errBuf.join("")).toMatch(/missing/i);
  });
});

describe("petforge spend (status)", () => {
  it("prints a friendly message when no persisted state exists yet", async () => {
    const deps = await loadDeps();
    await seedState(deps);
    const out: string[] = [];
    const code = await deps.spendCli([], { writeOut: (s) => out.push(s) });
    expect(code).toBe(0);
    expect(out.join("")).toMatch(/no persisted spend/i);
  });

  it("prints baseline + accumulated + total once set", async () => {
    const deps = await loadDeps();
    await seedState(deps);
    await deps.spendCli(["baseline", "100", "--messages=10"], { writeOut: () => {} });
    await deps.withStateLock(async (s) => {
      const p = s.counters.spendPersisted;
      if (p) {
        p.accumulatedCents = 5000;
        p.accumulatedMessages = 25;
      }
    });
    const out: string[] = [];
    await deps.spendCli([], { writeOut: (s) => out.push(s) });
    const body = out.join("");
    // baseline = 100 USD = 10 000 cents; accumulated = 5 000 cents = $50.
    // total = $100.00 + $50.00 = $150.00.
    expect(body).toContain("$150.00");
    expect(body).toContain("$100.00");
    expect(body).toContain("$50.00");
    expect(body).toMatch(/baseline/i);
    expect(body).toMatch(/accumulated/i);
  });

  it("--json emits the persisted block verbatim", async () => {
    const deps = await loadDeps();
    await seedState(deps);
    await deps.spendCli(["baseline", "42.00"], { writeOut: () => {} });
    const out: string[] = [];
    await deps.spendCli(["--json"], { writeOut: (s) => out.push(s) });
    const parsed = JSON.parse(out.join("")) as { baselineCents: number };
    expect(parsed.baselineCents).toBe(4200);
  });
});
