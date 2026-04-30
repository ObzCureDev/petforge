/**
 * Tests for the Task 8 rendering layer.
 *
 * Covers:
 *  - effects.ts (pure functions: rarity tint, phase overlay, shiny rotation)
 *  - species frame registry (every species × phase has at least one frame,
 *    frames within a phase share a height so cycles don't jitter)
 *  - command-level state consumption: the default command's helper clears
 *    pendingLevelUp / pendingUnlocks on disk after capturing them
 *  - non-TTY path runs without throwing and does not consume pending flags
 *  - card view rendering (via ink-testing-library) covers all key fields
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Force chalk to emit ANSI codes even when stdout is not a TTY (vitest pipes output).
// All effect tests assume colour wrapping is observable.
chalk.level = 1;

// We re-import each module under PETFORGE_HOME isolation because state-touching
// helpers depend on src/core/paths.ts constants computed at import time.

let testHome: string;
let prevHome: string | undefined;

beforeEach(async () => {
  prevHome = process.env.PETFORGE_HOME;
  testHome = await fs.mkdtemp(path.join(os.tmpdir(), "petforge-render-test-"));
  process.env.PETFORGE_HOME = testHome;
  vi.resetModules();
});

afterEach(async () => {
  if (prevHome === undefined) {
    delete process.env.PETFORGE_HOME;
  } else {
    process.env.PETFORGE_HOME = prevHome;
  }
  try {
    await fs.rm(testHome, { recursive: true, force: true });
  } catch {
    /* noop */
  }
});

describe("effects.ts (pure functions)", () => {
  it("applyRarityTint is identity for common", async () => {
    const { applyRarityTint } = await import("../src/render/effects.js");
    expect(applyRarityTint("hello", "common")).toBe("hello");
  });

  it("applyRarityTint wraps in ANSI codes for non-common rarities", async () => {
    const { applyRarityTint } = await import("../src/render/effects.js");
    for (const rarity of ["uncommon", "rare", "epic", "legendary"] as const) {
      const out = applyRarityTint("hi", rarity);
      // Non-common always wraps in some ANSI escape (CSI starts with \x1b[).
      expect(out).not.toBe("hi");
      expect(out).toContain("\x1b[");
      // Original text must still be present somewhere in the output.
      expect(out).toContain("hi");
    }
  });

  it("applyShiny rotates colours per frame index", async () => {
    const { applyShiny } = await import("../src/render/effects.js");
    const outs = [0, 1, 2, 3, 4].map((i) => applyShiny("x", i));
    // 4-color cycle: indices 0..3 produce 4 distinct outputs; index 4 wraps to 0.
    const distinct = new Set(outs.slice(0, 4));
    expect(distinct.size).toBe(4);
    expect(outs[4]).toBe(outs[0]);
  });

  it("applyPhaseEffect prepends a halo line for junior", async () => {
    const { applyPhaseEffect } = await import("../src/render/effects.js");
    const out = applyPhaseEffect("body", "junior", 0);
    expect(out.split("\n").length).toBeGreaterThanOrEqual(2);
    expect(out.endsWith("body")).toBe(true);
  });

  it("applyPhaseEffect prepends a crown for mythic and pulses with frame index", async () => {
    const { applyPhaseEffect } = await import("../src/render/effects.js");
    const even = applyPhaseEffect("body", "mythic", 0);
    const odd = applyPhaseEffect("body", "mythic", 1);
    expect(even.split("\n").length).toBeGreaterThanOrEqual(2);
    expect(odd.split("\n").length).toBeGreaterThanOrEqual(2);
    // Pulsation toggles bold formatting → output strings differ.
    expect(even).not.toBe(odd);
  });

  it("applyAllEffects layers shiny last (rainbow dominates)", async () => {
    const { applyAllEffects } = await import("../src/render/effects.js");
    const { generatePet } = await import("../src/core/pet-engine.js");
    const pet = generatePet({ username: "u", hostname: "h" });
    pet.rarity = "uncommon";
    pet.shiny = true;
    const a = applyAllEffects(pet, "x", "hatchling", 0);
    const b = applyAllEffects(pet, "x", "hatchling", 1);
    // Frame index 0 vs 1 should pick different shiny colours → different output.
    expect(a).not.toBe(b);
  });
});

