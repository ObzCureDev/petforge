/**
 * Scanner `sinceTs` bucket — fuels the V3.7.8 additive lifetime daemon.
 * Touches only a temp projectsDir, never imports state.ts.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanAllJsonl } from "../../../src/core/history/scanner.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "pf-scan-since-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function writeProject(projectKey: string, file: string, rows: object[]): Promise<void> {
  const dir = path.join(root, projectKey);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, file),
    `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`,
    "utf8",
  );
}

function msg(ts: number, id: string, input: number, output: number): object {
  return {
    timestamp: new Date(ts).toISOString(),
    message: {
      id,
      model: "claude-opus-4-7",
      usage: { input_tokens: input, output_tokens: output },
    },
  };
}

describe("scanAllJsonl sinceTs bucket", () => {
  const ts1 = new Date("2026-05-01T00:00:00Z").getTime();
  const ts2 = new Date("2026-05-15T00:00:00Z").getTime();
  const ts3 = new Date("2026-05-30T00:00:00Z").getTime();

  it("accumulates only messages with ts strictly > sinceTs", async () => {
    await writeProject("p", "conv.jsonl", [
      msg(ts1, "a", 100, 50),
      msg(ts2, "b", 200, 75),
      msg(ts3, "c", 400, 200),
    ]);

    const t = await scanAllJsonl({ projectsDir: root, sinceTs: ts2 });

    // Lifetime sees all 3.
    expect(t.usageLinesScanned).toBe(3);
    expect(t.byModel["claude-opus-4-7"]?.tokensIn).toBe(700);
    // Since bucket sees only c (ts3 > ts2). b is EXCLUDED because the
    // comparison is strict: a daemon picks up at the watermark exactly,
    // never re-counts the boundary message.
    expect(t.sinceMessageCount).toBe(1);
    expect(t.sinceByModel["claude-opus-4-7"]?.tokensIn).toBe(400);
    expect(t.sinceByModel["claude-opus-4-7"]?.tokensOut).toBe(200);
  });

  it("seeds the full lifetime when sinceTs is 0 (bootstrap path)", async () => {
    await writeProject("p", "conv.jsonl", [msg(ts1, "a", 100, 50), msg(ts2, "b", 200, 75)]);

    const t = await scanAllJsonl({ projectsDir: root, sinceTs: 0 });

    expect(t.sinceMessageCount).toBe(2);
    expect(t.sinceByModel["claude-opus-4-7"]?.tokensIn).toBe(300);
  });

  it("leaves sinceByModel empty when sinceTs is not provided", async () => {
    await writeProject("p", "conv.jsonl", [msg(ts1, "a", 100, 50)]);

    const t = await scanAllJsonl({ projectsDir: root });

    expect(t.sinceMessageCount).toBe(0);
    expect(Object.keys(t.sinceByModel)).toHaveLength(0);
  });

  it("dedupes by message.id inside the since bucket too", async () => {
    await writeProject("p", "conv.jsonl", [msg(ts3, "dup", 400, 200), msg(ts3, "dup", 400, 200)]);

    const t = await scanAllJsonl({ projectsDir: root, sinceTs: ts2 });

    expect(t.sinceMessageCount).toBe(1);
    expect(t.sinceByModel["claude-opus-4-7"]?.tokensIn).toBe(400);
  });
});
