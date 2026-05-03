# PetForge V3.2 — Medal Achievements + Hatch Phase Ladder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the achievement registry into a hatch phase ladder (6 milestones) + 13 medal-tagged families (bronze / silver / gold / [platinum]), totaling 46 achievements, and migrate existing user state losslessly.

**Architecture:** Achievement IDs become semantic with shorthand thresholds (`streak_3d`, `tool_5k`, `marathon_4h`); a new optional `medal` field on `AchievementDef` drives UI rendering. The hatch ladder uses phase-based triggers, every other family uses threshold-based triggers grouped into per-family check helpers in `checkAchievementsForEvent`. A pure migration function rewrites V3.1 IDs in existing state files at read time, idempotently.

**Tech Stack:** TypeScript strict, Vitest, Zod v4 (no schema bump — IDs are string-typed at the state layer), Ink TUI, the existing PetForge codebase (Node 20+, ESM, tsup, Biome).

**Spec correction**: the design doc says "12 families × 3 + 1 platinum = 43" but the table actually lists 13 families (streak + tool + marathon + night + polyglot + refactor + code_lines + token + cache + frugal + big_spender + pr + picky). True total: **46 achievements** (6 hatch + 13 × 3 medals + 1 platinum streak = 6 + 39 + 1 = 46). Task 10 fixes the spec doc count inline.

---

## File Structure (target end-state)

### Modified
- `src/core/schema.ts` — `ACHIEVEMENT_IDS` rebuilt to 46 V3.2 entries.
- `src/core/achievements.ts` — `AchievementDef` adds optional `medal`; `ACHIEVEMENTS` registry rebuilt; `checkAchievementsForEvent` reorganized into per-family helpers including `checkPhases` (the hatch ladder).
- `src/core/otel/achievements.ts` — checks reorganized for `code` / `token` / `cache` / `frugal` / `big_spender` / `pr` / `picky` 3-tier families.
- `src/core/state.ts` — calls `migrateV31Achievements` after JSON parse, before `StateSchema` validation, to rename IDs in `unlocked` + `pendingUnlocks`.
- `src/render/web/page.ts` — CSS adds `.ach.medal-bronze` / `.medal-silver` / `.medal-gold` / `.medal-platinum`; `achievementProgress(id, s)` switch case extended for the 46 IDs; `<details>` rendering injects medal emoji + class.
- `src/render/components/AchievementGrid.tsx` — name prefix gets the medal emoji.
- `tests/achievements.test.ts` — renamed to V3.2 IDs, plus new tests for hatch ladder + new families.
- `tests/hook.test.ts` — renamed IDs.
- `tests/render.test.ts` — renamed IDs.
- `README.md` — V3.2 entry summarizing the medal restructure.
- `CHANGELOG.md` — V3.2.0 entry.
- `package.json` — `"version": "3.2.0"`.
- `docs/superpowers/specs/2026-05-02-petforge-v3-2-medal-achievements-design.md` — total count 43 → 46.

### Created
- `src/core/migrations/v32-achievement-rename.ts` — pure functions `MIGRATION_MAP_V31_TO_V32` (24-row constant) and `migrateV31Achievements(unlocked, pendingUnlocks): { unlocked, pendingUnlocks }`. Idempotent.
- `tests/migrations-v32-rename.test.ts` — one `it` per mapping row + idempotence + V3.1-leak guard + dropped-IDs guard.
- `tests/achievements-medals.test.ts` — registry hygiene: every medal-tagged def has matching XP from the medal table; every family has exactly 3 (or 4 for streak) entries; the hatch ladder has exactly 6 entries with no medal.

### Deleted
None.

---

## Task 1: Add `Medal` type + rebuild `ACHIEVEMENT_IDS` (46 entries)

**Files:**
- Modify: `src/core/schema.ts`
- Modify: `src/core/achievements.ts` (interface only)

- [ ] **Step 1.1: Replace `ACHIEVEMENT_IDS` in `src/core/schema.ts`**

Replace the existing `ACHIEVEMENT_IDS` block with:

```ts
export const ACHIEVEMENT_IDS = [
  // Hatch phase ladder (6 — no medal, phase-based progression)
  "hatch_egg",
  "hatch_hatchling",
  "hatch_junior",
  "hatch_adult",
  "hatch_elder",
  "hatch_mythic",
  // Streak (4 — bronze / silver / gold / platinum)
  "streak_3d",
  "streak_7d",
  "streak_30d",
  "streak_100d",
  // Tool count (3)
  "tool_5k",
  "tool_25k",
  "tool_100k",
  // Marathon (3) — single-session duration
  "marathon_4h",
  "marathon_12h",
  "marathon_24h",
  // Night events (3)
  "night_200",
  "night_1k",
  "night_5k",
  // Polyglot (3) — distinct extensions per session
  "polyglot_5",
  "polyglot_8",
  "polyglot_12",
  // Refactor (3) — tools per session
  "refactor_100",
  "refactor_250",
  "refactor_500",
  // Code lines (OTel) (3)
  "code_10k",
  "code_50k",
  "code_200k",
  // Token volume (OTel) (3)
  "token_1m",
  "token_10m",
  "token_100m",
  // Cache hit (OTel) (3)
  "cache_100k",
  "cache_1m",
  "cache_10m",
  // Frugal — many prompts at low spend (OTel) (3)
  "frugal_100p",
  "frugal_500p",
  "frugal_2kp",
  // Big spender (OTel) (3) — IDs use dollar amounts
  "big_spender_100",
  "big_spender_500",
  "big_spender_2k",
  // PR machine (OTel) (3)
  "pr_50",
  "pr_200",
  "pr_500",
  // Picky reviewer (OTel) (3) — edits rejected
  "picky_50",
  "picky_250",
  "picky_1k",
] as const;
export type AchievementId = (typeof ACHIEVEMENT_IDS)[number];
```

- [ ] **Step 1.2: Add `Medal` type and `medal` field in `src/core/achievements.ts`**

Replace the existing `AchievementDef` interface:

```ts
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
```

- [ ] **Step 1.3: Run typecheck — many call-site failures expected**

Run: `npx tsc --noEmit`

Expected: many errors from removed/renamed IDs (`hatch`, `centurion`, `tool_whisperer`, etc.). These are addressed in subsequent tasks.

- [ ] **Step 1.4: Commit**

