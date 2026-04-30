# PetForge — Implementation Plan

| | |
|---|---|
| **Date** | 2026-04-30 |
| **Project** | PetForge |
| **Spec** | [`docs/superpowers/specs/2026-04-30-petforge-design.md`](../specs/2026-04-30-petforge-design.md) |
| **Status** | Approved — ready for execution |

> **For agentic workers**: REQUIRED SUB-SKILL: use `superpowers:writing-plans` / `superpowers:executing-plans` style execution. Implement task by task. Do not skip tests.

## Goal

Ship **PetForge V1.0**: a local-first CLI that tracks Claude Code activity through hooks, stores XP/levels/achievements locally, renders an evolving ASCII pet, optionally displays Buddy at runtime, and publishes as `@mindvisionstudio/petforge`.

## Architecture

Node.js 20+ CLI, TypeScript strict, local state under `~/.petforge/state.json`, Claude hook integration through `~/.claude/settings.json`, Ink-powered terminal rendering, no telemetry.

Claude's current hook config model is event → matcher group → hook handler, and `matcher: "*"` is valid for "match all", so the spec's hook format is structurally correct.

---

# 0. Pre-code spec patches (applied)

## Patch 0.1 — XP formula corrected

The original formula `Math.floor(250 * Math.pow(level - 1, 1.85))` did **not** produce the table boundary values (it gave ~52K at level 19 instead of 5K). Replaced with a boundary-driven curve:

```ts
const LEVEL_BOUNDARIES = [
  { level: 1,   xp: 0 },
  { level: 20,  xp: 5_000 },
  { level: 50,  xp: 50_000 },
  { level: 80,  xp: 250_000 },
  { level: 100, xp: 1_000_000 },
] as const;

export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  if (level >= 100) return 1_000_000;

  const upperIndex = LEVEL_BOUNDARIES.findIndex((b) => level <= b.level);
  const upper = LEVEL_BOUNDARIES[upperIndex];
  const lower = LEVEL_BOUNDARIES[upperIndex - 1];

  const t = (level - lower.level) / (upper.level - lower.level);
  const curved = Math.pow(t, 1.55);

  return Math.floor(lower.xp + (upper.xp - lower.xp) * curved);
}
```

Acceptance tests (locked):
- `xpForLevel(1)` === 0
- `xpForLevel(20)` === 5 000
- `xpForLevel(50)` === 50 000
- `xpForLevel(80)` === 250 000
- `xpForLevel(100)` === 1 000 000

## Patch 0.2 — Replace `perSession` with `activeSessions`

Single `perSession` would be clobbered if user runs multiple Claude Code terminals in parallel. Claude hooks include a `session_id` in their stdin payload — index by it:

```ts
activeSessions: Record<string, {
  startTs: number;
  toolUseCount: number;
  fileExtensions: string[];
}>;
```

- `SessionStart` creates / updates `activeSessions[session_id]`.
- `PostToolUse` mutates `activeSessions[session_id]`.
- `SessionEnd` evaluates marathon, increments `sessionsTotal`, then deletes `activeSessions[session_id]`.

Both patches integrated into the spec doc on 2026-04-30.

---

# 1. Repository bootstrap

- [ ] Create repo structure exactly as spec.
- [ ] Add `package.json` with:
  - [ ] `name: "@mindvisionstudio/petforge"`
  - [ ] `type: "module"`
  - [ ] `bin: { "petforge": "./dist/index.js" }`
  - [ ] `engines.node >= 20`
  - [ ] `publishConfig.access: "public"`
- [ ] Install runtime deps:
  - [ ] `ink`
  - [ ] `react`
  - [ ] `chalk`
  - [ ] `figlet`
  - [ ] `proper-lockfile`
  - [ ] `zod`
- [ ] Install dev deps:
  - [ ] `typescript`
  - [ ] `tsup`
  - [ ] `vitest`
  - [ ] `biome`
  - [ ] `@types/node`
  - [ ] `@types/react`
  - [ ] `@types/figlet`
