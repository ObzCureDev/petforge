/**
 * ActivityV1Line — the original V1 single-line activity counters
 * (Sessions / Streak / Prompts / Tools).
 *
 * Split out of ActivityBlock so the V2 OTel sub-line can sit alongside it
 * without changing V1 output.
 */

import { Text } from "ink";
import type React from "react";
import type { State } from "../../core/schema.js";

export function ActivityV1Line({ state }: { state: State }): React.ReactElement {
  const { counters } = state;
  return (
    <Text dimColor>
      Sessions: {counters.sessionsTotal} · Streak: {counters.streakDays}d · Prompts:{" "}
      {counters.promptsTotal} · Tools: {counters.toolUseTotal}
    </Text>
  );
}
