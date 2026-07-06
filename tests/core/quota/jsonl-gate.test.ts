import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { shouldProbe } from "../../../src/core/quota/jsonl-gate.js";

describe("quota/jsonl-gate", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pf-jsonl-"));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("returns false when projects dir is missing", async () => {
    const result = await shouldProbe({
      projectsDir: path.join(tmp, "absent"),
      now: Date.now(),
      gateMs: 60_000,
    });
    expect(result).toBe(false);
  });

  it("returns false when no .jsonl exists", async () => {
    const p = path.join(tmp, "projects");
    await fs.mkdir(path.join(p, "a"), { recursive: true });
    const result = await shouldProbe({ projectsDir: p, now: Date.now(), gateMs: 60_000 });
    expect(result).toBe(false);
  });

  it("returns true when a .jsonl was touched within the gate", async () => {
    const p = path.join(tmp, "projects");
    await fs.mkdir(path.join(p, "a"), { recursive: true });
    const f = path.join(p, "a", "conv-1.jsonl");
    await fs.writeFile(f, "", "utf8");
    const result = await shouldProbe({ projectsDir: p, now: Date.now(), gateMs: 60_000 });
    expect(result).toBe(true);
  });

  it("returns false when the only .jsonl is older than the gate", async () => {
    const p = path.join(tmp, "projects");
    await fs.mkdir(path.join(p, "a"), { recursive: true });
    const f = path.join(p, "a", "conv-1.jsonl");
    await fs.writeFile(f, "", "utf8");
    const oldTime = (Date.now() - 30 * 60_000) / 1000;
    await fs.utimes(f, oldTime, oldTime);
    const result = await shouldProbe({ projectsDir: p, now: Date.now(), gateMs: 10 * 60_000 });
    expect(result).toBe(false);
  });

  it("recursively descends into nested project dirs", async () => {
    const p = path.join(tmp, "projects");
    const nested = path.join(p, "team", "repo-abc");
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(path.join(nested, "conv.jsonl"), "", "utf8");
    const result = await shouldProbe({ projectsDir: p, now: Date.now(), gateMs: 60_000 });
    expect(result).toBe(true);
  });

  it("returns true for a fresh file even when stale files exceed the old 2000-visit cap " +
    "(regression: large-install false negative, see file header)", async () => {
    const p = path.join(tmp, "projects");
    const now = Date.now();
    const staleTimeSec = (now - 60 * 60_000) / 1000; // 1h old, well before the gate cutoff

    const STALE_DIR_COUNT = 5;
    const STALE_FILES_PER_DIR = 500; // 2500 total .jsonl - exceeds the old MAX_FILES_VISITED (2000)

    for (let d = 0; d < STALE_DIR_COUNT; d++) {
      const dir = path.join(p, `stale-${d}`);
      await fs.mkdir(dir, { recursive: true });
      await Promise.all(
        Array.from({ length: STALE_FILES_PER_DIR }, (_, i) =>
          fs.writeFile(path.join(dir, `conv-${i}.jsonl`), "", "utf8"),
        ),
      );
      // Backdate the directory's own mtime so best-first ordering ranks it
      // below the still-fresh active project directory created afterwards.
      await fs.utimes(dir, staleTimeSec, staleTimeSec);
    }
    for (let d = 0; d < STALE_DIR_COUNT; d++) {
      const dir = path.join(p, `stale-${d}`);
      await Promise.all(
        Array.from({ length: STALE_FILES_PER_DIR }, (_, i) =>
          fs.utimes(path.join(dir, `conv-${i}.jsonl`), staleTimeSec, staleTimeSec),
        ),
      );
    }

    // A single fresh file, in its own directory created last (newest mtime).
    const freshDir = path.join(p, "active-project");
    await fs.mkdir(freshDir, { recursive: true });
    await fs.writeFile(path.join(freshDir, "conv-fresh.jsonl"), "", "utf8");

    const result = await shouldProbe({ projectsDir: p, now, gateMs: 60_000 });
    expect(result).toBe(true);
  }, 20_000);

  it("returns false without throwing when the scan budget is exceeded before any fresh file is found", async () => {
    const p = path.join(tmp, "projects");
    await fs.mkdir(path.join(p, "a"), { recursive: true });
    // This file is fresh - absent a budget, shouldProbe would return true.
    await fs.writeFile(path.join(p, "a", "conv-1.jsonl"), "", "utf8");

    let calls = 0;
    const clock = () => {
      calls++;
      // First call establishes the scan start time; every call after that
      // reports a wall-clock time far past the (tiny) budget.
      return calls === 1 ? 0 : 10_000;
    };

    const result = await shouldProbe({
      projectsDir: p,
      now: Date.now(),
      gateMs: 60_000,
      scanBudgetMs: 1,
      clock,
    });
    expect(result).toBe(false);
  });
});
