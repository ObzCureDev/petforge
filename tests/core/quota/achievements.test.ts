import { describe, expect, it } from "vitest";
import { generatePet } from "../../../src/core/pet-engine.js";
import { checkQuotaAchievements } from "../../../src/core/quota/achievements.js";
import { createInitialState } from "../../../src/core/schema.js";
import { ensureQuotaCounters } from "../../../src/core/state.js";

function freshState() {
  const pet = generatePet({ username: "ci", hostname: "ci" });
  const s = createInitialState(pet, 0);
  ensureQuotaCounters(s);
  // make non-inert
  const q = s.counters.quota;
  if (!q) throw new Error("quota not initialised");
  q.optIn = true;
  q.lastProbeTs = 1;
  return s;
}

describe("quota/achievements", () => {
  it("does nothing when opt-out", () => {
    const pet = generatePet({ username: "ci", hostname: "ci" });
    const s = createInitialState(pet, 0);
    ensureQuotaCounters(s);
    expect(checkQuotaAchievements(s)).toEqual([]);
    expect(s.achievements.unlocked).toEqual([]);
  });

  it("does nothing when lastProbeTs === 0 even if opt-in", () => {
    const pet = generatePet({ username: "ci", hostname: "ci" });
    const s = createInitialState(pet, 0);
    ensureQuotaCounters(s);
    const q = s.counters.quota;
    if (!q) throw new Error();
    q.optIn = true;
    expect(checkQuotaAchievements(s)).toEqual([]);
  });

  it("unlocks efficient bronze at 5 consecutive efficient closes", () => {
    const s = freshState();
    const q = s.counters.quota;
    if (!q) throw new Error();
    q.consecutiveEfficient = 5;
    const unlocked = checkQuotaAchievements(s);
    expect(unlocked).toContain("quota_efficient_bronze");
    expect(s.achievements.unlocked).toContain("quota_efficient_bronze");
  });

  it("unlocks efficient silver at 20, gold at 100", () => {
    const s = freshState();
    const q = s.counters.quota;
    if (!q) throw new Error();
    q.consecutiveEfficient = 100;
    const unlocked = checkQuotaAchievements(s);
    expect(unlocked).toEqual(
      expect.arrayContaining([
        "quota_efficient_bronze",
        "quota_efficient_silver",
        "quota_efficient_gold",
      ]),
    );
  });

  it("unlocks marathon tiers at 1, 10, 50", () => {
    const s = freshState();
    const q = s.counters.quota;
    if (!q) throw new Error();
    q.marathonCount = 50;
    const unlocked = checkQuotaAchievements(s);
    expect(unlocked).toEqual(
      expect.arrayContaining([
        "quota_marathon_bronze",
        "quota_marathon_silver",
        "quota_marathon_gold",
      ]),
    );
  });

  it("is idempotent - second call returns nothing newly unlocked", () => {
    const s = freshState();
    const q = s.counters.quota;
    if (!q) throw new Error();
    q.marathonCount = 1;
    checkQuotaAchievements(s);
    expect(checkQuotaAchievements(s)).toEqual([]);
  });
});
