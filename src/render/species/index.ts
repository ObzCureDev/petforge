/**
 * Aggregated species frame registry.
 *
 * For each species, exposes 3 idle-cycle frames per phase. The hatchling /
 * junior / adult / elder / mythic visual differences are intentionally
 * obvious so the user can see growth at a glance.
 */

import type { Phase, Species } from "../../core/schema.js";
import { blobFrames } from "./blob.js";
import { daemonFrames } from "./daemon.js";
import { glitchFrames } from "./glitch.js";
import { pixelFrames } from "./pixel.js";
import { sparkFrames } from "./spark.js";

export const SPECIES_FRAMES: Record<Species, Record<Phase, string[]>> = {
  pixel: pixelFrames,
  glitch: glitchFrames,
  daemon: daemonFrames,
  spark: sparkFrames,
  blob: blobFrames,
};
