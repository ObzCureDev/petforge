import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeSpend, localDateKey, localMidnightMs } from "../../../src/core/spend/compute.js";

/**
 * Scans only a temp projectsDir; never imports state.ts. Cannot touch
 * ~/.petforge/state.json.
 */

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "pf-spend-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function write(file: string, rows: object[]): Promise<void> {
  const dir = path.join(root, "proj");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, file),
    `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`,
    "utf8",
  );
}

function msg(ts: number, id: string, usage: object): object {
  return {
    timestamp: new Date(ts).toISOString(),
    message: { id, model: "claude-opus-4-1", usage },
  };
}

describe("localMidnightMs / localDateKey", () => {
  it("midnight is <= now and on the same local day", () => {
    const now = new Date("2026-05-29T15:30:00Z").getTime();
    const mid = localMidnightMs(now);
    expect(mid).toBeLessThanOrEqual(now);
    expect(new Date(mid).getHours()).toBe(0);
    expect(new Date(mid).getMinutes()).toBe(0);
  });

  it("date key is YYYY-MM-DD", () => {
    expect(localDateKey(new Date("2026-05-29T15:30:00Z").getTime())).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("computeSpend", () => {
  // opus 4.1 (legacy) = $15/MTok in, $75/MTok out. Cache read = 10% input, creation = 125%.
  const now = new Date("2026-05-29T15:00:00Z").getTime();
  const lastWeek = now - 7 * 86_400_000;

  it("splits lifetime vs today and prices both correctly", async () => {
    await write("conv.jsonl", [
      // last week: 1M in, 200k out, no cache
      //   paid = 15 + 15 = $30.00 ; apiEquiv = 15 + 15 = $30.00
      msg(lastWeek, "msg_a", {
        input_tokens: 1_000_000,
        output_tokens: 200_000,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      }),
      // today: 2M in, 100k out, 10M cache read
      //   paid = 30 + (10M*15*0.1/1M=15) + 7.5 = $52.50
      //   apiEquiv = (12M*15/1M=180) + 7.5 = $187.50
      msg(now, "msg_b", {
        input_tokens: 2_000_000,
        output_tokens: 100_000,
        cache_read_input_tokens: 10_000_000,
        cache_creation_input_tokens: 0,
      }),
    ]);

    const s = await computeSpend({ projectsDir: root, now });

    expect(s.lifetimeMessages).toBe(2);
    expect(s.todayMessages).toBe(1);

    // Lifetime = A+B: paid $82.50, api $217.50
    expect(s.lifetimeCents).toBe(8250);
    expect(s.lifetimeApiCents).toBe(21750);

    // Today = B only: paid $52.50, api $187.50
    expect(s.todayCents).toBe(5250);
    expect(s.todayApiCents).toBe(18750);

    expect(s.todayKey).toBe(localDateKey(now));
    expect(s.lastScanTs).toBe(now);
    expect(s.scanMs).toBeGreaterThanOrEqual(0);
  });

  it("today is zero when nothing was used today", async () => {
    await write("conv.jsonl", [
      msg(lastWeek, "msg_a", { input_tokens: 500_000, output_tokens: 0 }),
    ]);

    const s = await computeSpend({ projectsDir: root, now });

    expect(s.lifetimeMessages).toBe(1);
    expect(s.todayMessages).toBe(0);
    expect(s.todayCents).toBe(0);
    expect(s.todayApiCents).toBe(0);
    expect(s.lifetimeCents).toBeGreaterThan(0);
  });

  it("returns zeroed snapshot on an empty projects dir", async () => {
    const s = await computeSpend({ projectsDir: root, now });
    expect(s.lifetimeMessages).toBe(0);
    expect(s.lifetimeCents).toBe(0);
    expect(s.todayCents).toBe(0);
    expect(s.todayKey).toBe(localDateKey(now));
  });
});
