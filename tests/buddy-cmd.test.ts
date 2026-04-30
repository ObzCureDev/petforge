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

describe("runBuddyImport", () => {
  it("from file: stores ASCII, flips toggle to 'on', returns line count", async () => {
    const ascii = "  ʌ_ʌ  \n /o o\\ \n |   |";
    const file = path.join(dir, "card.txt");
    await fs.writeFile(file, ascii, "utf8");
    const { runBuddyImport, runBuddyCommand } = await import("../src/commands/buddy.js");

    const res = await runBuddyImport({ source: { file }, clear: false });
    expect(res.cleared).toBe(false);
    expect(res.lines).toBe(3);
    expect(res.bytesStored).toBe(ascii.length);
    expect(res.toggle).toBe("on");

    const status = await runBuddyCommand(undefined);
    expect(status.hasCard).toBe(true);
    expect(status.cardLines).toBe(3);
    expect(status.toggle).toBe("on");
  });

  it("strips a trailing newline but preserves internal newlines", async () => {
    const file = path.join(dir, "card.txt");
    await fs.writeFile(file, "row1\nrow2\n", "utf8");
    const { runBuddyImport, runBuddyCommand } = await import("../src/commands/buddy.js");

    const res = await runBuddyImport({ source: { file }, clear: false });
    expect(res.bytesStored).toBe("row1\nrow2".length);
    expect(res.lines).toBe(2);
    const status = await runBuddyCommand(undefined);
    expect(status.cardLines).toBe(2);
  });

  it("rejects empty input", async () => {
    const file = path.join(dir, "empty.txt");
    await fs.writeFile(file, "", "utf8");
    const { runBuddyImport } = await import("../src/commands/buddy.js");
    await expect(runBuddyImport({ source: { file }, clear: false })).rejects.toThrow(/empty/);
  });

  it("rejects oversized input (>32 KB)", async () => {
    const file = path.join(dir, "big.txt");
    await fs.writeFile(file, "x".repeat(33 * 1024), "utf8");
    const { runBuddyImport } = await import("../src/commands/buddy.js");
    await expect(runBuddyImport({ source: { file }, clear: false })).rejects.toThrow(/oversized/);
  });

  it("clear: wipes cache, leaves toggle as-is", async () => {
    const file = path.join(dir, "card.txt");
    await fs.writeFile(file, "abc", "utf8");
    const { runBuddyImport, runBuddyCommand } = await import("../src/commands/buddy.js");

    await runBuddyImport({ source: { file }, clear: false });
    const cleared = await runBuddyImport({ source: "stdin", clear: true });
    expect(cleared.cleared).toBe(true);
    expect(cleared.bytesStored).toBe(0);
    expect(cleared.toggle).toBe("on");

    const status = await runBuddyCommand(undefined);
    expect(status.hasCard).toBe(false);
    expect(status.toggle).toBe("on");
  });

  it("does NOT downgrade an existing 'off' or 'auto' on clear", async () => {
    const { runBuddyCommand, runBuddyImport } = await import("../src/commands/buddy.js");
    await runBuddyCommand("off");
    await runBuddyImport({ source: "stdin", clear: true });
    const status = await runBuddyCommand(undefined);
    expect(status.toggle).toBe("off");
  });
});

describe("pickBuddyFrame", () => {
  it("returns undefined when userToggle is not 'on'", async () => {
    const { pickBuddyFrame } = await import("../src/core/buddy.js");
    const fakeState = {
      buddy: { userToggle: "auto", cardCache: "hello" },
    } as unknown as Parameters<typeof pickBuddyFrame>[0];
    expect(pickBuddyFrame(fakeState)).toBeUndefined();
  });

  it("returns undefined when cardCache is empty/missing", async () => {
    const { pickBuddyFrame } = await import("../src/core/buddy.js");
    const noCache = {
      buddy: { userToggle: "on", cardCache: null },
    } as unknown as Parameters<typeof pickBuddyFrame>[0];
    expect(pickBuddyFrame(noCache)).toBeUndefined();
    const empty = {
      buddy: { userToggle: "on", cardCache: "" },
    } as unknown as Parameters<typeof pickBuddyFrame>[0];
    expect(pickBuddyFrame(empty)).toBeUndefined();
  });

  it("returns the cache verbatim when toggle 'on' and cache non-empty", async () => {
    const { pickBuddyFrame } = await import("../src/core/buddy.js");
    const ok = {
      buddy: { userToggle: "on", cardCache: "ʌ_ʌ\n|   |" },
    } as unknown as Parameters<typeof pickBuddyFrame>[0];
    expect(pickBuddyFrame(ok)).toBe("ʌ_ʌ\n|   |");
  });
});
