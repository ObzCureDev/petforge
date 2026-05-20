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
  <a href="./CHANGELOG.md"><img src="https://img.shields.io/badge/version-3.7.0-blue" alt="Version"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-blue" alt="License"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%E2%89%A520-brightgreen" alt="Node ≥ 20"></a>
</p>

---

## What

PetForge gives your terminal a deterministic ASCII pet that **levels up from real coding activity**. It listens to Claude Code's official hooks (`UserPromptSubmit`, `PostToolUse`, `Stop`, `SessionStart`, `SessionEnd`), translates them into XP, evolutions across 6 phases, and 46 medal-tiered achievements (hook-driven + optional OTel-gated tiers).

If you have a **Claude Buddy** you like, you can import its ASCII visual once and PetForge will use it as your pet's appearance — name, rarity, and stats included. Otherwise PetForge generates an original creature deterministically from your username + hostname.

> **No Anthropic files are modified, copied, or redistributed.** PetForge ships its own engine. Buddy integration is consensual: nothing is persisted unless you explicitly run `petforge buddy import`.

---

## Highlights

- 🥚 **6 evolution phases** — Egg → Hatchling → Junior → Adult → Elder → Mythic
- 🏆 **46 achievements** organised into **7 collapsible categories** with a "Near completion" auto-group and a top **Next Goals** card — bronze/silver/gold/platinum medal tiers across 13 families + a 6-step hatch phase ladder
- 🐾 **18 deterministic species** across 5 rarity tiers — duck, goose, blob, turtle, snail, mushroom, chonk, octopus, penguin, cactus, rabbit, cat, owl, capybara, robot, ghost, axolotl, dragon
- ✨ **5 rarities + shiny** — Common 60% / Uncommon 25% / Rare 10% / Epic 4% / Legendary 1% (Dragon always Legendary, Octopus always Uncommon, etc.)
- 🪝 **5 official Claude Code hooks** — zero polling, sub-50ms updates
- 📺 **Live watch mode** — terminal animation + counters refreshed every 500ms
- 📱 **PWA mobile** — installable web view (manifest + 512×512 icon), live SSE updates on your LAN
- 🃏 **4-card web layout** — PET (with derived Mood / Trait / Next evolution), CURRENT RUN (split into RUN + DEV lines), STATS, ACHIEVEMENTS
- 📊 **OpenTelemetry collector** — opt-in, ingests Claude Code metrics, fans out to Datadog/Honeycomb
- 🎭 **Buddy import** — pin your favourite Claude Buddy ASCII as your pet, with parsed name/rarity/stats
- 🚀 **One-command up** — `petforge up --lan` starts the OTel collector AND the web view together
- 🔒 **100% local** — zero telemetry, zero phone-home, zero account
- 🧰 **Cross-platform** — Windows, macOS, Linux (Windows-specific EPERM/EBUSY retry on state writes)

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
| `petforge serve [--port=N] [--lan] [--host=IP] [--token=XXX]` | HTTP + SSE server with mobile-friendly web view |
| `petforge collect [--port=N] [--forward=URL]` | OTLP/HTTP/JSON collector for Claude Code metrics (strict 127.0.0.1) |
| **`petforge up [--lan] [--host=IP] [--port=N] [--collect-port=N] [--token=XXX] [--forward=URL]`** | **Recommended.** Starts collect + serve in a single process, single Ctrl+C kills both |
| `petforge buddy [on\|off\|auto]` | Toggle Claude Buddy visual integration |
| `petforge buddy import [--from=FILE] [--clear]` | Pin a Buddy ASCII as your pet's visual (stdin or file) |
| `petforge quota [enable\|disable\|--json]` | Show / configure Claude Code rate-limit tracking (opt-in, V3.7) |

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

PetForge now displays your Buddy in `card` / `watch` / `serve`. Name, rarity, and stats are auto-parsed from the card and replace your default pet name + rarity + the five derived stats (DEBUGGING, PATIENCE, CHAOS, WISDOM, SNARK) with the Buddy's own (e.g. `HUDDLE · rare` + DEBUGGING / PATIENCE / TENACITY / FLOW).

XP / levels / achievements / activity counters stay PetForge-driven.

---

## Auto-start on login

Run PetForge as a user-mode service that comes up automatically when you log in. No admin or sudo required.

```bash
petforge service install --lan      # same flags as `petforge up`
petforge service status             # check whether it's installed/running
petforge service uninstall          # remove the auto-start hook
```

Behind the scenes:

| OS      | Mechanism                                    | Location                                                       |
|---------|----------------------------------------------|----------------------------------------------------------------|
| Windows | Scheduled Task (logon trigger)               | `schtasks /TN PetForge`                                        |
| macOS   | launchd LaunchAgent                          | `~/Library/LaunchAgents/com.mindvisionstudio.petforge.plist`   |
| Linux   | systemd `--user` unit                        | `~/.config/systemd/user/petforge.service`                      |

