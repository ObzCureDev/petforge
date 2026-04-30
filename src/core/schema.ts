/**
 * PetForge state schema — types and Zod validators.
 *
 * Mirrors spec §4. The state lives at ~/.petforge/state.json and is the single
 * source of truth for the pet, progress, counters, achievements and buddy mode.
 */

import { z } from "zod";

// ---------- Enums ----------

export const SPECIES = ["pixel", "glitch", "daemon", "spark", "blob"] as const;
export type Species = (typeof SPECIES)[number];

export const RARITIES = ["common", "uncommon", "rare", "epic", "legendary"] as const;
export type Rarity = (typeof RARITIES)[number];

export const PHASES = ["hatchling", "junior", "adult", "elder", "mythic"] as const;
export type Phase = (typeof PHASES)[number];

export const BUDDY_TOGGLES = ["auto", "on", "off"] as const;
export type BuddyToggle = (typeof BUDDY_TOGGLES)[number];

export const ACHIEVEMENT_IDS = [
  "hatch",
  "first_tool",
  "marathon",
  "night_owl",
  "streak_3d",
  "streak_7d",
  "polyglot",
  "refactor_master",
  "tool_whisperer",
  "centurion",
] as const;
export type AchievementId = (typeof ACHIEVEMENT_IDS)[number];

// ---------- Sub-types ----------

export interface PetStats {
  focus: number;
  grit: number;
  flow: number;
  craft: number;
  spark: number;
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
}

export interface Meta {
  /** epoch ms first install. */
  createdAt: number;
  updatedAt: number;
}

export interface State {
  schemaVersion: 1;
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
  focus: z.number(),
  grit: z.number(),
  flow: z.number(),
  craft: z.number(),
  spark: z.number(),
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
});

export const CountersSchema = z.object({
  promptsTotal: z.number(),
  toolUseTotal: z.number(),
  sessionsTotal: z.number(),
  activeSessions: z.record(z.string(), ActiveSessionSchema),
  streakDays: z.number(),
  lastActiveDate: z.string(),
  nightOwlEvents: z.number(),
});

export const AchievementsSchema = z.object({
  unlocked: z.array(z.string()),
  pendingUnlocks: z.array(z.string()),
});

export const BuddyStateSchema = z.object({
  detected: z.boolean(),
  lastChecked: z.number(),
  userToggle: BuddyToggleSchema,
});

export const MetaSchema = z.object({
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const StateSchema = z.object({
  schemaVersion: z.literal(1),
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
    schemaVersion: 1,
    pet,
    progress: {
      xp: 0,
      level: 1,
      phase: "hatchling",
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
