/**
 * AchievementGrid — list of all 10 achievements with unlock status.
 *
 * Unlocked → green checkmark + name. Locked → grey square + name.
 */

import { Box, Text } from "ink";
import type React from "react";
import { ACHIEVEMENTS } from "../../core/achievements.js";
import { ACHIEVEMENT_IDS, type AchievementId } from "../../core/schema.js";

export interface AchievementGridProps {
  unlocked: readonly string[];
}

export function AchievementGrid({ unlocked }: AchievementGridProps): React.ReactElement {
  const unlockedSet = new Set(unlocked);
  return (
    <Box flexDirection="column">
      {ACHIEVEMENT_IDS.map((id) => {
        const isUnlocked = unlockedSet.has(id);
        const def = ACHIEVEMENTS[id as AchievementId];
        return (
          <Box key={id}>
            <Text color={isUnlocked ? "green" : "gray"}>
              {isUnlocked ? "✓" : "·"} {def.name}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
