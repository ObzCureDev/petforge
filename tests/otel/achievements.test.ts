import { describe, expect, it } from "vitest";
import { checkOtelAchievements } from "../../src/core/otel/achievements.js";
import type { OtelCounters } from "../../src/core/otel/schema.js";
import { generatePet } from "../../src/core/pet-engine.js";
import { createInitialState, type State } from "../../src/core/schema.js";

function fresh(): State {
  return createInitialState(generatePet({ username: "u", hostname: "h" }), 0);
}

function otelOf(state: State): OtelCounters {
  if (!state.counters.otel) throw new Error("otel must be initialized");
  return state.counters.otel;
}

function withOtel(): State {
  const s = fresh();
  const otel = otelOf(s);
  s.counters.otel = { ...otel, lastUpdate: 1, ingesterStarted: 1 };
  return s;
}

describe("checkOtelAchievements", () => {
  it("nothing fires when otel.lastUpdate === 0 (gating)", () => {
    const s = fresh();
    const otel = otelOf(s);
    s.counters.otel = { ...otel, linesAdded: 100_000 };
    const newly = checkOtelAchievements(s);
    expect(newly).toHaveLength(0);
  });

  it("code_10k fires at 10k lines added", () => {
    const s = withOtel();
    otelOf(s).linesAdded = 10_000;
    const newly = checkOtelAchievements(s);
    expect(newly).toContain("code_10k");
  });

  it("code_50k fires at 50k lines added", () => {
    const s = withOtel();
    otelOf(s).linesAdded = 50_000;
    const newly = checkOtelAchievements(s);
    expect(newly).toContain("code_50k");
    expect(newly).toContain("code_10k"); // both fire
  });

  it("token_1m fires at 1M tokens (in+out)", () => {
    const s = withOtel();
    otelOf(s).tokensIn = 600_000;
    otelOf(s).tokensOut = 400_000;
    const newly = checkOtelAchievements(s);
    expect(newly).toContain("token_1m");
  });

  it("cache_100k requires ratio >= 0.80 AND >= 100k input+cache_read", () => {
    const s = withOtel();
    otelOf(s).tokensIn = 20_000;
    otelOf(s).tokensCacheRead = 80_000;
    let newly = checkOtelAchievements(s);
    expect(newly).toContain("cache_100k");

    // ratio satisfied but volume too low
    const s2 = withOtel();
    otelOf(s2).tokensIn = 200;
    otelOf(s2).tokensCacheRead = 800;
    newly = checkOtelAchievements(s2);
    expect(newly).not.toContain("cache_100k");
  });

  it("frugal_100p requires 100 prompts AND <= $1 cost", () => {
    const s = withOtel();
    s.counters.promptsTotal = 100;
    otelOf(s).costUsdCents = 100;
    let newly = checkOtelAchievements(s);
    expect(newly).toContain("frugal_100p");

    const s2 = withOtel();
    s2.counters.promptsTotal = 100;
    otelOf(s2).costUsdCents = 101;
    newly = checkOtelAchievements(s2);
    expect(newly).not.toContain("frugal_100p");
  });

  it("big_spender_100 at $100 cumulative", () => {
    const s = withOtel();
    otelOf(s).costUsdCents = 10_000;
    const newly = checkOtelAchievements(s);
    expect(newly).toContain("big_spender_100");
  });

  it("pr_50 at 50 PRs", () => {
    const s = withOtel();
    otelOf(s).prCount = 50;
    expect(checkOtelAchievements(s)).toContain("pr_50");
  });

  it("picky_50 at 50 edits rejected", () => {
    const s = withOtel();
    otelOf(s).editsRejected = 50;
    expect(checkOtelAchievements(s)).toContain("picky_50");
  });

  it("no re-fire when already unlocked", () => {
    const s = withOtel();
    otelOf(s).linesAdded = 10_000;
    s.achievements.unlocked.push("code_10k");
    const newly = checkOtelAchievements(s);
    expect(newly).not.toContain("code_10k");
  });

  it("XP awarded equals registry XP", () => {
    const s = withOtel();
    otelOf(s).linesAdded = 10_000;
    const before = s.progress.xp;
    checkOtelAchievements(s);
    // code_10k is bronze tier = 1000 xp
    expect(s.progress.xp).toBe(before + 1_000);
  });
});
