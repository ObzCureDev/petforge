/**
 * ActivityBlock — single-line dim activity counters.
 *
 * Shared between `petforge card` and `petforge watch` so both views stay
 * in sync. Layout: one line of `Sessions / Streak / Prompts / Tools`
 * separated by " · ".
 */

import { Box, Text } from "ink";
import type React from "react";
import type { State } from "../../core/schema.js";

export interface ActivityBlockProps {
  state: State;
}

export function ActivityBlock({ state }: ActivityBlockProps): React.ReactElement {
  const { counters } = state;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>
        Sessions: {counters.sessionsTotal} · Streak: {counters.streakDays}d · Prompts:{" "}
        {counters.promptsTotal} · Tools: {counters.toolUseTotal}
      </Text>
    </Box>
  );
}
