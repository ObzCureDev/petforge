/**
 * StatBar — single-line stat row for the card view.
 *
 *   NAME   [████░░░░░░] 40
 *
 * Stats are 0..100; bar is 10 cells.
 */

import { Box, Text } from "ink";
import type React from "react";

export interface StatBarProps {
  name: string;
  value: number;
  /** Bar width in chars; defaults to 10. */
  width?: number;
  /** Name column width in chars; defaults to 7 (PetForge stats). */
  namePad?: number;
}

export function StatBar({
  name,
  value,
  width = 10,
  namePad = 7,
}: StatBarProps): React.ReactElement {
  const clamped = Math.max(0, Math.min(100, value));
  const filled = Math.round((clamped / 100) * width);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  return (
    <Box>
      <Text>{name.padEnd(namePad)}</Text>
      <Text color="green">{bar}</Text>
      <Text> {value}</Text>
    </Box>
  );
}
