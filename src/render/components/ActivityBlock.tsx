/**
 * ActivityBlock — dim activity counters for `petforge card` and `watch`.
 *
 * Composes two sub-lines:
 *   - ActivityV1Line: Sessions / Streak / Prompts / Tools (always rendered)
 *   - OtelLine: Lines / Tokens / Cost / Cache (V2.0; rendered only when
 *     the OTel collector has ingested data, otherwise null)
 *
 * V1.x users without OTel see only the original line — no behavioural
 * change for them.
 */

import { Box } from "ink";
import type React from "react";
import type { State } from "../../core/schema.js";
import { ActivityV1Line } from "./ActivityV1Line.js";
import { OtelLine } from "./OtelLine.js";

export interface ActivityBlockProps {
  state: State;
}

export function ActivityBlock({ state }: ActivityBlockProps): React.ReactElement {
  return (
    <Box flexDirection="column" marginTop={1}>
      <ActivityV1Line state={state} />
      <OtelLine state={state} />
    </Box>
  );
}