describe("species frame registry", () => {
  it("every species has all 5 phases with at least one frame", async () => {
    const { SPECIES_FRAMES } = await import("../src/render/species/index.js");
    const { SPECIES, PHASES } = await import("../src/core/schema.js");
    for (const species of SPECIES) {
      for (const phase of PHASES) {
        const frames = SPECIES_FRAMES[species][phase];
        expect(frames.length, `${species}/${phase} frame count`).toBeGreaterThan(0);
        for (const f of frames) {
          expect(typeof f).toBe("string");
          expect(f.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("frames within a phase share the same line count (no jitter)", async () => {
    const { SPECIES_FRAMES } = await import("../src/render/species/index.js");
    const { SPECIES, PHASES } = await import("../src/core/schema.js");
    for (const species of SPECIES) {
      for (const phase of PHASES) {
        const frames = SPECIES_FRAMES[species][phase];
        const heights = frames.map((f) => f.split("\n").length);
        const min = Math.min(...heights);
        const max = Math.max(...heights);
        // Allow a 1-line variance, but no more.
        expect(max - min, `${species}/${phase} height variance`).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("snapshot rendering does not throw", () => {
  it("applyAllEffects handles all 25 species/phase combinations × rarities × shiny", async () => {
    // Direct effect-pipeline test — much cheaper than mounting Ink 25× and
    // covers exactly what could throw at render time (frame lookup +
    // chalk wrapping + composition).
    const { SPECIES_FRAMES } = await import("../src/render/species/index.js");
    const { applyAllEffects } = await import("../src/render/effects.js");
    const { SPECIES, PHASES, RARITIES } = await import("../src/core/schema.js");
    const { generatePet } = await import("../src/core/pet-engine.js");

    for (const species of SPECIES) {
      for (const phase of PHASES) {
        const frames = SPECIES_FRAMES[species][phase];
        for (const rarity of RARITIES) {
          for (const shiny of [true, false]) {
            const pet = generatePet({ username: "u", hostname: "h" });
            pet.species = species;
            pet.rarity = rarity;
            pet.shiny = shiny;
            for (let f = 0; f < frames.length; f++) {
              const base = frames[f] ?? "";
              const out = applyAllEffects(pet, base, phase, f);
              expect(typeof out).toBe("string");
              expect(out.length).toBeGreaterThan(0);
            }
          }
        }
      }
    }
  });

  it("SnapshotView mounts in ink-testing-library without throwing", async () => {
    const { render } = await import("ink-testing-library");
    const { SnapshotView } = await import("../src/render/components/SnapshotView.js");
    const { createInitialState } = await import("../src/core/schema.js");
    const { generatePet } = await import("../src/core/pet-engine.js");

    const pet = generatePet({ username: "u", hostname: "h" });
    const state = createInitialState(pet);
    const { lastFrame, unmount } = render(
      React.createElement(SnapshotView, { state, frameIndex: 0 }),
    );
    const out = lastFrame() ?? "";
    expect(out.length).toBeGreaterThan(0);
    expect(out).toContain(pet.species.toUpperCase());
    unmount();
  });

  it("CardView includes all key fields", async () => {
    const { render } = await import("ink-testing-library");
    const { CardView } = await import("../src/render/components/CardView.js");
    const { createInitialState } = await import("../src/core/schema.js");
    const { generatePet } = await import("../src/core/pet-engine.js");

    const pet = generatePet({ username: "u", hostname: "h" });
    const state = createInitialState(pet);
    state.progress.xp = 1234;
    state.progress.level = 5;
    state.achievements.unlocked = ["hatch"];
    state.counters.sessionsTotal = 7;
    state.counters.streakDays = 3;
    state.counters.promptsTotal = 42;
    state.counters.toolUseTotal = 99;

    const { lastFrame, unmount } = render(React.createElement(CardView, { state }));
    const out = lastFrame() ?? "";
    expect(out).toMatch(/L5/);
    expect(out).toMatch(/FOCUS/);
    expect(out).toMatch(/GRIT/);
    expect(out).toMatch(/FLOW/);
    expect(out).toMatch(/CRAFT/);
    expect(out).toMatch(/SPARK/);
    expect(out).toMatch(/Hatch/);
    expect(out).toMatch(/Sessions: 7/);
    expect(out).toMatch(/Streak: 3d/);
    expect(out).toMatch(/Prompts: 42/);
    expect(out).toMatch(/Tools: 99/);
    expect(out).toMatch(/STATS/);
    expect(out).toMatch(/ACHIEVEMENTS/);
    unmount();
  });
});

describe("loadAndConsumeState (default command helper)", () => {
  it("captures pending flags but clears them on disk", async () => {
    const { withStateLock, readState } = await import("../src/core/state.js");
    const { generatePet } = await import("../src/core/pet-engine.js");
    const { createInitialState } = await import("../src/core/schema.js");
    const { loadAndConsumeState } = await import("../src/commands/render-state.js");

    // Seed a state with pending flags.
    const pet = generatePet({ username: "u", hostname: "h" });
    await withStateLock(
      (s) => {
        Object.assign(s, createInitialState(pet));
        s.progress.pendingLevelUp = true;
        s.achievements.pendingUnlocks = ["hatch", "first_tool"];
      },
      { onMissingOrCorrupt: () => createInitialState(pet) },
    );

    const captured = await loadAndConsumeState();
    // Captured snapshot retains the flags (so the renderer can play cinematics).
    expect(captured.progress.pendingLevelUp).toBe(true);
    expect(captured.achievements.pendingUnlocks).toEqual(["hatch", "first_tool"]);

    // On disk, flags are cleared.
    const onDisk = await readState();
    expect(onDisk.progress.pendingLevelUp).toBe(false);
    expect(onDisk.achievements.pendingUnlocks).toEqual([]);
  });

  it("loadStateForView leaves pending flags intact", async () => {
    const { withStateLock, readState } = await import("../src/core/state.js");
    const { generatePet } = await import("../src/core/pet-engine.js");
    const { createInitialState } = await import("../src/core/schema.js");
    const { loadStateForView } = await import("../src/commands/render-state.js");

    const pet = generatePet({ username: "u", hostname: "h" });
    await withStateLock(
      (s) => {
        Object.assign(s, createInitialState(pet));
        s.progress.pendingLevelUp = true;
        s.achievements.pendingUnlocks = ["hatch"];
      },
      { onMissingOrCorrupt: () => createInitialState(pet) },
    );

    const captured = await loadStateForView();
    expect(captured.progress.pendingLevelUp).toBe(true);
    expect(captured.achievements.pendingUnlocks).toEqual(["hatch"]);

    // Disk is unchanged.
    const onDisk = await readState();
    expect(onDisk.progress.pendingLevelUp).toBe(true);
    expect(onDisk.achievements.pendingUnlocks).toEqual(["hatch"]);
  });
});

describe("non-TTY default command path", () => {
  it("DefaultApp non-TTY skips animation and renders a single static snapshot", async () => {
    // The full defaultCli mounts Ink against process.stdout, which clashes
    // with vitest's console patching. Instead we drive DefaultApp directly
    // via ink-testing-library and observe that no animation occurs and the
    // initial frame is the snapshot.
    const { render } = await import("ink-testing-library");
    const { DefaultApp } = await import("../src/render/components/DefaultApp.js");
    const { createInitialState } = await import("../src/core/schema.js");
    const { generatePet } = await import("../src/core/pet-engine.js");

    const pet = generatePet({ username: "u", hostname: "h" });
    const state = createInitialState(pet);
    state.progress.pendingLevelUp = true;
    state.achievements.pendingUnlocks = ["hatch"];

    const { lastFrame, frames, unmount } = render(
      React.createElement(DefaultApp, { state, isTTY: false }),
    );
    // Snapshot frame is rendered immediately.
    const out = lastFrame() ?? "";
    expect(out).toContain(pet.species.toUpperCase());
    // No subsequent re-renders (no animation): only the initial mount frame.
    expect(frames.length).toBeLessThanOrEqual(2);
    unmount();
  });
});

describe("DefaultApp staging", () => {
  it("non-TTY mounts straight to snapshot (no animation)", async () => {
    const { render } = await import("ink-testing-library");
    const { DefaultApp } = await import("../src/render/components/DefaultApp.js");
    const { createInitialState } = await import("../src/core/schema.js");
    const { generatePet } = await import("../src/core/pet-engine.js");

    const pet = generatePet({ username: "u", hostname: "h" });
    const state = createInitialState(pet);
    state.progress.pendingLevelUp = true;
    state.achievements.pendingUnlocks = ["hatch"];

    let doneCalls = 0;
    const { lastFrame, unmount } = render(
      React.createElement(DefaultApp, {
        state,
        isTTY: false,
        onDone: () => doneCalls++,
      }),
    );
    // Non-TTY skips both cinematics; snapshot mounts immediately.
    expect(lastFrame()).toBeTruthy();
    expect(doneCalls).toBe(1);
    unmount();
  });

  it("CinematicAchievement with empty list resolves immediately", async () => {
    const { render } = await import("ink-testing-library");
    const { CinematicAchievement } = await import(
      "../src/render/components/CinematicAchievement.js"
    );
    let done = false;
    const { unmount } = render(
      React.createElement(CinematicAchievement, {
        ids: [],
        onDone: () => {
          done = true;
        },
      }),
    );
    // Effect runs synchronously after mount in React 19 + ink test env.
    await Promise.resolve();
    expect(done).toBe(true);
    unmount();
  });
});
