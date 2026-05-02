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
    it("has hatch ladder with correct XP from spec §9", () => {
      expect(ACHIEVEMENTS.hatch_egg.xp).toBe(50);
      expect(ACHIEVEMENTS.hatch_hatchling.xp).toBe(500);
      expect(ACHIEVEMENTS.hatch_junior.xp).toBe(2_000);
      expect(ACHIEVEMENTS.hatch_adult.xp).toBe(5_000);
      expect(ACHIEVEMENTS.hatch_elder.xp).toBe(10_000);
      expect(ACHIEVEMENTS.hatch_mythic.xp).toBe(25_000);
    });

    it("medal-tiered families use bronze/silver/gold XP values", () => {
      // Bronze = 1000, Silver = 3000, Gold = 10000.
      expect(ACHIEVEMENTS.tool_5k.xp).toBe(1_000);
      expect(ACHIEVEMENTS.tool_25k.xp).toBe(3_000);
      expect(ACHIEVEMENTS.tool_100k.xp).toBe(10_000);
      expect(ACHIEVEMENTS.marathon_4h.xp).toBe(1_000);
      expect(ACHIEVEMENTS.marathon_12h.xp).toBe(3_000);
      expect(ACHIEVEMENTS.marathon_24h.xp).toBe(10_000);
      expect(ACHIEVEMENTS.night_200.xp).toBe(1_000);
      expect(ACHIEVEMENTS.night_1k.xp).toBe(3_000);
      expect(ACHIEVEMENTS.night_5k.xp).toBe(10_000);
      expect(ACHIEVEMENTS.polyglot_5.xp).toBe(1_000);
      expect(ACHIEVEMENTS.polyglot_8.xp).toBe(3_000);
      expect(ACHIEVEMENTS.polyglot_12.xp).toBe(10_000);
      expect(ACHIEVEMENTS.refactor_100.xp).toBe(1_000);
    });

    it("streak family has 4 tiers up to platinum (30k)", () => {
      expect(ACHIEVEMENTS.streak_3d.xp).toBe(1_000);
      expect(ACHIEVEMENTS.streak_7d.xp).toBe(3_000);
      expect(ACHIEVEMENTS.streak_30d.xp).toBe(10_000);
      expect(ACHIEVEMENTS.streak_100d.xp).toBe(30_000);
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
      expect(isUnlocked(s, "hatch_hatchling")).toBe(false);
    });

    it("unlocks once and returns true", () => {
      const s = freshState();
      expect(unlockAchievement(s, "hatch_hatchling")).toBe(true);
      expect(s.achievements.unlocked).toContain("hatch_hatchling");
      expect(s.achievements.pendingUnlocks).toContain("hatch_hatchling");
      expect(s.progress.xp).toBe(500);
      expect(isUnlocked(s, "hatch_hatchling")).toBe(true);
    });

    it("is idempotent — second call no-ops and returns false", () => {
      const s = freshState();
      unlockAchievement(s, "hatch_hatchling");
      const xpAfter1 = s.progress.xp;
      expect(unlockAchievement(s, "hatch_hatchling")).toBe(false);
      expect(s.achievements.unlocked.filter((id) => id === "hatch_hatchling")).toHaveLength(1);
      expect(s.achievements.pendingUnlocks.filter((id) => id === "hatch_hatchling")).toHaveLength(
        1,
      );
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
    it("hatch_hatchling fires when level >= 5 on prompt", () => {
      const s = freshState();
      s.progress.level = 5;
      const newly = checkAchievementsForEvent(s, "prompt", {
        sessionId: "s1",
        now: Date.now(),
      });
      expect(newly).toContain("hatch_hatchling");
      expect(newly).toContain("hatch_egg"); // also fires (level >= 1)
    });

    it("hatch_mythic fires when level >= 100 (and all earlier hatches)", () => {
      const s = freshState();
      s.progress.level = 100;
      const newly = checkAchievementsForEvent(s, "stop", {
        sessionId: "s1",
        now: Date.now(),
      });
      expect(newly).toContain("hatch_mythic");
      expect(newly).toContain("hatch_elder");
      expect(newly).toContain("hatch_adult");
      expect(newly).toContain("hatch_junior");
      expect(newly).toContain("hatch_hatchling");
      expect(newly).toContain("hatch_egg");
    });

    it("tool_5k fires at 5000 tool uses", () => {
      const s = freshState();
      s.counters.toolUseTotal = 5_000;
      const newly = checkAchievementsForEvent(s, "post_tool_use", {
        sessionId: "s1",
        now: Date.now(),
      });
      expect(newly).toContain("tool_5k");
    });

    it("tool_25k fires at 25,000 (and tool_5k too)", () => {
      const s = freshState();
      s.counters.toolUseTotal = 25_000;
      const newly = checkAchievementsForEvent(s, "post_tool_use", {
        sessionId: "s1",
        now: Date.now(),
      });
      expect(newly).toContain("tool_25k");
      expect(newly).toContain("tool_5k");
    });

    it("tool_100k fires at 100,000", () => {
      const s = freshState();
      s.counters.toolUseTotal = 100_000;
      const newly = checkAchievementsForEvent(s, "post_tool_use", {
        sessionId: "s1",
        now: Date.now(),
      });
      expect(newly).toContain("tool_100k");
    });

    it("polyglot tiers fire at 5/8/12 extensions in a session", () => {
      const s = freshState();
      s.counters.activeSessions.s1 = {
        startTs: 0,
        toolUseCount: 12,
        fileExtensions: [
          ".ts",
          ".tsx",
          ".md",
          ".json",
          ".sh",
          ".py",
          ".go",
          ".rs",
          ".css",
          ".html",
          ".yml",
          ".toml",
        ],
      };
      s.counters.toolUseTotal = 12;
      const newly = checkAchievementsForEvent(s, "post_tool_use", {
        sessionId: "s1",
        now: Date.now(),
      });
      expect(newly).toContain("polyglot_5");
      expect(newly).toContain("polyglot_8");
      expect(newly).toContain("polyglot_12");
    });

    it("polyglot_5 does NOT fire with only 4 extensions", () => {
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
      expect(newly).not.toContain("polyglot_5");
    });

    it("refactor_100 fires at 100 tool uses in a session", () => {
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
      expect(newly).toContain("refactor_100");
    });

    it("marathon_4h fires on session_end with strictly >4h duration", () => {
      const s = freshState();
      const start = 1_700_000_000_000;
      s.counters.activeSessions.s1 = {
        startTs: start,
        toolUseCount: 0,
        fileExtensions: [],
      };
      const newly = checkAchievementsForEvent(s, "session_end", {
        sessionId: "s1",
        now: start + 4 * 60 * 60 * 1000 + 1,
      });
      expect(newly).toContain("marathon_4h");
    });

    it("marathon_4h also fires on prompt mid-session when active duration > 4h", () => {
      const s = freshState();
      const start = 1_700_000_000_000;
      s.counters.activeSessions.s1 = {
        startTs: start,
        toolUseCount: 0,
        fileExtensions: [],
      };
      const newly = checkAchievementsForEvent(s, "prompt", {
        sessionId: "s1",
        now: start + 4 * 60 * 60 * 1000 + 1,
      });
      expect(newly).toContain("marathon_4h");
    });

    it("marathon_12h fires when session > 12h", () => {
      const s = freshState();
      const start = 1_700_000_000_000;
      s.counters.activeSessions.s1 = {
        startTs: start,
        toolUseCount: 0,
        fileExtensions: [],
      };
      const newly = checkAchievementsForEvent(s, "post_tool_use", {
        sessionId: "s1",
        now: start + 12 * 60 * 60 * 1000 + 1,
      });
      expect(newly).toContain("marathon_12h");
      expect(newly).toContain("marathon_4h");
    });

    it("marathon_24h fires when session > 24h", () => {
      const s = freshState();
      const start = 1_700_000_000_000;
      s.counters.activeSessions.s1 = {
        startTs: start,
        toolUseCount: 0,
        fileExtensions: [],
      };
      const newly = checkAchievementsForEvent(s, "post_tool_use", {
        sessionId: "s1",
        now: start + 24 * 60 * 60 * 1000 + 1,
      });
      expect(newly).toContain("marathon_24h");
    });

    it("marathon_4h does NOT fire on exactly 4h", () => {
      const s = freshState();
      const start = 1_700_000_000_000;
      s.counters.activeSessions.s1 = {
        startTs: start,
        toolUseCount: 0,
        fileExtensions: [],
      };
      const newly = checkAchievementsForEvent(s, "session_end", {
        sessionId: "s1",
        now: start + 4 * 60 * 60 * 1000,
      });
      expect(newly).not.toContain("marathon_4h");
    });

    it("night_200 fires when nightOwlEvents reaches 200", () => {
      const s = freshState();
      s.counters.nightOwlEvents = 200;
      s.counters.promptsTotal = 1;
      const newly = checkAchievementsForEvent(s, "prompt", {
        sessionId: "s1",
        now: Date.now(),
      });
      expect(newly).toContain("night_200");
    });

    it("night_200 does NOT fire below 200 events", () => {
      const s = freshState();
      s.counters.nightOwlEvents = 199;
      s.counters.promptsTotal = 1;
      const newly = checkAchievementsForEvent(s, "prompt", {
        sessionId: "s1",
        now: Date.now(),
      });
      expect(newly).not.toContain("night_200");
    });

    it("night_1k fires at 1000 events", () => {
      const s = freshState();
      s.counters.nightOwlEvents = 1000;
      s.counters.promptsTotal = 1;
      const newly = checkAchievementsForEvent(s, "prompt", {
        sessionId: "s1",
        now: Date.now(),
      });
      expect(newly).toContain("night_1k");
      expect(newly).toContain("night_200");
    });

    it("night_5k fires at 5000 events", () => {
      const s = freshState();
      s.counters.nightOwlEvents = 5000;
      s.counters.promptsTotal = 1;
      const newly = checkAchievementsForEvent(s, "prompt", {
        sessionId: "s1",
        now: Date.now(),
      });
      expect(newly).toContain("night_5k");
    });

    it("streak_3d/7d/30d/100d fire at the right thresholds on session_start", () => {
      const s = freshState();
      s.counters.streakDays = 100;
      const newly = checkAchievementsForEvent(s, "session_start", {
        sessionId: "s1",
        now: Date.now(),
      });
      expect(newly).toContain("streak_3d");
      expect(newly).toContain("streak_7d");
      expect(newly).toContain("streak_30d");
      expect(newly).toContain("streak_100d");
    });

    it("each achievement grants its XP exactly once across repeated checks", () => {
      const s = freshState();
      s.counters.toolUseTotal = 5_000;
      s.counters.activeSessions.s1 = {
        startTs: 0,
        toolUseCount: 100,
        fileExtensions: [".ts", ".tsx", ".md", ".json", ".sh"],
      };
      // First check unlocks: hatch_egg, tool_5k, polyglot_5, refactor_100,
      // marathon_4h/12h/24h (active duration is `Date.now() - 0` which is way
      // past all marathon thresholds).
      const a = checkAchievementsForEvent(s, "post_tool_use", {
        sessionId: "s1",
        now: Date.now(),
      });
      const xpAfter = s.progress.xp;
      expect(a.sort()).toEqual(
        [
          "hatch_egg",
          "marathon_4h",
          "marathon_12h",
          "marathon_24h",
          "polyglot_5",
          "refactor_100",
          "tool_5k",
        ].sort(),
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
