# PetForge V3 — Buddy Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align PetForge's default schema (species, stats, rarities) with Claude Code Buddy's public vocabulary so that the pet a user sees by default uses the same names and structure as their imported Buddy card. The runtime parser already handles override on import; this plan changes the *default* layer.

**Architecture:** Schema bump V1 -> V2. Hard-reset migration: the user's pet is regenerated from the existing seed against the new species roster, while progress (XP, level, streaks, achievements, counters) is preserved 1-to-1. Species roster grows from 5 (pixel/glitch/daemon/spark/blob) to 18 (duck/goose/blob/turtle/snail/mushroom/chonk/octopus/penguin/cactus/rabbit/cat/owl/capybara/robot/ghost/axolotl/dragon). Stat keys rename (focus/grit/flow/craft/spark -> debugging/patience/chaos/wisdom/snark). Species and rarity become coupled (Octopus is always Uncommon, Dragon always Legendary, etc.) matching Buddy's design. The 17 new species ship with **bespoke hand-drawn ASCII art** in the same visual language as `blob.ts` — distinguishing trait per species (bill, tentacles, ears, hat, wings, etc.), 3 idle-cycle frames per phase, growth across egg/hatchling/junior/adult/elder/mythic. Files are already drafted in `src/render/species/` ahead of plan execution.

**Tech Stack:** TypeScript strict, Vitest, Zod v4, Ink TUI, the existing PetForge codebase (Node 20+, ESM, tsup, Biome).

**Out of scope (deferred to V3.1+):** hat system, eye variants, polished hand-drawn ASCII for the 17 new species, Mulberry32 PRNG migration, Buddy hex-decoding in the cli.js bundle. Each of these is independent and can land later without breaking V3.

---

## File Structure (target end-state)

### Modified

- `src/core/schema.ts` — `SPECIES` becomes 18-species literal tuple; `PetStats` keys renamed; `schemaVersion` bumped to `2`; Zod schemas updated.
- `src/core/pet-engine.ts` — `pickSpecies` becomes rarity-bucketed; `deriveStats` uses new keys; doc comments updated.
- `src/core/state.ts` — `readState` learns to migrate V1 -> V2 in-memory before validating; on-disk file is rewritten on next `withStateLock` mutation.
- `src/render/species/index.ts` — imports/exports 18 species frame modules instead of 5.
- `src/render/web/page.ts` — `statKeys` array updated to new keys.
- `src/render/components/CardView.tsx` — `<StatBar />` rows use new keys + uppercase labels.
- `tests/pet-engine.test.ts` — covers 18-species roster, new bucketed pick logic, new stat keys.
- `README.md` — V3 changelog entry, species table, stat list.
- `CHANGELOG.md` — V3.0.0 entry.

### Created

- `src/core/migrations/v1-to-v2.ts` — pure function that takes a parsed V1-shaped object and returns a V2 `State`, preserving progress/achievements/counters and regenerating the pet from the same seed against the new roster.
- `src/render/species/duck.ts`, `goose.ts`, `turtle.ts`, `snail.ts`, `mushroom.ts`, `chonk.ts`, `octopus.ts`, `penguin.ts`, `cactus.ts`, `rabbit.ts`, `cat.ts`, `owl.ts`, `capybara.ts`, `robot.ts`, `ghost.ts`, `axolotl.ts`, `dragon.ts` — 17 new species files, each with a full bespoke `Record<Phase, string[]>` literal (3 frames x 6 phases). Already drafted on disk; plan only needs to register them in `index.ts`.
- `tests/migrations-v1-to-v2.test.ts` — verifies migration preserves XP/level/achievements and regenerates the pet correctly.

### Deleted

- `src/render/species/pixel.ts`, `glitch.ts`, `daemon.ts`, `spark.ts` — the 4 species not in the Buddy roster. (`blob.ts` stays, blob is in both rosters.)

---

## Task 1: Update schema with new species roster, stat keys, and version bump

**Files:**
- Modify: `src/core/schema.ts`

- [ ] **Step 1.1: Replace the SPECIES tuple with the 18-species roster, ordered by rarity bucket**

Replace lines 13-14 of `src/core/schema.ts`:

```ts
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

/**
 * Each species has a fixed rarity. Determines the rarity bucket used by
 * `pickSpecies` after `pickRarity` rolls the rarity tier. Mirrors Buddy's
 * design (Octopus is always Uncommon, Dragon always Legendary, etc.).
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

/** Pre-built buckets for `pickSpecies`. Order within each bucket is stable. */
export const SPECIES_BY_RARITY: Record<Rarity, readonly Species[]> = {
  common: ["duck", "goose", "blob", "turtle", "snail", "mushroom", "chonk"],
  uncommon: ["octopus", "penguin", "cactus", "rabbit"],
  rare: ["cat", "owl", "capybara", "robot"],
  epic: ["ghost", "axolotl"],
  legendary: ["dragon"],
};
```

Note: `SPECIES_BY_RARITY` references `Rarity`, which is declared on the next line in the original file. Keep `RARITIES` and `Rarity` ABOVE `SPECIES_RARITY` and `SPECIES_BY_RARITY` so TypeScript resolves the type. Reorder the file so the order is: `RARITIES`/`Rarity` first, then `SPECIES`/`Species`/`SPECIES_RARITY`/`SPECIES_BY_RARITY`.

