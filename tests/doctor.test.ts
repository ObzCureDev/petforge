/**
 * Tests for src/commands/doctor.ts (`petforge doctor` diagnostic checklist).
 *
 * Isolation: each test uses a unique `PETFORGE_HOME` temp dir (so STATE_FILE
 * and CLAUDE_SETTINGS_FILE both point inside it) and `vi.resetModules()` so
 * the path constants recompute. We mock `../src/core/buddy.js` to avoid
 * spawning real `where`/`command -v` in CI.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;
let prevHome: string | undefined;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "petforge-doctor-"));
  prevHome = process.env.PETFORGE_HOME;
  process.env.PETFORGE_HOME = dir;
  vi.resetModules();
  vi.doMock("../src/core/buddy.js", () => ({
    isClaudeOnPath: vi.fn().mockResolvedValue(false),
    detectBuddy: vi.fn().mockResolvedValue({ detected: false }),
  }));
});

afterEach(async () => {
  vi.doUnmock("../src/core/buddy.js");
  if (prevHome === undefined) {
    delete process.env.PETFORGE_HOME;
  } else {
    process.env.PETFORGE_HOME = prevHome;
  }
  await fs.rm(dir, { recursive: true, force: true });
});

describe("runDoctor", () => {
  it("returns exit 1 when settings.json is missing", async () => {
    const { runDoctor } = await import("../src/commands/doctor.js");
    const result = await runDoctor();
    expect(result.exitCode).toBe(1);
    const settingsCheck = result.checks.find((c) => c.name.includes("settings.json"));
    expect(settingsCheck?.ok).toBe(false);
  });

  it("flags missing PetForge hooks as critical", async () => {
    // Write a valid settings.json with NO PetForge hooks → critical fail.
    const settingsDir = path.join(dir, ".claude");
    await fs.mkdir(settingsDir, { recursive: true });
    await fs.writeFile(path.join(settingsDir, "settings.json"), "{}", "utf8");

    const { runDoctor } = await import("../src/commands/doctor.js");
    const result = await runDoctor();
    const hooksCheck = result.checks.find((c) => c.name.includes("hooks registered"));
    expect(hooksCheck?.ok).toBe(false);
    expect(hooksCheck?.warning).not.toBe(true);
    expect(result.exitCode).toBe(1);
  });

  it("treats claude-not-on-PATH as a warning, not critical", async () => {
    const { runDoctor } = await import("../src/commands/doctor.js");
    const result = await runDoctor();
    const claudeCheck = result.checks.find((c) => c.name === "claude CLI on PATH");
    expect(claudeCheck?.ok).toBe(false);
    expect(claudeCheck?.warning).toBe(true);
    const buddyCheck = result.checks.find((c) => c.name === "claude /buddy card");
    expect(buddyCheck?.warning).toBe(true);
  });

  it("returns exit 0 when all critical checks pass", async () => {
    // Set up a valid state and settings via the existing init + hook flow.
    const { runInit } = await import("../src/commands/init.js");
    await runInit({ yes: true });
    const { runHook } = await import("../src/commands/hook.js");
    await runHook("session_start", { session_id: "s1" }, Date.now());

    const { runDoctor } = await import("../src/commands/doctor.js");
    const result = await runDoctor();

    // Sanity: state and settings checks both pass.
    const stateCheck = result.checks.find((c) => c.name.startsWith("~/.petforge/state.json"));
    expect(stateCheck?.ok).toBe(true);
    const settingsCheck = result.checks.find((c) => c.name.startsWith("~/.claude/settings.json"));
    expect(settingsCheck?.ok).toBe(true);
    const hooksCheck = result.checks.find((c) => c.name.startsWith("PetForge hooks registered"));
    expect(hooksCheck?.ok).toBe(true);

    // Buddy is warning, so exit code should be 0.
    expect(result.exitCode).toBe(0);
  });

  it("treats missing state.json as a warning (first run)", async () => {
    // Settings exist + hooks registered, but state.json absent.
    const { runInit } = await import("../src/commands/init.js");
    await runInit({ yes: true });

    const { runDoctor } = await import("../src/commands/doctor.js");
    const result = await runDoctor();

    const stateCheck = result.checks.find((c) => c.name.startsWith("~/.petforge/state.json"));
    expect(stateCheck?.ok).toBe(false);
    expect(stateCheck?.warning).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it("flags corrupt state.json as critical", async () => {
    const { runInit } = await import("../src/commands/init.js");
    await runInit({ yes: true });

    // Write garbage at STATE_FILE.
    const petforgeDir = path.join(dir, ".petforge");
    await fs.mkdir(petforgeDir, { recursive: true });
    await fs.writeFile(path.join(petforgeDir, "state.json"), "{ not json", "utf8");

    const { runDoctor } = await import("../src/commands/doctor.js");
    const result = await runDoctor();
    const stateCheck = result.checks.find((c) => c.name.includes("state.json"));
    expect(stateCheck?.ok).toBe(false);
    expect(stateCheck?.warning).not.toBe(true);
    expect(result.exitCode).toBe(1);
  });

  it("warns when promptsTotal > 50 and sessionsTotal === 0", async () => {
    const { runInit } = await import("../src/commands/init.js");
    await runInit({ yes: true });

    // Seed a state with promptsTotal > 50 and sessionsTotal === 0
    const { runHook } = await import("../src/commands/hook.js");
    await runHook("session_start", { session_id: "s1" }, Date.now());
    const { readState, writeStateAtomic } = await import("../src/core/state.js");
    const s = await readState();
    s.counters.promptsTotal = 100;
    s.counters.sessionsTotal = 0;
    await writeStateAtomic(s);

    const { runDoctor } = await import("../src/commands/doctor.js");
    const result = await runDoctor();
    const sessionCheck = result.checks.find((c) => c.name.includes("SessionStart"));
    expect(sessionCheck).toBeDefined();
    expect(sessionCheck?.ok).toBe(false);
    expect(sessionCheck?.warning).toBe(true);
    // Should NOT flip exit code (warning, not critical)
    expect(result.exitCode).toBe(0);
  });

  it("does not warn when sessionsTotal > 0", async () => {
    const { runInit } = await import("../src/commands/init.js");
    await runInit({ yes: true });

    const { runHook } = await import("../src/commands/hook.js");
    await runHook("session_start", { session_id: "s1" }, Date.now());
    const { readState, writeStateAtomic } = await import("../src/core/state.js");
    const s = await readState();
    s.counters.promptsTotal = 100;
    s.counters.sessionsTotal = 5;
    await writeStateAtomic(s);

    const { runDoctor } = await import("../src/commands/doctor.js");
    const result = await runDoctor();
    const sessionCheck = result.checks.find((c) => c.name.includes("SessionStart"));
    expect(sessionCheck?.ok).toBe(true);
  });

  it("emits OTel-related warnings without flipping exit code", async () => {
    // Set up a valid state and settings (no OTel env, no collector).
    const { runInit } = await import("../src/commands/init.js");
    await runInit({ yes: true });
    const { runHook } = await import("../src/commands/hook.js");
    await runHook("session_start", { session_id: "s1" }, Date.now());

    const { runDoctor } = await import("../src/commands/doctor.js");
    const result = await runDoctor();

    const otelChecks = result.checks.filter((c) => c.name.toLowerCase().includes("otel"));
    expect(otelChecks.length).toBeGreaterThanOrEqual(3);
    for (const c of otelChecks) {
      // Each OTel check is either passing or a warning — never critical.
      expect(c.ok || c.warning).toBe(true);
      if (!c.ok) expect(c.warning).toBe(true);
    }
    // Without OTel, exit should still be 0 since hooks/state pass.
    expect(result.exitCode).toBe(0);
  });
});