```bash
git add src/core/schema.ts src/core/achievements.ts
git commit -m "feat(schema): V3.2 — rebuild ACHIEVEMENT_IDS to 46 medal-tagged entries

Adds the hatch phase ladder (6 milestones) and reorganizes every other
family into bronze/silver/gold/[platinum] tiers. Introduces the Medal
type + optional medal field on AchievementDef. The full registry,
check helpers, migration, and renderers follow in subsequent commits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Rebuild `ACHIEVEMENTS` registry

**Files:**
- Modify: `src/core/achievements.ts` (registry only)

- [ ] **Step 2.1: Replace `ACHIEVEMENTS` with the 46-entry V3.2 registry**

Replace the entire `ACHIEVEMENTS` const with:

```ts
export const ACHIEVEMENTS: Readonly<Record<AchievementId, AchievementDef>> = {
  // Hatch phase ladder (no medal — phase-based)
  hatch_egg: {
    id: "hatch_egg",
    name: "Hatch · Egg",
    xp: 50,
    description: "Spawn your pet — your first hook fires (level 1).",
  },
  hatch_hatchling: {
    id: "hatch_hatchling",
    name: "Hatch · Hatchling",
    xp: 500,
    description: "Reach level 5 — your pet hatches out of the egg phase.",
  },
  hatch_junior: {
    id: "hatch_junior",
    name: "Hatch · Junior",
    xp: 2_000,
    description: "Reach level 20 — your pet matures into junior.",
  },
  hatch_adult: {
    id: "hatch_adult",
    name: "Hatch · Adult",
    xp: 5_000,
    description: "Reach level 50 — your pet reaches adult.",
  },
  hatch_elder: {
    id: "hatch_elder",
    name: "Hatch · Elder",
    xp: 10_000,
    description: "Reach level 80 — your pet ages into elder.",
  },
  hatch_mythic: {
    id: "hatch_mythic",
    name: "Hatch · Mythic",
    xp: 25_000,
    description: "Reach level 100 — your pet ascends to mythic.",
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
    description: "Use 25,000 tools total — true mastery.",
    medal: "silver",
  },
  tool_100k: {
    id: "tool_100k",
    name: "Tool · 100K",
    xp: 10_000,
    description: "Use 100,000 tools total — legendary tool wielder.",
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

  // Night events (10pm — 2am)
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

  // Cache hit (OTel) — volume + ratio
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
    description: "Send 100+ prompts while keeping total spend under $1.",
    medal: "bronze",
  },
  frugal_500p: {
    id: "frugal_500p",
    name: "Frugal · 500 prompts",
    xp: 3_000,
    description: "Send 500+ prompts while keeping total spend under $5.",
    medal: "silver",
  },
  frugal_2kp: {
    id: "frugal_2kp",
    name: "Frugal · 2K prompts",
    xp: 10_000,
    description: "Send 2,000+ prompts while keeping total spend under $20.",
    medal: "gold",
  },

  // Big spender (OTel) — IDs are dollar amounts
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
```

- [ ] **Step 2.2: Run typecheck**

Run: `npx tsc --noEmit`

Expected: errors now point only to call sites in `checkAchievementsForEvent`, the OTel checker, the migration, and tests. No errors inside the registry itself.

- [ ] **Step 2.3: Commit**

```bash
git add src/core/achievements.ts
git commit -m "feat(achievements): V3.2 registry — 46 entries, medal-tagged

Hatch phase ladder (6 milestones, no medal) + 13 medal families
(bronze/silver/gold; streak adds platinum). XP scales as 1k/3k/10k/30k
per medal. Descriptions written for each entry; check logic follows
in the next commit."
```

---

## Task 3: Rebuild `checkAchievementsForEvent` with phase ladder + family helpers

**Files:**
- Modify: `src/core/achievements.ts` (the `checkAchievementsForEvent` function only)

- [ ] **Step 3.1: Replace `checkAchievementsForEvent` body**

Locate the existing `checkAchievementsForEvent` function (the `switch (event)` block plus the helper closures `checkStreaks`/`checkNight`/`checkTools`/`checkMarathon`) and replace the entire region from `const newlyUnlocked` through the closing `}` of the function with:

```ts
  const newlyUnlocked: AchievementId[] = [];
  const tryUnlock = (id: AchievementId, condition: boolean): void => {
    if (condition && !isUnlocked(state, id)) {
      unlockAchievement(state, id);
      newlyUnlocked.push(id);
    }
  };

  const session = state.counters.activeSessions[input.sessionId];

  // Phase ladder — runs on level-changing events. Triggered by the level
  // boundary, not by the phase string, so a hook event that crosses
  // multiple phases at once unlocks every passed milestone in one call.
  const checkPhases = (): void => {
    const lvl = state.progress.level;
    tryUnlock("hatch_egg", lvl >= 1);
    tryUnlock("hatch_hatchling", lvl >= 5);
    tryUnlock("hatch_junior", lvl >= 20);
    tryUnlock("hatch_adult", lvl >= 50);
    tryUnlock("hatch_elder", lvl >= 80);
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

  // Marathon — uses the active session's duration. Triggers from any
  // event so a long-running session unlocks during the session, not only
  // on close (Claude Code rarely fires session_end in normal usage).
  const checkMarathon = (): void => {
    if (!session) return;
    const duration = input.now - session.startTs;
    tryUnlock("marathon_4h", duration > 4 * 60 * 60 * 1000);
    tryUnlock("marathon_12h", duration > 12 * 60 * 60 * 1000);
    tryUnlock("marathon_24h", duration > 24 * 60 * 60 * 1000);
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
      // session is still present here — caller deletes activeSessions[id]
      // AFTER this function returns so we can read startTs for marathon.
      checkMarathon();
      checkPhases();
      break;
    }
  }

  return newlyUnlocked;
}
```

- [ ] **Step 3.2: Run typecheck — only OTel checks + migration + tests should still error**

Run: `npx tsc --noEmit`

Expected: errors restricted to `src/core/otel/achievements.ts` (next task) and tests/migrations (later tasks).

- [ ] **Step 3.3: Commit**

```bash
git add src/core/achievements.ts
git commit -m "feat(achievements): rebuild checkAchievementsForEvent for V3.2

Adds checkPhases (hatch ladder), reorganizes the existing checkStreaks/
checkNight/checkTools/checkMarathon to use the new V3.2 IDs, and adds
checkPolyglot + checkRefactor as dedicated helpers."
```

---

## Task 4: Update `checkOtelAchievements` for V3.2

**Files:**
- Modify: `src/core/otel/achievements.ts`

- [ ] **Step 4.1: Replace the entire body of `checkOtelAchievements`**

Replace the file contents below the imports with:

```ts
const TEN_K = 10_000;
const FIFTY_K = 50_000;
const TWO_HUNDRED_K = 200_000;

const ONE_M_TOKENS = 1_000_000;
const TEN_M_TOKENS = 10_000_000;
const HUNDRED_M_TOKENS = 100_000_000;

const CACHE_VOL_BRONZE = 100_000;
const CACHE_VOL_SILVER = 1_000_000;
const CACHE_VOL_GOLD = 10_000_000;
const CACHE_RATIO_80 = 0.8;
const CACHE_RATIO_90 = 0.9;

const FRUGAL_BRONZE_PROMPTS = 100;
const FRUGAL_SILVER_PROMPTS = 500;
const FRUGAL_GOLD_PROMPTS = 2_000;
const FRUGAL_BRONZE_MAX_CENTS = 100; // $1
const FRUGAL_SILVER_MAX_CENTS = 500; // $5
const FRUGAL_GOLD_MAX_CENTS = 2_000; // $20

const SPENDER_BRONZE_CENTS = 10_000; // $100
const SPENDER_SILVER_CENTS = 50_000; // $500
const SPENDER_GOLD_CENTS = 200_000; // $2,000

const PR_BRONZE = 50;
const PR_SILVER = 200;
const PR_GOLD = 500;

const PICKY_BRONZE = 50;
const PICKY_SILVER = 250;
const PICKY_GOLD = 1_000;

/**
 * Check OTel-gated achievements. Returns the IDs that newly unlocked.
 * Mutates state.achievements.unlocked + pendingUnlocks + progress.xp.
 *
 * Gates on `state.counters.otel.lastUpdate > 0` — without that the
 * collector has never run and OTel-derived data is suspect.
 */