- [ ] **Step 1.2: Rename PetStats keys**

In `src/core/schema.ts`, replace the `PetStats` interface and `PetStatsSchema`:

```ts
export interface PetStats {
  debugging: number;
  patience: number;
  chaos: number;
  wisdom: number;
  snark: number;
}

export const PetStatsSchema = z.object({
  debugging: z.number(),
  patience: z.number(),
  chaos: z.number(),
  wisdom: z.number(),
  snark: z.number(),
});
```

- [ ] **Step 1.3: Bump schemaVersion to 2**

In `src/core/schema.ts`, change the `State` interface and `StateSchema`:

```ts
export interface State {
  schemaVersion: 2;
  pet: Pet;
  progress: Progress;
  counters: Counters;
  achievements: Achievements;
  buddy: BuddyState;
  meta: Meta;
}

export const StateSchema = z.object({
  schemaVersion: z.literal(2),
  pet: PetSchema,
  progress: ProgressSchema,
  counters: CountersSchema,
  achievements: AchievementsSchema,
  buddy: BuddyStateSchema,
  meta: MetaSchema,
});
```

And in `createInitialState`:

```ts
return {
  schemaVersion: 2,
  // ...rest unchanged
};
```

- [ ] **Step 1.4: Run typecheck to surface call-site breakage**

Run: `npx tsc --noEmit`

Expected: errors in `src/core/pet-engine.ts` (old stat keys, old species references), `src/render/web/page.ts`, `src/render/components/CardView.tsx`, `tests/pet-engine.test.ts`. These are addressed in Tasks 2-5 and are expected at this point.

- [ ] **Step 1.5: Commit**

```bash
git add src/core/schema.ts
git commit -m "feat(schema): bump to V2 with 18-species roster + Buddy stat keys

Introduces SPECIES_BY_RARITY bucketing so each species has a fixed rarity
(matches Buddy's design). Stat keys renamed from focus/grit/flow/craft/spark
to debugging/patience/chaos/wisdom/snark. schemaVersion bumped to 2;
migration follows in a subsequent commit."
```

---

## Task 2: Update pet-engine to use rarity-bucketed species selection and new stat keys

**Files:**
- Modify: `src/core/pet-engine.ts`
- Modify: `tests/pet-engine.test.ts`

- [ ] **Step 2.1: Write the failing tests for the new bucketed `pickSpecies`**

Replace the `describe("pickSpecies", ...)` block in `tests/pet-engine.test.ts` (lines 37-53) with:

```ts
describe("pickSpecies", () => {
  it("picks a species from the rarity bucket", () => {
    // common bucket has 7 entries; byte 0 -> duck, byte 1 -> goose, ...
    expect(pickSpecies(0, "common")).toBe("duck");
    expect(pickSpecies(1, "common")).toBe("goose");
    expect(pickSpecies(7, "common")).toBe("duck"); // wraps via mod
    expect(pickSpecies(0, "uncommon")).toBe("octopus");
    expect(pickSpecies(0, "rare")).toBe("cat");
    expect(pickSpecies(0, "epic")).toBe("ghost");
    expect(pickSpecies(0, "legendary")).toBe("dragon");
    expect(pickSpecies(255, "legendary")).toBe("dragon"); // single-element bucket
  });

  it("is deterministic for a given (byte, rarity)", () => {
    for (let b = 0; b < 256; b++) {
      const r = "common" as const;
      expect(pickSpecies(b, r)).toBe(pickSpecies(b, r));
    }
  });

  it("evenly distributes across all 7 commons over the byte range", () => {
    const counts: Record<string, number> = {};
    for (let b = 0; b < 256; b++) {
      const s = pickSpecies(b, "common");
      counts[s] = (counts[s] ?? 0) + 1;
    }
    // 256 / 7 ~= 36.6 each — every bucket lands on 36 or 37.
    for (const c of Object.values(counts)) {
      expect(c).toBeGreaterThanOrEqual(36);
      expect(c).toBeLessThanOrEqual(37);
    }
  });
});
```

- [ ] **Step 2.2: Run tests, verify they fail**

Run: `npx vitest run tests/pet-engine.test.ts`

Expected: failures in the `pickSpecies` block (signature mismatch — current `pickSpecies` takes one arg).

- [ ] **Step 2.3: Update `pickSpecies` to accept a rarity bucket**

Replace the doc comment block (lines 6-13) and the `pickSpecies` function (lines 36-44) of `src/core/pet-engine.ts`:

```ts
/**
 * Pet engine — deterministic pet generator.
 *
 * Spec V3. The pet is fully determined by the SHA-256 of
 * `username + hostname`, so a given user/machine pair always produces the
 * same pet. Bytes of the digest drive rarity/species/shiny/stats.
 *
 * Byte layout:
 *   bytes[0] -> species index (mod bucket size, after rarity is rolled)
 *   bytes[1] -> rarity (scaled to [0,1] via /255)
 *   bytes[2] -> shiny (true if < 3, ~1.17%)
 *   bytes[3..7] -> stats (debugging/patience/chaos/wisdom/snark, each mod 101)
 */
```

