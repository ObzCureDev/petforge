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
  <a href="./CHANGELOG.md"><img src="https://img.shields.io/badge/version-2.1.0-blue" alt="Version"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue" alt="License"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%E2%89%A520-brightgreen" alt="Node ≥ 20"></a>
</p>

---

## What

PetForge gives your terminal a deterministic ASCII pet that **levels up from real coding activity**. It listens to Claude Code's official hooks (`UserPromptSubmit`, `PostToolUse`, `Stop`, `SessionStart`, `SessionEnd`), translates them into XP, evolutions across 6 phases, and 18 unlockable achievements (10 from hooks + 8 from optional OTel telemetry).

If you have a **Claude Buddy** you like, you can import its ASCII visual once and PetForge will use it as your pet's appearance — name, rarity, and stats included. Otherwise PetForge generates an original creature deterministically from your username + hostname.

> **No Anthropic files are modified, copied, or redistributed.** PetForge ships its own engine. Buddy integration is consensual: nothing is persisted unless you explicitly run `petforge buddy import`.

---

## Highlights

- 🥚 **6 evolution phases** — Egg → Hatchling → Junior → Adult → Elder → Mythic
- 🏆 **18 achievements** — 10 hook-driven + 8 OTel-gated (tokens, lines, cost, cache, PRs)
- 🐣 **5 deterministic species** — Pixel, Glitch, Daemon, Spark, Blob
- ✨ **5 rarities + shiny** — same odds inspired by classic RPGs
- 🪝 **5 official Claude Code hooks** — zero polling, sub-50ms updates
- 📺 **Live watch mode** — terminal animation + counters refreshed every 500ms
- 📱 **Stream to your phone** — local web view via SSE on your LAN
- 📊 **OpenTelemetry collector** — opt-in, ingests Claude Code metrics, fans out to Datadog/Honeycomb
- 🎭 **Buddy import** — pin your favourite Claude Buddy ASCII as your pet, with parsed name/rarity/stats
- 🚀 **One-command up** — `petforge up --lan` starts the OTel collector AND the web view together
- 🔒 **100% local** — zero telemetry, zero phone-home, zero account
- 🧰 **Cross-platform** — Windows, macOS, Linux

---

## Install

```bash
npm install -g @mindvisionstudio/petforge
```

One-time setup of Claude Code hooks (idempotent, with backup):

```bash
petforge init             # hooks only
petforge init --otel      # hooks + OTel env vars
```

Code in Claude Code — hooks fire automatically, your pet evolves.

---

## Commands

| Command | What it does |
|---|---|
| `petforge` | Renders your pet snapshot (animated in TTY) |
| `petforge card` | Full status card: pet visual, name/rarity, stats, level, XP bar, achievements, activity |
| `petforge watch` | Live mode: continuous animation + auto-refresh of XP / level / counters every 500ms (Ctrl+C / q to exit) |
| `petforge init [--otel \| --no-otel]` | Configure Claude Code hooks (and optionally OTel env vars) |
| `petforge doctor` | Health check: hooks installed, state valid, OTel reachable, Buddy status |
| `petforge serve [--port=N] [--lan] [--token=XXX]` | HTTP + SSE server with mobile-friendly web view |
| `petforge collect [--port=N] [--forward=URL]` | OTLP/HTTP/JSON collector for Claude Code metrics (strict 127.0.0.1) |
| **`petforge up [--lan] [--port=N] [--collect-port=N] [--token=XXX] [--forward=URL]`** | **Recommended.** Starts collect + serve in a single process, single Ctrl+C kills both |
| `petforge buddy [on\|off\|auto]` | Toggle Claude Buddy visual integration |
| `petforge buddy import [--from=FILE] [--clear]` | Pin a Buddy ASCII as your pet's visual (stdin or file) |

---

## Quickstart workflows

### Just play

```bash
petforge init
# Code in Claude Code; check on your pet:
petforge card
```

### Live terminal view while coding

```bash
petforge watch
```

Stays open, animates at 8 FPS, reloads state every 500ms. Quit with `q` or `Ctrl+C`.

### Phone view + OTel ingest in one shot

