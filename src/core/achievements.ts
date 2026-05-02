/**
 * Achievements engine.
 *
 * Spec §9. Defines the V1 achievement registry, idempotent unlock logic, and
 * per-event detection. Also exposes two helpers used by the hook handler in
 * Task 5: `isNightOwlHour` (local-time window check) and `updateStreak`
 * (calendar-day streak counter, also local time).
 *
 * Conventions:
 *
 * - All functions in this module mutate state in place. The hook handler is
 *   responsible for persisting the resulting state and recomputing
 *   level/phase from `state.progress.xp` once per event after all
 *   XP-changing operations have run.
 * - `checkAchievementsForEvent` assumes counters (promptsTotal, toolUseTotal,
 *   activeSessions, nightOwlEvents, streakDays, etc.) have already been
 *   updated by the caller for the current event. It only reads counters and
 *   triggers unlocks; it never mutates them itself.
 * - For `session_end`, the caller MUST NOT remove
 *   `activeSessions[input.sessionId]` before invoking
 *   `checkAchievementsForEvent` — the marathon check needs `startTs`.
 */

import type { AchievementId, State } from "./schema.js";

// ---------- Hook event contract (consumed by Task 5) ----------

export type HookEvent =
  | "prompt" //         UserPromptSubmit
  | "post_tool_use" //  PostToolUse
  | "stop" //           Stop
  | "session_start" //  SessionStart
  | "session_end"; //   SessionEnd

export interface HookEventInput {
  /** Claude session id from stdin payload. */
  sessionId: string;
  /** epoch ms from caller (for testability). */
  now: number;
  /** Tool name from PostToolUse payload. */
  toolName?: string;
  /** File path string from tool_input — extracted by hook handler. */
  filePath?: string;
}

// ---------- Achievement registry ----------

export type Medal = "bronze" | "silver" | "gold" | "platinum";

export interface AchievementDef {
  id: AchievementId;
  name: string;
  xp: number;
  /** One-line human-readable explanation of the unlock condition. */
  description: string;
  /**
   * Optional medal label for UI rendering (color, emoji). Absent on
   * non-tiered achievements (e.g. the `hatch_*` phase ladder, where the
   * progression is the phase itself rather than a tier).
   */
  medal?: Medal;
}

export const ACHIEVEMENTS: Readonly<Record<AchievementId, AchievementDef>> = {
  hatch: {
    id: "hatch",
    name: "Hatch",
    xp: 500,
    description: "Reach level 5 — your pet hatches out of the egg phase.",
  },
  first_tool: {
    id: "first_tool",
    name: "First Tool",
    xp: 500,
    description: "Use any tool through Claude Code for the first time.",
  },
  marathon: {
    id: "marathon",
    name: "Marathon",
    xp: 1_000,
    description: "Stay in a single Claude Code session for over 4 hours.",
  },
  ultra_marathon: {
    id: "ultra_marathon",
    name: "Ultra Marathon",
    xp: 3_000,
    description: "Stay in a single Claude Code session for over 12 hours.",
  },
  night_owl: {
    id: "night_owl",
    name: "Night Owl",
    xp: 1_500,
    description: "Trigger 200 events between 10pm and 2am local time.",
  },
  nocturnal: {
    id: "nocturnal",
    name: "Nocturnal",
    xp: 4_000,
    description: "Trigger 1,000 events between 10pm and 2am local time.",
  },
  streak_3d: {
    id: "streak_3d",
    name: "Streak 3 Days",
    xp: 1_000,
    description: "Use Claude Code on 3 consecutive days.",
  },
  streak_7d: {
    id: "streak_7d",
    name: "Streak 7 Days",
    xp: 2_500,
    description: "Use Claude Code on 7 consecutive days.",
  },
  streak_30d: {
    id: "streak_30d",
    name: "Streak 30 Days",
    xp: 7_500,
    description: "Use Claude Code on 30 consecutive days.",
  },
  streak_100d: {
    id: "streak_100d",
    name: "Streak 100 Days",
    xp: 25_000,
    description: "Use Claude Code on 100 consecutive days.",
  },
  polyglot: {
    id: "polyglot",
    name: "Polyglot",
    xp: 1_500,
    description: "Edit 5 different file extensions in a single session.",
  },
  refactor_master: {
    id: "refactor_master",
    name: "Refactor Master",
    xp: 2_000,
    description: "Use 100+ tools in a single session.",
  },
  tool_whisperer: {
    id: "tool_whisperer",
    name: "Tool Whisperer",
    xp: 3_000,
    description: "Use 5,000 tools total across all sessions.",
  },
  tool_master: {
    id: "tool_master",
    name: "Tool Master",
    xp: 7_500,
    description: "Use 25,000 tools total across all sessions.",
  },
  tool_legend: {
    id: "tool_legend",
    name: "Tool Legend",
    xp: 20_000,
    description: "Use 100,000 tools total across all sessions — legendary.",
  },
  centurion: {
    id: "centurion",
    name: "Centurion",
    xp: 5_000,
    description: "Reach level 100.",
  },
  // V2.0 (OTel-gated)
  code_architect: {
    id: "code_architect",
    name: "Code Architect",
    xp: 3_000,
    description: "Add 10,000 lines of code (OTel collector required).",
  },
  code_titan: {
    id: "code_titan",
    name: "Code Titan",
    xp: 10_000,
    description: "Add 100,000 lines of code (OTel collector required).",
  },
  token_whisperer_v2: {
    id: "token_whisperer_v2",
    name: "Token Whisperer",
    xp: 3_000,
    description: "Process 1,000,000 tokens (input + output combined).",
  },
  cache_lord: {
    id: "cache_lord",
    name: "Cache Lord",
    xp: 2_500,
    description: "Reach >=80% prompt-cache hit rate over 100,000+ tokens.",
  },
  frugal_coder: {
    id: "frugal_coder",
    name: "Frugal Coder",
    xp: 1_500,
    description: "Send 100+ prompts while keeping total spend under $1.",
  },
  big_spender: {
    id: "big_spender",
    name: "Big Spender",
    xp: 2_000,
    description: "Spend $100+ on Claude API across all sessions.",
  },
  pr_machine: {
    id: "pr_machine",
    name: "PR Machine",
    xp: 3_000,
    description: "Create 50+ pull requests through Claude Code.",
  },
  picky_reviewer: {
    id: "picky_reviewer",
    name: "Picky Reviewer",
    xp: 1_500,
    description: "Reject 50+ proposed edits during review.",
  },
} as const;