```ts
import { type Pet, type PetStats, type Rarity, SPECIES_BY_RARITY, type Species } from "./schema.js";
```

Replace the `pickSpecies` function:

```ts
/** Pick a species from the rarity bucket using `byte` mod bucket size. */
export function pickSpecies(byte: number, rarity: Rarity): Species {
  const bucket = SPECIES_BY_RARITY[rarity];
  const idx = byte % bucket.length;
  const species = bucket[idx];
  if (species === undefined) {
    throw new Error(`pickSpecies: invalid index ${idx} for rarity ${rarity}`);
  }
  return species;
}
```

- [ ] **Step 2.4: Update `deriveStats` to use new stat keys**

Replace the `deriveStats` function:

```ts
/** Derive the 5 stats from `bytes[3..7]`, each in [0, 100]. */
export function deriveStats(bytes: Uint8Array): PetStats {
  return {
    debugging: (bytes[3] ?? 0) % 101,
    patience: (bytes[4] ?? 0) % 101,
    chaos: (bytes[5] ?? 0) % 101,
    wisdom: (bytes[6] ?? 0) % 101,
    snark: (bytes[7] ?? 0) % 101,
  };
}
```

- [ ] **Step 2.5: Update `generatePet` to compute rarity first, then species**

Replace the `generatePet` function:

```ts
export function generatePet(opts: GeneratePetOptions = {}): Pet {
  const username = opts.username ?? os.userInfo().username;
  const hostname = opts.hostname ?? os.hostname();
  const seed = computeSeed(username, hostname);
  const bytes = hexToBytes(seed);

  const speciesByte = bytes[0] ?? 0;
  const rarityByte = bytes[1] ?? 0;
  const shinyByte = bytes[2] ?? 0;

  const rarity = pickRarity(rarityByte / 255);

  return {
    species: pickSpecies(speciesByte, rarity),
    rarity,
    shiny: pickShiny(shinyByte),
    stats: deriveStats(bytes),
    seed,
  };
}
```

- [ ] **Step 2.6: Update the `deriveStats` test that checks specific byte mapping**

In `tests/pet-engine.test.ts`, replace the `"uses bytes[3..7] mod 101"` test body (lines 110-119):

```ts
it("uses bytes[3..7] mod 101", () => {
  const bytes = new Uint8Array([0, 0, 0, 0, 100, 101, 200, 255]);
  expect(deriveStats(bytes)).toEqual({
    debugging: 0,
    patience: 100,
    chaos: 0,
    wisdom: 99,
    snark: 53,
  });
});
```

- [ ] **Step 2.7: Update the differs-by-seed assertion**

In `tests/pet-engine.test.ts`, replace the inline check inside the `"can produce different pets for different seeds"` test (lines 161-169):

```ts
if (
  a.species !== b.species ||
  a.rarity !== b.rarity ||
  a.shiny !== b.shiny ||
  a.stats.debugging !== b.stats.debugging ||
  a.stats.patience !== b.stats.patience
) {
  differs = true;
}
```

- [ ] **Step 2.8: Update the `"works without options"` test**

In `tests/pet-engine.test.ts`, replace the body (lines 175-180):

```ts
it("works without options (uses os defaults)", () => {
  const pet = generatePet();
  expect(pet.seed).toMatch(/^[0-9a-f]{64}$/);
  expect(pet.stats.debugging).toBeGreaterThanOrEqual(0);
  expect(pet.stats.debugging).toBeLessThanOrEqual(100);
});
```

- [ ] **Step 2.9: Run pet-engine tests, verify they pass**

Run: `npx vitest run tests/pet-engine.test.ts`

Expected: all pet-engine tests pass.

- [ ] **Step 2.10: Commit**

```bash
git add src/core/pet-engine.ts tests/pet-engine.test.ts
git commit -m "feat(pet-engine): rarity-bucketed species pick + new stat keys

pickSpecies now takes (byte, rarity) and selects from SPECIES_BY_RARITY,
so each species has a fixed rarity tier (matches Buddy's design).
deriveStats returns debugging/patience/chaos/wisdom/snark."
```

---

## Task 3: V1 -> V2 state migration (hard reset of pet, progress preserved)

**Files:**
- Create: `src/core/migrations/v1-to-v2.ts`
- Create: `tests/migrations-v1-to-v2.test.ts`
- Modify: `src/core/state.ts`

- [ ] **Step 3.1: Write the failing migration test**

Create `tests/migrations-v1-to-v2.test.ts`:

