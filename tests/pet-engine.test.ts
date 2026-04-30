/**
 * Tests for src/core/pet-engine.ts.
 *
 * Determinism is the key property: same (username, hostname) → same Pet.
 */

import { describe, expect, it } from "vitest";
import {
  computeSeed,
  deriveStats,
  generatePet,
  pickRarity,
  pickShiny,
  pickSpecies,
} from "../src/core/pet-engine.js";
import type { Species } from "../src/core/schema.js";

describe("pet-engine", () => {
  describe("computeSeed", () => {
    it("is deterministic for same inputs", () => {
      const a = computeSeed("alice", "host1");
      const b = computeSeed("alice", "host1");
      expect(a).toBe(b);
    });

    it("differs for different inputs", () => {
      expect(computeSeed("alice", "host1")).not.toBe(computeSeed("bob", "host1"));
      expect(computeSeed("alice", "host1")).not.toBe(computeSeed("alice", "host2"));
    });

    it("returns 64-char lowercase hex", () => {
      const s = computeSeed("u", "h");
      expect(s).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("pickSpecies", () => {
    it("evenly distributes across 5 species over the full byte range", () => {
      const counts: Record<Species, number> = {
        pixel: 0,
        glitch: 0,
        daemon: 0,
        spark: 0,
        blob: 0,
      };
      for (let b = 0; b < 256; b++) counts[pickSpecies(b)]++;
      // 256 / 5 = 51.2 each — every bucket lands on 51 or 52.
      for (const c of Object.values(counts)) {
        expect(c).toBeGreaterThanOrEqual(51);
        expect(c).toBeLessThanOrEqual(52);
      }
    });
  });

  describe("pickRarity", () => {
    it("respects the spec weighted thresholds", () => {
      expect(pickRarity(0.0)).toBe("common");
      expect(pickRarity(0.59)).toBe("common");
      expect(pickRarity(0.6)).toBe("uncommon");
      expect(pickRarity(0.84)).toBe("uncommon");
      expect(pickRarity(0.85)).toBe("rare");
      expect(pickRarity(0.94)).toBe("rare");
      expect(pickRarity(0.95)).toBe("epic");
      expect(pickRarity(0.98)).toBe("epic");
      expect(pickRarity(0.99)).toBe("legendary");
      expect(pickRarity(1.0)).toBe("legendary");
    });

    it("is deterministic for a given t", () => {
      for (const t of [0.0, 0.25, 0.5, 0.7, 0.9, 0.97, 0.999]) {
        expect(pickRarity(t)).toBe(pickRarity(t));
      }
    });
  });

  describe("pickShiny", () => {
    it("is true for byte < 3, false otherwise", () => {
      expect(pickShiny(0)).toBe(true);
      expect(pickShiny(1)).toBe(true);
      expect(pickShiny(2)).toBe(true);
      expect(pickShiny(3)).toBe(false);
      expect(pickShiny(255)).toBe(false);
    });

    it("is deterministic for a given byte", () => {
      for (let b = 0; b < 256; b++) {
        expect(pickShiny(b)).toBe(pickShiny(b));
      }
    });
  });

  describe("deriveStats", () => {
    it("always returns values in [0, 100]", () => {
      for (let trial = 0; trial < 200; trial++) {
        const bytes = new Uint8Array(8);
        for (let i = 0; i < 8; i++) bytes[i] = Math.floor(Math.random() * 256);
        const stats = deriveStats(bytes);
        for (const v of Object.values(stats)) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(100);
        }
      }
    });

    it("is deterministic for a given byte array", () => {
      const bytes = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
      expect(deriveStats(bytes)).toEqual(deriveStats(bytes));
    });

    it("uses bytes[3..7] mod 101", () => {
      const bytes = new Uint8Array([0, 0, 0, 0, 100, 101, 200, 255]);
      expect(deriveStats(bytes)).toEqual({
        focus: 0,
        grit: 100,
        flow: 0,
        craft: 99,
        spark: 53,
      });
    });
  });

  describe("generatePet", () => {
    it("is deterministic for same username/hostname", () => {
      const a = generatePet({ username: "alice", hostname: "h" });
      const b = generatePet({ username: "alice", hostname: "h" });
      expect(a).toEqual(b);
    });

    it("rarity is deterministic for same seed", () => {
      const a = generatePet({ username: "user-x", hostname: "machine-y" });
      const b = generatePet({ username: "user-x", hostname: "machine-y" });
      expect(a.rarity).toBe(b.rarity);
    });

    it("shiny is deterministic for same seed", () => {
      const a = generatePet({ username: "shiny-test", hostname: "h" });
      const b = generatePet({ username: "shiny-test", hostname: "h" });
      expect(a.shiny).toBe(b.shiny);
    });

    it("stats are always 0..100", () => {
      // Many distinct seeds — every component lands inside the contract.
      for (let i = 0; i < 50; i++) {
        const pet = generatePet({ username: `u${i}`, hostname: `h${i}` });
        for (const v of Object.values(pet.stats)) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(100);
        }
      }
    });

    it("seed is the SHA-256 of username + hostname", () => {
      const pet = generatePet({ username: "alice", hostname: "host1" });
      expect(pet.seed).toBe(computeSeed("alice", "host1"));
    });

    it("can produce different pets for different seeds", () => {
      const a = generatePet({ username: "a", hostname: "h" });
      let differs = false;
      for (let i = 0; i < 50 && !differs; i++) {
        const b = generatePet({ username: `user${i}`, hostname: `host${i}` });
        if (
          a.species !== b.species ||
          a.rarity !== b.rarity ||
          a.shiny !== b.shiny ||
          a.stats.focus !== b.stats.focus ||
          a.stats.grit !== b.stats.grit
        ) {
          differs = true;
        }
      }
      expect(differs).toBe(true);
    });

    it("works without options (uses os defaults)", () => {
      const pet = generatePet();
      expect(pet.seed).toMatch(/^[0-9a-f]{64}$/);
      expect(pet.stats.focus).toBeGreaterThanOrEqual(0);
      expect(pet.stats.focus).toBeLessThanOrEqual(100);
    });
  });
});
