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
    it("xpForLevel(20) === 5_000", () => {
      expect(xpForLevel(20)).toBe(5_000);
    });
    it("xpForLevel(50) === 50_000", () => {
      expect(xpForLevel(50)).toBe(50_000);
    });
    it("xpForLevel(80) === 250_000", () => {
      expect(xpForLevel(80)).toBe(250_000);
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
      expect(levelForXp(5_000)).toBe(20);
      expect(levelForXp(50_000)).toBe(50);
      expect(levelForXp(250_000)).toBe(80);
      expect(levelForXp(1_000_000)).toBe(100);
    });

    it("xp above 1M caps at level 100", () => {
      expect(levelForXp(2_000_000)).toBe(100);
      expect(levelForXp(Number.MAX_SAFE_INTEGER)).toBe(100);
    });

    it("inverts xpForLevel for sample levels", () => {
      for (const L of [1, 5, 19, 20, 35, 49, 50, 65, 79, 80, 90, 99, 100]) {
        expect(levelForXp(xpForLevel(L))).toBe(L);
      }
    });

    it("xp just below a boundary returns level - 1", () => {
      expect(levelForXp(4_999)).toBe(19);
      expect(levelForXp(49_999)).toBe(49);
      expect(levelForXp(249_999)).toBe(79);
      expect(levelForXp(999_999)).toBe(99);
    });
  });

  describe("phaseForLevel — transitions exactly at 20/50/80/100", () => {
    it("hatchling at 1..19", () => {
      expect(phaseForLevel(1)).toBe("hatchling");
      expect(phaseForLevel(10)).toBe("hatchling");
      expect(phaseForLevel(19)).toBe("hatchling");
    });

    it("junior at 20..49", () => {
      expect(phaseForLevel(20)).toBe("junior");
      expect(phaseForLevel(35)).toBe("junior");
      expect(phaseForLevel(49)).toBe("junior");
    });

    it("adult at 50..79", () => {
      expect(phaseForLevel(50)).toBe("adult");
      expect(phaseForLevel(65)).toBe("adult");
      expect(phaseForLevel(79)).toBe("adult");
    });

    it("elder at 80..99", () => {
      expect(phaseForLevel(80)).toBe("elder");
      expect(phaseForLevel(90)).toBe("elder");
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

    it("partway through hatchling phase", () => {
      const p = nextLevelProgress(2_500);
      expect(p.currentLevel).toBeGreaterThanOrEqual(1);
      expect(p.currentLevel).toBeLessThan(20);
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
      for (const xp of [0, 100, 1_000, 4_999, 5_000, 25_000, 100_000, 250_000, 999_999]) {
        const p = nextLevelProgress(xp);
        expect(p.ratio).toBeGreaterThanOrEqual(0);
        expect(p.ratio).toBeLessThanOrEqual(1);
      }
    });
  });
});
