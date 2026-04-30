# PetForge — Design Spec

| | |
|---|---|
| **Date** | 2026-04-30 |
| **Project** | PetForge |
| **Owner** | Dan (ObzCureDev) |
| **Status** | Approved — ready for implementation plan |
| **Spec version** | v3 (final, post-brainstorming) |
| **Predecessors** | v1 sprites + VS Code ext (rejected), v2 RPG layer over Buddy (rejected after Buddy discovery + license concerns) |

---

## 1. Background & Context

Anthropic shipped **Claude Buddy** in April 2026 — a terminal tamagotchi natively integrated in Claude Code (`/buddy`). It generates a deterministic creature per user (18 species, 5 rarities, 5 stats, 8 hats) but **does not implement leveling, progression, or evolution** — a gap the community explicitly requests on GitHub.

PetForge fills that gap as a **local-first RPG progression layer** that tracks real coding activity through Claude Code hooks. It is **not** a fork or extension of Buddy — it ships its own pet engine and silently uses Buddy as a visual upgrade when available.

**Positioning** (README tagline):
> PetForge is a local-first RPG progression layer for AI coding companions. It tracks your real coding activity through Claude Code hooks, adds XP, levels, achievements, and terminal-native evolutions, and can optionally display your Claude Buddy when available. No Anthropic files are modified, copied, or redistributed.

---

## 2. Goals & Non-Goals

### Goals
- **G1**: Track Claude Code activity via 5 official hooks and translate to XP / levels / achievements.
- **G2**: Display a deterministic ASCII pet that evolves visually across 5 phases as XP grows.
- **G3**: Run as a CLI tool (`petforge` command) installed globally via npm. Cross-platform (Windows, macOS, Linux).
- **G4**: Detect Claude Buddy at runtime and use its visual when present; fall back silently to PetForge engine when absent / changed / disabled.
- **G5**: Ship 10 achievements across onboarding, time, volume, skill, and stretch categories.
- **G6**: Zero telemetry — fully local-first, no phone-home, no analytics.
- **G7**: Trademark-clean — no `claude` / `buddy` in name or assets, no copy of Anthropic content.

### Non-Goals (V1)
- **NG1**: Multi-device sync (user can manually sync `~/.petforge/` via Dropbox/iCloud if desired).
- **NG2**: Web companion / shareable stat dashboards.
- **NG3**: Sound effects.
- **NG4**: VS Code / Antigravity extension panel (V2 — wraps the CLI).
- **NG5**: OTLP collector (hooks suffice for V1).
- **NG6**: Skin shop, customization beyond evolution phases.
- **NG7**: PR to Anthropic (focus on standalone OSS quality first).
- **NG8**: Anti-abuse XP cap (YAGNI — user cheats themselves).

---

## 3. Architecture — 3 layers

```
┌──────────────────────────────────────────────────┐
│ Layer 3 : DISPLAY (CLI commands)                 │
│   - Auto-detect TTY for animation                │
│   - Plays pending level-up / achievement cines   │
│   - Renders pet ASCII + level + XP bar + stats   │
└──────────────────────────────────────────────────┘
                       ↑ reads
┌──────────────────────────────────────────────────┐
│ Layer 2 : STATE (~/.petforge/state.json)         │
│   - schemaVersion-tagged                         │
│   - Pet (deterministic from seed)                │
│   - Progress (xp, level, phase, pending flags)   │
│   - Counters (per-session + cumulative)          │
│   - Achievements (unlocked + pendingUnlocks)     │
│   - Buddy state cache                            │
│   - File-locked via proper-lockfile              │
└──────────────────────────────────────────────────┘
                       ↑ writes
┌──────────────────────────────────────────────────┐
│ Layer 1 : HOOKS (Claude Code)                    │
│   - 5 events → `petforge hook --event <name>`    │
│   - Reads JSON from stdin                        │
│   - Mutates state, exits < 50ms                  │
└──────────────────────────────────────────────────┘
                       ↑ optional invocation
┌──────────────────────────────────────────────────┐
│ Layer 0 : BUDDY DETECTION (optional)             │
│   - Runtime invoke `claude /buddy card`          │
│   - Replaces visual if detected + user opts in   │
│   - NEVER copy, parse internal files, redistribute│
└──────────────────────────────────────────────────┘
```

### Data flow

