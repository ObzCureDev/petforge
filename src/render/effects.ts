/**
 * ANSI rendering effects: rarity tints, phase overlays, shiny rainbow.
 *
 * Effects are designed to compose:
 *   base ASCII → rarity tint → phase overlay → shiny cycle
 *
 * They wrap a string with `chalk` styles. The output keeps the original
 * line structure; only ANSI colour codes are added.
 *
 * Frame indices drive time-varying effects (mythic pulsation, shiny rainbow,
 * elder shimmer). The renderer is expected to advance the index at ~8 FPS.
 */

import chalk from "chalk";
import type { Pet, Phase, Rarity } from "../core/schema.js";

/**
 * Apply a rarity tint to an ASCII frame.
 *
 *   common    → identity (default ANSI)
 *   uncommon  → green border feel
 *   rare      → blue glow
 *   epic      → magenta aura
 *   legendary → yellow / gold pulse (the pulse animation is layered by
 *               applyPhaseEffect via mythic; rarity itself stays a steady tint)
 */
export function applyRarityTint(text: string, rarity: Rarity): string {
  switch (rarity) {
    case "common":
      return text;
    case "uncommon":
      return chalk.green(text);
    case "rare":
      return chalk.blue(text);
    case "epic":
      return chalk.magenta(text);
    case "legendary":
      return chalk.yellow(text);
  }
}

/**
 * Apply a phase-specific overlay.
 *
 *   hatchling → identity
 *   junior    → gold halo (a glyph line prepended above the body)
 *   adult     → identity (ASCII V2 already encodes elaboration)
 *   elder     → shimmer (alternates dim/normal across frames)
 *   mythic    → crown glyph + pulsation (alternates bold/normal)
 *
 * `frameIndex` allows time-varying behaviour across frames.
 */
export function applyPhaseEffect(text: string, phase: Phase, frameIndex: number): string {
  switch (phase) {
    case "egg":
      return text;
    case "hatchling":
      return text;
    case "junior": {
      const halo = chalk.yellow("    ·  ·  ·");
      return `${halo}\n${text}`;
    }
    case "adult":
      return text;
    case "elder": {
      // Shimmer: alternate dim/normal across frames.
      return frameIndex % 2 === 0 ? chalk.dim(text) : text;
    }
    case "mythic": {
      const crown = chalk.yellowBright(chalk.bold("       ♛"));
      const body = frameIndex % 2 === 0 ? chalk.bold(text) : text;
      return `${crown}\n${body}`;
    }
  }
}

const SHINY_COLORS = ["red", "yellow", "cyan", "magenta"] as const;
type ShinyColor = (typeof SHINY_COLORS)[number];

/**
 * Apply the shiny rainbow cycle. The pet body is recoloured every frame
 * with the next colour in the 4-element rotation.
 */
export function applyShiny(text: string, frameIndex: number): string {
  const idx = ((frameIndex % SHINY_COLORS.length) + SHINY_COLORS.length) % SHINY_COLORS.length;
  const color = SHINY_COLORS[idx] as ShinyColor;
  return chalk[color](text);
}

/**
 * Compose all effects in the right order.
 *
 * Order: base → rarity → phase → shiny. Shiny intentionally wraps last so
 * its colour cycle dominates the final tint (otherwise the rarity colour
 * would mask the rainbow).
 */
export function applyAllEffects(
  pet: Pet,
  baseFrame: string,
  phase: Phase,
  frameIndex: number,
): string {
  let out = baseFrame;
  out = applyRarityTint(out, pet.rarity);
  out = applyPhaseEffect(out, phase, frameIndex);
  if (pet.shiny) {
    out = applyShiny(out, frameIndex);
  }
  return out;
}
