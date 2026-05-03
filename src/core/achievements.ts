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
  // Hatch phase ladder (no medal - phase-based)
  hatch_egg: {
    id: "hatch_egg",
    name: "Hatch · Egg",
    xp: 50,
    description: "Spawn your pet - your first hook fires (level 1).",
  },
  hatch_hatchling: {
    id: "hatch_hatchling",
    name: "Hatch · Hatchling",
    xp: 500,
    description: "Reach level 5 - your pet hatches out of the egg phase.",
  },
  hatch_junior: {
    id: "hatch_junior",
    name: "Hatch · Junior",
    xp: 2_000,
    description: "Reach level 12 - your pet matures into junior.",
  },
  hatch_adult: {
    id: "hatch_adult",
    name: "Hatch · Adult",
    xp: 5_000,
    description: "Reach level 30 - your pet reaches adult.",
  },
  hatch_elder: {
    id: "hatch_elder",
    name: "Hatch · Elder",
    xp: 10_000,
    description: "Reach level 60 - your pet ages into elder.",
  },
  hatch_mythic: {
    id: "hatch_mythic",
    name: "Hatch · Mythic",
    xp: 25_000,
    description: "Reach level 100 - your pet ascends to mythic.",
  },

  // Streak (4 tiers)
  streak_3d: {
    id: "streak_3d",
    name: "Streak · 3 Days",
    xp: 1_000,
    description: "Use Claude Code on 3 consecutive days.",
    medal: "bronze",
  },
  streak_7d: {
    id: "streak_7d",
    name: "Streak · 7 Days",
    xp: 3_000,
    description: "Use Claude Code on 7 consecutive days.",
    medal: "silver",
  },
  streak_30d: {
    id: "streak_30d",
    name: "Streak · 30 Days",
    xp: 10_000,
    description: "Use Claude Code on 30 consecutive days.",
    medal: "gold",
  },
  streak_100d: {
    id: "streak_100d",
    name: "Streak · 100 Days",
    xp: 30_000,
    description: "Use Claude Code on 100 consecutive days.",
    medal: "platinum",
  },

  // Tool count
  tool_5k: {
    id: "tool_5k",
    name: "Tool · 5K",
    xp: 1_000,
    description: "Use 5,000 tools total across all sessions.",
    medal: "bronze",
  },
  tool_25k: {
    id: "tool_25k",
    name: "Tool · 25K",
    xp: 3_000,
    description: "Use 25,000 tools total - true mastery.",
    medal: "silver",
  },
  tool_100k: {
    id: "tool_100k",
    name: "Tool · 100K",
    xp: 10_000,
    description: "Use 100,000 tools total - legendary tool wielder.",
    medal: "gold",
  },

  // Marathon (single-session duration)
  marathon_4h: {
    id: "marathon_4h",
    name: "Marathon · 4h",
    xp: 1_000,
    description: "Stay in a single session for over 4 hours.",
    medal: "bronze",
  },
  marathon_12h: {
    id: "marathon_12h",
    name: "Marathon · 12h",
    xp: 3_000,
    description: "Stay in a single session for over 12 hours.",
    medal: "silver",
  },
  marathon_24h: {
    id: "marathon_24h",
    name: "Marathon · 24h",
    xp: 10_000,
    description: "Stay in a single session for over 24 hours straight.",
    medal: "gold",
  },

  // Night events (10pm - 2am)
  night_200: {
    id: "night_200",
    name: "Night · 200",
    xp: 1_000,
    description: "Trigger 200 events between 10pm and 2am local time.",
    medal: "bronze",
  },
  night_1k: {
    id: "night_1k",
    name: "Night · 1K",
    xp: 3_000,
    description: "Trigger 1,000 events between 10pm and 2am local time.",
    medal: "silver",
  },
  night_5k: {
    id: "night_5k",
    name: "Night · 5K",
    xp: 10_000,
    description: "Trigger 5,000 events between 10pm and 2am local time.",
    medal: "gold",
  },

  // Polyglot (distinct extensions per session)
  polyglot_5: {
    id: "polyglot_5",
    name: "Polyglot · 5",
    xp: 1_000,
    description: "Edit 5 different file extensions in a single session.",
    medal: "bronze",
  },
  polyglot_8: {
    id: "polyglot_8",
    name: "Polyglot · 8",
    xp: 3_000,
    description: "Edit 8 different file extensions in a single session.",
    medal: "silver",
  },
  polyglot_12: {
    id: "polyglot_12",
    name: "Polyglot · 12",
    xp: 10_000,
    description: "Edit 12 different file extensions in a single session.",
    medal: "gold",
  },

  // Refactor (tools per session)
  refactor_100: {
    id: "refactor_100",
    name: "Refactor · 100",
    xp: 1_000,
    description: "Use 100+ tools in a single session.",
    medal: "bronze",
  },
  refactor_250: {
    id: "refactor_250",
    name: "Refactor · 250",
    xp: 3_000,
    description: "Use 250+ tools in a single session.",
    medal: "silver",
  },
  refactor_500: {
    id: "refactor_500",
    name: "Refactor · 500",
    xp: 10_000,
    description: "Use 500+ tools in a single session.",
    medal: "gold",
  },

  // Code lines (OTel)
  code_10k: {
    id: "code_10k",
    name: "Code · 10K lines",
    xp: 1_000,
    description: "Add 10,000 lines of code (OTel collector required).",
    medal: "bronze",
  },
  code_50k: {
    id: "code_50k",
    name: "Code · 50K lines",
    xp: 3_000,
    description: "Add 50,000 lines of code (OTel collector required).",
    medal: "silver",
  },
  code_200k: {
    id: "code_200k",
    name: "Code · 200K lines",
    xp: 10_000,
    description: "Add 200,000 lines of code (OTel collector required).",
    medal: "gold",
  },

  // Token volume (OTel)
  token_1m: {
    id: "token_1m",
    name: "Token · 1M",
    xp: 1_000,
    description: "Process 1,000,000 tokens (input + output combined).",
    medal: "bronze",
  },
  token_10m: {
    id: "token_10m",
    name: "Token · 10M",
    xp: 3_000,
    description: "Process 10,000,000 tokens (input + output combined).",
    medal: "silver",
  },
  token_100m: {
    id: "token_100m",
    name: "Token · 100M",
    xp: 10_000,
    description: "Process 100,000,000 tokens (input + output combined).",
    medal: "gold",
  },

  // Cache hit (OTel) - volume + ratio
  cache_100k: {
    id: "cache_100k",
    name: "Cache · 100K",
    xp: 1_000,
    description: "Reach >=80% prompt-cache hit rate over 100,000+ tokens.",
    medal: "bronze",
  },
  cache_1m: {
    id: "cache_1m",
    name: "Cache · 1M",
    xp: 3_000,
    description: "Reach >=80% prompt-cache hit rate over 1,000,000+ tokens.",
    medal: "silver",
  },
  cache_10m: {
    id: "cache_10m",
    name: "Cache · 10M",
    xp: 10_000,
    description: "Reach >=90% prompt-cache hit rate over 10,000,000+ tokens.",
    medal: "gold",
  },

  // Frugal (OTel)
  frugal_100p: {
    id: "frugal_100p",
    name: "Frugal · 100 prompts",
    xp: 1_000,
    description: "Send 100+ prompts while keeping total spend under $10.",
    medal: "bronze",
  },
  frugal_500p: {
    id: "frugal_500p",
    name: "Frugal · 500 prompts",
    xp: 3_000,
    description: "Send 500+ prompts while keeping total spend under $50.",
    medal: "silver",
  },
  frugal_2kp: {
    id: "frugal_2kp",
    name: "Frugal · 2K prompts",
    xp: 10_000,
    description: "Send 2,000+ prompts while keeping total spend under $200.",
    medal: "gold",
  },

  // Big spender (OTel) - IDs are dollar amounts
  big_spender_100: {
    id: "big_spender_100",
    name: "Big Spender · $100",
    xp: 1_000,
    description: "Spend $100+ on Claude API across all sessions.",
    medal: "bronze",
  },
  big_spender_500: {
    id: "big_spender_500",
    name: "Big Spender · $500",
    xp: 3_000,
    description: "Spend $500+ on Claude API across all sessions.",
    medal: "silver",
  },
  big_spender_2k: {
    id: "big_spender_2k",
    name: "Big Spender · $2K",
    xp: 10_000,
    description: "Spend $2,000+ on Claude API across all sessions.",
    medal: "gold",
  },

  // PR machine (OTel)
  pr_50: {
    id: "pr_50",
    name: "PR · 50",
    xp: 1_000,
    description: "Create 50+ pull requests through Claude Code.",
    medal: "bronze",
  },
  pr_200: {
    id: "pr_200",
    name: "PR · 200",
    xp: 3_000,
    description: "Create 200+ pull requests through Claude Code.",
    medal: "silver",
  },
  pr_500: {
    id: "pr_500",
    name: "PR · 500",
    xp: 10_000,
    description: "Create 500+ pull requests through Claude Code.",
    medal: "gold",
  },

  // Picky reviewer (OTel)
  picky_50: {
    id: "picky_50",
    name: "Picky · 50",
    xp: 1_000,
    description: "Reject 50+ proposed edits during review.",
    medal: "bronze",
  },
  picky_250: {
    id: "picky_250",
    name: "Picky · 250",
    xp: 3_000,
    description: "Reject 250+ proposed edits during review.",
    medal: "silver",
  },
  picky_1k: {
    id: "picky_1k",
    name: "Picky · 1K",
    xp: 10_000,
    description: "Reject 1,000+ proposed edits during review.",
    medal: "gold",
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

  // Phase ladder - runs on level-changing events. Triggered by the level
  // boundary, not by the phase string, so a hook event that crosses
  // multiple phases at once unlocks every passed milestone in one call.
  const checkPhases = (): void => {
    const lvl = state.progress.level;
    tryUnlock("hatch_egg", lvl >= 1);
    tryUnlock("hatch_hatchling", lvl >= 5);
    tryUnlock("hatch_junior", lvl >= 12);
    tryUnlock("hatch_adult", lvl >= 30);
    tryUnlock("hatch_elder", lvl >= 60);
    tryUnlock("hatch_mythic", lvl >= 100);
  };

  const checkStreaks = (): void => {
    const d = state.counters.streakDays;
    tryUnlock("streak_3d", d >= 3);
    tryUnlock("streak_7d", d >= 7);
    tryUnlock("streak_30d", d >= 30);
    tryUnlock("streak_100d", d >= 100);
  };

  const checkTools = (): void => {
    const t = state.counters.toolUseTotal;
    tryUnlock("tool_5k", t >= 5_000);
    tryUnlock("tool_25k", t >= 25_000);
    tryUnlock("tool_100k", t >= 100_000);
  };

  const checkNight = (): void => {
    const n = state.counters.nightOwlEvents;
    tryUnlock("night_200", n >= 200);
    tryUnlock("night_1k", n >= 1_000);
    tryUnlock("night_5k", n >= 5_000);
  };

  // Marathon - uses the active session's duration. Triggers from any
  // event so a long-running session unlocks during the session, not only
  // on close (Claude Code rarely fires session_end in normal usage).
  // V3.5.2: `>=` instead of `>` for consistency with the display
  // (`Math.min(target, durationMs)` caps at 100% at exactly target).
  const checkMarathon = (): void => {
    if (!session) return;
    const duration = input.now - session.startTs;
    tryUnlock("marathon_4h", duration >= 4 * 60 * 60 * 1000);
    tryUnlock("marathon_12h", duration >= 12 * 60 * 60 * 1000);
    tryUnlock("marathon_24h", duration >= 24 * 60 * 60 * 1000);
  };

  const checkPolyglot = (): void => {
    if (!session) return;
    const ext = session.fileExtensions.length;
    tryUnlock("polyglot_5", ext >= 5);
    tryUnlock("polyglot_8", ext >= 8);
    tryUnlock("polyglot_12", ext >= 12);
  };

  const checkRefactor = (): void => {
    if (!session) return;
    const t = session.toolUseCount;
    tryUnlock("refactor_100", t >= 100);
    tryUnlock("refactor_250", t >= 250);
    tryUnlock("refactor_500", t >= 500);
  };

  switch (event) {
    case "prompt": {
      checkPhases();
      checkStreaks();
      checkNight();
      checkMarathon();
      break;
    }
    case "post_tool_use": {
      checkPhases();
      checkTools();
      checkNight();
      checkStreaks();
      checkMarathon();
      checkPolyglot();
      checkRefactor();
      break;
    }
    case "stop": {
      checkPhases();
      checkMarathon();
      break;
    }
    case "session_start": {
      checkPhases();
      checkStreaks();
      break;
    }
    case "session_end": {
      // session is still present here - caller deletes activeSessions[id]
      // AFTER this function returns so we can read startTs for marathon.
      checkMarathon();
      checkPhases();
      break;
    }
  }

  return newlyUnlocked;
}

