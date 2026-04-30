/**
 * CardView — `petforge card` full status display.
 *
 * Layout: pet column on the left (renderer + name + XP bar), stats and
 * achievements column on the right. Footer shows session counters.
 *
 * When a Buddy card has been imported (`state.buddy.cardCache` set, toggle
 * "on"), parsed name / rarity / stats override their PetForge counterparts:
 *   - The header shows the Buddy's name (e.g. "Huddle") in place of the
 *     species (e.g. "DAEMON"), and the Buddy's rarity in place of the
 *     PetForge-generated rarity.
 *   - When >= 3 stat lines are parsed from the card, the right column
 *     swaps FOCUS/GRIT/FLOW/CRAFT/SPARK for the Buddy's own stats — so
 *     they don't double up against the same data already shown inside
 *     the imported visual.
 */

import { Box, Text } from "ink";
import type React from "react";
import { parseBuddyCard, pickBuddyFrame } from "../../core/buddy.js";
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
  const buddy = externalFrame ? parseBuddyCard(externalFrame) : undefined;

  const headerName = buddy?.name?.toUpperCase() ?? pet.species.toUpperCase();
  const headerRarity = buddy?.rarity ?? pet.rarity;

  const useBuddyStats = (buddy?.stats.length ?? 0) >= 3;
  const buddyNamePad = useBuddyStats
    ? Math.max(...(buddy?.stats.map((s) => s.name.length) ?? [0])) + 1
    : 7;

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
            {headerName} · {headerRarity}
            {pet.shiny ? " ✨ shiny" : ""}
          </Text>
          <Text dimColor>Phase: {progress.phase}</Text>
          <XpBar progress={progress} />
        </Box>
        <Box flexDirection="column">
          <Text bold>STATS</Text>
          {useBuddyStats && buddy ? (
            buddy.stats.map((s) => (
              <StatBar key={s.name} name={s.name} value={s.value} namePad={buddyNamePad} />
            ))
          ) : (
            <>
              <StatBar name="FOCUS" value={pet.stats.focus} />
              <StatBar name="GRIT" value={pet.stats.grit} />
              <StatBar name="FLOW" value={pet.stats.flow} />
              <StatBar name="CRAFT" value={pet.stats.craft} />
              <StatBar name="SPARK" value={pet.stats.spark} />
            </>
          )}
          <Text> </Text>
          <Text bold>ACHIEVEMENTS</Text>
          <AchievementGrid unlocked={achievements.unlocked} />
        </Box>
      </Box>
      <ActivityBlock state={state} />
    </Box>
  );
}