```bash
petforge init --otel              # one-time
petforge up --lan                 # daily
# [up]      starting collector + web view...
# [collect] listening on http://127.0.0.1:7879
# [serve]   listening on http://127.0.0.1:7878
# [serve]   phone access (same Wi-Fi): http://192.168.1.42:7878
# [up]      Ctrl+C to stop both.
```

Open the LAN URL on your phone, add to home screen, you're done.

### Pin your Claude Buddy as your pet

```bash
# 1. Run /buddy card inside a Claude Code session, copy the output.
# 2. Paste it into a file:
notepad ~/.petforge/buddy-card.txt        # Windows
# or: nano ~/.petforge/buddy-card.txt
# 3. Import:
petforge buddy import --from=~/.petforge/buddy-card.txt
# Buddy imported: 26 lines, 1065 bytes. Toggle: on.
```

PetForge now displays your Buddy in `card` / `watch` / `serve`. Name, rarity, and stats are auto-parsed from the card and replace `DAEMON · common` and `FOCUS/GRIT/FLOW/CRAFT/SPARK` with `HUDDLE · rare` and your Buddy's own stats (DEBUGGING, PATIENCE, etc).

XP / levels / achievements / activity counters stay PetForge-driven.

---

## How it works

```
┌─────────────────────────────────────────────────┐
│ Display      petforge / watch / card / serve    │
└─────────────────────────────────────────────────┘
                       ↑ reads (live)
┌─────────────────────────────────────────────────┐
│ State        ~/.petforge/state.json (locked)    │
└─────────────────────────────────────────────────┘
                       ↑ writes
┌─────────────────────────────────────────────────┐
│ Hooks        5 Claude Code events               │
│ Collector    OTel metrics on 127.0.0.1:7879     │
└─────────────────────────────────────────────────┘
                       ↑ optional override
┌─────────────────────────────────────────────────┐
│ Buddy        cardCache (set by `buddy import`)  │
└─────────────────────────────────────────────────┘
```

Every coding action grants XP:

| Event | XP |
|---|---|
| `UserPromptSubmit` | +5 |
| `PostToolUse` | +1 |
| `Stop` | +10 |
| `SessionEnd` | +50 |
| Achievement unlock | +50 to +5 000 |

Hit XP thresholds → level up → unlock the next evolution phase. Achievements fire as you cross natural milestones.

---

## Evolution phases

| Phase | Levels | XP cumulative | Visual |
|---|---|---|---|
| 🥚 **Egg** | 1–4 | 0 → ~500 | Egg trembling, fissures appear progressively |
| 🐣 **Hatchling** | 5–11 | ~500 → 2 000 | Just hatched — first species silhouette |
| 🐥 **Junior** | 12–29 | 2 000 → 30 000 | Growth phase, gold ANSI halo |
| 🦎 **Adult** | 30–59 | 30 000 → 100 000 | Peak form, elaborate ASCII |
| 🐉 **Elder** | 60–99 | 100 000 → 1 000 000 | Sage, shimmer overlay |
| 🌟 **Mythic** | 100 | 1 000 000+ | Apotheosis: crown glyph + pulsation |

The first achievement — **Hatch** — fires when your pet reaches level 5 and the egg cracks open. Level 100 unlocks **Centurion** (+5 000 XP). Most users hit Junior in a couple of weeks of regular use; Mythic is a multi-month milestone.

---

## Pet engine

Your pet is **deterministic**: it's generated from `sha256(username + hostname)`. Same machine = same pet, always. Different machine = different pet.

| Species | Theme |
|---|---|
| Pixel | 8-bit cube creature |
| Glitch | Corrupted pixel |
| Daemon | Process pun |
| Spark | Energy creature |
| Blob | Amorphous gel |

Rarity distribution: Common 60% · Uncommon 25% · Rare 10% · Epic 4% · Legendary 1%. Shiny: 1% independent rainbow overlay.

Each pet ships with 5 base stats (FOCUS, GRIT, FLOW, CRAFT, SPARK) derived from the same seed. Stats are flavor — they don't affect XP gain.

---

## Achievements (18)

### Hook-driven (always available)

