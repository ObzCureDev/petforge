/**
 * Aggregated species frame registry.
 *
 * For each of the 18 species, exposes 3 idle-cycle frames per phase
 * (egg / hatchling / junior / adult / elder / mythic). All ASCII art is
 * original to PetForge.
 */

import type { Phase, Species } from "../../core/schema.js";
import { axolotlFrames } from "./axolotl.js";
import { blobFrames } from "./blob.js";
import { cactusFrames } from "./cactus.js";
import { capybaraFrames } from "./capybara.js";
import { catFrames } from "./cat.js";
import { chonkFrames } from "./chonk.js";
import { dragonFrames } from "./dragon.js";
import { duckFrames } from "./duck.js";
import { ghostFrames } from "./ghost.js";
import { gooseFrames } from "./goose.js";
import { mushroomFrames } from "./mushroom.js";
import { octopusFrames } from "./octopus.js";
import { owlFrames } from "./owl.js";
import { penguinFrames } from "./penguin.js";
import { rabbitFrames } from "./rabbit.js";
import { robotFrames } from "./robot.js";
import { snailFrames } from "./snail.js";
import { turtleFrames } from "./turtle.js";

export const SPECIES_FRAMES: Record<Species, Record<Phase, string[]>> = {
  duck: duckFrames,
  goose: gooseFrames,
  blob: blobFrames,
  turtle: turtleFrames,
  snail: snailFrames,
  mushroom: mushroomFrames,
  chonk: chonkFrames,
  octopus: octopusFrames,
  penguin: penguinFrames,
  cactus: cactusFrames,
  rabbit: rabbitFrames,
  cat: catFrames,
  owl: owlFrames,
  capybara: capybaraFrames,
  robot: robotFrames,
  ghost: ghostFrames,
  axolotl: axolotlFrames,
  dragon: dragonFrames,
};