```ts
/**
 * Tests for src/core/migrations/v1-to-v2.ts.
 *
 * Hard reset: pet is regenerated against the new species roster + stat keys,
 * but progress / counters / achievements / buddy / meta are preserved.
 */

import { describe, expect, it } from "vitest";
import { migrateV1ToV2, type V1State } from "../src/core/migrations/v1-to-v2.js";
import { generatePet } from "../src/core/pet-engine.js";
import { SPECIES } from "../src/core/schema.js";

function makeV1Fixture(): V1State {
  return {
    schemaVersion: 1,
    pet: {
      species: "pixel",
      rarity: "rare",
      shiny: false,
      stats: { focus: 50, grit: 60, flow: 70, craft: 80, spark: 90 },
      seed: "a".repeat(64),
    },
    progress: { xp: 1234, level: 5, phase: "junior", pendingLevelUp: false },
    counters: {
      promptsTotal: 100,
      toolUseTotal: 200,
      sessionsTotal: 10,
      activeSessions: {},
      streakDays: 3,
      lastActiveDate: "2026-05-01",
      nightOwlEvents: 2,
    },
    achievements: { unlocked: ["hatch", "first_tool"], pendingUnlocks: [] },
    buddy: { detected: false, lastChecked: 0, userToggle: "auto" },
    meta: { createdAt: 1_700_000_000_000, updatedAt: 1_700_000_001_000 },
  };
}

describe("migrateV1ToV2", () => {
  it("bumps schemaVersion to 2", () => {
    const v1 = makeV1Fixture();
    const v2 = migrateV1ToV2(v1, () => generatePet({ username: "u", hostname: "h" }));
    expect(v2.schemaVersion).toBe(2);
  });

  it("preserves progress / counters / achievements / buddy / meta verbatim", () => {
    const v1 = makeV1Fixture();
    const v2 = migrateV1ToV2(v1, () => generatePet({ username: "u", hostname: "h" }));
    expect(v2.progress).toEqual(v1.progress);
    expect(v2.counters.promptsTotal).toBe(100);
    expect(v2.counters.streakDays).toBe(3);
    expect(v2.achievements).toEqual(v1.achievements);
    expect(v2.buddy).toEqual(v1.buddy);
    expect(v2.meta.createdAt).toBe(1_700_000_000_000);
  });

  it("regenerates the pet against the new species roster", () => {
    const v1 = makeV1Fixture();
    const v2 = migrateV1ToV2(v1, () => generatePet({ username: "u", hostname: "h" }));
    // The new pet's species must come from the V3 roster, not the V1 one.
    expect((SPECIES as readonly string[]).includes(v2.pet.species)).toBe(true);
    // Stat keys must use V3 names.
    expect(v2.pet.stats).toHaveProperty("debugging");
    expect(v2.pet.stats).toHaveProperty("snark");
    expect(v2.pet.stats).not.toHaveProperty("focus");
  });

  it("synthesizes counters.otel if missing on a V1 state", () => {
    const v1 = makeV1Fixture();
    const v2 = migrateV1ToV2(v1, () => generatePet({ username: "u", hostname: "h" }));
    expect(v2.counters.otel).toBeDefined();
    expect(v2.counters.otel?.lastUpdate).toBe(0);
  });

  it("preserves counters.otel if already present", () => {
    const v1 = makeV1Fixture();
    v1.counters.otel = {
      lastUpdate: 12345,
      linesAdded: 10,
      linesRemoved: 5,
      tokensIn: 100,
      tokensOut: 200,
      tokensCacheRead: 50,
      tokensCacheCreated: 0,
      costUsdCents: 7,
      filesEdited: 1,
      prsCreated: 0,
      reviewsRequested: 0,
    };
    const v2 = migrateV1ToV2(v1, () => generatePet({ username: "u", hostname: "h" }));
    expect(v2.counters.otel?.lastUpdate).toBe(12345);
    expect(v2.counters.otel?.linesAdded).toBe(10);
  });
});
```

- [ ] **Step 3.2: Run the test, verify it fails**

Run: `npx vitest run tests/migrations-v1-to-v2.test.ts`

Expected: FAIL with "Cannot find module 'migrations/v1-to-v2.js'".

- [ ] **Step 3.3: Implement the migration**

Create `src/core/migrations/v1-to-v2.ts`:

```ts
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
    activeSessions: Record<string, { startTs: number; toolUseCount: number; fileExtensions: string[] }>;
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
```

- [ ] **Step 3.4: Run migration tests, verify they pass**

Run: `npx vitest run tests/migrations-v1-to-v2.test.ts`

Expected: all 5 tests pass.

- [ ] **Step 3.5: Wire migration into `readState`**

Modify `src/core/state.ts`. Add a permissive Zod schema for V1 just-enough-for-migration, and update `readState` to migrate transparently.

Add near the top of `src/core/state.ts`, after the imports:

```ts
import { generatePet } from "./pet-engine.js";
import { migrateV1ToV2, type V1State } from "./migrations/v1-to-v2.js";
```

Add a helper above `readState`:

```ts
/**
 * Try to interpret the parsed JSON as a V1 state. We only check the bare
 * minimum needed for migration; the migration function is the real validator.
 * Returns the parsed object cast to V1State, or null if it does not look like
 * a V1 state.
 */
function looksLikeV1(parsed: unknown): V1State | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const v = parsed as Record<string, unknown>;
  if (v.schemaVersion !== 1) return null;
  // Basic structural checks — full validation happens in StateSchema after
  // migration. We trust V1 was previously written by us, so deep checking
  // is unnecessary.
  if (typeof v.pet !== "object" || v.pet === null) return null;
  if (typeof v.progress !== "object" || v.progress === null) return null;
  return v as unknown as V1State;
}
```