| ID | Name | Trigger | XP |
|---|---|---|---|
| `hatch` | 🥚 Hatch | Reach level 5 | +50 |
| `first_tool` | 🔧 First Tool | First `PostToolUse` | +10 |
| `marathon` | 🏃 Marathon | Single session > 4h | +100 |
| `night_owl` | 🦉 Night Owl | Activity 02:00–05:00 local | +50 |
| `streak_3d` | 📅 Streak 3 Days | 3 consecutive coding days | +200 |
| `streak_7d` | 📅 Streak 7 Days | 7 consecutive coding days | +500 |
| `polyglot` | 🌍 Polyglot | 5+ distinct file extensions in a session | +200 |
| `refactor_master` | ♻️ Refactor Master | 50 `Edit` / `MultiEdit` in a session | +300 |
| `tool_whisperer` | ⚡ Tool Whisperer | 1 000 tool uses cumulative | +500 |
| `centurion` | 💯 Centurion | Reach level 100 | +5 000 |

### OTel-gated (require `petforge collect`)

| ID | Name | Trigger | XP |
|---|---|---|---|
| `code_architect` | 🏗️ Code Architect | 10 000 lines added | +500 |
| `code_titan` | 🗿 Code Titan | 100 000 lines added | +5 000 |
| `token_whisperer_v2` | ⚡ Token Whisperer | 1 M tokens consumed | +1 000 |
| `cache_lord` | 💾 Cache Lord | ≥ 80 % cache hit ratio @ 100K+ tokens | +750 |
| `frugal_coder` | 💰 Frugal Coder | 100 prompts under $1 cumulative | +500 |
| `big_spender` | 💸 Big Spender | $100 cumulative spend | +500 |
| `pr_machine` | 🚀 PR Machine | 50 PRs opened | +1 500 |
| `picky_reviewer` | ✋ Picky Reviewer | 50 edits rejected | +500 |

---

## Buddy integration

PetForge supports a **manual import** model — you decide what gets stored.

### Why no auto-detection?

Earlier versions tried spawning `claude /buddy card` to detect your Buddy live. That doesn't actually work: slash-commands are REPL-only and don't return useful stdout when invoked from outside. The toggle still exists for users who want PetForge to try anyway, but the **import path is the reliable one**.

### Importing

Three input modes:

```bash
# From a file
petforge buddy import --from=~/.petforge/buddy-card.txt

# From stdin (Unix shells)
cat my-buddy.txt | petforge buddy import

# Clear the import (back to the PetForge default visual)
petforge buddy import --clear
```

The first import auto-flips `userToggle` to `on` so your Buddy appears immediately. To temporarily hide your imported Buddy without losing it: `petforge buddy off`. Re-enable: `petforge buddy on`.

### What gets parsed

When the imported card looks like Anthropic's `/buddy card` output, PetForge auto-extracts:

| Field | Example | Used for |
|---|---|---|
| **Name** (Title-Case word) | `Huddle` | Replaces `DAEMON` in the card header |
| **Species** (UPPERCASE) | `OCTOPUS` | (currently informational) |
| **Rarity** word | `RARE` | Replaces `common` in the card header + the rarity glow |
| **Stars** count | `★★★` | Visual indicator |
| **Stat lines** (`NAME ████ N`) | `DEBUGGING 75` | Replaces FOCUS/GRIT/etc on the right |

When ≥ 3 stat lines parse, PetForge **auto-strips them from the rendered visual** so they don't appear twice (once in the box on the left, once in the right-hand stats panel). The cardCache on disk stays intact — the strip is render-time only.

### Limits

- Max 32 KB per import (refused beyond)
- Empty input rejected
- Trailing newline stripped (typical from piping)

### Privacy

The imported ASCII is stored at `~/.petforge/state.json` under `state.buddy.cardCache`. It only appears there because **you** ran `petforge buddy import`. Auto-detection paths never persist anything.

---

## Stream to your phone

```bash
petforge serve --lan
# PetForge server listening on http://127.0.0.1:7878
# Phone access (same Wi-Fi): http://192.168.1.42:7878
```