- [ ] Configure `tsconfig.json` strict.
- [ ] Configure `tsup.config.ts` for CLI output.
- [ ] Configure `biome.json`.
- [ ] Configure `vitest.config.ts`.
- [ ] Add GitHub Actions:
  - [ ] install
  - [ ] typecheck
  - [ ] biome check
  - [ ] vitest
  - [ ] build

**Acceptance**:

```bash
npm run typecheck
npm run check
npm run test
npm run build
node dist/index.js --help
```

---

# 2. Core model and state

## 2.1 Schema

- [ ] Create `src/core/schema.ts`.
- [ ] Define TypeScript types:
  - [ ] `State`
  - [ ] `Pet`
  - [ ] `Progress`
  - [ ] `Counters`
  - [ ] `AchievementId`
  - [ ] `BuddyState`
- [ ] Add Zod validator mirroring the schema.
- [ ] Use patched `activeSessions`.
- [ ] Add `createInitialState()`.

## 2.2 Paths

- [ ] Create `src/core/paths.ts`.
- [ ] Resolve:
  - [ ] `~/.petforge/`
  - [ ] `~/.petforge/state.json`
  - [ ] `~/.petforge/hook-errors.log`
  - [ ] `~/.claude/settings.json`
- [ ] Use `os.homedir()` and `path.join()` only.

## 2.3 State locking

- [ ] Create `src/core/state.ts`.
- [ ] Implement:
  - [ ] `ensurePetforgeDir()`
  - [ ] `readState()`
  - [ ] `writeStateAtomic()`
  - [ ] `withStateLock(mutator)`
  - [ ] `recoverCorruptState()`
- [ ] Lock the state path or parent directory safely when state file does not exist.
- [ ] Write via:
  - [ ] temp file
  - [ ] fsync
  - [ ] atomic rename
- [ ] On corrupted JSON:
  - [ ] copy to `state.corrupt.<timestamp>.json`
  - [ ] recreate initial state
  - [ ] never crash hook execution

`proper-lockfile` is appropriate here because it is designed for inter-process locking on local or network filesystems.

**Tests**:

- [ ] initial state creation
- [ ] valid state read
- [ ] corrupted state recovery
- [ ] atomic write replaces content
- [ ] concurrent write smoke test

---

# 3. Pet engine and XP engine

## 3.1 Pet engine

- [ ] Create `src/core/pet-engine.ts`.
- [ ] Implement deterministic seed:
  - [ ] `sha256(username + hostname)`
- [ ] Implement:
  - [ ] `pickSpecies`
  - [ ] `pickRarity`
  - [ ] `pickShiny`
  - [ ] `deriveStats`
  - [ ] `generatePet`

**Tests**:

- [ ] same username/hostname → same pet
- [ ] different seed → different possible pet
- [ ] stats always 0–100
- [ ] shiny deterministic
- [ ] rarity deterministic

## 3.2 XP engine

- [ ] Create `src/core/xp.ts`.
- [ ] Implement patched:
  - [ ] `xpForLevel`
  - [ ] `levelForXp`
  - [ ] `phaseForLevel`
  - [ ] `nextLevelProgress`
- [ ] Cap level at 100.
- [ ] Do not cap XP; only cap displayed level.

**Tests**:

- [ ] exact boundary tests
- [ ] monotonic XP curve
- [ ] level 100 at 1M+
- [ ] phase transitions:
  - [ ] 1–19 hatchling
  - [ ] 20–49 junior
  - [ ] 50–79 adult
  - [ ] 80–99 elder
  - [ ] 100 mythic

---

# 4. Achievements engine

- [ ] Create `src/core/achievements.ts`.
- [ ] Define static achievement registry with the 10 V1 achievements.
- [ ] Implement:
  - [ ] `unlockAchievement(state, id)`
  - [ ] `isUnlocked(state, id)`
  - [ ] `checkAchievementsForEvent(state, event, input, now)`