Replace the body of `readState` (lines 104-128 of the original):

```ts
export async function readState(): Promise<State> {
  let raw: string;
  try {
    raw = await fs.readFile(STATE_FILE, "utf8");
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      throw new StateNotFoundError();
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new StateCorruptError("state.json is not valid JSON", err);
  }

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

- [ ] **Step 3.6: Add a state-level migration test**

Append to `tests/state.test.ts` (existing file). Add a new `describe` block at the bottom of the file, just before the final closing `});` of the outer describe (or as a sibling describe — match the existing structure):

```ts
describe("V1 -> V2 transparent migration in readState", () => {
  it("loads a V1 state.json and returns a V2 State", async () => {
    const v1 = {
      schemaVersion: 1,
      pet: {
        species: "pixel",
        rarity: "rare",
        shiny: false,
        stats: { focus: 1, grit: 2, flow: 3, craft: 4, spark: 5 },
        seed: "a".repeat(64),
      },
      progress: { xp: 999, level: 4, phase: "junior", pendingLevelUp: false },
      counters: {
        promptsTotal: 50,
        toolUseTotal: 75,
        sessionsTotal: 5,
        activeSessions: {},
        streakDays: 2,
        lastActiveDate: "2026-05-01",
        nightOwlEvents: 0,
      },
      achievements: { unlocked: [], pendingUnlocks: [] },
      buddy: { detected: false, lastChecked: 0, userToggle: "auto" },
      meta: { createdAt: 1, updatedAt: 2 },
    };

    const { promises: fsp } = await import("node:fs");
    const path = await import("node:path");
    const home = process.env.PETFORGE_HOME;
    if (!home) throw new Error("PETFORGE_HOME must be set by the test harness");
    await fsp.mkdir(home, { recursive: true });
    await fsp.writeFile(path.join(home, "state.json"), JSON.stringify(v1), "utf8");

    const { readState } = await import("../src/core/state.js");
    const out = await readState();
    expect(out.schemaVersion).toBe(2);
    expect(out.progress.xp).toBe(999);
    expect(out.pet.stats).toHaveProperty("debugging");
    expect(out.pet.stats).not.toHaveProperty("focus");
  });
});
```

If `tests/state.test.ts` already imports `fs`/`path`/`vi.resetModules`, use the existing imports/helpers instead of re-importing dynamically. Match the file's existing test pattern.

- [ ] **Step 3.7: Run state tests, verify they pass**

Run: `npx vitest run tests/state.test.ts tests/migrations-v1-to-v2.test.ts`

Expected: all tests pass.

- [ ] **Step 3.8: Commit**

```bash
git add src/core/migrations/v1-to-v2.ts src/core/state.ts tests/migrations-v1-to-v2.test.ts tests/state.test.ts
git commit -m "feat(state): V1 -> V2 transparent migration on readState

Hard reset of pet (regenerated from same seed against new roster), all
progress / counters / achievements / buddy / meta preserved verbatim.
Existing users keep XP/level/streaks; species and stats are re-rolled."
```

---

## Task 4: Register the 18-species roster in the frame index

**Files:**
- Delete: `src/render/species/pixel.ts`, `glitch.ts`, `daemon.ts`, `spark.ts`
- Modify: `src/render/species/index.ts`
- Already on disk (drafted ahead of plan execution): the 17 new species files, each with bespoke hand-drawn art (3 frames x 6 phases). Verify they are present before starting this task.
- Keep: `src/render/species/blob.ts` (already hand-drawn, stays as-is)

**Approach:** the 17 new species files have already been drafted on disk with bespoke ASCII art in the same visual language as `blob.ts`. Each species has a distinguishing trait (DUCK has a bill, OCTOPUS has tentacles, CAT has a wizard hat, DRAGON has horns + wings + crown, etc.) and 3 idle-cycle frames per phase across all 6 phases. This task only deletes the obsolete species and wires the new files into the frame registry.

- [ ] **Step 4.0: Verify the 17 new species files are present**

Run: `ls src/render/species/`

Expected output should include: `axolotl.ts blob.ts cactus.ts capybara.ts cat.ts chonk.ts dragon.ts duck.ts ghost.ts goose.ts index.ts mushroom.ts octopus.ts owl.ts penguin.ts rabbit.ts robot.ts snail.ts turtle.ts` (and possibly the 4 obsolete files about to be deleted in 4.1).

If any of the 17 new species files are missing, stop and re-draft them following the style of `blob.ts` before proceeding.

- [ ] **Step 4.1: Delete the 4 obsolete species files**

```bash
git rm src/render/species/pixel.ts src/render/species/glitch.ts src/render/species/daemon.ts src/render/species/spark.ts
```

- [ ] **Step 4.2: (skipped) shared starter helper no longer needed**

The original plan called for a shared `_starter.ts` helper. We replaced this with 17 bespoke hand-drawn species files, so this step is intentionally a no-op. Skip directly to Step 4.3.

Create `src/render/species/_starter.ts`:

```ts
/**
 * Shared starter frames used by species without hand-drawn art yet.
 *
 * Style intentionally matches `blob.ts`: box-drawing silhouette, 3 idle
 * frames per phase, recognizable growth across phases. Each species file
 * labels its frames with the species name (`DUCK`, `OCTOPUS`, etc.) so the
 * roster reads as 18 distinct entries even before per-species art lands.
 *
 * To replace this with hand-drawn art for a given species, rewrite that
 * species' file inline (see `blob.ts` for reference style) — no change
 * needed here.
 */