1. User installs : `npm i -g @mindvisionstudio/petforge`
2. User runs : `petforge init` → patches `~/.claude/settings.json` (with backup `.bak`) to register 5 hooks
3. User uses Claude Code normally
4. Claude fires events → `petforge hook --event <name>` runs (timeout 1s) → updates `state.json` atomically
5. User runs : `petforge` → reads state → plays pending cinematics → renders pet snapshot

---

## 4. State Schema (`~/.petforge/state.json`)

```ts
interface State {
  schemaVersion: 1;

  pet: {
    species: "pixel" | "glitch" | "daemon" | "spark" | "blob";
    rarity: "common" | "uncommon" | "rare" | "epic" | "legendary";
    shiny: boolean;
    stats: {
      focus: number;  // 0-100
      grit: number;
      flow: number;
      craft: number;
      spark: number;
    };
    seed: string;  // SHA-256(username + hostname), hex
  };

  progress: {
    xp: number;            // cumulative
    level: number;         // 1-100
    phase: "hatchling" | "junior" | "adult" | "elder" | "mythic";
    pendingLevelUp: boolean;
  };

  counters: {
    promptsTotal: number;
    toolUseTotal: number;
    sessionsTotal: number;

    perSession: {
      startTs: number;       // epoch ms
      toolUseCount: number;
      fileExtensions: string[];  // unique extensions seen this session
    } | null;

    streakDays: number;
    lastActiveDate: string;  // ISO date YYYY-MM-DD
    nightOwlEvents: number;  // events in [22h, 02h) local
  };

  achievements: {
    unlocked: string[];        // ids of unlocked achievements
    pendingUnlocks: string[];  // unlocked but cinematic not yet shown
  };

  buddy: {
    detected: boolean;
    lastChecked: number;       // epoch ms
    userToggle: "auto" | "on" | "off";
  };

  meta: {
    createdAt: number;         // epoch ms first install
    updatedAt: number;
  };
}
```

### Atomicity & locking

- All writes go through `proper-lockfile` for cross-platform exclusive lock on `state.json.lock`.
- Write strategy : write to `state.json.tmp`, fsync, rename atomically. Lockfile released after rename.
- Read strategy : acquire shared lock, read, release. (Or if proper-lockfile single-mode : exclusive lock for read+write cycle.)
- Schema migration : if `schemaVersion < 1` (future-proofing), run migration before mutation.

---

## 5. CLI Commands

| Command | Behavior |
|---|---|
| `petforge` | Reads state, plays pending cinematics (level-ups, achievement unlocks), then renders snapshot. Auto-detects TTY via `process.stdout.isTTY`: interactive → exactly 16 frames at 8 FPS (2.0 s idle anim cycle) + final static snapshot ; non-TTY → snapshot only, no animation. |
| `petforge init` | Detects `~/.claude/settings.json`, computes diff with required hook config, prompts user (Y/N), writes with backup `.bak`. Idempotent: skips with friendly message if already configured. |
| `petforge hook --event <name>` | Internal endpoint called by Claude Code hooks. Reads JSON event from stdin, acquires lock, mutates state, releases lock, exits in <50ms. Never prints to stdout (would pollute Claude Code output). |
| `petforge card` | Full status display: pet ASCII + species + rarity badge + shiny indicator + 5 stat bars + level + XP progress bar + achievements progress (10 cases ✓/⬜) + Buddy detection status + total session count. |
| `petforge watch` | Persistent mode: refreshes display at 8 FPS with idle animation looping. Ctrl+C to exit. |
| `petforge buddy [on\|off\|auto]` | No arg : prints current Buddy detection state and userToggle. With arg : sets `userToggle` and persists. |
| `petforge doctor` | Health check (exit 0 / 1) : Node version ≥ 20, hooks registered in `~/.claude/settings.json`, `~/.petforge/state.json` valid + parseable, `claude` CLI on PATH, `claude /buddy card` returns data. Prints checklist with ✓/✗ per item. |

### Cinematics

- **Level-up** : when `progress.pendingLevelUp === true`, play `figlet "LEVEL UP!"` with color burst over 1.5s, then clear flag. Triggered before normal display.
- **Achievement unlock** : when `progress.pendingUnlocks` non-empty, play banner per achievement (icon + name + XP gained) for 1.2s each, then clear list.

### Animation

