/**
 * XpBar — single-line XP progress bar.
 *
 *   L<level> [████░░░░░░] xpIntoLevel / xpForNextLevel xp
 *
 * At max level, displays "MAX" with cumulative XP instead.
 */

import { Box, Text } from "ink";
import type React from "react";
import type { Progress } from "../../core/schema.js";
import { nextLevelProgress } from "../../core/xp.js";

export interface XpBarProps {
  progress: Progress;
  /** Bar width in chars; defaults to 20. */
  width?: number;
}

export function XpBar({ progress, width = 20 }: XpBarProps): React.ReactElement {
  const p = nextLevelProgress(progress.xp);
  const filled = Math.max(0, Math.min(width, Math.floor(p.ratio * width)));
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  const label = p.isMaxed
    ? `MAX (${progress.xp.toLocaleString()} xp)`
    : `${p.xpIntoLevel.toLocaleString()} / ${p.xpForNextLevel.toLocaleString()} xp`;
  return (
    <Box>
      <Text>L{progress.level} </Text>
      <Text color="cyan">{bar}</Text>
      <Text> {label}</Text>
    </Box>
  );
}