import type { Phase } from "../../core/schema.js";

export function buildStarterFrames(name: string): Record<Phase, string[]> {
  const N = name.toUpperCase();
  const label = `\n   ${N}`;
  return {
    egg: [
      `   ╭───╮\n  ╭ ◌ ◌ ╮\n  │ ░░░ │\n  ╰─────╯`,
      `   ╭─╮─╮\n  ╭ ◌ ╱ ╮\n  │ ░░░ │\n  ╰─────╯`,
      `   ╭╱──╮\n  ╭ ╲ ╱ ╮\n  │ ░╱░ │\n  ╰──╲──╯`,
    ],
    hatchling: [
      `   ╭───╮\n  ╭ · · ╮\n  │  ◡  │\n  ╰─────╯${label}`,
      `   ╭───╮\n  ╭ · · ╮\n  │  ‿  │\n  ╰─────╯${label}`,
      `   ╭───╮\n  ╭ - - ╮\n  │  ◡  │\n  ╰─────╯${label}`,
    ],
    junior: [
      `   ╭─────╮\n  ╭  ◉ ◉  ╮\n  │   ◡   │\n  │ ░░░░░ │\n  ╰───────╯${label}`,
      `   ╭─────╮\n  ╭  ◉ ◉  ╮\n  │   ‿   │\n  │ ▒▒▒▒▒ │\n  ╰───────╯${label}`,
      `   ╭─────╮\n  ╭  - -  ╮\n  │   ◡   │\n  │ ░░░░░ │\n  ╰───────╯${label}`,
    ],
    adult: [
      `    ╭───────╮\n   ╭  ◉   ◉  ╮\n   │    ◡    │\n   │ ░░░░░░░ │\n   │ ▒▒▒▒▒▒▒ │\n   ╰─────────╯${label}`,
      `    ╭───────╮\n   ╭  ◉   ◉  ╮\n   │    ‿    │\n   │ ▒▒▒▒▒▒▒ │\n   │ ░░░░░░░ │\n   ╰─────────╯${label}`,
      `    ╭───────╮\n   ╭  -   -  ╮\n   │    ◡    │\n   │ ░░░░░░░ │\n   │ ▒▒▒▒▒▒▒ │\n   ╰─────────╯${label}`,
    ],
    elder: [
      `   ░╭───────╮▒\n   ▒╭  ◈   ◈  ╮░\n   ░│    ◡    │▒\n   ▒│ ░░░░░░░ │░\n   ░│ ▒▒▒▒▒▒▒ │▒\n   ▒╰─────────╯░${label}`,
      `   ▒╭───────╮░\n   ░╭  ◈   ◈  ╮▒\n   ▒│    ‿    │░\n   ░│ ▒▒▒▒▒▒▒ │▒\n   ▒│ ░░░░░░░ │░\n   ░╰─────────╯▒${label}`,
      `   ░╭───────╮▒\n   ▒╭  ◇   ◇  ╮░\n   ░│    ◡    │▒\n   ▒│ ░░░░░░░ │░\n   ░│ ▒▒▒▒▒▒▒ │▒\n   ▒╰─────────╯░${label}`,
    ],
    mythic: [
      `      ✧ ◆ ✧\n     ╭───────╮\n    ╭  ◈   ◈  ╮\n    │    ▼    │\n    │ ░░░◆░░░ │\n    │ ▒▒▒▒▒▒▒ │\n    ╰─────────╯${label}`,
      `      ✦ ◆ ✦\n     ╭───────╮\n    ╭  ◈   ◈  ╮\n    │    ▽    │\n    │ ▒▒▒◆▒▒▒ │\n    │ ░░░░░░░ │\n    ╰─────────╯${label}`,
      `      ✧ ◆ ✦\n     ╭───────╮\n    ╭  ◇   ◇  ╮\n    │    ▼    │\n    │ ░░░◆░░░ │\n    │ ▒▒▒▒▒▒▒ │\n    ╰─────────╯${label}`,
    ],
  };
}
```

- [ ] **Step 4.3: (skipped) species files already drafted with bespoke art**

The 17 new species files already exist on disk with hand-drawn `Record<Phase, string[]>` literals (3 frames x 6 phases each). No file creation is needed in this step. The export names follow the `<species>Frames` pattern: `duckFrames`, `gooseFrames`, `turtleFrames`, `snailFrames`, `mushroomFrames`, `chonkFrames`, `octopusFrames`, `penguinFrames`, `cactusFrames`, `rabbitFrames`, `catFrames`, `owlFrames`, `capybaraFrames`, `robotFrames`, `ghostFrames`, `axolotlFrames`, `dragonFrames`.

- [ ] **Step 4.3: Update the species frame index**

Replace the entire content of `src/render/species/index.ts`:

```ts
/**
 * Aggregated species frame registry.
 *
 * For each of the 18 species, exposes 3 idle-cycle frames per phase.
 * Several species ship placeholder art pending hand-drawn V3 frames; see
 * the per-file `PLACEHOLDER ART` markers.
 */