- Frame buffer rendered with Ink (React in terminal).
- Idle: 2-3 frames (eye blink, slight wobble, breath) cycled at 8 FPS.
- Snapshot mode (non-TTY): single static render, no anim.

---

## 6. Claude Code Hooks Configuration

Written to `~/.claude/settings.json` by `petforge init`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "petforge hook --event prompt", "timeout": 1 }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "petforge hook --event post_tool_use", "timeout": 1 }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "petforge hook --event stop", "timeout": 1 }
        ]
      }
    ],
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "petforge hook --event session_start", "timeout": 1 }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "petforge hook --event session_end", "timeout": 1 }
        ]
      }
    ]
  }
}
```

`petforge init` merges with existing user hooks rather than overwriting them. If a hook entry from PetForge is detected and unchanged → skip with success message. If detected and outdated → prompt user before update.

### XP per event

| Event | XP gain | Side-effect on counters |
|---|---|---|
| `UserPromptSubmit` | +5 | `promptsTotal++`, check Hatch achievement, check Night Owl |
| `PostToolUse` | +1 | `toolUseTotal++`, `perSession.toolUseCount++`, extract file extension if Edit/Write tool, check First Tool / Refactor Master / Polyglot / Tool Whisperer |
| `Stop` | +10 | (no counter change) |
| `SessionStart` | 0 | `perSession = { startTs: now, toolUseCount: 0, fileExtensions: [] }`, check & update streak |
| `SessionEnd` | +50 | `sessionsTotal++`, check Marathon (now - startTs > 1h), reset `perSession = null` |

XP gain triggers level recomputation. If new level > old level → `pendingLevelUp = true`. Phase recomputation triggered by level boundary.

---

## 7. Pet Engine (deterministic generation)

Independent of Buddy. Generates a creature from a deterministic local seed.

```ts
function generatePet(): Pet {
  const seed = sha256(os.userInfo().username + os.hostname());
  const bytes = hexToBytes(seed);

  return {
    species: pickSpecies(bytes[0]),       // 5 species, equal weights
    rarity: pickRarity(bytes[1] / 255),   // weighted distribution
    shiny: bytes[2] < 3,                  // 1% (3/255)
    stats: {
      focus: bytes[3] % 101,              // 0-100
      grit:  bytes[4] % 101,
      flow:  bytes[5] % 101,
      craft: bytes[6] % 101,
      spark: bytes[7] % 101,
    },
    seed,
  };
}
```

### Species (5)

| Slug | Name | Theme | Visual cue |
|---|---|---|---|
| `pixel` | Pixel | 8-bit cube creature | Square outline, scanlines |
| `glitch` | Glitch | Corrupted pixel | Shifted/duplicated pixels, color noise |
| `daemon` | Daemon | Process pun (mythic) | Devil-like silhouette with code overlay |
| `spark` | Spark | Energy creature | Lightning/electric arcs |
| `blob` | Blob | Amorphous gel | Round/wobbly shape |

### Rarity weights

| Rarity | Probability | Visual treatment |
|---|---|---|
| Common | 60% | Default ANSI colors |
| Uncommon | 25% | Green tint border |
| Rare | 10% | Blue glow |
| Epic | 4% | Purple aura |
| Legendary | 1% | Gold pulsation |

### Shiny

1% independent roll. Adds a rotating ANSI rainbow overlay (4-color cycle) on the pet.

### Stats

5 stats (FOCUS, GRIT, FLOW, CRAFT, SPARK), each 0-100, derived from seed bytes. Stats are flavor — they do **not** affect XP / leveling. Pure cosmetic for `petforge card` display.

---

## 8. Evolution Phases

| Phase | Levels | XP cumulative | Visual |
|---|---|---|---|
| 🥚 Hatchling | 1-19 | 0 → 5 000 | Base ASCII species |
| 🐣 Junior | 20-49 | 5 000 → 50 000 | + ANSI gold halo, scaled +20% |
| 🦎 Adult | 50-79 | 50 000 → 250 000 | ASCII V2 (more elaborate) |
| 🐉 Elder | 80-99 | 250 000 → 1 000 000 | + shimmer ANSI overlay |
| 🌟 Mythic | 100 | 1 000 000+ | + pulsation effect + crown glyph |

Level → XP curve : roughly geometric progression. Leveling formula:

```ts
function xpForLevel(level: number): number {
  // level 1 = 0 xp ; level 2 = ~250 ; level 100 = 1 000 000
  // tuned so 1 M xp ≈ a few weeks of intensive use
  if (level <= 1) return 0;
  return Math.floor(250 * Math.pow(level - 1, 1.85));
}
```

> Curve to be calibrated after dogfood week. Initial values are placeholders that produce ~5K cumulative XP at level 19, ~50K at 49, ~250K at 79, ~1M at 100.

### Buddy visual override

If `state.buddy.detected === true` and `state.buddy.userToggle !== "off"` :
- The species ASCII is **replaced** at runtime by invoking `claude /buddy card` and capturing the sprite from stdout.
- ANSI overlays (halo, shimmer, pulsation, shiny) **remain** PetForge-controlled and superpose on top.
- We never persist Buddy ASCII to `state.json` or any file. Always runtime invoke.

---

## 9. Achievements (10)

All 10 ship in V1. Each unlock grants XP, sets `pendingUnlocks` for cinematic at next display.

| ID | Name | Trigger | XP | Difficulty |
|---|---|---|---|---|
| `hatch` | Hatch | First `UserPromptSubmit` | 500 | Instant |
| `first_tool` | First Tool | First `PostToolUse` | 500 | Instant |
| `marathon` | Marathon | `SessionEnd` with `now - startTs > 3 600 000` (1h) | 1 000 | Easy |
| `night_owl` | Night Owl | `nightOwlEvents >= 50` (events in [22h, 02h) local) | 1 500 | Medium |
| `streak_3d` | Streak 3 Days | `streakDays >= 3` | 1 000 | Easy |
| `streak_7d` | Streak 7 Days | `streakDays >= 7` | 2 500 | Medium |
| `polyglot` | Polyglot | `perSession.fileExtensions.length >= 5` | 1 500 | Easy |
| `refactor_master` | Refactor Master | `perSession.toolUseCount >= 100` (any tool — captures heavy sessions regardless of tool mix) | 2 000 | Medium |
| `tool_whisperer` | Tool Whisperer | `toolUseTotal >= 1 000` | 3 000 | Hard |
| `centurion` | Centurion | `level === 100` | 5 000 | Hard |

Detection happens inside the relevant hook handler. Already-unlocked achievements are not re-fired (id-based dedup against `unlocked`).

---

## 10. Tech Stack

| Concern | Choice |
|---|---|
| Runtime | Node.js ≥ 20 (ESM) |
| Language | TypeScript 5.x (strict) |
| Build | [tsup](https://tsup.egoist.dev/) — esbuild bundler, outputs ESM + CJS + .d.ts |
| TUI framework | [Ink](https://github.com/vadimdemedes/ink) — React for terminals |
| Colors | [chalk](https://github.com/chalk/chalk) — ANSI 256 + truecolor |
| ASCII text | [figlet](https://github.com/patorjk/figlet.js) — for level-up cinematic |
| File locking | [proper-lockfile](https://github.com/moxystudio/node-proper-lockfile) — cross-platform exclusive lock |
| Test framework | [Vitest](https://vitest.dev/) |
| Lint + format | [Biome](https://biomejs.dev/) — replaces ESLint + Prettier |
| Distribution | npm registry as `@mindvisionstudio/petforge` (scoped, public) |
| License | Apache 2.0 |
| Telemetry | None (zero phone-home) |

### Repository layout

```
petforge/
├── src/
│   ├── index.ts              # CLI entrypoint (route to commands)
│   ├── commands/
│   │   ├── default.tsx       # `petforge` (default display)
│   │   ├── init.ts           # `petforge init`
│   │   ├── hook.ts           # `petforge hook --event ...`
│   │   ├── card.tsx          # `petforge card`
│   │   ├── watch.tsx         # `petforge watch`
│   │   ├── buddy.ts          # `petforge buddy`
│   │   └── doctor.ts         # `petforge doctor`
│   ├── core/
│   │   ├── state.ts          # Read/write state.json with lock
│   │   ├── schema.ts         # State type + zod validator
│   │   ├── pet-engine.ts     # Deterministic pet generation
│   │   ├── xp.ts             # Level curve + phase logic
│   │   ├── achievements.ts   # 10 achievement detection rules
│   │   └── buddy.ts          # Optional Buddy detection
│   ├── render/
│   │   ├── pet.tsx           # ASCII pet renderer
│   │   ├── species/          # 5 species × 5 phases ASCII files
│   │   ├── effects.ts        # ANSI halos, shimmers, pulsations
│   │   └── cinematics.tsx    # Level-up + achievement banners
│   └── settings/
│       └── claude-config.ts  # Read/patch ~/.claude/settings.json
├── tests/
│   ├── pet-engine.test.ts
│   ├── xp.test.ts
│   ├── achievements.test.ts
│   ├── state.test.ts
│   └── claude-config.test.ts
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-04-30-petforge-design.md   # this file
├── package.json
├── tsconfig.json
├── biome.json
├── vitest.config.ts
├── tsup.config.ts
├── README.md
└── LICENSE                   # Apache 2.0
```

---

## 11. Legal Constraints (hard rules)

- ❌ Never read internal Claude Code files (binary, dist/*).
- ❌ Never copy Buddy ASCII into PetForge assets.
- ❌ Never reproduce Buddy logic verbatim (the 18 species names, the 5 stats names, the rarity numbers — pick original ones).
- ❌ Never use `claude` or `buddy` in package name, repo name, project name, or branding.
- ✅ Runtime invocation of `claude /buddy card` permitted (= reading public stdout).
- ✅ Display of user's own Buddy via runtime invoke is permitted.
- ✅ PetForge species (Pixel/Glitch/Daemon/Spark/Blob) and stats (FOCUS/GRIT/FLOW/CRAFT/SPARK) are original.

---

## 12. Risks

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Anthropic ships equivalent feature | Medium | Low | Engine PetForge is core, Buddy is optional. OSS standalone. |
| Buddy deprecated / changed | Medium | Low | Synthetic mode is primary. Engine works without Buddy. |
| Hook config format changes | Low | Medium | Version-pin `claude` requirement, parse defensively, doctor command catches it. |
| Hook performance > 1s timeout | Low | Critical | Lockfile + atomic write + early exit. Bench < 50ms required. |
| Trademark complaint | Very Low | Critical | Clean naming + zero copy + runtime-only Buddy invoke. |
| Cross-platform Windows paths | Low | Medium | Use `os.homedir()` + `path.join()` everywhere. Test on Windows + macOS. |

---

## 13. MVP Scope — definitive

### In scope (V1.0)

- 7 CLI commands listed in §5
- 5 species, 5 phases, 5 stats, deterministic generation
- 5 hooks integration with official format
- 10 achievements
- State management with lockfile + schema validation
- ANSI effects per phase (halo, shimmer, pulsation)
- Cinematics for level-up and achievement unlock
- Auto-detect TTY for `petforge` default
- Optional Buddy detection (silent fallback)
- README + GIF demo + install instructions
- Test coverage for pet-engine, xp, achievements, state, claude-config (Vitest)
- CI: GitHub Actions running tests + biome check on PRs
- Repository public on github.com/ObzCureDev/petforge under Apache 2.0

### Out of scope (V2+)

- VS Code / Antigravity extension
- Web companion / shareable dashboard
- Multi-device sync (manual via Dropbox left to user)
- Sound effects
- Skins / customization beyond evolution phases
- OTLP collector
- Anti-abuse XP cap
- Telemetry (would require explicit V2 design + opt-in flow)
- Anthropic PR submission

---

## 14. Success Criteria

V1.0 is shipped when :
1. Published on npm as `@mindvisionstudio/petforge` and installable globally.
2. `petforge init` configures hooks idempotently on a fresh machine in one command.
3. After 1 day of normal usage, user reaches at least Junior phase (level 20+) and unlocks 2-3 achievements organically.
4. `petforge doctor` returns all green on Windows + macOS + Linux.
5. README has a recorded GIF showing install → init → first session → first level-up.
6. CI green on PRs.

---

## 15. Naming Reservations (verified 2026-04-30)

- npm scope `@mindvisionstudio` ✅ created
- npm package `@mindvisionstudio/petforge` ✅ available
- GitHub repo `github.com/ObzCureDev/petforge` ✅ created
- Subdomain `petforge.mindvisionstudio.com` ✅ available (point when ready)

---

## 16. Open Questions

None. All clarifying decisions resolved during the brainstorming session 2026-04-30.

---

## 17. Next Step

Invoke `superpowers:writing-plans` skill with this spec as input to produce a phased implementation plan.