Open the LAN URL on your phone, add to home screen for an "app" feel. The web view streams live: every hook event your machine receives is reflected on your phone within ~50ms via Server-Sent Events (auto-reconnects on disconnect).

By default the server binds to `127.0.0.1` (loopback only). `--lan` exposes it on `0.0.0.0`. For shared networks, `--token=XXX` requires a shared secret in the URL (`?token=XXX`) or via a `Bearer` header.

The server is **read-only** — it streams state and never mutates it.

---

## OpenTelemetry integration (V2.0+)

Claude Code emits rich metrics over OpenTelemetry — tokens, cost, lines added/removed, accept/reject decisions, commits, PRs. PetForge ingests these to unlock 8 OTel-gated achievements and a richer activity line.

### Setup

```bash
petforge init --otel       # patches ~/.claude/settings.json with OTel env vars
```

Then start the collector. Easiest:

```bash
petforge up                # starts collect + serve together
```

Or just the collector alone, in its own terminal:

```bash
petforge collect
```

**Restart Claude Code** so it picks up the new env vars from `~/.claude/settings.json`. After the first push (~30 s), `petforge card` shows a second activity line:

```
Lines: +8 234 / -1 109 · Tokens: 1.2M · Cost: $4.30 · Cache: 78%
```

### Coexistence with other collectors (fan-out)

If you already run a collector (Datadog, Honeycomb, Grafana Cloud), set:

```bash
export PETFORGE_OTEL_FORWARD=https://api.honeycomb.io/v1/metrics
petforge up
```

PetForge will fan-out the raw payload to that URL (fire-and-forget, 1 s timeout) after ingesting locally.

### Disabling

```bash
petforge init --no-otel    # strip env vars; OTel counters in state stay intact
```

### Security

The collector binds **strictly to `127.0.0.1`** — no LAN exposure flag. Claude Code's OTel payload contains truncated user prompts and file paths. Multi-machine setups must front this with their own auth (mTLS / nginx).

---

## Ports & layout

| Port | Command | Bind | Purpose | UI? |
|---|---|---|---|---|
| **7878** | `serve` / `up` | 127.0.0.1 (or 0.0.0.0 with `--lan`) | Web view (HTML + SSE) | yes |
| **7879** | `collect` / `up` | 127.0.0.1 (always) | OTel collector (POST `/v1/metrics`) | no, API only |

| Path | What |
|---|---|
| `~/.petforge/state.json` | Single source of truth (atomic writes, cross-process locked) |
| `~/.petforge/.lock` | proper-lockfile sentinel |
| `~/.petforge/hook-errors.log` | Best-effort error log (hooks never crash Claude) |
| `~/.claude/settings.json` | Patched by `petforge init` to register hooks (and OTel env if `--otel`) |

---

## Requirements

- Node.js ≥ 20
- Claude Code installed and on PATH
- For Buddy import: Claude Code v2.1.89+ with `/buddy` enabled (to copy your card from)

---

## Troubleshooting

**My pet doesn't gain XP.**
Run `petforge doctor`. Most common causes: hooks not installed yet (`petforge init`), or you ran `init` with a Claude Code session already open — Claude reads `~/.claude/settings.json` at session start, so close and reopen the session.

**`petforge init` says my settings.json has invalid JSON.**
PetForge refuses to overwrite a malformed settings file. Fix the JSON in `~/.claude/settings.json` (or delete the file and PetForge will create a new one).

**I see hook errors in `~/.petforge/hook-errors.log`.**
Hook errors never crash Claude Code (every error path exits 0). Two cases worth attention:
- **EPERM on rename** (Windows-only) — fixed in 2.0.1 with retry. If you still see it, you're on an older version.
- **`Hook cancelled`** — Claude Code killed the hook before it finished. Usually transient (one-shot CLI invocations). XP for that single event is lost; the next hook fires normally.

**`petforge buddy import` succeeds but the visual doesn't appear.**
Check for stale long-running `petforge collect` processes from a previous build:
```powershell
# Windows
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -match "petforge.*collect" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```
Old collectors hold an outdated schema in memory and silently strip unknown fields (like `cardCache`) on every state write. Killing them and re-importing fixes it. Use `petforge up` (single process, clean Ctrl+C) to avoid this.

