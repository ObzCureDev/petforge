# Changelog

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
