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
});
