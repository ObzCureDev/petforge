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

export interface AchievementDef {
  id: AchievementId;
  name: string;
  xp: number;
}

export const ACHIEVEMENTS: Readonly<Record<AchievementId, AchievementDef>> = {
  hatch: { id: "hatch", name: "Hatch", xp: 500 },
  first_tool: { id: "first_tool", name: "First Tool", xp: 500 },
  marathon: { id: "marathon", name: "Marathon", xp: 1_000 },
  night_owl: { id: "night_owl", name: "Night Owl", xp: 1_500 },
  streak_3d: { id: "streak_3d", name: "Streak 3 Days", xp: 1_000 },
  streak_7d: { id: "streak_7d", name: "Streak 7 Days", xp: 2_500 },
  polyglot: { id: "polyglot", name: "Polyglot", xp: 1_500 },
  refactor_master: { id: "refactor_master", name: "Refactor Master", xp: 2_000 },
  tool_whisperer: { id: "tool_whisperer", name: "Tool Whisperer", xp: 3_000 },
  centurion: { id: "centurion", name: "Centurion", xp: 5_000 },
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

  switch (event) {
    case "prompt": {
      tryUnlock("hatch", state.progress.level >= 5);
      tryUnlock("night_owl", state.counters.nightOwlEvents >= 50);
      break;
    }
    case "post_tool_use": {
      tryUnlock("hatch", state.progress.level >= 5);
      tryUnlock("first_tool", state.counters.toolUseTotal >= 1);
      tryUnlock("tool_whisperer", state.counters.toolUseTotal >= 1_000);
      tryUnlock("night_owl", state.counters.nightOwlEvents >= 50);
      if (session) {
        tryUnlock("polyglot", session.fileExtensions.length >= 5);
        tryUnlock("refactor_master", session.toolUseCount >= 100);
      }
      break;
    }
    case "stop": {
      // No achievement triggers tied to "stop" alone — XP for stop events is
      // awarded by the hook handler. Still check level-based achievements
      // here in case accumulated XP crossed level 5 (hatch) or 100
      // (centurion).
      tryUnlock("hatch", state.progress.level >= 5);
      tryUnlock("centurion", state.progress.level >= 100);
      break;
    }
    case "session_start": {
      tryUnlock("streak_3d", state.counters.streakDays >= 3);
      tryUnlock("streak_7d", state.counters.streakDays >= 7);
      break;
    }
    case "session_end": {
      // Marathon: caller must NOT delete activeSessions[sessionId] before
      // calling this function — we need startTs to compute duration.
      if (session) {
        const duration = input.now - session.startTs;
        tryUnlock("marathon", duration > 60 * 60 * 1000);
      }
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
