/**
 * Tests for src/core/migrations/v32-achievement-rename.ts.
 *
 * Idempotent rename of V3.1 achievement IDs to V3.2 IDs. Drops obsolete
 * `first_tool` (the tool family covers it). XP carried by the original
 * unlocks is already in state.progress.xp - this migration only touches
 * the `unlocked` and `pendingUnlocks` arrays.
 */

import { describe, expect, it } from "vitest";
import {
  MIGRATION_MAP_V31_TO_V32,
  migrateV31Achievements,
} from "../src/core/migrations/v32-achievement-rename.js";

describe("migrateV31Achievements", () => {
  const ROWS: Array<[string, string | null]> = [
    ["hatch", "hatch_hatchling"],
    ["first_tool", null],
    ["marathon", "marathon_4h"],
    ["ultra_marathon", "marathon_12h"],
    ["night_owl", "night_200"],
    ["nocturnal", "night_1k"],
    ["streak_3d", "streak_3d"],
    ["streak_7d", "streak_7d"],
    ["streak_30d", "streak_30d"],
    ["streak_100d", "streak_100d"],
    ["polyglot", "polyglot_5"],
    ["refactor_master", "refactor_100"],
    ["tool_whisperer", "tool_5k"],
    ["tool_master", "tool_25k"],
    ["tool_legend", "tool_100k"],
    ["centurion", "hatch_mythic"],
    ["code_architect", "code_10k"],
    ["code_titan", "code_50k"],
    ["token_whisperer_v2", "token_1m"],
    ["cache_lord", "cache_100k"],
    ["frugal_coder", "frugal_100p"],
    ["big_spender", "big_spender_100"],
    ["pr_machine", "pr_50"],
    ["picky_reviewer", "picky_50"],
  ];

  it("maps every V3.1 ID to its V3.2 successor (or null = drop)", () => {
    for (const [v31, v32] of ROWS) {
      expect(MIGRATION_MAP_V31_TO_V32[v31]).toBe(v32);
    }
  });

  it("renames each non-dropped ID inside `unlocked`", () => {
    for (const [v31, v32] of ROWS) {
      if (v32 === null) continue; // dropped
      const out = migrateV31Achievements({ unlocked: [v31], pendingUnlocks: [] });
      expect(out.unlocked).toEqual([v32]);
    }
  });

  it("drops V3.1 IDs that map to null", () => {
    const out = migrateV31Achievements({
      unlocked: ["first_tool", "streak_3d"],
      pendingUnlocks: [],
    });
    expect(out.unlocked).toEqual(["streak_3d"]);
  });

  it("renames inside `pendingUnlocks` the same way", () => {
    const out = migrateV31Achievements({
      unlocked: [],
      pendingUnlocks: ["centurion", "first_tool", "tool_whisperer"],
    });
    // first_tool dropped; centurion -> hatch_mythic; tool_whisperer -> tool_5k
    expect(out.pendingUnlocks).toEqual(["hatch_mythic", "tool_5k"]);
  });

  it("is idempotent - running twice yields the same output", () => {
    const before = {
      unlocked: ["hatch", "first_tool", "tool_whisperer", "streak_3d"],
      pendingUnlocks: ["centurion"],
    };
    const once = migrateV31Achievements(before);
    const twice = migrateV31Achievements(once);
    expect(twice).toEqual(once);
  });

  it("leaves V3.2 IDs untouched", () => {
    const v32Only = {
      unlocked: ["hatch_hatchling", "tool_5k", "marathon_4h", "streak_30d"],
      pendingUnlocks: ["night_1k"],
    };
    expect(migrateV31Achievements(v32Only)).toEqual(v32Only);
  });

  it("preserves order within unlocked / pendingUnlocks", () => {
    const out = migrateV31Achievements({
      unlocked: ["streak_3d", "tool_whisperer", "centurion", "polyglot"],
      pendingUnlocks: [],
    });
    expect(out.unlocked).toEqual(["streak_3d", "tool_5k", "hatch_mythic", "polyglot_5"]);
  });

  it("ignores unknown IDs (keeps them as-is for forward compat)", () => {
    const out = migrateV31Achievements({
      unlocked: ["future_achievement", "tool_whisperer"],
      pendingUnlocks: [],
    });
    expect(out.unlocked).toEqual(["future_achievement", "tool_5k"]);
  });
});
