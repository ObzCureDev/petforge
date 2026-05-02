/**
 * V3.1 -> V3.2 achievement ID rename.
 *
 * V3.1 used a mix of singletons (hatch, centurion, polyglot, ...) and
 * tier suffixes (streak_3d, tool_whisperer / tool_master / tool_legend, ...).
 * V3.2 unifies on `<family>_<threshold>` with the medal label moved to a
 * dedicated `medal` field on the registry. `first_tool` is dropped (the
 * tool family covers all tool-count progression); `centurion` folds into
 * `hatch_mythic` (the 6th rung of the hatch phase ladder).
 *
 * The function is pure and idempotent: it operates on the `unlocked` and
 * `pendingUnlocks` arrays in `state.achievements`, returning a fresh
 * object. XP carried by these unlocks is already in `state.progress.xp`
 * - the migration does not touch XP.
 */

/**
 * Mapping V3.1 ID -> V3.2 ID, or `null` to drop. Anything not in this
 * map is passed through unchanged (forward compatibility for V3.2+ IDs
 * already present, plus a safe-default for unknown strings).
 */
export const MIGRATION_MAP_V31_TO_V32: Readonly<Record<string, string | null>> = {
  hatch: "hatch_hatchling",
  first_tool: null,
  marathon: "marathon_4h",
  ultra_marathon: "marathon_12h",
  night_owl: "night_200",
  nocturnal: "night_1k",
  streak_3d: "streak_3d",
  streak_7d: "streak_7d",
  streak_30d: "streak_30d",
  streak_100d: "streak_100d",
  polyglot: "polyglot_5",
  refactor_master: "refactor_100",
  tool_whisperer: "tool_5k",
  tool_master: "tool_25k",
  tool_legend: "tool_100k",
  centurion: "hatch_mythic",
  code_architect: "code_10k",
  code_titan: "code_50k",
  token_whisperer_v2: "token_1m",
  cache_lord: "cache_100k",
  frugal_coder: "frugal_100p",
  big_spender: "big_spender_100",
  pr_machine: "pr_50",
  picky_reviewer: "picky_50",
};

export interface AchievementListsV31Or32 {
  unlocked: string[];
  pendingUnlocks: string[];
}

/**
 * Apply the rename map to both `unlocked` and `pendingUnlocks`. IDs that
 * map to `null` are dropped; IDs not in the map are kept as-is.
 *
 * Pure: returns a fresh object, does not mutate input. Idempotent:
 * running on V3.2 IDs is a no-op (they're not keys in the map, so they
 * pass through unchanged).
 */
export function migrateV31Achievements(lists: AchievementListsV31Or32): AchievementListsV31Or32 {
  return {
    unlocked: rename(lists.unlocked),
    pendingUnlocks: rename(lists.pendingUnlocks),
  };
}

function rename(ids: string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (id in MIGRATION_MAP_V31_TO_V32) {
      const mapped = MIGRATION_MAP_V31_TO_V32[id];
      if (mapped === null || mapped === undefined) continue; // dropped
      out.push(mapped);
    } else {
      out.push(id); // unknown - keep as-is
    }
  }
  return out;
}
