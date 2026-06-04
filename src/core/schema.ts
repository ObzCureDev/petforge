/**
 * PetForge state schema — types and Zod validators.
 *
 * Mirrors spec §4. The state lives at ~/.petforge/state.json and is the single
 * source of truth for the pet, progress, counters, achievements and buddy mode.
 */

import { z } from "zod";
import { createInitialOtelCounters, type OtelCounters, OtelCountersSchema } from "./otel/schema.js";
import { type QuotaState, QuotaStateSchema } from "./quota/schema.js";
import {
  type PersistedSpend,
  PersistedSpendSchema,
  type SpendSnapshot,
  SpendSnapshotSchema,
} from "./spend/schema.js";

// ---------- Enums ----------

export const SPECIES = [
  // Common (7)
  "duck",
  "goose",
  "blob",
  "turtle",
  "snail",
  "mushroom",
  "chonk",
  // Uncommon (4)
  "octopus",
  "penguin",
  "cactus",
  "rabbit",
  // Rare (4)
  "cat",
  "owl",
  "capybara",
  "robot",
  // Epic (2)
  "ghost",
  "axolotl",
  // Legendary (1)
  "dragon",
] as const;
export type Species = (typeof SPECIES)[number];

export const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"] as const;
export type Rarity = (typeof RARITIES)[number];

/**
 * Each species has a fixed rarity tier — matches Buddy's design where Octopus
 * is always Uncommon, Dragon always Legendary, etc. `pickRarity` rolls the
 * tier first; `pickSpecies` then selects from the matching bucket.
 */
export const SPECIES_RARITY: Record<Species, Rarity> = {
  duck: "common",
  goose: "common",
  blob: "common",
  turtle: "common",
  snail: "common",
  mushroom: "common",
  chonk: "common",
  octopus: "uncommon",
  penguin: "uncommon",
  cactus: "uncommon",
  rabbit: "uncommon",
  cat: "rare",
  owl: "rare",
  capybara: "rare",
  robot: "rare",
  ghost: "epic",
  axolotl: "epic",
  dragon: "legendary",
};

/** Pre-built rarity buckets for `pickSpecies`. Order within each is stable. */
export const SPECIES_BY_RARITY: Record<Rarity, readonly Species[]> = {
  common: ["duck", "goose", "blob", "turtle", "snail", "mushroom", "chonk"],
  uncommon: ["octopus", "penguin", "cactus", "rabbit"],
  rare: ["cat", "owl", "capybara", "robot"],
  epic: ["ghost", "axolotl"],
  legendary: ["dragon"],
};

export const PHASES = ["egg", "hatchling", "junior", "adult", "elder", "mythic"] as const;
export type Phase = (typeof PHASES)[number];

export const BUDDY_TOGGLES = ["auto", "on", "off"] as const;
export type BuddyToggle = (typeof BUDDY_TOGGLES)[number];

export const ACHIEVEMENT_IDS = [
  // Hatch phase ladder (6 - no medal, phase-based progression)
  "hatch_egg",
  "hatch_hatchling",
  "hatch_junior",
  "hatch_adult",
  "hatch_elder",
  "hatch_mythic",
  // Streak (4 - bronze / silver / gold / platinum)
  "streak_3d",
  "streak_7d",
  "streak_30d",
  "streak_100d",
  // Tool count (3)
  "tool_5k",
  "tool_25k",
  "tool_100k",
  // Marathon (3) - single-session duration
  "marathon_4h",
  "marathon_12h",
  "marathon_24h",
  // Night events (3)
  "night_200",
  "night_1k",
  "night_5k",
  // Polyglot (3) - distinct extensions per session
  "polyglot_5",
  "polyglot_8",
  "polyglot_12",
  // Refactor (3) - tools per session
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
  // Frugal - many prompts at low spend (OTel) (3)
  "frugal_100p",
  "frugal_500p",
  "frugal_2kp",
  // Big spender (OTel) (3) - IDs use dollar amounts
  "big_spender_100",
  "big_spender_500",
  "big_spender_2k",
  // PR machine (OTel) (3)
  "pr_50",
  "pr_200",
  "pr_500",
  // Picky reviewer (OTel) (3) - edits rejected
  "picky_50",
  "picky_250",
  "picky_1k",
  // Quota efficient (3 - V3.7, OTel-style optional)
  "quota_efficient_bronze",
  "quota_efficient_silver",
  "quota_efficient_gold",
  // Quota marathon (3 - V3.7, OTel-style optional)
  "quota_marathon_bronze",
  "quota_marathon_silver",
  "quota_marathon_gold",
] as const;
export type AchievementId = (typeof ACHIEVEMENT_IDS)[number];