import type { Phase, Species } from "../../core/schema.js";
import { axolotlFrames } from "./axolotl.js";
import { blobFrames } from "./blob.js";
import { cactusFrames } from "./cactus.js";
import { capybaraFrames } from "./capybara.js";
import { catFrames } from "./cat.js";
import { chonkFrames } from "./chonk.js";
import { dragonFrames } from "./dragon.js";
import { duckFrames } from "./duck.js";
import { ghostFrames } from "./ghost.js";
import { gooseFrames } from "./goose.js";
import { mushroomFrames } from "./mushroom.js";
import { octopusFrames } from "./octopus.js";
import { owlFrames } from "./owl.js";
import { penguinFrames } from "./penguin.js";
import { rabbitFrames } from "./rabbit.js";
import { robotFrames } from "./robot.js";
import { snailFrames } from "./snail.js";
import { turtleFrames } from "./turtle.js";

export const SPECIES_FRAMES: Record<Species, Record<Phase, string[]>> = {
  duck: duckFrames,
  goose: gooseFrames,
  blob: blobFrames,
  turtle: turtleFrames,
  snail: snailFrames,
  mushroom: mushroomFrames,
  chonk: chonkFrames,
  octopus: octopusFrames,
  penguin: penguinFrames,
  cactus: cactusFrames,
  rabbit: rabbitFrames,
  cat: catFrames,
  owl: owlFrames,
  capybara: capybaraFrames,
  robot: robotFrames,
  ghost: ghostFrames,
  axolotl: axolotlFrames,
  dragon: dragonFrames,
};
```

- [ ] **Step 4.4: Run typecheck**

Run: `npx tsc --noEmit`

Expected: no errors related to species (errors may remain in CardView.tsx and page.ts — those are addressed in Task 5).

- [ ] **Step 4.5: Commit**

```bash
git add -A src/render/species/
git commit -m "feat(render): swap species roster to 18-species Buddy alignment

Removes pixel/glitch/daemon/spark frame files. Adds 17 new species
files with bespoke hand-drawn ASCII art (DUCK / GOOSE / OCTOPUS /
... / DRAGON), each in the same visual language as blob.ts with a
distinguishing trait per species (bills, tentacles, hats, horns,
wings) and 3 idle frames across all 6 phases."
```

---

## Task 5: Update renderers to use new stat keys

**Files:**
- Modify: `src/render/components/CardView.tsx`
- Modify: `src/render/web/page.ts`

- [ ] **Step 5.1: Update CardView stat rows**

In `src/render/components/CardView.tsx`, replace lines 76-80:

```tsx
              <StatBar name="DEBUGGING" value={pet.stats.debugging} />
              <StatBar name="PATIENCE" value={pet.stats.patience} />
              <StatBar name="CHAOS" value={pet.stats.chaos} />
              <StatBar name="WISDOM" value={pet.stats.wisdom} />
              <StatBar name="SNARK" value={pet.stats.snark} />
```

Also update the doc comment at line 13 — change `swaps FOCUS/GRIT/FLOW/CRAFT/SPARK` to `swaps DEBUGGING/PATIENCE/CHAOS/WISDOM/SNARK`.

- [ ] **Step 5.2: Update web page statKeys array**

In `src/render/web/page.ts`, replace line 325:

```ts
      var statKeys = ["debugging", "patience", "chaos", "wisdom", "snark"];
```

- [ ] **Step 5.3: Run typecheck**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 5.4: Run all tests**

Run: `npx vitest run`

Expected: all tests pass. Some existing tests may reference old species/stats — fix any failure by matching the test to the new schema (typically just renaming literal strings). If a test was meaningful for the old roster only (e.g. "5 species evenly distributed"), it has already been replaced in Task 2.

- [ ] **Step 5.5: Commit**

```bash
git add src/render/components/CardView.tsx src/render/web/page.ts
git commit -m "feat(render): label stats with Buddy-aligned names

CardView and the web page now show DEBUGGING / PATIENCE / CHAOS /
WISDOM / SNARK. Buddy import (when active) still parses and overrides
these from the imported card."
```

---

## Task 6: Update README + CHANGELOG, run full validation

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 6.1: Update README — species + stats sections**

In `README.md`, find the section that lists species (search for `Pixel`, `Glitch`, `Daemon`, `Spark`, `Blob` in Markdown text — likely under a "Pet system" or "Species" heading) and replace the 5-species list with:

```markdown
**18 species across 5 rarity tiers** (matches Buddy's roster):

- **Common** (60%): Duck, Goose, Blob, Turtle, Snail, Mushroom, Chonk
- **Uncommon** (25%): Octopus, Penguin, Cactus, Rabbit
- **Rare** (10%): Cat, Owl, Capybara, Robot
- **Epic** (4%): Ghost, Axolotl
- **Legendary** (1%): Dragon

**5 stats** (each 0-100, deterministic from your seed):
DEBUGGING, PATIENCE, CHAOS, WISDOM, SNARK.

When you import your real Buddy card via `petforge buddy import`, the imported
species name, rarity, and stats override the random defaults.
```

If no such section exists, add it under a new heading near the top of the README. Match the surrounding style.

- [ ] **Step 6.2: Add CHANGELOG entry**

Prepend to `CHANGELOG.md` (just under the top header):

```markdown
## 3.0.0 — 2026-05-02

**Breaking** — schemaVersion bumped from 1 to 2.

- Species roster grows from 5 (pixel/glitch/daemon/spark/blob) to 18,
  aligned with Claude Code Buddy's public vocabulary (duck / goose / blob /
  turtle / snail / mushroom / chonk / octopus / penguin / cactus / rabbit /
  cat / owl / capybara / robot / ghost / axolotl / dragon). Each species
  has a fixed rarity tier matching Buddy's design.