// ---------- Core helpers ----------

export function isUnlocked(state: State, id: AchievementId): boolean {
  return state.achievements.unlocked.includes(id);
}

/**
 * Unlock an achievement on the state, idempotently.
 *
 * - If already unlocked: no-op (returns `false`).
 * - Otherwise: appends `id` to both `unlocked` and `pendingUnlocks`, adds the
 *   achievement's XP to `state.progress.xp`, and returns `true`.
 *
 * Mutates state in place. Does not recompute level/phase — the hook handler
 * (Task 5) does that once per event after all XP-changing operations.
 */
export function unlockAchievement(state: State, id: AchievementId): boolean {
  if (isUnlocked(state, id)) return false;
  state.achievements.unlocked.push(id);
  state.achievements.pendingUnlocks.push(id);
  state.progress.xp += ACHIEVEMENTS[id].xp;
  return true;
}

// ---------- Event check ----------

/**
 * Run achievement checks for a hook event, mutating state for any unlocks.
 *
 * Pre-conditions: the hook handler has already updated relevant counters
 * (e.g. `promptsTotal`, `toolUseTotal`, `activeSessions[session_id]`,
 * `nightOwlEvents`, `streakDays`) BEFORE calling this function.
 *
 * Returns the list of newly-unlocked achievement ids (subset of
 * `pendingUnlocks` after this call).
 */