- [ ] Achievement unlock must:
  - [ ] append to `unlocked`
  - [ ] append to `pendingUnlocks`
  - [ ] grant XP once
  - [ ] dedupe by ID

## Event checks

- [ ] `hatch` on first prompt.
- [ ] `first_tool` on first tool use.
- [ ] `marathon` on session end with duration > 1h.
- [ ] `night_owl` when night events >= 50.
- [ ] `streak_3d` when streak >= 3.
- [ ] `streak_7d` when streak >= 7.
- [ ] `polyglot` when active session extensions >= 5.
- [ ] `refactor_master` when active session tool uses >= 100.
- [ ] `tool_whisperer` when total tool uses >= 1000.
- [ ] `centurion` when level === 100.

**Tests**:

- [ ] each achievement unlocks once
- [ ] each grants correct XP once
- [ ] `pendingUnlocks` receives ID
- [ ] already unlocked achievement does not re-fire
- [ ] night owl local time boundary `[22h, 02h)`
- [ ] streak same day does not double count
- [ ] streak missed day resets to 1

---

# 5. Hook command

- [ ] Create `src/commands/hook.ts`.
- [ ] Parse args:
  - [ ] `--event prompt`
  - [ ] `--event post_tool_use`
  - [ ] `--event stop`
  - [ ] `--event session_start`
  - [ ] `--event session_end`
- [ ] Read stdin JSON (extract `session_id`).
- [ ] Never print to stdout.
- [ ] On success: exit 0.
- [ ] On recoverable error:
  - [ ] write to `~/.petforge/hook-errors.log`
  - [ ] exit 0 to avoid breaking Claude workflow
- [ ] On lock timeout:
  - [ ] skip mutation
  - [ ] log locally
  - [ ] exit 0

This is important because some Claude hook stdout can be injected into Claude context depending on event type, so PetForge hooks must stay silent.

## Hook mutation logic

- [ ] `prompt`
  - [ ] `xp += 5`
  - [ ] `promptsTotal++`
  - [ ] update last active date / streak if needed
  - [ ] check hatch
  - [ ] check night owl
- [ ] `post_tool_use`
  - [ ] `xp += 1`
  - [ ] `toolUseTotal++`
  - [ ] `activeSessions[session_id].toolUseCount++`
  - [ ] extract file extension for Edit/Write/MultiEdit/NotebookEdit when path exists → push to `activeSessions[session_id].fileExtensions` (deduped)
  - [ ] check first tool / polyglot / refactor master / tool whisperer / night owl
- [ ] `stop`
  - [ ] `xp += 10`
- [ ] `session_start`
  - [ ] create `activeSessions[session_id] = { startTs: now, toolUseCount: 0, fileExtensions: [] }`
  - [ ] update streak
- [ ] `session_end`
  - [ ] `xp += 50`
  - [ ] `sessionsTotal++`
  - [ ] check marathon (read `activeSessions[session_id].startTs` BEFORE deletion)
  - [ ] `delete activeSessions[session_id]`

After every XP change:

- [ ] recompute level
- [ ] recompute phase
- [ ] if new level > old level, set `pendingLevelUp = true`
- [ ] if level 100, check centurion

**Tests**:

- [ ] hook exits 0 with invalid JSON
- [ ] hook exits 0 with unknown event
- [ ] hook never writes stdout
- [ ] XP increments per event
- [ ] active session keyed by `session_id`
- [ ] concurrent hooks (different session_ids) do not corrupt state
- [ ] benchmark target: normal mutation under 50ms

---

# 6. Claude settings integration

