/**
 * XP / level / phase engine.
 *
 * Spec §8 (V1.1). The level curve is piecewise non-linear, anchored at 5
 * boundary (level, xp) pairs. Within each segment the curve is `t^1.55`
 * interpolation. The 5 anchor values are part of the locked design and must
 * be returned exactly by `xpForLevel`:
 *
 *     level   xp
 *      1            0
 *     12        2_000
 *     30       30_000
 *     60      100_000
 *    100    1_000_000
 *
 * Levels are capped at 100 for display purposes; cumulative XP is **not**
 * capped — the user can keep accumulating XP past 1M.
 *
 * Phase mapping (V1.1):
 *     egg         1..4
 *     hatchling   5..11
 *     junior     12..29
 *     adult      30..59
 *     elder      60..99
 *     mythic       100
 */

import type { Phase } from "./schema.js";

export const LEVEL_BOUNDARIES = [
  { level: 1, xp: 0 },
  { level: 12, xp: 2_000 },
  { level: 30, xp: 30_000 },
  { level: 60, xp: 100_000 },
  { level: 100, xp: 1_000_000 },
] as const;

const MAX_LEVEL = 100;
const MAX_LEVEL_XP = 1_000_000;

/**
 * XP required to reach the start of `level`.
 *
 * - level <= 1 returns 0
 * - level >= 100 returns 1_000_000
 * - between boundaries, interpolated with a `t^1.55` curve
 */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  if (level >= MAX_LEVEL) return MAX_LEVEL_XP;

  const upperIndex = LEVEL_BOUNDARIES.findIndex((b) => level <= b.level);
  const upper = LEVEL_BOUNDARIES[upperIndex];
  const lower = LEVEL_BOUNDARIES[upperIndex - 1];
  if (!upper || !lower) {
    // Should be impossible given the level bounds enforced above, but
    // this satisfies noUncheckedIndexedAccess.
    throw new Error(`xpForLevel: invalid level ${level}`);
  }

  const t = (level - lower.level) / (upper.level - lower.level);
  const curved = t ** 1.55;
  return Math.floor(lower.xp + (upper.xp - lower.xp) * curved);
}

/**
 * Highest level L (1..100) such that `xpForLevel(L) <= xp`.
 *
 * Linear scan — only 100 iterations, trivially correct.
 */
export function levelForXp(xp: number): number {
  if (xp <= 0) return 1;
  for (let level = MAX_LEVEL; level >= 1; level--) {
    if (xpForLevel(level) <= xp) return level;
  }
  return 1;
}

export function phaseForLevel(level: number): Phase {
  if (level >= 100) return "mythic";
  if (level >= 60) return "elder";
  if (level >= 30) return "adult";
  if (level >= 12) return "junior";
  if (level >= 5) return "hatchling";
  return "egg";
}

export interface LevelProgress {
  currentLevel: number;
  /** `currentLevel + 1`, or 100 when already maxed. */
  nextLevel: number;
  currentLevelXp: number;
  /** XP required to reach `nextLevel`, or `MAX_LEVEL_XP` if maxed. */
  nextLevelXp: number;
  /** `xp - currentLevelXp` (or `xp - MAX_LEVEL_XP` past cap). */
  xpIntoLevel: number;
  /** XP span between `currentLevel` and `nextLevel` (1 when maxed, to avoid /0). */
  xpForNextLevel: number;
  /** Progress in [0, 1]. */
  ratio: number;
  isMaxed: boolean;
}

/**
 * Compute progress between the current level and the next, suitable for an
 * XP bar. When the user is at the level cap, `ratio === 1` and `isMaxed === true`.
 */
export function nextLevelProgress(xp: number): LevelProgress {
  const currentLevel = levelForXp(xp);
  const currentLevelXp = xpForLevel(currentLevel);

  if (currentLevel >= MAX_LEVEL) {
    return {
      currentLevel: MAX_LEVEL,
      nextLevel: MAX_LEVEL,
      currentLevelXp: MAX_LEVEL_XP,
      nextLevelXp: MAX_LEVEL_XP,
      xpIntoLevel: xp - MAX_LEVEL_XP,
      xpForNextLevel: 1,
      ratio: 1,
      isMaxed: true,
    };
  }

  const nextLevel = currentLevel + 1;
  const nextLevelXp = xpForLevel(nextLevel);
  const xpIntoLevel = xp - currentLevelXp;
  const xpForNextLevel = nextLevelXp - currentLevelXp;
  const ratio = xpForNextLevel > 0 ? xpIntoLevel / xpForNextLevel : 0;

  return {
    currentLevel,
    nextLevel,
    currentLevelXp,
    nextLevelXp,
    xpIntoLevel,
    xpForNextLevel,
    ratio,
    isMaxed: false,
  };
}
