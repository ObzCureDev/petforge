/**
 * Tests for src/commands/buddy.ts (`petforge buddy [on|off|auto]`).
 *
 * Same isolation pattern as state/init tests: per-test PETFORGE_HOME temp dir
 * + vi.resetModules() so paths.ts recomputes.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;
let prevHome: string | undefined;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "petforge-buddy-cmd-"));
  prevHome = process.env.PETFORGE_HOME;
  process.env.PETFORGE_HOME = dir;
  vi.resetModules();
});

afterEach(async () => {
  if (prevHome === undefined) {
    delete process.env.PETFORGE_HOME;
  } else {
    process.env.PETFORGE_HOME = prevHome;
  }
  await fs.rm(dir, { recursive: true, force: true });
});

describe("runBuddyCommand", () => {
  it("with no arg: returns current state (default 'auto'), changed=false", async () => {
    const { runBuddyCommand } = await import("../src/commands/buddy.js");
    const r = await runBuddyCommand(undefined);
    expect(r.toggle).toBe("auto");
    expect(r.changed).toBe(false);
    expect(r.detected).toBe(false);
    expect(r.lastChecked).toBe(0);
  });

  it("'on': sets userToggle to 'on' and persists", async () => {
    const { runBuddyCommand } = await import("../src/commands/buddy.js");
    const r1 = await runBuddyCommand("on");
    expect(r1.toggle).toBe("on");
    expect(r1.changed).toBe(true);
    const r2 = await runBuddyCommand(undefined);
    expect(r2.toggle).toBe("on");
    expect(r2.changed).toBe(false);
  });

  it("'off' persists across calls", async () => {
    const { runBuddyCommand } = await import("../src/commands/buddy.js");
    await runBuddyCommand("off");
    const r = await runBuddyCommand(undefined);
    expect(r.toggle).toBe("off");
  });

  it("'auto' persists across calls", async () => {
    const { runBuddyCommand } = await import("../src/commands/buddy.js");
    await runBuddyCommand("on");
    await runBuddyCommand("auto");
    const r = await runBuddyCommand(undefined);
    expect(r.toggle).toBe("auto");
  });

  it("calling with same arg twice: changed=false on second call", async () => {
    const { runBuddyCommand } = await import("../src/commands/buddy.js");
    await runBuddyCommand("on");
    const r = await runBuddyCommand("on");
    expect(r.changed).toBe(false);
    expect(r.toggle).toBe("on");
  });

  it("creates fresh state if state.json is missing", async () => {
    // No prior state — runBuddyCommand should auto-create via recoverCorruptState.
    const { runBuddyCommand } = await import("../src/commands/buddy.js");
    const r = await runBuddyCommand("on");
    expect(r.toggle).toBe("on");

    // Verify state.json now exists on disk.
    const stateFile = path.join(dir, ".petforge", "state.json");
    const raw = await fs.readFile(stateFile, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.buddy.userToggle).toBe("on");
  });
});

describe("buddyCli", () => {
  let stdoutWrite: ReturnType<typeof vi.spyOn>;
  let stderrWrite: ReturnType<typeof vi.spyOn>;
  let stdoutBuf: string;
  let stderrBuf: string;

  beforeEach(() => {
    stdoutBuf = "";
    stderrBuf = "";
    stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      stdoutBuf += typeof chunk === "string" ? chunk : String(chunk);
      return true;
    });
    stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      stderrBuf += typeof chunk === "string" ? chunk : String(chunk);
      return true;
    });
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
  });

  it("rejects an unknown buddy mode and prints usage hint", async () => {
    const { buddyCli } = await import("../src/commands/buddy.js");
    const code = await buddyCli(["bogus"]);
    expect(code).toBe(1);
    expect(stderrBuf).toContain("Unknown buddy mode: bogus");
    expect(stderrBuf).toContain("Usage: petforge buddy");
  });

  it("with no arg: prints current toggle and last-detection summary", async () => {
    const { buddyCli } = await import("../src/commands/buddy.js");
    const code = await buddyCli([]);
    expect(code).toBe(0);
    expect(stdoutBuf).toContain("Buddy mode: auto");
    expect(stdoutBuf).toContain("Last detection:");
  });

  it("'on': prints confirmation message", async () => {
    const { buddyCli } = await import("../src/commands/buddy.js");
    const code = await buddyCli(["on"]);
    expect(code).toBe(0);
    expect(stdoutBuf).toContain("Buddy mode set to: on");
  });

  it("'on' twice: second call prints 'no change'", async () => {
    const { buddyCli } = await import("../src/commands/buddy.js");
    await buddyCli(["on"]);
    stdoutBuf = "";
    const code = await buddyCli(["on"]);
    expect(code).toBe(0);
    expect(stdoutBuf).toContain("(no change)");
  });
});