export function checkOtelAchievements(state: State): AchievementId[] {
  const otel = state.counters.otel;
  if (!otel || otel.lastUpdate === 0) return [];

  const newly: AchievementId[] = [];
  const tryUnlock = (id: AchievementId, condition: boolean): void => {
    if (condition && unlockAchievement(state, id)) newly.push(id);
  };

  // Code lines
  tryUnlock("code_10k", otel.linesAdded >= TEN_K);
  tryUnlock("code_50k", otel.linesAdded >= FIFTY_K);
  tryUnlock("code_200k", otel.linesAdded >= TWO_HUNDRED_K);

  // Tokens (in + out)
  const tokens = otel.tokensIn + otel.tokensOut;
  tryUnlock("token_1m", tokens >= ONE_M_TOKENS);
  tryUnlock("token_10m", tokens >= TEN_M_TOKENS);
  tryUnlock("token_100m", tokens >= HUNDRED_M_TOKENS);

  // Cache: volume + ratio compound
  const cacheVolume = otel.tokensIn + otel.tokensCacheRead;
  const cacheRatio = cacheVolume > 0 ? otel.tokensCacheRead / cacheVolume : 0;
  tryUnlock(
    "cache_100k",
    cacheVolume >= CACHE_VOL_BRONZE && cacheRatio >= CACHE_RATIO_80,
  );
  tryUnlock(
    "cache_1m",
    cacheVolume >= CACHE_VOL_SILVER && cacheRatio >= CACHE_RATIO_80,
  );
  tryUnlock(
    "cache_10m",
    cacheVolume >= CACHE_VOL_GOLD && cacheRatio >= CACHE_RATIO_90,
  );

  // Frugal: prompts >= N AND total cost <= ceiling
  const prompts = state.counters.promptsTotal;
  tryUnlock(
    "frugal_100p",
    prompts >= FRUGAL_BRONZE_PROMPTS && otel.costUsdCents <= FRUGAL_BRONZE_MAX_CENTS,
  );
  tryUnlock(
    "frugal_500p",
    prompts >= FRUGAL_SILVER_PROMPTS && otel.costUsdCents <= FRUGAL_SILVER_MAX_CENTS,
  );
  tryUnlock(
    "frugal_2kp",
    prompts >= FRUGAL_GOLD_PROMPTS && otel.costUsdCents <= FRUGAL_GOLD_MAX_CENTS,
  );

  // Big spender
  tryUnlock("big_spender_100", otel.costUsdCents >= SPENDER_BRONZE_CENTS);
  tryUnlock("big_spender_500", otel.costUsdCents >= SPENDER_SILVER_CENTS);
  tryUnlock("big_spender_2k", otel.costUsdCents >= SPENDER_GOLD_CENTS);

  // PRs
  tryUnlock("pr_50", otel.prCount >= PR_BRONZE);
  tryUnlock("pr_200", otel.prCount >= PR_SILVER);
  tryUnlock("pr_500", otel.prCount >= PR_GOLD);

  // Picky reviewer
  tryUnlock("picky_50", otel.editsRejected >= PICKY_BRONZE);
  tryUnlock("picky_250", otel.editsRejected >= PICKY_SILVER);
  tryUnlock("picky_1k", otel.editsRejected >= PICKY_GOLD);

  return newly;
}
```

(Imports at the top of the file — `unlockAchievement`, `AchievementId`, `State` — stay the same.)

- [ ] **Step 4.2: Run typecheck**

Run: `npx tsc --noEmit`

Expected: errors restricted to migrations and tests now.

- [ ] **Step 4.3: Commit**

```bash
git add src/core/otel/achievements.ts
git commit -m "feat(otel): rebuild OTel achievement checks for V3.2

7 OTel families (code / token / cache / frugal / big_spender / pr / picky)
each with bronze/silver/gold thresholds. Cache uses 80%/80%/90% ratio
ladder; frugal uses prompts AND cost-ceiling compound conditions."
```

---

## Task 5: V3.1 -> V3.2 ID rename migration (TDD)

**Files:**
- Create: `src/core/migrations/v32-achievement-rename.ts`
- Create: `tests/migrations-v32-rename.test.ts`

- [ ] **Step 5.1: Write the failing tests**

Create `tests/migrations-v32-rename.test.ts`:

```ts
/**
 * Tests for src/core/migrations/v32-achievement-rename.ts.
 *
 * Idempotent rename of V3.1 achievement IDs to V3.2 IDs. Drops obsolete
 * `first_tool` (the tool family covers it). XP carried by the original
 * unlocks is already in state.progress.xp — this migration only touches
 * the `unlocked` and `pendingUnlocks` arrays.
 */

import { describe, expect, it } from "vitest";
import {
  MIGRATION_MAP_V31_TO_V32,
  migrateV31Achievements,
} from "../src/core/migrations/v32-achievement-rename.js";

describe("migrateV31Achievements", () => {
  const ROWS: Array<[string, string | null]> = [
    ["hatch", "hatch_hatchling"],
    ["first_tool", null],
    ["marathon", "marathon_4h"],
    ["ultra_marathon", "marathon_12h"],
    ["night_owl", "night_200"],
    ["nocturnal", "night_1k"],
    ["streak_3d", "streak_3d"],
    ["streak_7d", "streak_7d"],
    ["streak_30d", "streak_30d"],
    ["streak_100d", "streak_100d"],
    ["polyglot", "polyglot_5"],
    ["refactor_master", "refactor_100"],
    ["tool_whisperer", "tool_5k"],
    ["tool_master", "tool_25k"],
    ["tool_legend", "tool_100k"],
    ["centurion", "hatch_mythic"],
    ["code_architect", "code_10k"],
    ["code_titan", "code_50k"],
    ["token_whisperer_v2", "token_1m"],
    ["cache_lord", "cache_100k"],
    ["frugal_coder", "frugal_100p"],
    ["big_spender", "big_spender_100"],
    ["pr_machine", "pr_50"],
    ["picky_reviewer", "picky_50"],
  ];

  it("maps every V3.1 ID to its V3.2 successor (or null = drop)", () => {
    for (const [v31, v32] of ROWS) {
      expect(MIGRATION_MAP_V31_TO_V32[v31]).toBe(v32);
    }
  });

  it("renames each non-dropped ID inside `unlocked`", () => {
    for (const [v31, v32] of ROWS) {
      if (v32 === null) continue; // dropped
      const out = migrateV31Achievements({ unlocked: [v31], pendingUnlocks: [] });
      expect(out.unlocked).toEqual([v32]);
    }
  });

  it("drops V3.1 IDs that map to null", () => {
    const out = migrateV31Achievements({
      unlocked: ["first_tool", "streak_3d"],
      pendingUnlocks: [],
    });
    expect(out.unlocked).toEqual(["streak_3d"]);
  });

  it("renames inside `pendingUnlocks` the same way", () => {
    const out = migrateV31Achievements({
      unlocked: [],
      pendingUnlocks: ["centurion", "first_tool", "tool_whisperer"],
    });
    // first_tool dropped; centurion -> hatch_mythic; tool_whisperer -> tool_5k
    expect(out.pendingUnlocks).toEqual(["hatch_mythic", "tool_5k"]);
  });

  it("is idempotent — running twice yields the same output", () => {
    const before = {
      unlocked: ["hatch", "first_tool", "tool_whisperer", "streak_3d"],
      pendingUnlocks: ["centurion"],
    };
    const once = migrateV31Achievements(before);
    const twice = migrateV31Achievements(once);
    expect(twice).toEqual(once);
  });

  it("leaves V3.2 IDs untouched", () => {
    const v32Only = {
      unlocked: ["hatch_hatchling", "tool_5k", "marathon_4h", "streak_30d"],
      pendingUnlocks: ["night_1k"],
    };
    expect(migrateV31Achievements(v32Only)).toEqual(v32Only);
  });

  it("preserves order within unlocked / pendingUnlocks", () => {
    const out = migrateV31Achievements({
      unlocked: ["streak_3d", "tool_whisperer", "centurion", "polyglot"],
      pendingUnlocks: [],
    });
    expect(out.unlocked).toEqual(["streak_3d", "tool_5k", "hatch_mythic", "polyglot_5"]);
  });

  it("ignores unknown IDs (keeps them as-is for forward compat)", () => {
    const out = migrateV31Achievements({
      unlocked: ["future_achievement", "tool_whisperer"],
      pendingUnlocks: [],
    });
    expect(out.unlocked).toEqual(["future_achievement", "tool_5k"]);
  });
});
```

- [ ] **Step 5.2: Run tests, verify they fail**

Run: `npx vitest run tests/migrations-v32-rename.test.ts`

Expected: FAIL with "Cannot find module 'migrations/v32-achievement-rename.js'".

- [ ] **Step 5.3: Implement the migration**

Create `src/core/migrations/v32-achievement-rename.ts`:

```ts
/**
 * V3.1 -> V3.2 achievement ID rename.
 *
 * V3.1 used a mix of singletons (hatch, centurion, polyglot, ...) and
 * tier suffixes (streak_3d, tool_whisperer / tool_master / tool_legend, ...).
 * V3.2 unifies on `<family>_<threshold>` with the medal label moved to a
 * dedicated `medal` field on the registry. `first_tool` is dropped (the
 * tool family covers all tool-count progression); `centurion` folds into
 * `hatch_mythic` (the 6th rung of the hatch phase ladder).
 *
 * The function is pure and idempotent: it operates on the `unlocked` and
 * `pendingUnlocks` arrays in `state.achievements`, returning a fresh
 * object. XP carried by these unlocks is already in `state.progress.xp`
 * — the migration does not touch XP.
 */

