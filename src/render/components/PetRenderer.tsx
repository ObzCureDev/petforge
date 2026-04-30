/**
 * PetRenderer — wraps the species/phase ASCII frame and applies effects.
 *
 * Splits the styled output into one `<Text>` per line so Ink lays out the
 * pet column cleanly. The optional `externalFrame` lets callers replace
 * the species frame with an external visual (e.g. Buddy stdout) while
 * keeping the same effect pipeline.
 */

import { Box, Text } from "ink";
import type React from "react";
import type { Pet, Phase } from "../../core/schema.js";
import { applyAllEffects } from "../effects.js";
import { SPECIES_FRAMES } from "../species/index.js";

export interface PetRendererProps {
  pet: Pet;
  phase: Phase;
  /** Animation frame counter; cycles through species frames at index%length. */
  frameIndex: number;
  /** Optional override for the base frame (e.g. a Buddy stdout visual). */
  externalFrame?: string;
}

export function PetRenderer({
  pet,
  phase,
  frameIndex,
  externalFrame,
}: PetRendererProps): React.ReactElement {
  const frames = SPECIES_FRAMES[pet.species][phase];
  const idx = frames.length > 0 ? frameIndex % frames.length : 0;
  const base = externalFrame ?? frames[idx] ?? "";
  const styled = applyAllEffects(pet, base, phase, frameIndex);
  const lines = styled.split("\n");
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        // Index-as-key is intentional: ASCII frames are positional and
        // re-render every animation tick.
        // biome-ignore lint/suspicious/noArrayIndexKey: positional ASCII rows
        <Text key={i}>{line}</Text>
      ))}
    </Box>
  );
}
