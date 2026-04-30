/**
 * Tests for src/core/achievements.ts.
 *
 * Covers:
 *   - registry XP values match spec §9
 *   - unlockAchievement is idempotent and grants XP exactly once
 *   - checkAchievementsForEvent fires each of the 10 V1 achievements
 *   - night-owl boundary [22h, 02h) — exclusive of 02h
 *   - streak helper: same-day no-op, consecutive day increment, missed day reset
 */

import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENTS,
  checkAchievementsForEvent,
  isNightOwlHour,
  isUnlocked,
  unlockAchievement,
  updateStreak,
} from "../src/core/achievements.js";
import { generatePet } from "../src/core/pet-engine.js";
import { createInitialState } from "../src/core/schema.js";

function freshState() {
  return createInitialState(
    generatePet({ username: "test-user", hostname: "test-host" }),
    Date.UTC(2026, 3, 30, 12, 0, 0),
  );
}

describe("achievements", () => {
  describe("registry", () => {
    it("has all 10 achievements with correct XP from spec §9", () => {
      expect(ACHIEVEMENTS.hatch.xp).toBe(500);
      expect(ACHIEVEMENTS.first_tool.xp).toBe(500);
      expect(ACHIEVEMENTS.marathon.xp).toBe(1_000);
      expect(ACHIEVEMENTS.night_owl.xp).toBe(1_500);
      expect(ACHIEVEMENTS.streak_3d.xp).toBe(1_000);
      expect(ACHIEVEMENTS.streak_7d.xp).toBe(2_500);
      expect(ACHIEVEMENTS.polyglot.xp).toBe(1_500);
      expect(ACHIEVEMENTS.refactor_master.xp).toBe(2_000);
      expect(ACHIEVEMENTS.tool_whisperer.xp).toBe(3_000);
      expect(ACHIEVEMENTS.centurion.xp).toBe(5_000);
    });

    it("each registered id matches its key", () => {
      for (const [key, def] of Object.entries(ACHIEVEMENTS)) {
        expect(def.id).toBe(key);
      }
    });
  });

  describe("isUnlocked / unlockAchievement", () => {
    it("isUnlocked returns false on a fresh state", () => {
      const s = freshState();
      expect(isUnlocked(s, "hatch")).toBe(false);
    });

    it("unlocks once and returns true", () => {
      const s = freshState();
      expect(unlockAchievement(s, "hatch")).toBe(true);
      expect(s.achievements.unlocked).toContain("hatch");
      expect(s.achievements.pendingUnlocks).toContain("hatch");
      expect(s.progress.xp).toBe(500);
      expect(isUnlocked(s, "hatch")).toBe(true);
    });

    it("is idempotent — second call no-ops and returns false", () => {
      const s = freshState();
      unlockAchievement(s, "hatch");
      const xpAfter1 = s.progress.xp;
      expect(unlockAchievement(s, "hatch")).toBe(false);
      expect(s.achievements.unlocked.filter((id) => id === "hatch")).toHaveLength(1);
      expect(s.achievements.pendingUnlocks.filter((id) => id === "hatch")).toHaveLength(1);
      expect(s.progress.xp).toBe(xpAfter1);
    });

    it("grants the correct XP for each achievement", () => {
      for (const def of Object.values(ACHIEVEMENTS)) {
        const s = freshState();
        unlockAchievement(s, def.id);
        expect(s.progress.xp).toBe(def.xp);
      }
    });
  });

  describe("checkAchievementsForEvent", () => {
    it("hatch fires on first prompt", () => {
      const s = freshState();
      s.counters.promptsTotal = 1;
      const newly = checkAchievementsForEvent(s, "prompt", {
        sessionId: "s1",
        now: Date.now(),
      });
      expect(newly).toEqual(["hatch"]);
      expect(s.achievements.pendingUnlocks).toContain("hatch");
    });

    it("first_tool fires on first tool use", () => {
      const s = freshState();
      s.counters.toolUseTotal = 1;
      const newly = checkAchievementsForEvent(s, "post_tool_use", {
        sessionId: "s1",
        now: Date.now(),
      });
      expect(newly).toContain("first_tool");
    });

    it("tool_whisperer fires at 1000 tool uses (and first_tool too)", () => {
      const s = freshState();
      s.counters.toolUseTotal = 1_000;
      const newly = checkAchievementsForEvent(s, "post_tool_use", {
        sessionId: "s1",
        now: Date.now(),
      });
      expect(newly).toContain("tool_whisperer");
      expect(newly).toContain("first_tool");
    });

    it("polyglot fires when 5 distinct extensions in a session", () => {
      const s = freshState();
      s.counters.activeSessions.s1 = {
        startTs: 0,
        toolUseCount: 5,
        fileExtensions: [".ts", ".tsx", ".md", ".json", ".sh"],
      };
      s.counters.toolUseTotal = 5;
      const newly = checkAchievementsForEvent(s, "post_tool_use", {
        sessionId: "s1",
        now: Date.now(),
      });
      expect(newly).toContain("polyglot");
    });

    it("polyglot does NOT fire with only 4 extensions", () => {
      const s = freshState();
      s.counters.activeSessions.s1 = {
        startTs: 0,
        toolUseCount: 4,
        fileExtensions: [".ts", ".tsx", ".md", ".json"],
      };
      s.counters.toolUseTotal = 4;
      const newly = checkAchievementsForEvent(s, "post_tool_use", {
        sessionId: "s1",
        now: Date.now(),
      });
      expect(newly).not.toContain("polyglot");
    });

    it("refactor_master fires at 100 tool uses in a session", () => {
      const s = freshState();
      s.counters.activeSessions.s1 = {
        startTs: 0,
        toolUseCount: 100,
        fileExtensions: [],
      };
      s.counters.toolUseTotal = 100;
      const newly = checkAchievementsForEvent(s, "post_tool_use", {
        sessionId: "s1",
        now: Date.now(),
      });
      expect(newly).toContain("refactor_master");
    });

    it("marathon fires on session_end with strictly >1h duration", () => {
      const s = freshState();
      const start = 1_700_000_000_000;
      s.counters.activeSessions.s1 = {
        startTs: start,
        toolUseCount: 0,
        fileExtensions: [],
      };
      const newly = checkAchievementsForEvent(s, "session_end", {
        sessionId: "s1",
        now: start + 60 * 60 * 1000 + 1,
      });
      expect(newly).toContain("marathon");
    });

    it("marathon does NOT fire on exactly 1h", () => {
      const s = freshState();
      const start = 1_700_000_000_000;
      s.counters.activeSessions.s1 = {
        startTs: start,
        toolUseCount: 0,
        fileExtensions: [],
      };
      const newly = checkAchievementsForEvent(s, "session_end", {
        sessionId: "s1",
        now: start + 60 * 60 * 1000,
      });
      expect(newly).not.toContain("marathon");
    });

    it("night_owl fires when nightOwlEvents reaches 50", () => {
      const s = freshState();
      s.counters.nightOwlEvents = 50;
      s.counters.promptsTotal = 1;
      const newly = checkAchievementsForEvent(s, "prompt", {
        sessionId: "s1",
        now: Date.now(),
      });
      expect(newly).toContain("night_owl");
    });

    it("night_owl does NOT fire below 50 events", () => {
      const s = freshState();
      s.counters.nightOwlEvents = 49;
      s.counters.promptsTotal = 1;
      const newly = checkAchievementsForEvent(s, "prompt", {
        sessionId: "s1",
        now: Date.now(),
      });
      expect(newly).not.toContain("night_owl");
    });

    it("streak_3d fires at 3 days, streak_7d at 7", () => {
      const s = freshState();
      s.counters.streakDays = 3;
      const a = checkAchievementsForEvent(s, "session_start", {
        sessionId: "s1",
        now: Date.now(),
      });
      expect(a).toContain("streak_3d");
      expect(a).not.toContain("streak_7d");

      s.counters.streakDays = 7;
      const b = checkAchievementsForEvent(s, "session_start", {
        sessionId: "s1",
        now: Date.now(),
      });
      expect(b).toContain("streak_7d");
    });

    it("centurion fires when level reaches 100 (on session_end)", () => {
      const s = freshState();
      s.progress.level = 100;
      const newly = checkAchievementsForEvent(s, "session_end", {
        sessionId: "s1",
        now: Date.now(),
      });
      expect(newly).toContain("centurion");
    });

    it("centurion fires on stop event when level reaches 100", () => {
      const s = freshState();
      s.progress.level = 100;
      const newly = checkAchievementsForEvent(s, "stop", {
        sessionId: "s1",
        now: Date.now(),
      });
      expect(newly).toContain("centurion");
    });

    it("does not re-fire already-unlocked achievement", () => {
      const s = freshState();
      s.counters.promptsTotal = 1;
      checkAchievementsForEvent(s, "prompt", { sessionId: "s1", now: Date.now() });
      const second = checkAchievementsForEvent(s, "prompt", {
        sessionId: "s1",
        now: Date.now(),
      });
      expect(second).not.toContain("hatch");
      expect(s.achievements.unlocked.filter((id) => id === "hatch")).toHaveLength(1);
    });

    it("each achievement grants its XP exactly once across repeated checks", () => {
      const s = freshState();
      s.counters.toolUseTotal = 1_000;
      s.counters.activeSessions.s1 = {
        startTs: 0,
        toolUseCount: 100,
        fileExtensions: [".ts", ".tsx", ".md", ".json", ".sh"],
      };
      // First check: should unlock first_tool, tool_whisperer, polyglot, refactor_master.
      const a = checkAchievementsForEvent(s, "post_tool_use", {
        sessionId: "s1",
        now: Date.now(),
      });
      const xpAfter = s.progress.xp;
      expect(a.sort()).toEqual(
        ["first_tool", "polyglot", "refactor_master", "tool_whisperer"].sort(),
      );
      // Second check: nothing new, no XP delta.
      const b = checkAchievementsForEvent(s, "post_tool_use", {
        sessionId: "s1",
        now: Date.now(),
      });
      expect(b).toEqual([]);
      expect(s.progress.xp).toBe(xpAfter);
    });
  });

  describe("isNightOwlHour", () => {
    function atHour(h: number): number {
      return new Date(2026, 3, 30, h, 0, 0).getTime();
    }
    it("returns true for 22, 23, 0, 1", () => {
      for (const h of [22, 23, 0, 1]) {
        expect(isNightOwlHour(atHour(h))).toBe(true);
      }
    });
    it("returns false for 2..21 (exclusive of 02h boundary)", () => {
      for (let h = 2; h <= 21; h++) {
        expect(isNightOwlHour(atHour(h))).toBe(false);
      }
    });
  });

  describe("updateStreak", () => {
    function localDateAt(year: number, month1: number, day: number): number {
      return new Date(year, month1 - 1, day, 12, 0, 0).getTime();
    }

    it("first event sets streak to 1", () => {
      const s = freshState();
      s.counters.lastActiveDate = "";
      const t = localDateAt(2026, 4, 30);
      const changed = updateStreak(s, t);
      expect(changed).toBe(true);
      expect(s.counters.streakDays).toBe(1);
      expect(s.counters.lastActiveDate).toBe("2026-04-30");
    });

    it("same day does not double count", () => {
      const s = freshState();
      s.counters.streakDays = 5;
      s.counters.lastActiveDate = "2026-04-30";
      const t = localDateAt(2026, 4, 30);
      const changed = updateStreak(s, t);
      expect(changed).toBe(false);
      expect(s.counters.streakDays).toBe(5);
      expect(s.counters.lastActiveDate).toBe("2026-04-30");
    });

    it("consecutive day increments", () => {
      const s = freshState();
      s.counters.streakDays = 5;
      s.counters.lastActiveDate = "2026-04-29";
      const t = localDateAt(2026, 4, 30);
      const changed = updateStreak(s, t);
      expect(changed).toBe(true);
      expect(s.counters.streakDays).toBe(6);
      expect(s.counters.lastActiveDate).toBe("2026-04-30");
    });

    it("missed day resets streak to 1", () => {
      const s = freshState();
      s.counters.streakDays = 10;
      s.counters.lastActiveDate = "2026-04-28";
      const t = localDateAt(2026, 4, 30);
      const changed = updateStreak(s, t);
      expect(changed).toBe(true);
      expect(s.counters.streakDays).toBe(1);
      expect(s.counters.lastActiveDate).toBe("2026-04-30");
    });

    it("invalid stored date resets to 1", () => {
      const s = freshState();
      s.counters.streakDays = 10;
      s.counters.lastActiveDate = "garbage";
      const t = localDateAt(2026, 4, 30);
      const changed = updateStreak(s, t);
      expect(changed).toBe(true);
      expect(s.counters.streakDays).toBe(1);
      expect(s.counters.lastActiveDate).toBe("2026-04-30");
    });

    it("month boundary: Apr 30 -> May 1 increments", () => {
      const s = freshState();
      s.counters.streakDays = 2;
      s.counters.lastActiveDate = "2026-04-30";
      const t = localDateAt(2026, 5, 1);
      updateStreak(s, t);
      expect(s.counters.streakDays).toBe(3);
      expect(s.counters.lastActiveDate).toBe("2026-05-01");
    });
  });
});