/**
 * Mapping V3.1 ID -> V3.2 ID, or `null` to drop. Anything not in this
 * map is passed through unchanged (forward compatibility for V3.2+ IDs
 * already present, plus a safe-default for unknown strings).
 */
export const MIGRATION_MAP_V31_TO_V32: Readonly<Record<string, string | null>> = {
  hatch: "hatch_hatchling",
  first_tool: null,
  marathon: "marathon_4h",
  ultra_marathon: "marathon_12h",
  night_owl: "night_200",
  nocturnal: "night_1k",
  streak_3d: "streak_3d",
  streak_7d: "streak_7d",
  streak_30d: "streak_30d",
  streak_100d: "streak_100d",
  polyglot: "polyglot_5",
  refactor_master: "refactor_100",
  tool_whisperer: "tool_5k",
  tool_master: "tool_25k",
  tool_legend: "tool_100k",
  centurion: "hatch_mythic",
  code_architect: "code_10k",
  code_titan: "code_50k",
  token_whisperer_v2: "token_1m",
  cache_lord: "cache_100k",
  frugal_coder: "frugal_100p",
  big_spender: "big_spender_100",
  pr_machine: "pr_50",
  picky_reviewer: "picky_50",
};

export interface AchievementListsV31Or32 {
  unlocked: string[];
  pendingUnlocks: string[];
}

/**
 * Apply the rename map to both `unlocked` and `pendingUnlocks`. IDs that
 * map to `null` are dropped; IDs not in the map are kept as-is.
 *
 * Pure: returns a fresh object, does not mutate input. Idempotent:
 * running on V3.2 IDs is a no-op (they're not keys in the map, so they
 * pass through unchanged).
 */
export function migrateV31Achievements(
  lists: AchievementListsV31Or32,
): AchievementListsV31Or32 {
  return {
    unlocked: rename(lists.unlocked),
    pendingUnlocks: rename(lists.pendingUnlocks),
  };
}

function rename(ids: string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (id in MIGRATION_MAP_V31_TO_V32) {
      const mapped = MIGRATION_MAP_V31_TO_V32[id];
      if (mapped === null) continue; // dropped
      out.push(mapped);
    } else {
      out.push(id); // unknown — keep as-is
    }
  }
  return out;
}
```

- [ ] **Step 5.4: Run tests, verify they pass**

Run: `npx vitest run tests/migrations-v32-rename.test.ts`

Expected: all 8 tests pass.

- [ ] **Step 5.5: Commit**

```bash
git add src/core/migrations/v32-achievement-rename.ts tests/migrations-v32-rename.test.ts
git commit -m "feat(migrations): V3.1 -> V3.2 achievement ID rename

Pure idempotent migration of unlocked + pendingUnlocks arrays. 24
mapping rows including drop (first_tool) and fold (centurion ->
hatch_mythic). Unknown IDs pass through unchanged for forward compat."
```

---

## Task 6: Wire migration into `readState`

**Files:**
- Modify: `src/core/state.ts`

- [ ] **Step 6.1: Add the migration import + apply it in `readState`**

In `src/core/state.ts`, add the import near the others at the top of the file:

```ts
import { migrateV31Achievements } from "./migrations/v32-achievement-rename.js";
```

In the `readState` function, locate the block that currently handles V1 -> V2 migration. Add the V3.2 achievement migration AFTER the V1 -> V2 step but BEFORE `StateSchema.safeParse`. Replace the block:

```ts
  // V1 -> V2 transparent migration. The on-disk file stays V1-shaped until
  // the next withStateLock cycle rewrites it.
  const v1 = looksLikeV1(parsed);
  if (v1) {
    return migrateV1ToV2(v1, () => generatePet());
  }

  const result = StateSchema.safeParse(parsed);
  if (!result.success) {
    throw new StateCorruptError("state.json failed schema validation", result.error);
  }
  return result.data;
}
```

with:

```ts
  // V1 -> V2 transparent migration. The on-disk file stays V1-shaped until
  // the next withStateLock cycle rewrites it.
  const v1 = looksLikeV1(parsed);
  if (v1) {
    const migrated = migrateV1ToV2(v1, () => generatePet());
    // V3.2 achievement IDs may already need renaming inside the V1 state.
    const v32Achievements = migrateV31Achievements({
      unlocked: migrated.achievements.unlocked,
      pendingUnlocks: migrated.achievements.pendingUnlocks,
    });
    migrated.achievements.unlocked = v32Achievements.unlocked;
    migrated.achievements.pendingUnlocks = v32Achievements.pendingUnlocks;
    return migrated;
  }

  // V3.1 -> V3.2 achievement ID rename. schemaVersion is still 2 for both
  // V3.1 and V3.2; only the contents of `unlocked` / `pendingUnlocks` change.
  // Idempotent: running on already-V3.2 state is a no-op.
  if (typeof parsed === "object" && parsed !== null) {
    const obj = parsed as { achievements?: { unlocked?: unknown; pendingUnlocks?: unknown } };
    const a = obj.achievements;
    if (
      a &&
      Array.isArray(a.unlocked) &&
      Array.isArray(a.pendingUnlocks)
    ) {
      const v32 = migrateV31Achievements({
        unlocked: a.unlocked.filter((x): x is string => typeof x === "string"),
        pendingUnlocks: a.pendingUnlocks.filter((x): x is string => typeof x === "string"),
      });
      a.unlocked = v32.unlocked;
      a.pendingUnlocks = v32.pendingUnlocks;
    }
  }

  const result = StateSchema.safeParse(parsed);
  if (!result.success) {
    throw new StateCorruptError("state.json failed schema validation", result.error);
  }
  return result.data;
}
```

- [ ] **Step 6.2: Add a state-level test that the achievement migration runs through `readState`**

In `tests/state.test.ts`, add a new `describe` block after the existing V1 -> V2 migration test:

```ts
describe("V3.1 -> V3.2 achievement ID rename through readState", () => {
  it("renames V3.1 IDs in unlocked + pendingUnlocks on read", async () => {
    const { paths, petEngine, schema, state } = await loadModules();
    await state.ensurePetforgeDir();
    const fresh = schema.createInitialState(testPet(petEngine), 1700000000000);
    fresh.achievements.unlocked = ["hatch", "tool_whisperer", "centurion"];
    fresh.achievements.pendingUnlocks = ["first_tool", "marathon"];
    await fs.writeFile(paths.STATE_FILE, JSON.stringify(fresh, null, 2), "utf8");

    const out = await state.readState();
    expect(out.achievements.unlocked).toEqual([
      "hatch_hatchling",
      "tool_5k",
      "hatch_mythic",
    ]);
    // first_tool dropped; marathon renamed
    expect(out.achievements.pendingUnlocks).toEqual(["marathon_4h"]);
  });
});
```

- [ ] **Step 6.3: Run state tests**

Run: `npx vitest run tests/state.test.ts tests/migrations-v32-rename.test.ts`

Expected: all tests pass (including the new `readState` migration test).

- [ ] **Step 6.4: Commit**

```bash
git add src/core/state.ts tests/state.test.ts
git commit -m "feat(state): apply V3.1 -> V3.2 achievement rename in readState