- [ ] Create `src/settings/claude-config.ts`.
- [ ] Implement:
  - [ ] `readClaudeSettings()`
  - [ ] `writeClaudeSettingsWithBackup()`
  - [ ] `buildPetforgeHookConfig()`
  - [ ] `mergeHookConfig(existing, petforge)`
  - [ ] `detectExistingPetforgeHooks()`
  - [ ] `detectOutdatedPetforgeHooks()`
- [ ] Preserve all existing user hooks.
- [ ] Preserve unknown fields.
- [ ] Preserve formatting best-effort with 2-space JSON.
- [ ] Create backup:
  - [ ] `settings.json.bak`
  - [ ] if exists, use timestamped backup
- [ ] Do not write automatically unless user confirms.

## `petforge init`

- [ ] Create `src/commands/init.ts`.
- [ ] If `~/.claude/settings.json` missing:
  - [ ] create parent dir
  - [ ] create new settings file after confirmation
- [ ] If hooks already configured and unchanged:
  - [ ] print success and exit
- [ ] If hooks outdated:
  - [ ] show diff summary
  - [ ] prompt update
- [ ] If settings invalid JSON:
  - [ ] fail safely
  - [ ] do not overwrite
  - [ ] tell user path to fix

**Tests**:

- [ ] empty settings file
- [ ] existing unrelated hooks preserved
- [ ] existing PetForge hooks not duplicated
- [ ] outdated PetForge hooks updated
- [ ] invalid JSON does not write
- [ ] backup created before mutation

---

# 7. CLI routing and commands

- [ ] Create `src/index.ts`.
- [ ] Add shebang:

```ts
#!/usr/bin/env node
```

- [ ] Implement route table:
  - [ ] default
  - [ ] init
  - [ ] hook
  - [ ] card
  - [ ] watch
  - [ ] buddy
  - [ ] doctor
  - [ ] help
  - [ ] version

## `petforge doctor`

- [ ] Check Node >= 20.
- [ ] Check `~/.petforge/state.json`.
- [ ] Check state schema valid.
- [ ] Check `~/.claude/settings.json`.
- [ ] Check PetForge hooks registered.
- [ ] Check `claude` CLI on PATH.
- [ ] Check optional `claude /buddy card` with timeout.
- [ ] Print checklist.
- [ ] Exit 0 if critical checks pass.
- [ ] Exit 1 if critical checks fail.
- [ ] Buddy failure is warning, not critical.

## `petforge buddy`

- [ ] No arg: print current state.
- [ ] `on`: force runtime Buddy visual if available.
- [ ] `off`: always use PetForge visual.
- [ ] `auto`: detect and use if available.
- [ ] Persist toggle.

---

# 8. Rendering system

Ink is a good fit because it gives a React-style component model for terminal apps.

## 8.1 ASCII assets

- [ ] Create `src/render/species/`.
- [ ] Add 5 species.
- [ ] Add 5 phase variants per species.
- [ ] Keep assets original.
- [ ] No Claude/Buddy names or copied visuals.

Suggested minimal V1 asset structure:

```
species/
  pixel.ts
  glitch.ts
  daemon.ts
  spark.ts
  blob.ts
```

Each exports:

```ts
export const pixelFrames = {
  hatchling: [...],
  junior: [...],
  adult: [...],
  elder: [...],
  mythic: [...],
};
```

## 8.2 Effects

- [ ] Create `src/render/effects.ts`.
- [ ] Implement:
  - [ ] rarity tint
  - [ ] shiny cycle
  - [ ] junior halo
  - [ ] elder shimmer
  - [ ] mythic crown + pulse
- [ ] Effects must work on PetForge ASCII and Buddy stdout visual.

## 8.3 Components

- [ ] `PetRenderer`
- [ ] `XpBar`
- [ ] `StatBar`
- [ ] `AchievementGrid`
- [ ] `CardView`
- [ ] `SnapshotView`
- [ ] `WatchView`
- [ ] `CinematicLevelUp`
- [ ] `CinematicAchievement`

## 8.4 Commands

