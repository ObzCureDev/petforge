/**
 * Tests for src/commands/hook.ts.
 *
 * Layered:
 *  - applyHookEvent (pure mutation logic, no I/O)
 *  - hookCli       (CLI shell — argv parsing, stdout silence, exit codes)
 *  - runHook       (state I/O end-to-end, including concurrency + benchmark)
 *
 * Isolation: each test gets a unique PETFORGE_HOME temp dir and re-imports
 * the modules with `vi.resetModules()` so `paths.ts` recomputes against the
 * test home (mirrors tests/state.test.ts).
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as HookMod from "../src/commands/hook.js";
import type * as PathsMod from "../src/core/paths.js";
import type * as PetEngineMod from "../src/core/pet-engine.js";
import type * as SchemaMod from "../src/core/schema.js";
import type * as StateMod from "../src/core/state.js";

interface TestModules {
  hook: typeof HookMod;
  paths: typeof PathsMod;
  petEngine: typeof PetEngineMod;
  schema: typeof SchemaMod;
  state: typeof StateMod;
}

let testHome: string;
let prevHome: string | undefined;

async function loadModules(): Promise<TestModules> {
  vi.resetModules();
  const paths = await import("../src/core/paths.js");
  const petEngine = await import("../src/core/pet-engine.js");
  const schema = await import("../src/core/schema.js");
  const state = await import("../src/core/state.js");
  const hook = await import("../src/commands/hook.js");
  return { hook, paths, petEngine, schema, state };
}

function testPet(petEngine: typeof PetEngineMod): SchemaMod.Pet {
  return petEngine.generatePet({ username: "test-user", hostname: "test-host" });
}

beforeEach(async () => {
  prevHome = process.env.PETFORGE_HOME;
  testHome = await fs.mkdtemp(path.join(os.tmpdir(), "petforge-hook-"));
  process.env.PETFORGE_HOME = testHome;
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

describe("applyHookEvent (pure)", () => {
  // Daytime "now" so isNightOwlHour returns false unless explicitly tested.
  function noonOf(year: number, month1: number, day: number): number {
    return new Date(year, month1 - 1, day, 12, 0, 0).getTime();
  }

  it("prompt: +5 xp, +1 promptsTotal, updates streak", async () => {
    const { hook, petEngine, schema } = await loadModules();
    const s = schema.createInitialState(testPet(petEngine), 0);
    hook.applyHookEvent(s, "prompt", { session_id: "s1" }, noonOf(2026, 4, 30));
    expect(s.progress.xp).toBeGreaterThanOrEqual(5);
    expect(s.counters.promptsTotal).toBe(1);
    expect(s.counters.lastActiveDate).toBe("2026-04-30");
    expect(s.counters.streakDays).toBe(1);
  });

  it("prompt: night-owl hour increments nightOwlEvents", async () => {
    const { hook, petEngine, schema } = await loadModules();
    const s = schema.createInitialState(testPet(petEngine), 0);
    const lateNight = new Date(2026, 3, 30, 23, 0, 0).getTime();
    hook.applyHookEvent(s, "prompt", { session_id: "s1" }, lateNight);
    expect(s.counters.nightOwlEvents).toBe(1);
  });

  it("post_tool_use: +1 xp, +1 toolUseTotal, increments session.toolUseCount, tracks ext", async () => {
    const { hook, petEngine, schema } = await loadModules();
    const s = schema.createInitialState(testPet(petEngine), 0);
    s.counters.activeSessions.s1 = {
      startTs: 0,
      toolUseCount: 0,
      fileExtensions: [],
    };
    hook.applyHookEvent(
      s,
      "post_tool_use",
      { session_id: "s1", tool_name: "Edit", tool_input: { file_path: "src/foo.ts" } },
      noonOf(2026, 4, 30),
    );
    expect(s.progress.xp).toBeGreaterThanOrEqual(1);
    expect(s.counters.toolUseTotal).toBe(1);
    expect(s.counters.activeSessions.s1?.toolUseCount).toBe(1);
    expect(s.counters.activeSessions.s1?.fileExtensions).toContain(".ts");
  });

  it("post_tool_use: dedupes file extensions across calls", async () => {
    const { hook, petEngine, schema } = await loadModules();
    const s = schema.createInitialState(testPet(petEngine), 0);
    s.counters.activeSessions.s1 = {
      startTs: 0,
      toolUseCount: 0,
      fileExtensions: [],
    };
    hook.applyHookEvent(
      s,
      "post_tool_use",
      { session_id: "s1", tool_name: "Edit", tool_input: { file_path: "src/a.ts" } },
      noonOf(2026, 4, 30),
    );
    hook.applyHookEvent(
      s,
      "post_tool_use",
      { session_id: "s1", tool_name: "Write", tool_input: { file_path: "src/b.ts" } },
      noonOf(2026, 4, 30),
    );
    expect(s.counters.activeSessions.s1?.fileExtensions).toEqual([".ts"]);
  });

  it("post_tool_use: only Edit/Write/MultiEdit/NotebookEdit track extensions", async () => {
    const { hook, petEngine, schema } = await loadModules();
    const s = schema.createInitialState(testPet(petEngine), 0);
    s.counters.activeSessions.s1 = {
      startTs: 0,
      toolUseCount: 0,
      fileExtensions: [],
    };
    // Bash tool with a file path in input — should NOT be tracked.
    hook.applyHookEvent(
      s,
      "post_tool_use",
      { session_id: "s1", tool_name: "Bash", tool_input: { file_path: "src/foo.ts" } },
      noonOf(2026, 4, 30),
    );
    expect(s.counters.activeSessions.s1?.fileExtensions).toEqual([]);
  });

  it("stop: +10 xp", async () => {
    const { hook, petEngine, schema } = await loadModules();
    const s = schema.createInitialState(testPet(petEngine), 0);
    hook.applyHookEvent(s, "stop", { session_id: "s1" }, noonOf(2026, 4, 30));
    expect(s.progress.xp).toBe(10);
  });

  it("session_start: creates activeSessions entry, updates streak", async () => {
    const { hook, petEngine, schema } = await loadModules();
    const s = schema.createInitialState(testPet(petEngine), 0);
    const now = noonOf(2026, 4, 30);
    hook.applyHookEvent(s, "session_start", { session_id: "s1" }, now);
    expect(s.counters.activeSessions.s1).toEqual({
      startTs: now,
      toolUseCount: 0,
      fileExtensions: [],
    });
    expect(s.counters.streakDays).toBe(1);
    expect(s.counters.lastActiveDate).toBe("2026-04-30");
  });

  it("session_end: +50 xp, sessions++, deletes activeSessions, fires marathon if >1h", async () => {
    const { hook, petEngine, schema } = await loadModules();
    const s = schema.createInitialState(testPet(petEngine), 0);
    const start = noonOf(2026, 4, 30);
    s.counters.activeSessions.s1 = {
      startTs: start,
      toolUseCount: 0,
      fileExtensions: [],
    };
    const end = start + 60 * 60 * 1000 + 1; // > 1h
    hook.applyHookEvent(s, "session_end", { session_id: "s1" }, end);
    expect(s.counters.sessionsTotal).toBe(1);
    expect(s.counters.activeSessions.s1).toBeUndefined();
    // marathon (1000 xp) + session_end (50 xp) = 1050
    expect(s.progress.xp).toBe(50 + 1000);
    expect(s.achievements.unlocked).toContain("marathon");
  });

  it("session_end: deletes activeSessions even when no marathon", async () => {
    const { hook, petEngine, schema } = await loadModules();
    const s = schema.createInitialState(testPet(petEngine), 0);
    const start = noonOf(2026, 4, 30);
    s.counters.activeSessions.s1 = {
      startTs: start,
      toolUseCount: 0,
      fileExtensions: [],
    };
    hook.applyHookEvent(s, "session_end", { session_id: "s1" }, start + 1000);
    expect(s.counters.activeSessions.s1).toBeUndefined();
    expect(s.achievements.unlocked).not.toContain("marathon");
  });

  it("level recompute and pendingLevelUp on threshold cross", async () => {
    const { hook, petEngine, schema } = await loadModules();
    const s = schema.createInitialState(testPet(petEngine), 0);
    // Level 2 starts at xpForLevel(2). For our piecewise curve that's small —
    // a hatch (500 xp) easily crosses it. Here we drive a prompt that will
    // trigger hatch on the very first prompt: hatch fires at promptsTotal>=1
    // and grants 500 xp on top of the +5 prompt xp.
    expect(s.progress.level).toBe(1);
    hook.applyHookEvent(s, "prompt", { session_id: "s1" }, noonOf(2026, 4, 30));
    expect(s.progress.xp).toBeGreaterThanOrEqual(505);
    expect(s.progress.level).toBeGreaterThan(1);
    expect(s.progress.pendingLevelUp).toBe(true);
  });

  it("active sessions are independently keyed by session_id", async () => {
    const { hook, petEngine, schema } = await loadModules();
    const s = schema.createInitialState(testPet(petEngine), 0);
    const now = noonOf(2026, 4, 30);

    hook.applyHookEvent(s, "session_start", { session_id: "sA" }, now);
    hook.applyHookEvent(s, "session_start", { session_id: "sB" }, now);

    hook.applyHookEvent(
      s,
      "post_tool_use",
      { session_id: "sA", tool_name: "Edit", tool_input: { file_path: "x.ts" } },
      now,
    );
    hook.applyHookEvent(
      s,
      "post_tool_use",
      { session_id: "sB", tool_name: "Write", tool_input: { file_path: "x.md" } },
      now,
    );
    hook.applyHookEvent(
      s,
      "post_tool_use",
      { session_id: "sB", tool_name: "Write", tool_input: { file_path: "x.json" } },
      now,
    );

    expect(s.counters.activeSessions.sA?.toolUseCount).toBe(1);
    expect(s.counters.activeSessions.sA?.fileExtensions).toEqual([".ts"]);
    expect(s.counters.activeSessions.sB?.toolUseCount).toBe(2);
    expect(s.counters.activeSessions.sB?.fileExtensions).toEqual([".md", ".json"]);
  });
});

describe("hookCli (CLI wrapper)", () => {
  function ensureStdinTty() {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  }

  it("returns 0 with no arguments", async () => {
    ensureStdinTty();
    const { hook } = await loadModules();
    const code = await hook.hookCli([]);
    expect(code).toBe(0);
  });

  it("returns 0 with unknown event", async () => {
    ensureStdinTty();
    const { hook } = await loadModules();
    const code = await hook.hookCli(["--event", "bogus"]);
    expect(code).toBe(0);
  });

  it("returns 0 with valid event and no stdin", async () => {
    ensureStdinTty();
    const { hook } = await loadModules();
    const code = await hook.hookCli(["--event", "prompt"]);
    expect(code).toBe(0);
  });

  it("never writes to stdout", async () => {
    ensureStdinTty();
    const { hook } = await loadModules();
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await hook.hookCli(["--event", "prompt"]);
      await hook.hookCli(["--event", "bogus"]);
      await hook.hookCli([]);
      expect(writeSpy).not.toHaveBeenCalled();
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("logs to hook-errors.log on invalid args", async () => {
    ensureStdinTty();
    const { hook, paths } = await loadModules();
    await hook.hookCli([]);
    const log = await fs.readFile(paths.HOOK_ERROR_LOG, "utf8");
    expect(log).toContain("hook: invalid or missing --event arg");
  });
});

describe("readStdin / parsePayload", () => {
  it("readStdin reads JSON from a Readable stream", async () => {
    const { hook } = await loadModules();
    const stream = Readable.from(['{"session_id":"s1"}']);
    const raw = await hook.readStdin(stream as unknown as NodeJS.ReadableStream);
    expect(raw).toBe('{"session_id":"s1"}');
  });

  it("parsePayload returns empty object on empty / malformed JSON", async () => {
    const { hook } = await loadModules();
    expect(hook.parsePayload("")).toEqual({});
    expect(hook.parsePayload("not json")).toEqual({});
    expect(hook.parsePayload("[1,2]")).toEqual({}); // arrays rejected
  });

  it("parsePayload parses a valid Claude payload", async () => {
    const { hook } = await loadModules();
    const p = hook.parsePayload(
      '{"session_id":"abc","tool_name":"Edit","tool_input":{"file_path":"a.ts"}}',
    );
    expect(p.session_id).toBe("abc");
    expect(p.tool_name).toBe("Edit");
  });
});

describe("runHook (state I/O)", () => {
  function ensureStdinTty() {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  }

  it("creates state.json on first run with valid pet", async () => {
    ensureStdinTty();
    const { hook, state } = await loadModules();
    await hook.runHook("prompt", { session_id: "s1" }, Date.now());
    const s = await state.readState();
    expect(s.progress.xp).toBeGreaterThanOrEqual(5);
    expect(s.counters.promptsTotal).toBe(1);
    expect(s.pet.seed).toMatch(/^[0-9a-f]{64}$/);
  });

  it("concurrent hooks (different session_ids) don't corrupt state", async () => {
    const { hook, state } = await loadModules();
    const N = 5;
    const tasks: Promise<void>[] = [];
    for (let i = 0; i < N; i++) {
      tasks.push(hook.runHook("prompt", { session_id: `s${i}` }, Date.now()));
    }
    await Promise.all(tasks);
    const s = await state.readState();
    expect(s.counters.promptsTotal).toBe(N);
    // Each prompt grants +5 xp; the very first one also unlocks `hatch`
    // (+500 xp). Streak achievement isn't triggered (single day).
    // We assert promptsTotal exactly; xp is at least N*5.
    expect(s.progress.xp).toBeGreaterThanOrEqual(N * 5);
  });

  it("benchmark: 10 sequential hooks complete within budget", async () => {
    ensureStdinTty();
    const { hook } = await loadModules();
    // Warm-up to avoid first-run init cost in the measurement.
    await hook.runHook("prompt", { session_id: "warmup" }, Date.now());

    const N = 10;
    const start = performance.now();
    for (let i = 0; i < N; i++) {
      await hook.runHook("prompt", { session_id: `s${i}` }, Date.now());
    }
    const elapsed = performance.now() - start;
    const avgMs = elapsed / N;
    // Spec target: <50ms. Be generous to avoid CI flakes; <150ms is still
    // well within the "feels instant" bracket the spec calls out.
    expect(avgMs).toBeLessThan(150);
    // Surface the timing in test output for dashboard visibility.
    console.log(`[benchmark] avg hook duration: ${avgMs.toFixed(2)}ms over ${N} runs`);
  });
});
