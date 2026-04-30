/**
 * Tests for src/core/buddy.ts.
 *
 * We can't actually spawn `claude` in CI/dev, so we mock `node:child_process`
 * and emit fake stdout/stderr/close/error events synchronously-ish via setTimeout.
 *
 * Goals (from plan §9):
 *  - missing `claude` returns detected:false
 *  - timeout returns detected:false
 *  - stdout visual is passed through at render time only (getBuddyCardOutput)
 *  - no Buddy ASCII written to state (detectBuddy returns only `{ detected }`)
 */

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock child_process BEFORE importing buddy.ts.
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

import { spawn } from "node:child_process";
import {
  detectBuddy,
  getBuddyCardOutput,
  isClaudeOnPath,
  shouldRefreshDetection,
} from "../src/core/buddy.js";

const spawnMock = spawn as unknown as ReturnType<typeof vi.fn>;

interface ChildLike extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: (signal?: NodeJS.Signals | number) => boolean;
}

function fakeChild(opts: {
  stdout?: string;
  stderr?: string;
  code?: number;
  errorCode?: string;
  delayMs?: number;
}): ChildLike {
  const child = new EventEmitter() as ChildLike;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn(() => true) as unknown as ChildLike["kill"];

  setTimeout(() => {
    if (opts.errorCode) {
      const err = new Error("spawn failed") as NodeJS.ErrnoException;
      err.code = opts.errorCode;
      child.emit("error", err);
      return;
    }
    if (opts.stdout) child.stdout.emit("data", Buffer.from(opts.stdout));
    if (opts.stderr) child.stderr.emit("data", Buffer.from(opts.stderr));
    child.emit("close", opts.code ?? 0);
  }, opts.delayMs ?? 0);

  return child;
}

beforeEach(() => {
  spawnMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("buddy", () => {
  describe("isClaudeOnPath", () => {
    it("returns true when which/where succeeds with output", async () => {
      spawnMock.mockReturnValue(fakeChild({ stdout: "/usr/local/bin/claude\n", code: 0 }));
      expect(await isClaudeOnPath()).toBe(true);
    });

    it("returns false when which/where exits non-zero", async () => {
      spawnMock.mockReturnValue(fakeChild({ code: 1 }));
      expect(await isClaudeOnPath()).toBe(false);
    });

    it("returns false on ENOENT (command itself missing — exotic)", async () => {
      spawnMock.mockReturnValue(fakeChild({ errorCode: "ENOENT" }));
      expect(await isClaudeOnPath()).toBe(false);
    });

    it("returns false on empty stdout (claude not found by where/which)", async () => {
      spawnMock.mockReturnValue(fakeChild({ stdout: "", code: 0 }));
      expect(await isClaudeOnPath()).toBe(false);
    });
  });

  describe("getBuddyCardOutput", () => {
    it("returns detected:true with stdout when claude succeeds", async () => {
      spawnMock.mockReturnValue(fakeChild({ stdout: "  ASCII pet output  ", code: 0 }));
      const res = await getBuddyCardOutput();
      expect(res.detected).toBe(true);
      expect(res.cardOutput).toBe("  ASCII pet output  ");
    });

    it("returns detected:false on exit 1", async () => {
      spawnMock.mockReturnValue(fakeChild({ stderr: "Buddy unavailable", code: 1 }));
      const res = await getBuddyCardOutput();
      expect(res.detected).toBe(false);
      expect(res.cardOutput).toBeUndefined();
    });

    it("returns detected:false on empty stdout", async () => {
      spawnMock.mockReturnValue(fakeChild({ stdout: "   ", code: 0 }));
      const res = await getBuddyCardOutput();
      expect(res.detected).toBe(false);
    });

    it("returns detected:false on timeout", async () => {
      spawnMock.mockReturnValue(fakeChild({ stdout: "too late", code: 0, delayMs: 200 }));
      const res = await getBuddyCardOutput(50);
      expect(res.detected).toBe(false);
    });

    it("returns detected:false on ENOENT (claude not on PATH)", async () => {
      spawnMock.mockReturnValue(fakeChild({ errorCode: "ENOENT" }));
      const res = await getBuddyCardOutput();
      expect(res.detected).toBe(false);
    });
  });

  describe("detectBuddy", () => {
    it("skips spawn when isClaudeOnPath returns false", async () => {
      // First call (isClaudeOnPath) fails — only the path check should spawn.
      spawnMock.mockReturnValueOnce(fakeChild({ code: 1 }));
      const res = await detectBuddy();
      expect(res.detected).toBe(false);
      expect(spawnMock).toHaveBeenCalledTimes(1);
    });

    it("invokes claude /buddy card when on PATH", async () => {
      spawnMock
        .mockReturnValueOnce(fakeChild({ stdout: "/usr/bin/claude\n", code: 0 }))
        .mockReturnValueOnce(fakeChild({ stdout: "PET DRAWING", code: 0 }));
      const res = await detectBuddy();
      expect(res.detected).toBe(true);
      expect(spawnMock).toHaveBeenCalledTimes(2);
    });

    it("does NOT include cardOutput in returned object (no ASCII leakage)", async () => {
      spawnMock
        .mockReturnValueOnce(fakeChild({ stdout: "/usr/bin/claude\n", code: 0 }))
        .mockReturnValueOnce(fakeChild({ stdout: "PET DRAWING", code: 0 }));
      const res = await detectBuddy();
      expect((res as { cardOutput?: string }).cardOutput).toBeUndefined();
      expect(Object.keys(res)).toEqual(["detected"]);
    });

    it("returns detected:false when claude is on PATH but invocation fails", async () => {
      spawnMock
        .mockReturnValueOnce(fakeChild({ stdout: "/usr/bin/claude\n", code: 0 }))
        .mockReturnValueOnce(fakeChild({ stderr: "boom", code: 1 }));
      const res = await detectBuddy();
      expect(res.detected).toBe(false);
    });
  });

  describe("shouldRefreshDetection", () => {
    it("returns false if userToggle === 'off'", () => {
      expect(shouldRefreshDetection({ lastChecked: 0, userToggle: "off" }, Date.now())).toBe(false);
      expect(shouldRefreshDetection({ lastChecked: 0, userToggle: "off" }, Date.now(), true)).toBe(
        false,
      );
    });

    it("returns true if force === true and toggle is on/auto", () => {
      const now = Date.now();
      expect(shouldRefreshDetection({ lastChecked: now, userToggle: "auto" }, now, true)).toBe(
        true,
      );
      expect(shouldRefreshDetection({ lastChecked: now, userToggle: "on" }, now, true)).toBe(true);
    });

    it("returns true after 24h cache window", () => {
      const now = 1_700_000_000_000;
      const old = now - 25 * 60 * 60 * 1000;
      expect(shouldRefreshDetection({ lastChecked: old, userToggle: "auto" }, now)).toBe(true);
    });

    it("returns false within 24h cache window", () => {
      const now = 1_700_000_000_000;
      const recent = now - 10 * 60 * 60 * 1000;
      expect(shouldRefreshDetection({ lastChecked: recent, userToggle: "auto" }, now)).toBe(false);
    });

    it("respects 'on' toggle the same as 'auto' for cache window", () => {
      const now = 1_700_000_000_000;
      const old = now - 25 * 60 * 60 * 1000;
      const recent = now - 10 * 60 * 60 * 1000;
      expect(shouldRefreshDetection({ lastChecked: old, userToggle: "on" }, now)).toBe(true);
      expect(shouldRefreshDetection({ lastChecked: recent, userToggle: "on" }, now)).toBe(false);
    });
  });
});