- [ ] `petforge`
  - [ ] if TTY: play pending cinematics, 16 idle frames, final snapshot
  - [ ] if non-TTY: static snapshot only
- [ ] `petforge card`
  - [ ] full status
- [ ] `petforge watch`
  - [ ] persistent 8 FPS
  - [ ] Ctrl+C exits cleanly

**Tests**:

- [ ] snapshot rendering does not throw
- [ ] non-TTY mode does not animate
- [ ] pending level-up flag clears after cinematic
- [ ] pending achievements clear after cinematic
- [ ] card includes all key fields

---

# 9. Buddy runtime detection

- [ ] Create `src/core/buddy.ts`.
- [ ] Implement:
  - [ ] `isClaudeOnPath()`
  - [ ] `detectBuddy(timeoutMs = 750)`
  - [ ] `getBuddyCardOutput(timeoutMs = 750)`
- [ ] Cache only:
  - [ ] detected boolean
  - [ ] lastChecked timestamp
- [ ] Never persist Buddy ASCII.
- [ ] Never parse internal Claude files.
- [ ] Never fail display if Buddy errors.
- [ ] If `buddy.userToggle === "off"`, skip detection.
- [ ] If `auto`, refresh detection max once per 24h unless `doctor`.

**Tests**:

- [ ] missing `claude` returns detected false
- [ ] timeout returns detected false
- [ ] stdout visual is passed through at render time only
- [ ] no Buddy ASCII written to state

---

# 10. Release hardening

- [ ] Add README:
  - [ ] tagline
  - [ ] install
  - [ ] init
  - [ ] hook explanation
  - [ ] commands
  - [ ] privacy / zero telemetry
  - [ ] legal note: no Anthropic files copied or redistributed
  - [ ] troubleshooting
- [ ] Add Apache 2.0 LICENSE.
- [ ] Add `CHANGELOG.md`.
- [ ] Add `.npmignore` or package `files` allowlist.
- [ ] Run `npm pack --dry-run`.
- [ ] Test global install locally:

```bash
npm pack
npm i -g ./mindvisionstudio-petforge-*.tgz
petforge doctor
```

- [ ] Manual QA:
  - [ ] Windows WSL
  - [ ] native Windows PowerShell
  - [ ] macOS
  - [ ] Linux
- [ ] Record GIF:
  - [ ] install
  - [ ] init
  - [ ] first prompt
  - [ ] first achievement
  - [ ] card display
- [ ] Publish:

```bash
npm publish --access public
```

---

# Suggested implementation order

1. **Core first**: schema, paths, state, pet engine, XP.
2. **Hook engine second**: silent mutation, counters, achievements.
3. **Config third**: `init` and `doctor`.
4. **Rendering fourth**: default/card/watch.
5. **Buddy optional last**: runtime detection only.
6. **Release polish**: README, GIF, npm publish.

This order avoids wasting time on visuals before the local state and hook pipeline are solid.

---

# Definition of Done V1.0

- [ ] `npm run test` green.
- [ ] `npm run check` green.
- [ ] `npm run build` green.
- [ ] `petforge init` patches Claude settings idempotently.
- [ ] Hooks mutate state silently.
- [ ] No stdout pollution from hook command.
- [ ] `petforge card` shows pet, XP, level, phase, stats, achievements.
- [ ] `petforge watch` animates.
- [ ] `petforge doctor` returns green on at least one dev machine.
- [ ] Buddy failure never breaks PetForge.
- [ ] No Anthropic assets persisted or redistributed.
- [ ] npm package published as `@mindvisionstudio/petforge`.

---

## References

- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks)
- [Claude Code Hooks Guide (stdout context injection)](https://code.claude.com/docs/en/hooks-guide)
- [proper-lockfile](https://github.com/moxystudio/node-proper-lockfile)
- [Ink (React for CLIs)](https://github.com/vadimdemedes/ink)
