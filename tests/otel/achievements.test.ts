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

  it("code_architect fires at 10k lines added", () => {
    const s = withOtel();
    otelOf(s).linesAdded = 10_000;
    const newly = checkOtelAchievements(s);
    expect(newly).toContain("code_architect");
  });

  it("code_titan fires at 100k lines added", () => {
    const s = withOtel();
    otelOf(s).linesAdded = 100_000;
    const newly = checkOtelAchievements(s);
    expect(newly).toContain("code_titan");
    expect(newly).toContain("code_architect"); // both fire
  });

  it("token_whisperer_v2 fires at 1M tokens (in+out)", () => {
    const s = withOtel();
    otelOf(s).tokensIn = 600_000;
    otelOf(s).tokensOut = 400_000;
    const newly = checkOtelAchievements(s);
    expect(newly).toContain("token_whisperer_v2");
  });

  it("cache_lord requires ratio >= 0.80 AND >= 100k input+cache_read", () => {
    const s = withOtel();
    otelOf(s).tokensIn = 20_000;
    otelOf(s).tokensCacheRead = 80_000;
    let newly = checkOtelAchievements(s);
    expect(newly).toContain("cache_lord");

    // ratio satisfied but volume too low
    const s2 = withOtel();
    otelOf(s2).tokensIn = 200;
    otelOf(s2).tokensCacheRead = 800;
    newly = checkOtelAchievements(s2);
    expect(newly).not.toContain("cache_lord");
  });

  it("frugal_coder requires 100 prompts AND <= $1 cost", () => {
    const s = withOtel();
    s.counters.promptsTotal = 100;
    otelOf(s).costUsdCents = 100;
    let newly = checkOtelAchievements(s);
    expect(newly).toContain("frugal_coder");

    const s2 = withOtel();
    s2.counters.promptsTotal = 100;
    otelOf(s2).costUsdCents = 101;
    newly = checkOtelAchievements(s2);
    expect(newly).not.toContain("frugal_coder");
  });

  it("big_spender at $100 cumulative", () => {
    const s = withOtel();
    otelOf(s).costUsdCents = 10_000;
    const newly = checkOtelAchievements(s);
    expect(newly).toContain("big_spender");
  });

  it("pr_machine at 50 PRs", () => {
    const s = withOtel();
    otelOf(s).prCount = 50;
    expect(checkOtelAchievements(s)).toContain("pr_machine");
  });

  it("picky_reviewer at 50 edits rejected", () => {
    const s = withOtel();
    otelOf(s).editsRejected = 50;
    expect(checkOtelAchievements(s)).toContain("picky_reviewer");
  });

  it("no re-fire when already unlocked", () => {
    const s = withOtel();
    otelOf(s).linesAdded = 10_000;
    s.achievements.unlocked.push("code_architect");
    const newly = checkOtelAchievements(s);
    expect(newly).not.toContain("code_architect");
  });

  it("XP awarded equals registry XP", () => {
    const s = withOtel();
    otelOf(s).linesAdded = 10_000;
    const before = s.progress.xp;
    checkOtelAchievements(s);
    expect(s.progress.xp).toBe(before + 3_000);
  });
});