On Linux, if you want PetForge to keep running while you're logged out, run once (requires sudo):

```bash
sudo loginctl enable-linger "$USER"
```

> **Note (Windows non-English locale):** `petforge service status` parses `schtasks` output and currently only recognizes English locale strings. On a non-English Windows host, a running task will be reported as `installed-stopped` instead of `installed-running`. The install / uninstall flows are unaffected. Locale-independent status detection is planned for V3.6.1.

---

## Quota tracking (opt-in, V3.7)

PetForge can show your Claude Code 5h session and 7d weekly rate-limit usage directly in the web view and CLI card - same data the "Claude Code Gauge" extension family exposes, but without leaving PetForge.

```bash
petforge quota enable     # one-time opt-in (validates credentials)
petforge up --quota       # collect + serve + quota daemon
```

The probe runs every 5 minutes, **only** when a Claude Code JSONL has been touched in the last 10 minutes. When you stop coding, PetForge stops calling Anthropic. Each probe consumes ~9 input tokens of `claude-haiku-4-5`.

When session utilization crosses 80%, the pet's mood flips to "stressed"; at 95% (or status `denied`) it flips to "panic". Sustained efficient use unlocks the `quota_efficient_*` achievement family; hitting 95%+ unlocks `quota_marathon_*`.

**Caveats:** the rate-limit response headers PetForge reads (`anthropic-ratelimit-unified-*`) are not part of Anthropic's documented API. This is an explicit opt-in for that reason. If Anthropic changes the shape, PetForge will fail soft (the QUOTAS card shows "stale" + the reason) and nothing else breaks.

To disable:

```bash
petforge quota disable
```

Existing quota achievements stay unlocked when disabled.

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

The hatch phase ladder fires one milestone per phase boundary: `hatch_egg` at the start, `hatch_hatchling` at level 5, `hatch_junior` at level 12, `hatch_adult` at level 30, `hatch_elder` at level 60, and `hatch_mythic` at level 100 (+25K XP — the mythic milestone subsumes the old Centurion). Most users hit Junior in a couple of weeks of regular use; Mythic is a multi-month milestone.

---

## Pet engine

Your pet is **deterministic**: it's generated from `sha256(username + hostname)`. Same machine = same pet, always. Different machine = different pet.

**Rarity is rolled first**, then the species is picked from the bucket matching that rarity. Each species belongs to exactly one tier — Octopus is always Uncommon, Cat is always Rare, Dragon is always Legendary. There are no surprises across machines: the rarity glow always matches the species table below.

| Rarity | Odds | Species |
|---|---|---|
| Common | 60% | duck · goose · blob · turtle · snail · mushroom · chonk |
| Uncommon | 25% | octopus · penguin · cactus · rabbit |
| Rare | 10% | cat · owl · capybara · robot |
| Epic | 4% | ghost · axolotl |
| Legendary | 1% | dragon |

Shiny: 1% independent rainbow overlay (any species, any rarity).

Each pet ships with 5 base stats — **debugging, patience, chaos, wisdom, snark** — derived from the same seed (each in `[0, 100]`). Stats are flavor: they don't affect XP gain. When you import a Buddy, its own stat names (e.g. DEBUGGING, PATIENCE, TENACITY, FLOW) replace these on the right-hand panel.

---

## Achievements

**46 achievements** organized as:

- **Hatch phase ladder** (6 milestones, no medal): egg / hatchling / junior /
  adult / elder / mythic — fires when your pet enters each phase.
- **13 medal families**, each with bronze (1K XP), silver (3K), gold (10K)
  tiers (streak adds a platinum at 30K):
  - **Streak** (3d / 7d / 30d / 100d), **Tool** (5K / 25K / 100K),
    **Marathon** (4h / 12h / 24h), **Night** (200 / 1K / 5K events),
    **Polyglot** (5 / 8 / 12 ext per session),
    **Refactor** (100 / 250 / 500 tools per session)
  - OTel-gated (require `petforge collect`):
    **Code lines** (10K / 50K / 200K), **Tokens** (1M / 10M / 100M),
    **Cache** (100K / 1M / 10M with hit-rate ladder),
    **Frugal** (100p<$1 / 500p<$5 / 2Kp<$20),
    **Big spender** ($100 / $500 / $2K),
    **PR** (50 / 200 / 500), **Picky** (50 / 250 / 1K rejected edits)

Hatch ladder XP: 50 (egg) / 500 (hatchling) / 2K (junior) / 5K (adult) /
10K (elder) / 25K (mythic).

### Web view layout (V3.3+)

The achievements panel in `petforge serve` is now grouped into **7 collapsible categories** matching the families above:

- **Evolution** (hatch ladder), **Streak**, **Activity** (tool, refactor, polyglot),
  **Time** (marathon, night), **Coding** (code lines, tokens, cache),
  **Economy** (frugal, big spender), **Collaboration** (pr, picky)

Each category header shows a status symbol (✅ all complete · ◐ in-progress · ○ none yet) plus an `unlocked / total` count. Click to expand.

