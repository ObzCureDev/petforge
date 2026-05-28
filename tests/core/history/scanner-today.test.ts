import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanAllJsonl } from "../../../src/core/history/scanner.js";

/**
 * These tests scan only a temp `projectsDir` and never import state.ts, so
 * they cannot touch ~/.petforge/state.json. Safe to run without stopping the
 * PetForge service.
 */

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "pf-scan-today-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

interface Line {
  ts: number;
  id: string;
  model?: string;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheCreation?: number;
}

async function writeProject(projectKey: string, file: string, lines: Line[]): Promise<void> {
  const dir = path.join(root, projectKey);
  await fs.mkdir(dir, { recursive: true });
  const body = lines
    .map((l) =>
      JSON.stringify({
        timestamp: new Date(l.ts).toISOString(),
        message: {
          id: l.id,
          model: l.model ?? "claude-opus-4-7",
          usage: {
            input_tokens: l.input ?? 0,
            output_tokens: l.output ?? 0,
            cache_read_input_tokens: l.cacheRead ?? 0,
            cache_creation_input_tokens: l.cacheCreation ?? 0,
          },
        },
      }),
    )
    .join("\n");
  await fs.writeFile(path.join(dir, file), `${body}\n`, "utf8");
}

describe("scanAllJsonl today bucket", () => {
  const lastWeek = new Date("2026-05-22T10:00:00Z").getTime();
  const today = new Date("2026-05-29T09:00:00Z").getTime();
  const cutoff = new Date("2026-05-29T00:00:00Z").getTime();

  it("only counts messages at/after todayStartMs into todayByModel", async () => {
    await writeProject("proj-a", "conv.jsonl", [
      { ts: lastWeek, id: "msg_old", input: 1000, output: 500 },
      { ts: today, id: "msg_new", input: 2000, output: 100 },
    ]);

    const t = await scanAllJsonl({ projectsDir: root, todayStartMs: cutoff });

    expect(t.usageLinesScanned).toBe(2);
    expect(t.todayMessageCount).toBe(1);
    // Lifetime spans both messages.
    expect(t.byModel["claude-opus-4-7"]?.tokensIn).toBe(3000);
    // Today only the second.
    expect(t.todayByModel["claude-opus-4-7"]?.tokensIn).toBe(2000);
    expect(t.todayByModel["claude-opus-4-7"]?.tokensOut).toBe(100);
  });

  it("leaves todayByModel empty when todayStartMs is not provided", async () => {
    await writeProject("proj-a", "conv.jsonl", [
      { ts: today, id: "msg_new", input: 2000, output: 100 },
    ]);

    const t = await scanAllJsonl({ projectsDir: root });

    expect(t.usageLinesScanned).toBe(1);
    expect(t.todayMessageCount).toBe(0);
    expect(Object.keys(t.todayByModel)).toHaveLength(0);
  });

  it("dedupes by message.id in the today bucket too", async () => {
    // Same message.id repeated across lines (Claude Code logs a turn across
    // multiple JSONL entries) must count once everywhere, including today.
    await writeProject("proj-a", "conv.jsonl", [
      { ts: today, id: "msg_dup", input: 2000, output: 100 },
      { ts: today, id: "msg_dup", input: 2000, output: 100 },
    ]);

    const t = await scanAllJsonl({ projectsDir: root, todayStartMs: cutoff });

    expect(t.todayMessageCount).toBe(1);
    expect(t.todayByModel["claude-opus-4-7"]?.tokensIn).toBe(2000);
  });

  it("excludes messages with no parseable timestamp from today", async () => {
    const dir = path.join(root, "proj-b");
    await fs.mkdir(dir, { recursive: true });
    // No timestamp field at all.
    const line = JSON.stringify({
      message: {
        id: "msg_no_ts",
        model: "claude-opus-4-7",
        usage: { input_tokens: 500, output_tokens: 50 },
      },
    });
    await fs.writeFile(path.join(dir, "conv.jsonl"), `${line}\n`, "utf8");

    const t = await scanAllJsonl({ projectsDir: root, todayStartMs: cutoff });

    expect(t.usageLinesScanned).toBe(1);
    expect(t.todayMessageCount).toBe(0);
  });
});
