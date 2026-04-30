# Changelog

## 1.1.0 — 2026-04-30

### Changes
- New "Egg" phase: pet starts as an egg (level 1-4, 0-500 XP) with progressive cracks. Hatchling phase moved to level 5-11.
- Recurved level boundaries for slower early-game evolution: Junior at 12, Adult at 30, Elder at 60, Mythic at 100.
- `Hatch` achievement now triggers when the egg hatches (level ≥ 5) instead of the first prompt — narrative moment with cinematic.
- `petforge watch` now live-reloads state.json every 500ms — XP/level/achievements update while you code.
- `petforge watch` now displays the Activity line (Sessions / Streak / Prompts / Tools) — same as `petforge card`.
- New `ActivityBlock` component shared between `card` and `watch` views.

### Migration
Existing V1.0 states (state.json) remain valid — phase recomputes from level on next hook event. Users still on level < 5 will revert to the new "egg" phase visually but keep all progress.

## 1.0.0 — 2026-04-30

Initial release.

### Features
- 5 deterministic species (Pixel, Glitch, Daemon, Spark, Blob)
- 5 rarities (Common 60% / Uncommon 25% / Rare 10% / Epic 4% / Legendary 1%)
- 5 evolution phases (Hatchling / Junior / Adult / Elder / Mythic)
- 1% shiny rainbow overlay
- 5 stats (FOCUS, GRIT, FLOW, CRAFT, SPARK)
- 10 achievements: Hatch, First Tool, Marathon, Night Owl, Streak 3d, Streak 7d, Polyglot, Refactor Master, Tool Whisperer, Centurion
- 7 CLI commands: `petforge`, `petforge init`, `petforge card`, `petforge watch`, `petforge buddy`, `petforge doctor`, `petforge hook`
- 5 Claude Code hook integrations (UserPromptSubmit, PostToolUse, Stop, SessionStart, SessionEnd)
- Optional runtime Buddy detection (zero persistence of Buddy ASCII)
- Local-first, zero telemetry, cross-platform (Node ≥ 20)
- Atomic state writes with `proper-lockfile`
- 189 tests covering core engines, hooks, settings integration, rendering

### Tech stack
- TypeScript 5.9 strict, ESM, Node 20+
- Ink + React 19 for terminal UI
- chalk + figlet for effects
- Vitest + Biome for QA