// ---------- Sub-types ----------

export interface PetStats {
  debugging: number;
  patience: number;
  chaos: number;
  wisdom: number;
  snark: number;
}

export interface Pet {
  species: Species;
  rarity: Rarity;
  shiny: boolean;
  stats: PetStats;
  /** SHA-256(username + hostname), hex. */
  seed: string;
}

export interface Progress {
  /** Cumulative XP. */
  xp: number;
  /** 1..100. */
  level: number;
  phase: Phase;
  pendingLevelUp: boolean;
}

export interface ActiveSession {
  /** epoch ms (from SessionStart event). */
  startTs: number;
  toolUseCount: number;
  /** Unique extensions seen this session. */
  fileExtensions: string[];
  /**
   * V3.5+ — epoch ms of the most recent hook event for this session.
   * Used by the inactivity-based prune (1h since last event). Optional
   * for backward compatibility; pre-V3.5 sessions fall back to startTs.
   */
  lastEventTs?: number;
}

export interface Counters {
  promptsTotal: number;
  toolUseTotal: number;
  sessionsTotal: number;
  /** Indexed by Claude Code session_id (multiple parallel sessions supported). */
  activeSessions: Record<string, ActiveSession>;
  streakDays: number;
  /** ISO date YYYY-MM-DD. */
  lastActiveDate: string;
  /** Events in [22h, 02h) local. */
  nightOwlEvents: number;
  /** V2.0 OTel-derived counters (optional for V1.x state migration). */
  otel?: OtelCounters;
  /** V3.7 quota tracking (opt-in, additive). */
  quota?: QuotaState;
  /**
   * V3.7.7 corrected-lifetime + today spend. NEVER written to state.json by
   * hooks — computed in-process by `petforge serve` and injected into the
   * streamed state for the web view. Optional everywhere.
   */
  spend?: SpendSnapshot;
  /**
   * V3.7.8 additive lifetime spend. WRITTEN to state by the serve spend
   * daemon after each scan: takes the delta of messages newer than
   * `lastSeenNewestTs`, adds to `accumulated*`, advances the watermark.
   * Survives Claude Code's JSONL archival. Optional for V3.7.x state files.
   */
  spendPersisted?: PersistedSpend;
}

export interface Achievements {
  /** Ids of unlocked achievements. */
  unlocked: string[];
  /** Unlocked but cinematic not yet shown. */
  pendingUnlocks: string[];
}

export interface BuddyState {
  detected: boolean;
  /** epoch ms. */
  lastChecked: number;
  userToggle: BuddyToggle;
  /**
   * User-imported Buddy ASCII (via `petforge buddy import`). When non-null
   * AND `userToggle === "on"`, the renderer shows this verbatim instead of
   * the species frame. Persistence is consensual — only set by an explicit
   * import command, never from auto-detection.
   */
  cardCache?: string | null;
}

export interface Meta {
  /** epoch ms first install. */
  createdAt: number;
  updatedAt: number;
}

export interface State {
  schemaVersion: 2;
  pet: Pet;
  progress: Progress;
  counters: Counters;
  achievements: Achievements;
  buddy: BuddyState;
  meta: Meta;
}

// ---------- Zod validators ----------