export function checkAchievementsForEvent(
  state: State,
  event: HookEvent,
  input: HookEventInput,
): AchievementId[] {
  const newlyUnlocked: AchievementId[] = [];
  const tryUnlock = (id: AchievementId, condition: boolean): void => {
    if (condition && !isUnlocked(state, id)) {
      unlockAchievement(state, id);
      newlyUnlocked.push(id);
    }
  };

  const session = state.counters.activeSessions[input.sessionId];

  // Shared helpers used across multiple events.
  const checkStreaks = (): void => {
    const d = state.counters.streakDays;
    tryUnlock("streak_3d", d >= 3);
    tryUnlock("streak_7d", d >= 7);
    tryUnlock("streak_30d", d >= 30);
    tryUnlock("streak_100d", d >= 100);
  };
  const checkNight = (): void => {
    const n = state.counters.nightOwlEvents;
    tryUnlock("night_owl", n >= 200);
    tryUnlock("nocturnal", n >= 1_000);
  };
  const checkTools = (): void => {
    const t = state.counters.toolUseTotal;
    tryUnlock("tool_whisperer", t >= 5_000);
    tryUnlock("tool_master", t >= 25_000);
    tryUnlock("tool_legend", t >= 100_000);
  };
  // Marathon ladder — uses the active session's duration. Triggers from any
  // event so a long-running session unlocks DURING the session, not only on
  // close (Claude Code rarely fires session_end in normal usage).
  const checkMarathon = (): void => {
    if (!session) return;
    const duration = input.now - session.startTs;
    tryUnlock("marathon", duration > 4 * 60 * 60 * 1000);
    tryUnlock("ultra_marathon", duration > 12 * 60 * 60 * 1000);
  };

  switch (event) {
    case "prompt": {
      tryUnlock("hatch", state.progress.level >= 5);
      checkNight();
      // streak counter is also incremented in the prompt hook (defensive
      // catch-up when session_start did not fire — e.g. user resumed a
      // pre-existing session across the day boundary).
      checkStreaks();
      checkMarathon();
      break;
    }
    case "post_tool_use": {
      tryUnlock("hatch", state.progress.level >= 5);
      tryUnlock("first_tool", state.counters.toolUseTotal >= 1);
      checkTools();
      checkNight();
      checkStreaks();
      checkMarathon();
      if (session) {
        tryUnlock("polyglot", session.fileExtensions.length >= 5);
        tryUnlock("refactor_master", session.toolUseCount >= 100);
      }
      break;
    }
    case "stop": {
      // Stop fires often (every Claude response completion), so it's a good
      // additional gate for active-session-duration achievements.
      tryUnlock("hatch", state.progress.level >= 5);
      tryUnlock("centurion", state.progress.level >= 100);
      checkMarathon();
      break;
    }
    case "session_start": {
      checkStreaks();
      break;
    }
    case "session_end": {
      // Marathon ladder: caller must NOT delete activeSessions[sessionId]
      // before calling this function — we need startTs to compute duration.
      checkMarathon();
      tryUnlock("hatch", state.progress.level >= 5);
      tryUnlock("centurion", state.progress.level >= 100);
      break;
    }
  }

  return newlyUnlocked;
}

// ---------- Night-owl helper ----------

/**
 * Returns true if the local hour of `now` is in `[22:00, 02:00)`.
 *
 * Local time matches the user's daily-streak boundary (also local).
 * 22, 23, 0, 1 → true. Everything else → false.
 */
export function isNightOwlHour(now: number): boolean {
  const hour = new Date(now).getHours();
  return hour >= 22 || hour < 2;
}

// ---------- Streak helper ----------

/**
 * Update `streakDays` / `lastActiveDate` on `state` given a new event timestamp.
 *
 * Rules:
 *
 * - If `lastActiveDate` is empty (first event ever): `streakDays = 1`.
 * - If today === `lastActiveDate`: no change (already counted today).
 * - If today === `lastActiveDate + 1` day: `streakDays += 1`.
 * - Otherwise (gap > 1 day, or stored date invalid): `streakDays = 1`.
 *
 * Mutates `state.counters.streakDays` and `state.counters.lastActiveDate`.
 *
 * Returns `true` if state changed (caller may use this to decide whether to
 * re-check streak achievements).
 */
export function updateStreak(state: State, now: number): boolean {
  const today = isoDate(now);
  const last = state.counters.lastActiveDate;

  if (last === today) return false;

  if (last === "") {
    state.counters.streakDays = 1;
    state.counters.lastActiveDate = today;
    return true;
  }

  const lastTs = parseIsoDate(last);
  const todayTs = parseIsoDate(today);
  if (lastTs === null || todayTs === null) {
    // Defensive: invalid stored date, reset.
    state.counters.streakDays = 1;
    state.counters.lastActiveDate = today;
    return true;
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const dayDiff = Math.round((todayTs - lastTs) / dayMs);

  if (dayDiff === 1) {
    state.counters.streakDays += 1;
  } else {
    state.counters.streakDays = 1;
  }
  state.counters.lastActiveDate = today;
  return true;
}

/** YYYY-MM-DD in local time (matches the user's day boundary). */
function isoDate(now: number): string {
  const d = new Date(now);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** Parse `YYYY-MM-DD` as local-time midnight. Returns `null` if malformed. */
function parseIsoDate(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const yyyy = Number(m[1]);
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  return new Date(yyyy, mm - 1, dd).getTime();
}
