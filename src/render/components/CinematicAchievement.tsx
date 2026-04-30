/**
 * CinematicAchievement — sequential banner per pending achievement (~1.2s each).
 *
 * Iterates through the supplied id list, rendering a single yellow banner
 * with the achievement name and XP per step. Calls `onDone` after the
 * final step. Empty list → calls `onDone` synchronously on mount.
 */

import { Box, Text } from "ink";
import type React from "react";
import { useEffect, useState } from "react";
import { ACHIEVEMENTS } from "../../core/achievements.js";
import { ACHIEVEMENT_IDS, type AchievementId } from "../../core/schema.js";

export interface CinematicAchievementProps {
  ids: readonly string[];
  onDone: () => void;
  /** Per-step duration (ms) — defaults to 1200. */
  durationMs?: number;
}

function isKnownId(id: string): id is AchievementId {
  return (ACHIEVEMENT_IDS as readonly string[]).includes(id);
}

export function CinematicAchievement({
  ids,
  onDone,
  durationMs = 1200,
}: CinematicAchievementProps): React.ReactElement | null {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (ids.length === 0) {
      onDone();
      return;
    }
    if (i >= ids.length) {
      onDone();
      return;
    }
    const t = setTimeout(() => {
      setI((cur) => cur + 1);
    }, durationMs);
    return (): void => {
      clearTimeout(t);
    };
  }, [i, ids, onDone, durationMs]);

  if (ids.length === 0 || i >= ids.length) return null;
  const id = ids[i];
  if (!id || !isKnownId(id)) {
    // Defensive: if state has a phantom id, just show it raw rather than crash.
    return (
      <Box flexDirection="column">
        <Text color="yellow">★ Achievement unlocked!</Text>
        <Text bold>{id ?? "(unknown)"}</Text>
      </Box>
    );
  }
  const def = ACHIEVEMENTS[id];

  return (
    <Box flexDirection="column">
      <Text color="yellow">★ Achievement unlocked!</Text>
      <Text bold>{def.name}</Text>
      <Text>+{def.xp} XP</Text>
    </Box>
  );
}
