# 🐾 PetForge

> **Local-first RPG progression layer for AI coding companions.**
> Tracks your real coding activity through Claude Code hooks, adds XP, levels, achievements, and terminal-native evolutions.

[![Status](https://img.shields.io/badge/status-pre--MVP-orange)](./docs/superpowers/specs/2026-04-30-petforge-design.md)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)](https://nodejs.org)

---

## What

PetForge gives your terminal a deterministic ASCII pet that **levels up from real coding activity**. It listens to Claude Code's official hooks (`UserPromptSubmit`, `PostToolUse`, `Stop`, `SessionStart`, `SessionEnd`) and translates them into XP, evolutions across 5 phases, and 10 unlockable achievements.

If you have **Claude Buddy** enabled, PetForge silently uses Buddy's sprite as your pet's visual identity. If not, it generates an original PetForge creature locally. Either way, the progression layer is yours.

> **No Anthropic files are modified, copied, or redistributed.** PetForge ships its own pet engine and invokes Buddy at runtime only when the user has it enabled.

---

## Highlights

- 🎮 **5 evolution phases** — Hatchling → Junior → Adult → Elder → Mythic
- 🏆 **10 achievements** — Hatch, Marathon, Night Owl, Streak 7d, Polyglot, Tool Whisperer, Centurion…
- 🐣 **5 deterministic species** — Pixel, Glitch, Daemon, Spark, Blob
- ✨ **5 rarities + shiny** — same odds inspired by classic RPGs
- 🪝 **5 official Claude Code hooks** — zero polling, instant updates
- 🔒 **100% local** — zero telemetry, zero phone-home, zero account
- 🧰 **Cross-platform** — Windows, macOS, Linux

---

## Install

```bash
npm install -g @mindvisionstudio/petforge
```

Then configure Claude Code hooks (one-time, interactive):

```bash
petforge init
```

You're done. Use Claude Code normally and watch your pet evolve.

---

## Commands

| Command | What it does |
|---|---|
| `petforge` | Renders your pet snapshot (with idle animation if your terminal is interactive) |
| `petforge init` | Configures Claude Code hooks (with backup, idempotent) |
| `petforge card` | Full status card: pet, species, rarity, stats, level, XP bar, achievements |
| `petforge watch` | Persistent display with continuous idle animation (Ctrl+C to exit) |
| `petforge buddy [on\|off\|auto]` | Toggle Claude Buddy visual integration |
| `petforge doctor` | Health check (hooks installed, state valid, Buddy detected, etc.) |

---

## How it works

```
┌─────────────────────────────────────────────────┐
│ Display      petforge / watch / card            │
└─────────────────────────────────────────────────┘
                       ↑ reads
┌─────────────────────────────────────────────────┐
│ State        ~/.petforge/state.json (locked)    │
└─────────────────────────────────────────────────┘
                       ↑ writes
┌─────────────────────────────────────────────────┐
│ Hooks        5 Claude Code events               │
└─────────────────────────────────────────────────┘
                       ↑ optional invoke
┌─────────────────────────────────────────────────┐
│ Buddy        claude /buddy card (runtime only)  │
└─────────────────────────────────────────────────┘
```

Every coding action grants XP:

| Event | XP |
|---|---|
| `UserPromptSubmit` | +5 |
| `PostToolUse` | +1 |
| `Stop` | +10 |
| `SessionEnd` | +50 |
| Achievement unlock | +500 to +5000 |

Hit XP thresholds → level up → unlock the next evolution phase. Achievements fire as you cross natural milestones.

---

## Pet engine

Your pet is **deterministic**: it's generated from a hash of your username + hostname. Same machine = same pet, always. Different machine = different pet.

| Species | Theme |
|---|---|
| Pixel | 8-bit cube creature |
| Glitch | Corrupted pixel |
| Daemon | Process pun |
| Spark | Energy creature |
| Blob | Amorphous gel |

Rarity distribution: Common 60% · Uncommon 25% · Rare 10% · Epic 4% · Legendary 1%. Shiny: 1% independent overlay.

---

## Buddy integration (optional)

If you have **Claude Buddy** enabled (`/buddy` in Claude Code v2.1.89+ Pro), PetForge will use your Buddy's sprite as your pet's visual base. ANSI overlays (halos, shimmers, pulsations) remain controlled by PetForge.

PetForge **never** copies, parses internal Buddy files, or redistributes Anthropic content. Buddy is invoked at runtime via `claude /buddy card` and the output is rendered live.

To opt out: `petforge buddy off` — falls back to the local PetForge engine.

---

## Requirements

- Node.js ≥ 20
- Claude Code installed and on PATH (for hook invocation; pet works without it but XP doesn't accrue)
- Optional: Claude Code v2.1.89+ with `/buddy` enabled, for Buddy visual integration

---

## Development

```bash
git clone https://github.com/ObzCureDev/petforge.git
cd petforge
npm install
npm run dev          # tsup watch mode
npm test             # vitest
npm run lint         # biome check
npm run build        # tsup production build
```

See [`docs/superpowers/specs/2026-04-30-petforge-design.md`](./docs/superpowers/specs/2026-04-30-petforge-design.md) for the full design specification.

---

## Roadmap

**V2 ideas** (not committed):
- VS Code / Antigravity extension panel
- Web companion / shareable stat dashboard
- Sound effects
- Skin shop
- Multi-device cloud sync
- More species & evolution branches

---

## License

[Apache License 2.0](./LICENSE)

---

## Acknowledgments

- [Anthropic](https://anthropic.com) — for Claude Code and the Buddy concept that inspired the missing leveling layer
- [Vadim Demedes](https://github.com/vadimdemedes) — for [Ink](https://github.com/vadimdemedes/ink), the React-for-CLIs framework
- The Claude Code community — for asking for an RPG progression system on GitHub

---

Built by [MindVision Studio](https://mindvisionstudio.com) · github.com/ObzCureDev
