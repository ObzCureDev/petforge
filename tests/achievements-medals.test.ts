/**
 * Registry hygiene tests for the V3.2 medal-tagged achievement registry.
 *
 * Asserts:
 *   - Every medal-tagged achievement has the expected XP for its tier.
 *   - The hatch ladder has exactly 6 phase entries with no medal field.
 *   - Every family in the threshold table has the expected count of entries.
 *   - The total registry has exactly 46 entries.
 */

import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS } from "../src/core/achievements.js";
import { ACHIEVEMENT_IDS } from "../src/core/schema.js";

describe("V3.2 achievement registry hygiene", () => {
  it("ACHIEVEMENT_IDS has exactly 46 entries", () => {
    expect(ACHIEVEMENT_IDS.length).toBe(46);
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

  it("XP per medal matches the standard scale (1k / 3k / 10k / 30k)", () => {
    const expectedXp: Record<string, number> = {
      bronze: 1_000,
      silver: 3_000,
      gold: 10_000,
      platinum: 30_000,
    };
    for (const id of ACHIEVEMENT_IDS) {
      const def = ACHIEVEMENTS[id];
      if (def.medal) {
        expect(def.xp).toBe(expectedXp[def.medal]);
      }
    }
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
