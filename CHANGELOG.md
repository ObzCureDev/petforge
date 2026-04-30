# Changelog

## 2.0.0 — 2026-04-30

### Features
- New `petforge collect` command: long-running OTLP/HTTP/JSON collector that ingests Claude Code metrics into PetForge state.
- 8 new OTel-gated achievements: Code Architect (10K lines), Code Titan (100K lines), Token Whisperer ⚡ (1M tokens), Cache Lord (≥80% cache hit ratio), Frugal Coder (100 prompts ≤ $1), Big Spender ($100 cumulative), PR Machine (50 PRs), Picky Reviewer (50 edits rejected).
- New `petforge init --otel` / `--no-otel` flags: one-command setup of Claude Code OTel env vars in `~/.claude/settings.json`.
- New OTel activity line in `petforge card` / `serve` / `watch`: lines added/removed, total tokens, cost, cache hit ratio. Shown only when OTel data has been ingested.
- New `petforge doctor` checks: OTel env presence, collector reachable, recent ingest.
- Optional fan-out via `PETFORGE_OTEL_FORWARD=URL` (or `--forward=URL`): chain to existing OTel collectors (Datadog, Honeycomb, Grafana).

### Architecture
- New `state.counters.otel` block (cumulative counters). Optional in schema — V1.x states migrate transparently.
- Collector binds **strictly to 127.0.0.1**. No `--lan` flag (payload contains user prompts and file paths).
- OTLP/HTTP JSON only — no protobuf dependency.
- Cumulative-delta aggregator with in-memory memo per (metric, attrs) tuple.

### Migration
V1.x → V2.0: state.json gains `counters.otel` automatically on first read. `schemaVersion` unchanged at 1. Existing achievements / hooks behaviour unchanged.

### Out of scope (future)
- V2.1: append-only event store (`events.ndjson`), heatmap in `serve`, insights generation
- V2.2: cinematic milestones, WISDOM cosmetic stat

## 1.2.0 — 2026-04-30

### Features
- New `petforge serve [--port=7878] [--lan] [--token=XXX]` command:
  starts a local HTTP server with a mobile-friendly web view of your pet.
  Live updates via Server-Sent Events; reconnects automatically on disconnect.
  Default binds to `127.0.0.1` (local-only). `--lan` exposes on `0.0.0.0`
  for phone access on the same Wi-Fi. Optional `--token` for shared networks.

### Why
Some users want to glance at their pet from a phone or second screen
without keeping a terminal open. The web view is read-only — it streams
state, never mutates.

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
