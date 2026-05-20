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
 *     swaps DEBUGGING/PATIENCE/CHAOS/WISDOM/SNARK for the Buddy's own stats —
 *     so they don't double up against the same data already shown inside
 *     the imported visual.
 */

import { Box, Text } from "ink";
import type React from "react";
import { parseBuddyCard, pickBuddySpecies } from "../../core/buddy.js";
import type { State } from "../../core/schema.js";
import { rarityColor } from "../rarity-color.js";
import { AchievementGrid } from "./AchievementGrid.js";
import { ActivityBlock } from "./ActivityBlock.js";
import { PetRenderer } from "./PetRenderer.js";
import { QuotaBlock } from "./QuotaBlock.js";
import { StatBar } from "./StatBar.js";
import { XpBar } from "./XpBar.js";

export interface CardViewProps {
  state: State;
  /** Optional animation frame; default 0 makes the card a static snapshot. */
  frameIndex?: number;
}

export function CardView({ state, frameIndex = 0 }: CardViewProps): React.ReactElement {
  const { pet, progress, achievements } = state;
  // V3 buddy import: extract { species, name, rarity, stats } from the card
  // and drive OUR animated frames. The static card image is never displayed.
  const buddySpecies = pickBuddySpecies(state);
  const cache =
    state.buddy.userToggle === "on" && state.buddy.cardCache ? state.buddy.cardCache : undefined;
  const buddy = cache ? parseBuddyCard(cache) : undefined;

  const headerName = buddy?.name?.toUpperCase() ?? (buddySpecies ?? pet.species).toUpperCase();
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
            speciesOverride={buddySpecies}
          />
          <Text>
            {headerName} · <Text color={rarityColor(headerRarity)}>{headerRarity}</Text> ·{" "}
            {progress.phase}
            {pet.shiny ? " ✨ shiny" : ""}
          </Text>
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
              <StatBar name="DEBUGGING" value={pet.stats.debugging} />
              <StatBar name="PATIENCE" value={pet.stats.patience} />
              <StatBar name="CHAOS" value={pet.stats.chaos} />
              <StatBar name="WISDOM" value={pet.stats.wisdom} />
              <StatBar name="SNARK" value={pet.stats.snark} />
            </>
          )}
          <QuotaBlock quota={state.counters.quota} />
          <Text> </Text>
          <Text bold>ACHIEVEMENTS</Text>
          <AchievementGrid unlocked={achievements.unlocked} />
        </Box>
      </Box>
      <ActivityBlock state={state} />
    </Box>
  );
}
