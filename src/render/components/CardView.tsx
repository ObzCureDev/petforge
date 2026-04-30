/**
 * CardView — `petforge card` full status display.
 *
 * Layout: pet column on the left (renderer + name + XP bar), stats and
 * achievements column on the right. Footer shows session counters.
 */

import { Box, Text } from "ink";
import type React from "react";
import { pickBuddyFrame } from "../../core/buddy.js";
import type { State } from "../../core/schema.js";
import { AchievementGrid } from "./AchievementGrid.js";
import { ActivityBlock } from "./ActivityBlock.js";
import { PetRenderer } from "./PetRenderer.js";
import { StatBar } from "./StatBar.js";
import { XpBar } from "./XpBar.js";

export interface CardViewProps {
  state: State;
  /** Optional animation frame; default 0 makes the card a static snapshot. */
  frameIndex?: number;
}

export function CardView({ state, frameIndex = 0 }: CardViewProps): React.ReactElement {
  const { pet, progress, achievements } = state;
  const externalFrame = pickBuddyFrame(state);
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Box flexDirection="column" marginRight={2}>
          <PetRenderer
            pet={pet}
            phase={progress.phase}
            frameIndex={frameIndex}
            externalFrame={externalFrame}
          />
          <Text>
            {pet.species.toUpperCase()} · {pet.rarity}
            {pet.shiny ? " ✨ shiny" : ""}
          </Text>
          <Text dimColor>Phase: {progress.phase}</Text>
          <XpBar progress={progress} />
        </Box>
        <Box flexDirection="column">
          <Text bold>STATS</Text>
          <StatBar name="FOCUS" value={pet.stats.focus} />
          <StatBar name="GRIT" value={pet.stats.grit} />
          <StatBar name="FLOW" value={pet.stats.flow} />
          <StatBar name="CRAFT" value={pet.stats.craft} />
          <StatBar name="SPARK" value={pet.stats.spark} />
          <Text> </Text>
          <Text bold>ACHIEVEMENTS</Text>
          <AchievementGrid unlocked={achievements.unlocked} />
        </Box>
      </Box>
      <ActivityBlock state={state} />
    </Box>
  );
}
