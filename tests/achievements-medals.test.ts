/**
 * Registry hygiene tests for the V3.2 medal-tagged achievement registry,
 * extended in V3.7 with the quota family (which uses its own XP scale).
 *
 * Asserts:
 *   - Every V3.2 medal-tagged achievement has the standard 1k/3k/10k/30k XP.
 *   - V3.7 quota_* achievements use their own family-specific scale.
 *   - The hatch ladder has exactly 6 phase entries with no medal field.
 *   - Every family in the threshold table has the expected count of entries.
 *   - The total registry has exactly 52 entries (46 V3.2 + 6 V3.7 quota).
 */

import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS } from "../src/core/achievements.js";
import { ACHIEVEMENT_IDS } from "../src/core/schema.js";

describe("V3.2 achievement registry hygiene", () => {
  it("ACHIEVEMENT_IDS has exactly 52 entries (46 V3.2 + 6 V3.7 quota)", () => {
    expect(ACHIEVEMENT_IDS.length).toBe(52);
  });

  it("every ID in ACHIEVEMENT_IDS has a registry entry", () => {
    for (const id of ACHIEVEMENT_IDS) {
      expect(ACHIEVEMENTS[id]).toBeDefined();
    }
  });

  it("hatch ladder has 6 entries, none with a medal", () => {
    const hatchIds = ACHIEVEMENT_IDS.filter((id) => id.startsWith("hatch_"));
    expect(hatchIds).toEqual([
      "hatch_egg",
      "hatch_hatchling",
      "hatch_junior",
      "hatch_adult",
      "hatch_elder",
      "hatch_mythic",
    ]);
    for (const id of hatchIds) {
      expect(ACHIEVEMENTS[id].medal).toBeUndefined();
    }
  });

  it("V3.2 medal-tagged XP matches the standard scale (1k / 3k / 10k / 30k)", () => {
    const expectedXp: Record<string, number> = {
      bronze: 1_000,
      silver: 3_000,
      gold: 10_000,
      platinum: 30_000,
    };
    for (const id of ACHIEVEMENT_IDS) {
      // V3.7 quota_* family uses its own family-specific XP scale.
      if (id.startsWith("quota_")) continue;
      const def = ACHIEVEMENTS[id];
      if (def.medal) {
        expect(def.xp).toBe(expectedXp[def.medal]);
      }
    }
  });

  it("V3.7 quota achievements use the documented quota XP scale", () => {
    // Spec §"Achievements" - quota_efficient_* and quota_marathon_* use
    // their own scale to reflect different effort signals (sustained vs spike).
    expect(ACHIEVEMENTS.quota_efficient_bronze.xp).toBe(500);
    expect(ACHIEVEMENTS.quota_efficient_silver.xp).toBe(2_000);
    expect(ACHIEVEMENTS.quota_efficient_gold.xp).toBe(10_000);
    expect(ACHIEVEMENTS.quota_marathon_bronze.xp).toBe(300);
    expect(ACHIEVEMENTS.quota_marathon_silver.xp).toBe(1_500);
    expect(ACHIEVEMENTS.quota_marathon_gold.xp).toBe(7_500);
  });

  it("every family has 3 medal entries (streak has 4)", () => {
    const familyCount: Record<string, number> = {};
    for (const id of ACHIEVEMENT_IDS) {
      const def = ACHIEVEMENTS[id];
      if (!def.medal) continue;
      const family = id.split("_")[0];
      if (family !== undefined) {
        familyCount[family] = (familyCount[family] || 0) + 1;
      }
    }
    expect(familyCount.streak).toBe(4);
    expect(familyCount.tool).toBe(3);
    expect(familyCount.marathon).toBe(3);
    expect(familyCount.night).toBe(3);
    expect(familyCount.polyglot).toBe(3);
    expect(familyCount.refactor).toBe(3);
    expect(familyCount.code).toBe(3);
    expect(familyCount.token).toBe(3);
    expect(familyCount.cache).toBe(3);
    expect(familyCount.frugal).toBe(3);
    expect(familyCount.big).toBe(3); // big_spender - split() keeps the first segment
    expect(familyCount.pr).toBe(3);
    expect(familyCount.picky).toBe(3);
    // V3.7 - quota_efficient_* (3) + quota_marathon_* (3) = 6 medal entries
    // under the "quota" prefix.
    expect(familyCount.quota).toBe(6);
  });

  it("every medal-tagged achievement has bronze/silver/gold/platinum value", () => {
    const allowed = new Set(["bronze", "silver", "gold", "platinum"]);
    for (const id of ACHIEVEMENT_IDS) {
      const m = ACHIEVEMENTS[id].medal;
      if (m !== undefined) {
        expect(allowed.has(m)).toBe(true);
      }
    }
  });
});