Renames are transparent at read time. The on-disk file stays V3.1-shaped
until the next withStateLock cycle rewrites it. Composes with the
existing V1 -> V2 migration (V1 states get both renames applied)."
```

---

## Task 7: Update existing achievement-related tests for renamed IDs

**Files:**
- Modify: `tests/achievements.test.ts`
- Modify: `tests/hook.test.ts`
- Modify: `tests/render.test.ts`

- [ ] **Step 7.1: Replace `tests/achievements.test.ts` body of the `checkAchievementsForEvent` describe block**

Search for `describe("checkAchievementsForEvent"` in `tests/achievements.test.ts`. Replace its entire body (the `it(...)` calls) with the V3.2 set:

```ts
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

    it("hatch_mythic fires when level >= 100", () => {
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
        fileExtensions: [".ts", ".tsx", ".md", ".json", ".sh", ".py", ".go", ".rs", ".css", ".html", ".yml", ".toml"],
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
      // First check: should unlock hatch_egg, tool_5k, polyglot_5,
      // refactor_100, marathon_4h, marathon_12h, marathon_24h.
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
```

- [ ] **Step 7.2: Update `tests/hook.test.ts` marathon test**

In `tests/hook.test.ts`, find the test `it("session_end: +50 xp, sessions++, deletes activeSessions, fires marathon if >4h"` and replace its assertion `expect(s.achievements.unlocked).toContain("marathon");` with `expect(s.achievements.unlocked).toContain("marathon_4h");`. Other XP arithmetic stays unchanged (1000 XP for marathon_4h matches the bronze tier).

If the test name still contains the word `marathon`, leave it (it's still a marathon test, just on the renamed ID).

- [ ] **Step 7.3: Run all tests**

Run: `npx vitest run`

Expected: all tests pass.

- [ ] **Step 7.4: Commit**

```bash
git add tests/achievements.test.ts tests/hook.test.ts
git commit -m "test(achievements): rename to V3.2 IDs + add tier-coverage tests

Existing tests rewritten to reference the renamed IDs (tool_5k,
marathon_4h, night_200, ...). New tests cover the silver/gold tiers of
each rebuilt family, plus the hatch ladder. The cumulative XP-once test
now expects the V3.2 unlock set (which includes both marathon_4h and
the higher marathon_12h/24h since the test uses startTs=0)."
```

---

## Task 8: Web view rendering — medal classes + emoji + 46-case progress switch

**Files:**
- Modify: `src/render/web/page.ts`

- [ ] **Step 8.1: Replace `achievementProgress` switch with the 46-case version**

In `src/render/web/page.ts`, locate the `function achievementProgress(id, s)` block inside `CLIENT_JS`. Replace its body (the `switch (id)` and its cases) with:

```js
    var FOUR_H = 4 * 60 * 60 * 1000;
    var TWELVE_H = 12 * 60 * 60 * 1000;
    var TWENTYFOUR_H = 24 * 60 * 60 * 1000;
    function activeSessionDurationMs() {
      var as = c.activeSessions || {};
      var max = 0;
      var nowMs = Date.now();
      for (var k in as) {
        var ts = as[k] && as[k].startTs;
        if (typeof ts === "number") {
          var d = nowMs - ts;
          if (d > max) max = d;
        }
      }
      return max;
    }
    switch (id) {
      // Hatch ladder (level)
      case "hatch_egg": return { current: p.level || 0, target: 1 };
      case "hatch_hatchling": return { current: p.level || 0, target: 5 };
      case "hatch_junior": return { current: p.level || 0, target: 20 };
      case "hatch_adult": return { current: p.level || 0, target: 50 };
      case "hatch_elder": return { current: p.level || 0, target: 80 };
      case "hatch_mythic": return { current: p.level || 0, target: 100 };
      // Streak
      case "streak_3d": return { current: c.streakDays || 0, target: 3 };
      case "streak_7d": return { current: c.streakDays || 0, target: 7 };
      case "streak_30d": return { current: c.streakDays || 0, target: 30 };
      case "streak_100d": return { current: c.streakDays || 0, target: 100 };
      // Tool
      case "tool_5k": return { current: c.toolUseTotal || 0, target: 5000 };
      case "tool_25k": return { current: c.toolUseTotal || 0, target: 25000 };
      case "tool_100k": return { current: c.toolUseTotal || 0, target: 100000 };
      // Marathon
      case "marathon_4h": return { current: Math.min(FOUR_H, activeSessionDurationMs()), target: FOUR_H };
      case "marathon_12h": return { current: Math.min(TWELVE_H, activeSessionDurationMs()), target: TWELVE_H };
      case "marathon_24h": return { current: Math.min(TWENTYFOUR_H, activeSessionDurationMs()), target: TWENTYFOUR_H };
      // Night
      case "night_200": return { current: c.nightOwlEvents || 0, target: 200 };
      case "night_1k": return { current: c.nightOwlEvents || 0, target: 1000 };
      case "night_5k": return { current: c.nightOwlEvents || 0, target: 5000 };
      // Polyglot (max distinct extensions across active sessions)
      case "polyglot_5": return { current: maxOver("fileExtensions"), target: 5 };
      case "polyglot_8": return { current: maxOver("fileExtensions"), target: 8 };
      case "polyglot_12": return { current: maxOver("fileExtensions"), target: 12 };
      // Refactor (max tool count across active sessions)
      case "refactor_100": return { current: maxOver("toolUseCount"), target: 100 };
      case "refactor_250": return { current: maxOver("toolUseCount"), target: 250 };
      case "refactor_500": return { current: maxOver("toolUseCount"), target: 500 };
      // Code lines (OTel)
      case "code_10k": return { current: o.linesAdded || 0, target: 10000 };
      case "code_50k": return { current: o.linesAdded || 0, target: 50000 };
      case "code_200k": return { current: o.linesAdded || 0, target: 200000 };
      // Token (OTel)
      case "token_1m": return { current: (o.tokensIn || 0) + (o.tokensOut || 0), target: 1000000 };
      case "token_10m": return { current: (o.tokensIn || 0) + (o.tokensOut || 0), target: 10000000 };
      case "token_100m": return { current: (o.tokensIn || 0) + (o.tokensOut || 0), target: 100000000 };
      // Cache (OTel) — show volume progress; ratio is a side-condition
      case "cache_100k": return { current: (o.tokensIn || 0) + (o.tokensCacheRead || 0), target: 100000 };
      case "cache_1m": return { current: (o.tokensIn || 0) + (o.tokensCacheRead || 0), target: 1000000 };
      case "cache_10m": return { current: (o.tokensIn || 0) + (o.tokensCacheRead || 0), target: 10000000 };
      // Frugal (OTel) — show prompt progress; cost ceiling is a side-condition
      case "frugal_100p": return { current: c.promptsTotal || 0, target: 100 };
      case "frugal_500p": return { current: c.promptsTotal || 0, target: 500 };
      case "frugal_2kp": return { current: c.promptsTotal || 0, target: 2000 };
      // Big spender (OTel) — costUsdCents in cents; thresholds in cents
      case "big_spender_100": return { current: o.costUsdCents || 0, target: 10000 };
      case "big_spender_500": return { current: o.costUsdCents || 0, target: 50000 };
      case "big_spender_2k": return { current: o.costUsdCents || 0, target: 200000 };
      // PR (OTel)
      case "pr_50": return { current: o.prCount || 0, target: 50 };
      case "pr_200": return { current: o.prCount || 0, target: 200 };
      case "pr_500": return { current: o.prCount || 0, target: 500 };
      // Picky (OTel)
      case "picky_50": return { current: o.editsRejected || 0, target: 50 };
      case "picky_250": return { current: o.editsRejected || 0, target: 250 };
      case "picky_1k": return { current: o.editsRejected || 0, target: 1000 };
      default: return { current: 0, target: 1 };
    }
  }
```

(Note: the existing `var c`, `var p`, `var o`, and `function maxOver` declarations earlier in `achievementProgress` stay — only the `var FOUR_H ...` block + `switch (id)` body is replaced.)

- [ ] **Step 8.2: Add medal CSS rules**

In `src/render/web/page.ts`, in the `const CSS = ...` template literal, find the existing `.ach-bar-fill` rule. INSERT immediately after `.ach.unlocked .ach-bar-fill { background: #3fb950; }`:

```css
  /* Medal-specific tints (overrides .ach.unlocked default). */
  .ach.medal-bronze.unlocked .ach-bar-fill   { background: #cd7f32; }
  .ach.medal-bronze.unlocked .ach-pct        { color: #cd7f32; }
  .ach.medal-bronze.unlocked .ach-mark       { color: #cd7f32; }
  .ach.medal-silver.unlocked .ach-bar-fill   { background: #c9d1d9; }
  .ach.medal-silver.unlocked .ach-pct        { color: #c9d1d9; }
  .ach.medal-silver.unlocked .ach-mark       { color: #c9d1d9; }
  .ach.medal-gold.unlocked .ach-bar-fill     { background: #ffd700; }
  .ach.medal-gold.unlocked .ach-pct          { color: #ffd700; }
  .ach.medal-gold.unlocked .ach-mark         { color: #ffd700; }
  .ach.medal-platinum.unlocked .ach-bar-fill { background: #79c0ff; }
  .ach.medal-platinum.unlocked .ach-pct      { color: #79c0ff; }
  .ach.medal-platinum.unlocked .ach-mark     { color: #79c0ff; }
```

- [ ] **Step 8.3: Render medal emoji + class in achievement HTML**

In `src/render/web/page.ts`, locate the achievement HTML construction inside `renderState()` (the loop building `achHtml`). Replace the existing loop body:

```js
      var prog = achievementProgress(id, s);
      var ratio = prog.target > 0 ? Math.min(1, prog.current / prog.target) : 0;
      var pctStr = Math.round(ratio * 100) + "%";
      var progressLabel = prog.current.toLocaleString() + " / " + prog.target.toLocaleString();
      achHtml += '<details class="ach' + (unlocked ? ' unlocked' : '') + '">';
      achHtml += '<summary class="ach-summary">';
      achHtml += '<span class="ach-mark">' + (unlocked ? '✓' : '·') + '</span> ';
      achHtml += '<span class="ach-name">' + def.name + '</span>';
      achHtml += '<span class="ach-pct">' + (unlocked ? '' : pctStr) + '</span>';
      achHtml += '</summary>';
      achHtml += '<div class="ach-detail">';
      achHtml += '<p class="ach-desc">' + def.description + '</p>';
      achHtml += '<div class="ach-bar-track"><div class="ach-bar-fill" style="width:' + (ratio * 100) + '%"></div></div>';
      achHtml += '<p class="ach-progress-label">' + progressLabel + (unlocked ? ' · unlocked (+' + def.xp + ' xp)' : '') + '</p>';
      achHtml += '</div>';
      achHtml += '</details>';
```

with:

```js
      var prog = achievementProgress(id, s);
      var ratio = prog.target > 0 ? Math.min(1, prog.current / prog.target) : 0;
      var pctStr = Math.round(ratio * 100) + "%";
      var progressLabel = prog.current.toLocaleString() + " / " + prog.target.toLocaleString();
      var medal = def.medal || "";
      var medalEmoji = medal === "bronze" ? "🥉"
        : medal === "silver" ? "🥈"
        : medal === "gold" ? "🥇"
        : medal === "platinum" ? "💎"
        : "";
      var classes = "ach" + (unlocked ? " unlocked" : "") + (medal ? " medal-" + medal : "");
      achHtml += '<details class="' + classes + '">';
      achHtml += '<summary class="ach-summary">';
      achHtml += '<span class="ach-mark">' + (unlocked ? "✓" : "·") + '</span> ';
      if (medalEmoji) achHtml += '<span class="ach-medal">' + medalEmoji + '</span> ';
      achHtml += '<span class="ach-name">' + def.name + '</span>';
      achHtml += '<span class="ach-pct">' + (unlocked ? "" : pctStr) + '</span>';
      achHtml += '</summary>';
      achHtml += '<div class="ach-detail">';
      achHtml += '<p class="ach-desc">' + def.description + '</p>';
      achHtml += '<div class="ach-bar-track"><div class="ach-bar-fill" style="width:' + (ratio * 100) + '%"></div></div>';
      achHtml += '<p class="ach-progress-label">' + progressLabel + (unlocked ? " · unlocked (+" + def.xp + " xp)" : "") + '</p>';
      achHtml += '</div>';
      achHtml += '</details>';
```

- [ ] **Step 8.4: Run typecheck + tests**

Run: `npx tsc --noEmit && npx vitest run`

Expected: typecheck clean; all tests pass.

- [ ] **Step 8.5: Commit**

```bash
git add src/render/web/page.ts
git commit -m "feat(web): medal emoji + tinted bars on achievement details

CSS adds .ach.medal-bronze/silver/gold/platinum tints for the bar fill,
mark, and percentage. The achievement <details> renders the medal
emoji (🥉🥈🥇💎) before the name. The achievementProgress switch
covers all 46 V3.2 IDs."
```

---

## Task 9: Ink TUI medal emoji prefix in `AchievementGrid`

**Files:**
- Modify: `src/render/components/AchievementGrid.tsx`

- [ ] **Step 9.1: Read the current AchievementGrid**

Run: `cat src/render/components/AchievementGrid.tsx`

Note the current rendering structure (it iterates `ACHIEVEMENT_IDS`, looks up each in `ACHIEVEMENTS`, and prints unlocked / locked).

- [ ] **Step 9.2: Add medal emoji prefix**

In `src/render/components/AchievementGrid.tsx`, replace the per-achievement render logic. Locate the line that builds the displayed name (typically `def.name` inside a `<Text>`), and replace it with:

```tsx
            const medalEmoji =
              def.medal === "bronze"
                ? "🥉"
                : def.medal === "silver"
                  ? "🥈"
                  : def.medal === "gold"
                    ? "🥇"
                    : def.medal === "platinum"
                      ? "💎"
                      : "  ";
            return (
              <Text key={id} color={unlocked ? "green" : "gray"}>
                {unlocked ? "✓" : "·"} {medalEmoji} {def.name}
              </Text>
            );
```

(Adjust to match existing JSX structure — the helpers `medalEmoji` and the `<Text>` wrapper are the only additions; keep any existing column/row layout.)

- [ ] **Step 9.3: Run render tests**

Run: `npx vitest run tests/render.test.ts`

Expected: tests pass; if any test asserts on a specific old name like `Hatch` (without the dot/space), update the matcher to the new `Hatch · Hatchling` format. (Use `expect(out).toMatch(/Hatch/)` style — partial-match is preferred so naming tweaks don't break the test.)

- [ ] **Step 9.4: Commit**

```bash
git add src/render/components/AchievementGrid.tsx tests/render.test.ts
git commit -m "feat(ink): medal emoji prefix on AchievementGrid

Bronze/silver/gold/platinum get 🥉🥈🥇💎 before the name; non-medal
achievements (the hatch ladder) get a 2-char gap so the name column
stays aligned across rows."
```

---

## Task 10: Registry-hygiene tests + update spec count

**Files:**
- Create: `tests/achievements-medals.test.ts`
- Modify: `docs/superpowers/specs/2026-05-02-petforge-v3-2-medal-achievements-design.md`

- [ ] **Step 10.1: Write the registry-hygiene tests**

Create `tests/achievements-medals.test.ts`:

```ts
/**
 * Registry hygiene tests for the V3.2 medal-tagged achievement registry.
 *
 * Asserts:
 *   - Every medal-tagged achievement has the expected XP for its tier.
 *   - The hatch ladder has exactly 6 phase entries with no medal field.
 *   - Every family in the threshold table has the expected count of entries.
 *   - The total registry has exactly 46 entries.
 */

import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS } from "../src/core/achievements.js";
import { ACHIEVEMENT_IDS } from "../src/core/schema.js";

describe("V3.2 achievement registry hygiene", () => {
  it("ACHIEVEMENT_IDS has exactly 46 entries", () => {
    expect(ACHIEVEMENT_IDS.length).toBe(46);
  });

  it("every ID in ACHIEVEMENT_IDS has a registry entry", () => {
    for (const id of ACHIEVEMENT_IDS) {
      expect(ACHIEVEMENTS[id]).toBeDefined();
    }
  });

  it("hatch ladder has 6 entries, none with a medal", () => {
    const hatchIds = ACHIEVEMENT_IDS.filter((id) => id.startsWith("hatch_"));
    expect(hatchIds).toEqual([
      "hatch_egg",
      "hatch_hatchling",
      "hatch_junior",
      "hatch_adult",
      "hatch_elder",
      "hatch_mythic",
    ]);
    for (const id of hatchIds) {
      expect(ACHIEVEMENTS[id].medal).toBeUndefined();
    }
  });

  it("XP per medal matches the standard scale (1k / 3k / 10k / 30k)", () => {
    const expectedXp: Record<string, number> = {
      bronze: 1_000,
      silver: 3_000,
      gold: 10_000,
      platinum: 30_000,
    };
    for (const id of ACHIEVEMENT_IDS) {
      const def = ACHIEVEMENTS[id];
      if (def.medal) {
        expect(def.xp).toBe(expectedXp[def.medal]);
      }
    }
  });

  it("every family has 3 medal entries (streak has 4)", () => {
    const familyCount: Record<string, number> = {};
    for (const id of ACHIEVEMENT_IDS) {
      const def = ACHIEVEMENTS[id];
      if (!def.medal) continue;
      const family = id.split("_")[0];
      familyCount[family] = (familyCount[family] || 0) + 1;
    }
    expect(familyCount.streak).toBe(4);
    expect(familyCount.tool).toBe(3);
    expect(familyCount.marathon).toBe(3);
    expect(familyCount.night).toBe(3);
    expect(familyCount.polyglot).toBe(3);
    expect(familyCount.refactor).toBe(3);
    expect(familyCount.code).toBe(3);
    expect(familyCount.token).toBe(3);
    expect(familyCount.cache).toBe(3);
    expect(familyCount.frugal).toBe(3);
    expect(familyCount.big).toBe(3); // big_spender — split() keeps the first segment
    expect(familyCount.pr).toBe(3);
    expect(familyCount.picky).toBe(3);
  });

  it("every medal-tagged achievement has bronze/silver/gold/platinum value", () => {
    const allowed = new Set(["bronze", "silver", "gold", "platinum"]);
    for (const id of ACHIEVEMENT_IDS) {
      const m = ACHIEVEMENTS[id].medal;
      if (m !== undefined) {
        expect(allowed.has(m)).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 10.2: Run hygiene tests**

Run: `npx vitest run tests/achievements-medals.test.ts`

Expected: all 6 tests pass.

- [ ] **Step 10.3: Fix the spec doc count**

In `docs/superpowers/specs/2026-05-02-petforge-v3-2-medal-achievements-design.md`, find the "Final achievement count" section. Replace the bullet list:

```markdown
- 6 phase milestones (hatch ladder)
- 12 families × 3 medals = 36 medal achievements
- 1 platinum (streak)

**Total: 43 achievements**
```

with:

```markdown
- 6 phase milestones (hatch ladder)
- 13 medal families × 3 = 39 medal achievements
- 1 platinum (streak)

**Total: 46 achievements**
```

- [ ] **Step 10.4: Commit**

```bash
git add tests/achievements-medals.test.ts docs/superpowers/specs/2026-05-02-petforge-v3-2-medal-achievements-design.md
git commit -m "test(achievements): registry-hygiene + fix spec doc count

Spec said 43 achievements; the family table actually lists 13 medal
families, so the correct total is 46 (6 hatch + 13*3 + 1 platinum).
Fix the spec inline; new hygiene test asserts the 46 count + per-medal
XP scale + family entry counts."
```

---

## Task 11: Version bump, README, CHANGELOG, full validation

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 11.1: Bump package version**

In `package.json`, change `"version": "..."` to `"version": "3.2.0"`.

- [ ] **Step 11.2: Update README — achievements section**

In `README.md`, find any block that lists achievements (search for "Hatch", "Streak", or the achievements list). Replace it with:

```markdown
**46 achievements** organized as:

- **Hatch phase ladder** (6 milestones, no medal): egg / hatchling / junior /
  adult / elder / mythic — fires when your pet enters each phase.
- **13 medal families**, each with 🥉 bronze, 🥈 silver, 🥇 gold tiers
  (streak adds a 💎 platinum):
  - **Streak** (3d / 7d / 30d / 100d), **Tool** (5K / 25K / 100K),
    **Marathon** (4h / 12h / 24h), **Night** (200 / 1K / 5K events),
    **Polyglot** (5 / 8 / 12 ext per session),
    **Refactor** (100 / 250 / 500 tools per session)
  - OTel-gated (require `petforge collect`):
    **Code lines** (10K / 50K / 200K), **Tokens** (1M / 10M / 100M),
    **Cache** (100K / 1M / 10M with hit-rate ladder),
    **Frugal** (100p<$1 / 500p<$5 / 2Kp<$20),
    **Big spender** ($100 / $500 / $2K),
    **PR** (50 / 200 / 500), **Picky** (50 / 250 / 1K rejected edits)

XP per medal: bronze 1K, silver 3K, gold 10K, platinum 30K. Hatch ladder
scales from 50 (egg) to 25K (mythic).
```

If no such block exists, add it under a new heading near the achievement-related text in the README.

- [ ] **Step 11.3: Add CHANGELOG entry**

Prepend to `CHANGELOG.md` (just under the top header):

```markdown
## 3.2.0 — 2026-05-02

**Achievement restructure** — 24 → 46 achievements with bronze/silver/gold medal tiers.

- Hatch becomes a 6-milestone phase ladder (egg / hatchling / junior / adult /
  elder / mythic), unlocked by the corresponding level boundary. Centurion is
  folded into hatch_mythic.
- 13 medal-tagged families (streak / tool / marathon / night / polyglot /
  refactor / code / token / cache / frugal / big_spender / pr / picky) each
  expose bronze/silver/gold tiers; streak adds a platinum tier at 100 days.
- New `medal` field on `AchievementDef`. UI renders 🥉🥈🥇💎 emoji prefix
  in both the web view and the Ink TUI; the web view tints the progress
  bar / mark by medal color.
- V3.1 -> V3.2 ID rename runs transparently in `readState`. `first_tool`
  is dropped (tool family covers it); existing XP is preserved verbatim.
- Bumps the previously-too-easy thresholds (tool 1K -> 5K, night 50 -> 200,
  marathon 1h -> 4h) and adds tiers above (tool 100K, night 5K, marathon 24h).
- Registry-hygiene tests assert the 46-entry total + per-medal XP scale.
```

- [ ] **Step 11.4: Run the full validation pipeline**

Run:

```bash
npx biome check .
npx tsc --noEmit
npx vitest run
```

Expected: clean Biome, clean typecheck, all tests pass (302+ counting the new hygiene tests + migration tests).

- [ ] **Step 11.5: Build + reinstall global**

```bash
npm run build
npm install -g .
petforge --version
```

Expected: build succeeds; `petforge --version` reports `3.2.0`.

- [ ] **Step 11.6: Smoke test**

Stop any running petforge instance, then start fresh:

```bash
# stop existing
PIDS=$(netstat -ano | grep -E "7878|7879" | grep LISTENING | awk '{print $5}' | sort -u)
for pid in $PIDS; do taskkill //F //PID $pid 2>&1 >/dev/null; done

# start fresh
petforge up --lan
```

Open the served URL, verify:
- Achievement list shows the medal emoji (🥉🥈🥇💎) prefixed before the name.
- Existing unlocks are preserved with renamed IDs (`hatch_hatchling` instead of `hatch`, `tool_5k` instead of `tool_whisperer`, etc.).
- Locked achievements show grey `·`, unlocked ones show green `✓` with medal-tinted fill.
- Click on a locked achievement — the detail panel stays open across animation ticks (split-render fix from V3.1 still works).

- [ ] **Step 11.7: Commit**

```bash
git add package.json README.md CHANGELOG.md
git commit -m "release(v3.2.0): medal achievements + hatch phase ladder

Bumps to 3.2.0. README and CHANGELOG describe the full 46-achievement
set. Build + reinstall global verified to report 3.2.0."
```

---

## Self-Review

**Spec coverage:**

| Spec point | Task |
|---|---|
| `Medal` type + optional `medal` field on `AchievementDef` | Task 1.2 |
| Hatch phase ladder with 6 milestones, phase-based triggers | Task 2.1 (registry) + Task 3.1 (`checkPhases`) |
| 13 medal families with bronze/silver/gold (+ streak platinum) | Task 2.1 (registry) + Tasks 3.1 / 4.1 (checkers) |
| Total 46 achievements | Task 1.1 (ID list) + Task 10.1 (hygiene assertion) |
| Semantic IDs + medal field for UI rendering | Task 1.2 (interface) + Task 8.3 (web render) + Task 9.2 (Ink render) |
| Migration: V3.1 → V3.2 lossless ID rename | Task 5 (migration) + Task 6 (wired into readState) |
| Migration handles V1 → V2 chain (achievements get renamed too) | Task 6.1 (V1→V2 path now also runs migrateV31Achievements) |
| `first_tool` dropped, `centurion` folds to `hatch_mythic` | Task 5.3 (mapping table) |
| XP retained for existing unlocks | Task 5.3 (migration only touches unlocked/pendingUnlocks; XP already in progress.xp) |
| Backfill: newly-qualifying achievements unlock on next hook | Task 3.1 (the rebuilt checks evaluate ALL conditions on next event) |
| Web rendering: medal emoji + class + bar tint | Task 8.2 (CSS) + Task 8.3 (HTML) |
| Ink rendering: medal emoji prefix | Task 9.2 |
| Threshold values per family from spec | Task 2.1 (registry) + Tasks 3.1 / 4.1 (checks) match the spec table 1-to-1 |
| Tests cover migration rows + idempotence + V3.1 leak guard | Task 5.1 |
| Registry hygiene tests | Task 10.1 |
| Spec count fix (43 → 46) | Task 10.3 |
| README + CHANGELOG + version bump | Task 11.1-11.3 |

**Placeholder scan:** No "TBD", "TODO", "implement later", or "fill in details" anywhere in the plan. Every code step has a complete code block. Every test step has full assertions. The Ink TUI step (9.2) shows the new render line in full.

**Type consistency:**
- `AchievementId` (defined in Task 1.1) is used by `AchievementDef` (Task 1.2), `tryUnlock` signature (Task 3.1, 4.1), and `MIGRATION_MAP_V31_TO_V32` (`string` keys → `string | null` values, on purpose, since V3.1 IDs aren't in the V3.2 union).
- `Medal` (Task 1.2) is referenced in registry entries (Task 2.1) and in the CSS class names (Task 8.2) — values match: `"bronze" | "silver" | "gold" | "platinum"`.
- `migrateV31Achievements` signature (Task 5.3) matches its callers in Task 6.1 and the test in Task 5.1.
- `achievementProgress` switch (Task 8.1) covers every `ACHIEVEMENT_IDS` entry — count verified: 6 + 4 + 3 + 3 + 3 + 3 + 3 + 3 + 3 + 3 + 3 + 3 + 3 + 3 = 46.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-02-petforge-v3-2-medal-achievements-plan.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Each commit is a green-build checkpoint. Ideal for a plan this size (11 tasks).

**2. Inline Execution** — I execute tasks in this session using `executing-plans`, batching where natural with checkpoints between feature units. Faster end-to-end but less review surface.

Which approach?
