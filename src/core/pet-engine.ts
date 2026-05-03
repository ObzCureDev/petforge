/**
 * Pet engine — deterministic pet generator.
 *
 * Spec V3. The pet is fully determined by the SHA-256 of
 * `username + hostname`, so a given user/machine pair always produces the
 * same pet. Bytes of the digest drive rarity/species/shiny/stats.
 *
 * Byte layout:
 *   bytes[0] → species index (mod bucket size, after rarity is rolled)
 *   bytes[1] → rarity (scaled to [0,1] via /255)
 *   bytes[2] → shiny (true if < 3, ~1.17%)
 *   bytes[3..7] → stats (debugging/patience/chaos/wisdom/snark, each mod 101)
 *
 * Species and rarity are coupled: each species has a fixed rarity tier
 * (Octopus is always Uncommon, Dragon always Legendary, etc.) matching
 * Buddy's design. `pickRarity` rolls the tier; `pickSpecies` selects from
 * the matching `SPECIES_BY_RARITY` bucket.
 */

import crypto from "node:crypto";
import os from "node:os";
import { type Pet, type PetStats, type Rarity, SPECIES_BY_RARITY, type Species } from "./schema.js";

/** SHA-256 of `username + hostname`, hex-encoded. */
export function computeSeed(username: string, hostname: string): string {
  return crypto
    .createHash("sha256")
    .update(username + hostname)
    .digest("hex");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Pick a species from the rarity bucket using `byte` mod bucket size. */
export function pickSpecies(byte: number, rarity: Rarity): Species {
  const bucket = SPECIES_BY_RARITY[rarity];
  const idx = byte % bucket.length;
  const species = bucket[idx];
  if (species === undefined) {
    throw new Error(`pickSpecies: invalid index ${idx} for rarity ${rarity}`);
  }
  return species;
}

/**
 * Pick rarity from a continuous value `t ∈ [0, 1]`.
 *
 * Weights (spec §7):
 *   common    60%  (t < 0.60)
 *   uncommon  25%  (t < 0.85)
 *   rare      10%  (t < 0.95)
 *   epic       4%  (t < 0.99)
 *   legendary  1%  (else)
 */
export function pickRarity(t: number): Rarity {
  if (t < 0.6) return "common";
  if (t < 0.85) return "uncommon";
  if (t < 0.95) return "rare";
  if (t < 0.99) return "epic";
  return "legendary";
}

/** Shiny when the byte is strictly less than 3 (3/256 ≈ 1.17%). */
export function pickShiny(byte: number): boolean {
  return byte < 3;
}

/** Derive the 5 stats from `bytes[3..7]`, each in [0, 100]. */
export function deriveStats(bytes: Uint8Array): PetStats {
  return {
    debugging: (bytes[3] ?? 0) % 101,
    patience: (bytes[4] ?? 0) % 101,
    chaos: (bytes[5] ?? 0) % 101,
    wisdom: (bytes[6] ?? 0) % 101,
    snark: (bytes[7] ?? 0) % 101,
  };
}

export interface GeneratePetOptions {
  /** Override `os.userInfo().username` — used by tests. */
  username?: string;
  /** Override `os.hostname()` — used by tests. */
  hostname?: string;
}

/**
 * Generate the deterministic pet for the given (or current) user/machine.
 */
export function generatePet(opts: GeneratePetOptions = {}): Pet {
  const username = opts.username ?? os.userInfo().username;
  const hostname = opts.hostname ?? os.hostname();
  const seed = computeSeed(username, hostname);
  const bytes = hexToBytes(seed);

  const speciesByte = bytes[0] ?? 0;
  const rarityByte = bytes[1] ?? 0;
  const shinyByte = bytes[2] ?? 0;

  const rarity = pickRarity(rarityByte / 255);

  return {
    species: pickSpecies(speciesByte, rarity),
    rarity,
    shiny: pickShiny(shinyByte),
    stats: deriveStats(bytes),
    seed,
  };
}
