/**
 * SnapshotView — the small, default `petforge` view.
 *
 * Shows the pet at a given animation frame plus the XP bar. Used both by
 * the static non-TTY path and as the inner stage of the idle animation.
 */

import { Box, Text } from "ink";
import type React from "react";
import { parseBuddyCard, pickBuddyFrame, stripBuddyStatLines } from "../../core/buddy.js";
import type { State } from "../../core/schema.js";
import { PetRenderer } from "./PetRenderer.js";
import { XpBar } from "./XpBar.js";

export interface SnapshotViewProps {
  state: State;
  /** Animation frame counter; defaults to 0 (static frame). */
  frameIndex?: number;
}

export function SnapshotView({ state, frameIndex = 0 }: SnapshotViewProps): React.ReactElement {
  const rawFrame = pickBuddyFrame(state);
  const buddy = rawFrame ? parseBuddyCard(rawFrame) : undefined;
  const headerName = buddy?.name?.toUpperCase() ?? state.pet.species.toUpperCase();
  const headerRarity = buddy?.rarity ?? state.pet.rarity;
  const useBuddyStats = (buddy?.stats.length ?? 0) >= 3;
  const externalFrame =
    rawFrame !== undefined && useBuddyStats ? stripBuddyStatLines(rawFrame) : rawFrame;
  return (
    <Box flexDirection="column">
      <PetRenderer
        pet={state.pet}
        phase={state.progress.phase}
        frameIndex={frameIndex}
        externalFrame={externalFrame}
      />
      <Text>
        {headerName} · {headerRarity}
        {state.pet.shiny ? " ✨ shiny" : ""}
      </Text>
      <XpBar progress={state.progress} />
    </Box>
  );
}