A virtual **"Near completion"** group appears at the very top when any in-progress achievement has crossed 70 % of its target (top 5, sorted by ratio descending). It hides itself entirely when there's nothing close.

Above the achievements panel, the **NEXT GOALS** card highlights the top 5 in-progress achievements (≥ 50 % first, then anything below if there's room) so you can see what to chase next at a glance.

Each row uses status symbols instead of bare percentages: ✅ for completed, ◐ + percentage + a thin medal-tinted progress bar for in-progress, ○ + percentage for locked. Mini bars are sized 0.25 rem high and tinted by medal color (bronze / silver / gold / platinum).

### Idempotent backfill

If you upgrade from an older version where some checks didn't fire (e.g. pre-V3.1 Marathon only ran on `session_end`), the next hook event will **automatically re-evaluate every threshold** and unlock anything you've already crossed. XP is awarded retroactively. The backfill is idempotent — running it again is a no-op.

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
| **Name** (Title-Case word) | `Huddle` | Replaces the default pet name in the card header |
| **Species** (UPPERCASE) | `OCTOPUS` | (currently informational) |
| **Rarity** word | `RARE` | Replaces `common` in the card header + drives the rarity glow |
| **Stars** count | `★★★` | Visual indicator |
| **Stat lines** (`NAME ████ N`) | `DEBUGGING 75` | Replaces the default 5 derived stats (debugging / patience / chaos / wisdom / snark) on the right |

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

Open the LAN URL on your phone, add to home screen — PetForge ships a **proper PWA manifest** (`manifest.webmanifest` + 512×512 PNG icon), so iOS/Android treat the page like a native app: home-screen icon, splash, full-screen launch, theme color. The web view streams live: every hook event your machine receives is reflected on your phone within ~50 ms via Server-Sent Events (auto-reconnects on disconnect).

The page is laid out as **4 distinct cards** since V3.3:

- **PET** — ASCII pet + display name + rarity/phase/level sub-line + XP bar + 3 derived rows (Mood: Night Owl > Coding > Resting > Focused; Trait: top stat + " Aura"; Next evolution: % toward next phase boundary)
- **CURRENT RUN** — RUN line (sessions / streak / prompts / tools) + DEV line (lines / tokens / cost / cache hit %, hidden cleanly when no OTel data)
- **STATS** — 3-column grid (name / value / bar) for the 5 derived stats
- **NEXT GOALS** + **ACHIEVEMENTS** — see [Web view layout](#web-view-layout-v33) above

By default the server binds to `127.0.0.1` (loopback only). `--lan` exposes it on `0.0.0.0`. For shared networks, `--token=XXX` requires a shared secret in the URL (`?token=XXX`) or via a `Bearer` header.

If the auto-detected LAN IP is wrong (PetForge picks the first non-loopback IPv4, which on Windows can be a Hyper-V / WSL / Docker / VirtualBox vEthernet adapter, or a Tailscale / VPN tunnel), pass `--host=IP` to override only the displayed URL. The bind stays on `0.0.0.0`, so the server is still reachable on every interface — `--host` just decides which one PetForge prints. Examples: `--host=192.168.1.42` (Wi-Fi), `--host=100.x.y.z` (Tailscale), `--host=mybox.local` (mDNS).

The server is **read-only** — it streams state and never mutates it.

---

## OpenTelemetry integration (V2.0+)

Claude Code emits rich metrics over OpenTelemetry — tokens, cost, lines added/removed, accept/reject decisions, commits, PRs. PetForge ingests these to unlock **21 OTel-gated achievements** (across 7 families: code lines, tokens, cache, frugal, big spender, PR, picky) and a richer activity line.

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
npm test             # vitest — 313 tests across 21 files
npm run check        # biome lint + format check
npm run check:fix    # biome auto-fix
npm run typecheck    # tsc --noEmit
npm run build        # tsup production build (single ESM bundle ~216 KB)
```

The codebase is ~9.6 KLoC TypeScript, strict mode, 0 type errors, 1 explicit `any`. Bundling is a single-file ESM via tsup; the published artifact is `dist/index.js`.

See [`CHANGELOG.md`](./CHANGELOG.md) for release notes (V1.0 → V3.4 documented) and [`docs/superpowers/specs/`](./docs/superpowers/specs/) for design specs (V1, V2 OTel, V3.2 medals, V3.3 visual restructure, V3.4 achievement organization).

---

## Roadmap

**V3.5+ ideas** (not committed):
- Achievement filter tabs (All / In-progress / Locked / Completed) above the categories
- `events.ndjson` append-only event store + per-day heatmap card in `serve`
- Cinematic milestones (level-up + medal-tier celebration animations) on the web view
- VS Code / Antigravity extension panel mirroring the 4-card layout
- Skin shop & extra buddy variants
- Opt-in multi-device sync (encrypted state diff)
- More species (frog, fox, raven) and a hardcore-tier achievement layer above platinum

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
