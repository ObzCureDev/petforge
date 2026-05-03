/**
 * SnapshotView — the small, default `petforge` view.
 *
 * Shows the pet at a given animation frame plus the XP bar. Used both by
 * the static non-TTY path and as the inner stage of the idle animation.
 */

import { Box, Text } from "ink";
import type React from "react";
import { parseBuddyCard, pickBuddySpecies } from "../../core/buddy.js";
import type { State } from "../../core/schema.js";
import { rarityColor } from "../rarity-color.js";
import { PetRenderer } from "./PetRenderer.js";
import { XpBar } from "./XpBar.js";

export interface SnapshotViewProps {
  state: State;
  /** Animation frame counter; defaults to 0 (static frame). */
  frameIndex?: number;
}

export function SnapshotView({ state, frameIndex = 0 }: SnapshotViewProps): React.ReactElement {
  const buddySpecies = pickBuddySpecies(state);
  const cache =
    state.buddy.userToggle === "on" && state.buddy.cardCache ? state.buddy.cardCache : undefined;
  const buddy = cache ? parseBuddyCard(cache) : undefined;
  const headerName =
    buddy?.name?.toUpperCase() ?? (buddySpecies ?? state.pet.species).toUpperCase();
  const headerRarity = buddy?.rarity ?? state.pet.rarity;
  return (
    <Box flexDirection="column">
      <PetRenderer
        pet={state.pet}
        phase={state.progress.phase}
        frameIndex={frameIndex}
        speciesOverride={buddySpecies}
      />
      <Text>
        {headerName} · <Text color={rarityColor(headerRarity)}>{headerRarity}</Text> ·{" "}
        {state.progress.phase}
        {state.pet.shiny ? " ✨ shiny" : ""}
      </Text>
      <XpBar progress={state.progress} />
    </Box>
  );
}