**OTel collector reachable but no data ingest after 60 s.**
The OTel env vars in `~/.claude/settings.json` are read **at session start**. Close and reopen Claude Code. Verify with:
```bash
# inside Claude Code
echo $OTEL_EXPORTER_OTLP_ENDPOINT
# → http://127.0.0.1:7879
```
Also confirm `CLAUDE_CODE_ENABLE_TELEMETRY=1` is set (it's the master switch on Anthropic's side).

**I want to reset my pet (start over from the egg).**
```bash
# bash / Git Bash / WSL
rm ~/.petforge/state.json

# PowerShell
Remove-Item $HOME\.petforge\state.json
```
Your pet respawns deterministically with the same species/rarity/stats/shiny (derived from `sha256(username + hostname)`). XP, level, achievements, counters reset to zero — you'll see the egg crack again at level 5.

**I want to wipe everything (state + logs + lockfile + Buddy import).**
```bash
rm -rf ~/.petforge          # bash
Remove-Item -Recurse $HOME\.petforge   # PowerShell
```

**I want to remove PetForge from Claude Code's hooks.**
Restore the backup that `petforge init` created:
```bash
mv ~/.claude/settings.json.bak ~/.claude/settings.json
```
Or edit `~/.claude/settings.json` manually — PetForge entries are the ones whose `command` starts with `petforge hook --event`.

**My terminal mangles ANSI colors / box characters.**
Use a UTF-8 + truecolor terminal (Windows Terminal, modern macOS Terminal, iTerm2, Alacritty, VS Code terminal). Old `cmd.exe` and legacy PowerShell hosts may render fissures and shimmers poorly.

**`petforge watch` shows the pet but XP doesn't update.**
Make sure you're on v1.1.0+ (`petforge --version`). Earlier versions cached the initial state. Upgrade with `npm install -g @mindvisionstudio/petforge@latest`.

**On Windows, `petforge collect &` errors with "AmpersandNotAllowed".**
That's bash syntax. PowerShell equivalents:
```powershell
Start-Process petforge -ArgumentList "collect"            # detached window
Start-Job -ScriptBlock { petforge collect }               # background job
```
Or just use `petforge up` which runs both servers in foreground with one Ctrl+C.

---

## Privacy

PetForge is **fully local**:
- No network calls except optional OTel fan-out you opt into
- No analytics, no telemetry, no phone-home
- No account, no signup
- State lives at `~/.petforge/state.json` and only there
- Pet engine derives your creature from `sha256(username + hostname)` locally
- Buddy ASCII is persisted only when you explicitly run `petforge buddy import`

**No Anthropic content is copied or redistributed.** PetForge ships its own assets and only invokes Claude Code as a runtime consumer.

---

## Development

```bash
git clone https://github.com/ObzCureDev/petforge.git
cd petforge
npm install
npm run dev          # tsup watch mode
npm test             # vitest (290+ tests across 19 files)
npm run check        # biome lint + format check
npm run check:fix    # biome auto-fix
npm run typecheck    # tsc --noEmit
npm run build        # tsup production build
```

See [`CHANGELOG.md`](./CHANGELOG.md) for release notes and [`docs/superpowers/specs/`](./docs/superpowers/specs/) for design specs.

---

## Roadmap

**V2.x ideas** (not committed):
- `events.ndjson` append-only event store + per-day heatmap in `serve`
- Cinematic milestones (level-up celebration animations) + WISDOM stat
- VS Code / Antigravity extension panel
- Skin shop & buddy variants
- Multi-device cloud sync (opt-in)
- More species & evolution branches

---

## License

[Apache License 2.0](./LICENSE)

---

## Acknowledgments

- [Anthropic](https://anthropic.com) — for Claude Code, the Buddy concept, and the OTel surface
- [Vadim Demedes](https://github.com/vadimdemedes) — for [Ink](https://github.com/vadimdemedes/ink), the React-for-CLIs framework
- The Claude Code community — for asking for an RPG progression layer

---

Built by [MindVision Studio](https://mindvisionstudio.com) · github.com/ObzCureDev