// ---------- Backfill ----------

/**
 * Re-evaluate every non-OTel achievement against current state and unlock
 * any whose threshold is already met. Use to recover from prior bugs where
 * a hook did not fire the relevant check (e.g. pre-V3.2 marathon only ran
 * on session_end, pre-V3.2 streak only ran on session_start).
 *
 * OTel-gated achievements have side conditions (cache ratio, frugal
 * cost ceiling) and live in `checkOtelAchievements` — call that separately.
 *
 * Mutates state in place. Returns newly-unlocked IDs. Does NOT recompute
 * level/phase — the caller is responsible.
 */
export function backfillEarnedAchievements(state: State, now: number): AchievementId[] {
  const newly: AchievementId[] = [];
  const tryUnlock = (id: AchievementId, condition: boolean): void => {
    if (condition && !isUnlocked(state, id) && unlockAchievement(state, id)) {
      newly.push(id);
    }
  };

  // Phase ladder — must match phaseForLevel boundaries (xp.ts).
  const lvl = state.progress.level;
  tryUnlock("hatch_egg", lvl >= 1);
  tryUnlock("hatch_hatchling", lvl >= 5);
  tryUnlock("hatch_junior", lvl >= 12);
  tryUnlock("hatch_adult", lvl >= 30);
  tryUnlock("hatch_elder", lvl >= 60);
  tryUnlock("hatch_mythic", lvl >= 100);

  // Streak
  const d = state.counters.streakDays;
  tryUnlock("streak_3d", d >= 3);
  tryUnlock("streak_7d", d >= 7);
  tryUnlock("streak_30d", d >= 30);
  tryUnlock("streak_100d", d >= 100);

  // Tool total
  const t = state.counters.toolUseTotal;
  tryUnlock("tool_5k", t >= 5_000);
  tryUnlock("tool_25k", t >= 25_000);
  tryUnlock("tool_100k", t >= 100_000);

  // Night events
  const n = state.counters.nightOwlEvents;
  tryUnlock("night_200", n >= 200);
  tryUnlock("night_1k", n >= 1_000);
  tryUnlock("night_5k", n >= 5_000);

  // Marathon, polyglot, refactor — max across active sessions.
  const sessions = Object.values(state.counters.activeSessions);
  let maxDuration = 0;
  let maxExt = 0;
  let maxToolPerSession = 0;
  for (const s of sessions) {
    if (s.startTs && now - s.startTs > maxDuration) maxDuration = now - s.startTs;
    if (s.fileExtensions.length > maxExt) maxExt = s.fileExtensions.length;
    if (s.toolUseCount > maxToolPerSession) maxToolPerSession = s.toolUseCount;
  }
  tryUnlock("marathon_4h", maxDuration >= 4 * 60 * 60 * 1000);
  tryUnlock("marathon_12h", maxDuration >= 12 * 60 * 60 * 1000);
  tryUnlock("marathon_24h", maxDuration >= 24 * 60 * 60 * 1000);
  tryUnlock("polyglot_5", maxExt >= 5);
  tryUnlock("polyglot_8", maxExt >= 8);
  tryUnlock("polyglot_12", maxExt >= 12);
  tryUnlock("refactor_100", maxToolPerSession >= 100);
  tryUnlock("refactor_250", maxToolPerSession >= 250);
  tryUnlock("refactor_500", maxToolPerSession >= 500);

  return newly;
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
