/**
 * Tests for src/core/xp.ts.
 *
 * The 5 boundary acceptance values are part of the locked spec — those
 * tests must remain exact.
 */

import { describe, expect, it } from "vitest";
import { levelForXp, nextLevelProgress, phaseForLevel, xpForLevel } from "../src/core/xp.js";

describe("xp", () => {
  describe("xpForLevel — locked acceptance values", () => {
    it("xpForLevel(1) === 0", () => {
      expect(xpForLevel(1)).toBe(0);
    });
    it("xpForLevel(12) === 2_000", () => {
      expect(xpForLevel(12)).toBe(2_000);
    });
    it("xpForLevel(30) === 30_000", () => {
      expect(xpForLevel(30)).toBe(30_000);
    });
    it("xpForLevel(60) === 100_000", () => {
      expect(xpForLevel(60)).toBe(100_000);
    });
    it("xpForLevel(100) === 1_000_000", () => {
      expect(xpForLevel(100)).toBe(1_000_000);
    });
  });

  describe("xpForLevel — properties", () => {
    it("is monotonically non-decreasing across all levels", () => {
      for (let level = 1; level < 100; level++) {
        expect(xpForLevel(level + 1)).toBeGreaterThanOrEqual(xpForLevel(level));
      }
    });

    it("clamps level <= 1 to 0", () => {
      expect(xpForLevel(0)).toBe(0);
      expect(xpForLevel(-5)).toBe(0);
      expect(xpForLevel(1)).toBe(0);
    });

    it("clamps level >= 100 to 1_000_000", () => {
      expect(xpForLevel(100)).toBe(1_000_000);
      expect(xpForLevel(101)).toBe(1_000_000);
      expect(xpForLevel(999)).toBe(1_000_000);
    });
  });

  describe("levelForXp", () => {
    it("0 xp → level 1", () => {
      expect(levelForXp(0)).toBe(1);
    });

    it("negative xp → level 1", () => {
      expect(levelForXp(-100)).toBe(1);
    });

    it("xp at boundary returns the boundary level", () => {
      expect(levelForXp(0)).toBe(1);
      expect(levelForXp(2_000)).toBe(12);
      expect(levelForXp(30_000)).toBe(30);
      expect(levelForXp(100_000)).toBe(60);
      expect(levelForXp(1_000_000)).toBe(100);
    });

    it("xp above 1M caps at level 100", () => {
      expect(levelForXp(2_000_000)).toBe(100);
      expect(levelForXp(Number.MAX_SAFE_INTEGER)).toBe(100);
    });

    it("inverts xpForLevel for sample levels", () => {
      for (const L of [1, 5, 11, 12, 25, 29, 30, 45, 59, 60, 80, 99, 100]) {
        expect(levelForXp(xpForLevel(L))).toBe(L);
      }
    });

    it("xp just below a boundary returns level - 1", () => {
      expect(levelForXp(1_999)).toBe(11);
      expect(levelForXp(29_999)).toBe(29);
      expect(levelForXp(99_999)).toBe(59);
      expect(levelForXp(999_999)).toBe(99);
    });
  });

  describe("phaseForLevel — transitions exactly at 5/12/30/60/100", () => {
    it("egg at 1..4", () => {
      expect(phaseForLevel(1)).toBe("egg");
      expect(phaseForLevel(2)).toBe("egg");
      expect(phaseForLevel(4)).toBe("egg");
    });

    it("hatchling at 5..11", () => {
      expect(phaseForLevel(5)).toBe("hatchling");
      expect(phaseForLevel(8)).toBe("hatchling");
      expect(phaseForLevel(11)).toBe("hatchling");
    });

    it("junior at 12..29", () => {
      expect(phaseForLevel(12)).toBe("junior");
      expect(phaseForLevel(20)).toBe("junior");
      expect(phaseForLevel(29)).toBe("junior");
    });

    it("adult at 30..59", () => {
      expect(phaseForLevel(30)).toBe("adult");
      expect(phaseForLevel(45)).toBe("adult");
      expect(phaseForLevel(59)).toBe("adult");
    });

    it("elder at 60..99", () => {
      expect(phaseForLevel(60)).toBe("elder");
      expect(phaseForLevel(80)).toBe("elder");
      expect(phaseForLevel(99)).toBe("elder");
    });

    it("mythic at 100", () => {
      expect(phaseForLevel(100)).toBe("mythic");
      expect(phaseForLevel(150)).toBe("mythic");
    });
  });

  describe("nextLevelProgress", () => {
    it("at level 1 with 0 xp", () => {
      const p = nextLevelProgress(0);
      expect(p.currentLevel).toBe(1);
      expect(p.nextLevel).toBe(2);
      expect(p.currentLevelXp).toBe(0);
      expect(p.nextLevelXp).toBe(xpForLevel(2));
      expect(p.xpIntoLevel).toBe(0);
      expect(p.ratio).toBeCloseTo(0);
      expect(p.isMaxed).toBe(false);
    });

    it("partway through the curve (early levels)", () => {
      const p = nextLevelProgress(1_000);
      expect(p.currentLevel).toBeGreaterThanOrEqual(1);
      expect(p.currentLevel).toBeLessThan(12);
      expect(p.ratio).toBeGreaterThan(0);
      expect(p.ratio).toBeLessThan(1);
      expect(p.isMaxed).toBe(false);
    });

    it("at level 100 isMaxed and never divides by zero", () => {
      const p = nextLevelProgress(1_500_000);
      expect(p.currentLevel).toBe(100);
      expect(p.nextLevel).toBe(100);
      expect(p.isMaxed).toBe(true);
      expect(p.ratio).toBe(1);
      expect(p.xpForNextLevel).toBe(1);
      expect(p.xpIntoLevel).toBe(500_000);
    });

    it("exactly at the cap (1M xp) is maxed", () => {
      const p = nextLevelProgress(1_000_000);
      expect(p.currentLevel).toBe(100);
      expect(p.isMaxed).toBe(true);
      expect(p.ratio).toBe(1);
      expect(p.xpIntoLevel).toBe(0);
    });

    it("ratio always lies in [0, 1] across the curve", () => {
      for (const xp of [0, 100, 1_000, 1_999, 2_000, 8_000, 15_000, 50_000, 100_000, 999_999]) {
        const p = nextLevelProgress(xp);
        expect(p.ratio).toBeGreaterThanOrEqual(0);
        expect(p.ratio).toBeLessThanOrEqual(1);
      }
    });
  });
});
