/**
 * V1 -> V2 state migration.
 *
 * V1 used a 5-species roster (pixel/glitch/daemon/spark/blob) and stat keys
 * focus/grit/flow/craft/spark. V2 swaps to the 18-species Buddy-aligned
 * roster and stat keys debugging/patience/chaos/wisdom/snark.
 *
 * Migration policy is "hard reset of the pet, progress preserved":
 *  - schemaVersion bumps to 2
 *  - pet is regenerated from the same seed (still deterministic per machine)
 *    against the new schema, so every user gets a brand new species/stats roll
 *  - progress (xp, level, phase), counters, achievements, buddy state, and
 *    meta carry over verbatim
 *  - counters.otel is synthesized to a zero block if missing (V1.x states
 *    pre-V2.0 OTel never had it)
 *
 * The function is pure: it takes a V1-shaped object plus a pet factory and
 * returns a V2 State. Disk I/O is the caller's responsibility.
 */

import { createInitialOtelCounters, type OtelCounters } from "../otel/schema.js";
import type { Pet, State } from "../schema.js";

export interface V1State {
  schemaVersion: 1;
  pet: {
    species: "pixel" | "glitch" | "daemon" | "spark" | "blob";
    rarity: "common" | "uncommon" | "rare" | "epic" | "legendary";
    shiny: boolean;
    stats: { focus: number; grit: number; flow: number; craft: number; spark: number };
    seed: string;
  };
  progress: {
    xp: number;
    level: number;
    phase: "egg" | "hatchling" | "junior" | "adult" | "elder" | "mythic";
    pendingLevelUp: boolean;
  };
  counters: {
    promptsTotal: number;
    toolUseTotal: number;
    sessionsTotal: number;
    activeSessions: Record<
      string,
      { startTs: number; toolUseCount: number; fileExtensions: string[] }
    >;
    streakDays: number;
    lastActiveDate: string;
    nightOwlEvents: number;
    otel?: OtelCounters;
  };
  achievements: { unlocked: string[]; pendingUnlocks: string[] };
  buddy: {
    detected: boolean;
    lastChecked: number;
    userToggle: "auto" | "on" | "off";
    cardCache?: string | null;
  };
  meta: { createdAt: number; updatedAt: number };
}

export function migrateV1ToV2(v1: V1State, regeneratePet: () => Pet): State {
  return {
    schemaVersion: 2,
    pet: regeneratePet(),
    progress: { ...v1.progress },
    counters: {
      ...v1.counters,
      activeSessions: { ...v1.counters.activeSessions },
      otel: v1.counters.otel ?? createInitialOtelCounters(),
    },
    achievements: {
      unlocked: [...v1.achievements.unlocked],
      pendingUnlocks: [...v1.achievements.pendingUnlocks],
    },
    buddy: { ...v1.buddy },
    meta: { ...v1.meta },
  };
}