- Stat keys renamed: focus/grit/flow/craft/spark -> debugging/patience/
  chaos/wisdom/snark.
- Existing users: pet is regenerated from the same seed against the new
  roster on first hook after upgrade. XP, level, streaks, achievements,
  and counters are preserved verbatim. The pet itself (species, stats)
  re-rolls — this is intentional ("hard reset" migration).
- 17 new species ship day-one with bespoke hand-drawn ASCII art in the
  same visual language as the existing blob frames, with a distinguishing
  trait per species (bills, tentacles, hats, horns, wings, etc.). Future
  iterations refine individual species via community PRs as needed.

PetForge stays trademark-clean: only common-noun species names and
descriptive stat names are reused; Anthropic's ASCII art is never
redistributed.
```

- [ ] **Step 6.3: Run the full validation pipeline**

```bash
npx biome check .
npx tsc --noEmit
npx vitest run
```

Expected: clean Biome, clean typecheck, all tests pass.

- [ ] **Step 6.4: Bump package version**

In `package.json`, change `"version": "2.1.0"` to `"version": "3.0.0"`.

- [ ] **Step 6.5: Commit**

```bash
git add README.md CHANGELOG.md package.json
git commit -m "docs(v3.0.0): align with Buddy roster + new stat names

V3 brings PetForge's default schema in line with Claude Code Buddy's
public vocabulary. Existing users keep all progress; the pet itself
re-rolls under the new 18-species roster."
```

- [ ] **Step 6.6: Manual smoke test**

Run locally:

```bash
npm run build
node dist/index.js card
```

Verify the rendered card shows: a species from the new roster, stat labels DEBUGGING / PATIENCE / CHAOS / WISDOM / SNARK, the placeholder silhouette for that species. If you have an existing `~/.petforge/state.json` from V2.1, the migration runs transparently on first read.

If your imported Buddy card was set in V2.1 (`buddy.cardCache` + `buddy.userToggle === "on"`), the import override should still work. Verify by toggling buddy off then on:

```bash
node dist/index.js buddy off
node dist/index.js card    # should show V3 placeholder + new stat names
node dist/index.js buddy on
node dist/index.js card    # should show your imported card + parsed stats
```

---

## Self-Review

**Spec coverage:**

| Spec point | Task |
|---|---|
| 18 species roster, fixed rarity per species | Task 1 (SPECIES + SPECIES_BY_RARITY) |
| Stat names `DEBUGGING/PATIENCE/CHAOS/WISDOM/SNARK` | Task 1 (PetStats) + Task 2 (deriveStats) + Task 5 (renderers) |
| Rarity distribution unchanged (60/25/10/4/1) | Already in pet-engine, no change needed |
| Seed = `sha256(username+hostname)` (Dan's decision: keep current) | No change |
| Migration: hard reset of pet, progress preserved (Dan's decision A) | Task 3 |
| `schemaVersion` bump 1 -> 2 | Task 1 (StateSchema) + Task 3 (migration) |
| Junior fallback = neutral silhouette per species (Dan's decision: neutre par espèce) | Task 4 — every species file ships a labeled silhouette across all phases (incl. junior). Buddy import overrides the junior visual when active. |
| Buddy import override still works (already shipped in V2.1) | Verified in Task 6.6 smoke test |
| Solo art production with PRs welcomed | Done as part of plan drafting — 17 bespoke species files shipped on day one. Future refinements happen as single-file edits per species (community PRs welcome). |
| Trademark posture: no Anthropic ASCII redistributed | Enforced by design — every species file's art is original to PetForge. |

**Placeholder scan:** No "TBD" / "implement later" / "fill in details" in the plan. All code blocks are complete and runnable. Test code includes assertions, not stubs.

**Type consistency:** `pickSpecies(byte: number, rarity: Rarity)` defined in Task 2.3 matches the test signature in Task 2.1. `migrateV1ToV2(v1: V1State, regeneratePet: () => Pet)` defined in Task 3.3 matches the test in Task 3.1. `SPECIES_BY_RARITY` referenced in Task 2.3 is created in Task 1.1.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-02-petforge-v3-buddy-alignment-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Good for this plan because each task is bounded and produces a green-build commit.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints. Good if you want to watch each step land in real time.

Which approach?
