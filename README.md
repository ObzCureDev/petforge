<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./logos/petforge_logo_dark.webp">
    <img alt="PetForge — ASCII RPG companion for AI coders" src="./logos/petforge_true_logo.webp" width="800">
  </picture>
</p>

<p align="center">
  <strong>Local-first RPG progression layer for AI coding companions.</strong><br>
  Tracks your real coding activity through Claude Code hooks, adds XP, levels, achievements, and terminal-native evolutions.
</p>

<p align="center">
  <a href="./docs/superpowers/specs/2026-04-30-petforge-design.md"><img src="https://img.shields.io/badge/status-pre--MVP-orange" alt="Status"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue" alt="License"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%E2%89%A520-brightgreen" alt="Node ≥ 20"></a>
</p>

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

## Troubleshooting

**My pet doesn't seem to gain XP.**
Run `petforge doctor`. The most common cause is hooks not installed yet — run `petforge init`.

**`petforge init` says my settings.json has invalid JSON.**
PetForge refuses to overwrite a malformed settings file. Open `~/.claude/settings.json` and fix the JSON, or delete the file (PetForge will create a new one).

**I see `petforge` errors when Claude is running.**
Hook errors are logged to `~/.petforge/hook-errors.log`. PetForge hooks are designed to never crash Claude Code — every error path exits 0. If you see issues, share the log file.

**I want to reset my pet.**
Delete `~/.petforge/state.json`. Your pet will respawn deterministically on the next hook invocation (same species/rarity/stats — they're derived from your username + hostname).

**I don't have Claude Buddy.**
That's fine — PetForge runs the local engine when Buddy isn't detected. Run `petforge buddy off` to skip detection entirely.

**My terminal doesn't show ANSI colors / box characters correctly.**
Make sure your terminal supports UTF-8 + truecolor (most modern terminals do). On Windows, use Windows Terminal or VS Code's integrated terminal.

---

## Privacy

PetForge is **fully local**:
- No network calls, ever
- No analytics, no telemetry, no phone-home
- No account, no signup
- Your state lives at `~/.petforge/state.json` and only there
- The pet engine derives your creature from `sha256(username + hostname)` locally
- Buddy integration (when enabled) invokes the local `claude` CLI — PetForge never reads internal Claude files

**No Anthropic content is copied or redistributed.** PetForge ships its own assets and only invokes Claude Buddy as a stdout consumer at runtime.

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