export const SpeciesSchema = z.enum(SPECIES);
export const RaritySchema = z.enum(RARITIES);
export const PhaseSchema = z.enum(PHASES);
export const BuddyToggleSchema = z.enum(BUDDY_TOGGLES);

export const PetStatsSchema = z.object({
  debugging: z.number(),
  patience: z.number(),
  chaos: z.number(),
  wisdom: z.number(),
  snark: z.number(),
});

export const PetSchema = z.object({
  species: SpeciesSchema,
  rarity: RaritySchema,
  shiny: z.boolean(),
  stats: PetStatsSchema,
  seed: z.string(),
});

export const ProgressSchema = z.object({
  xp: z.number(),
  level: z.number(),
  phase: PhaseSchema,
  pendingLevelUp: z.boolean(),
});

export const ActiveSessionSchema = z.object({
  startTs: z.number(),
  toolUseCount: z.number(),
  fileExtensions: z.array(z.string()),
  // V3.5 additive — pre-V3.5 sessions parse without it.
  lastEventTs: z.number().optional(),
});

export const CountersSchema = z.object({
  promptsTotal: z.number(),
  toolUseTotal: z.number(),
  sessionsTotal: z.number(),
  activeSessions: z.record(z.string(), ActiveSessionSchema),
  streakDays: z.number(),
  lastActiveDate: z.string(),
  nightOwlEvents: z.number(),
  otel: OtelCountersSchema.optional(),
  quota: QuotaStateSchema.optional(),
  // Render-only, injected by serve; never persisted by hooks.
  spend: SpendSnapshotSchema.optional(),
  // V3.7.8 additive lifetime; written by serve spend daemon, additive only.
  spendPersisted: PersistedSpendSchema.optional(),
});

export const AchievementsSchema = z.object({
  unlocked: z.array(z.string()),
  pendingUnlocks: z.array(z.string()),
});

export const BuddyStateSchema = z.object({
  detected: z.boolean(),
  lastChecked: z.number(),
  userToggle: BuddyToggleSchema,
  cardCache: z.string().nullable().optional(),
});

export const MetaSchema = z.object({
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const StateSchema = z.object({
  schemaVersion: z.literal(2),
  pet: PetSchema,
  progress: ProgressSchema,
  counters: CountersSchema,
  achievements: AchievementsSchema,
  buddy: BuddyStateSchema,
  meta: MetaSchema,
});

// ---------- Initial state ----------

/**
 * Build a fresh State around the supplied Pet.
 *
 * Pet generation is the responsibility of the caller (see pet-engine in Task 3).
 * The state layer takes the Pet as a parameter so it stays decoupled.
 */
export function createInitialState(pet: Pet, now: number = Date.now()): State {
  return {
    schemaVersion: 2,
    pet,
    progress: {
      xp: 0,
      level: 1,
      phase: "egg",
      pendingLevelUp: false,
    },
    counters: {
      promptsTotal: 0,
      toolUseTotal: 0,
      sessionsTotal: 0,
      activeSessions: {},
      streakDays: 0,
      lastActiveDate: "",
      nightOwlEvents: 0,
      otel: createInitialOtelCounters(),
    },
    achievements: {
      unlocked: [],
      pendingUnlocks: [],
    },
    buddy: {
      detected: false,
      lastChecked: 0,
      userToggle: "auto",
    },
    meta: {
      createdAt: now,
      updatedAt: now,
    },
  };
}

// ---------- V1.x → V2.0 migration ----------

/**
 * Ensure `state.counters.otel` is populated.
 *
 * V1.x state files do not contain the `otel` block. After loading + validating
 * a state via `StateSchema` (which keeps `otel` optional), call this to
 * synthesize a fresh, all-zero `OtelCounters` if absent. Subsequent OTel-gated
 * achievement evaluation gates on `otel.lastUpdate > 0`, so a freshly
 * synthesized block is correctly inert until the collector ingests data.
 */
export function ensureOtelCounters(state: State): void {
  if (!state.counters.otel) {
    state.counters.otel = createInitialOtelCounters();
  }
}
