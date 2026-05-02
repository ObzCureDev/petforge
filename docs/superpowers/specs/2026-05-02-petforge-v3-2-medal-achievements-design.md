# PetForge V3.2 — Medal Achievements + Hatch Phase Ladder

**Date:** 2026-05-02
**Status:** Spec validated, awaiting plan.
**Predecessor:** V3.1 ([2026-05-02-petforge-v3-buddy-alignment-plan](../plans/2026-05-02-petforge-v3-buddy-alignment-plan.md)) — V3.1 introduced the V3 schema, 18-species roster, buddy-aligned stats, tiered streak/tool/night/marathon families, and PWA. V3.2 layers medal labels on top.

## Goal

Reorganize the achievement registry so that:

1. The `hatch` achievement becomes a **6-milestone phase ladder** matching the pet phase enum (egg, hatchling, junior, adult, elder, mythic). Replaces both the current single `hatch` and `centurion` (centurion folds into `hatch_mythic`).
2. Every other family of achievements gets a **bronze / silver / gold ladder** (with `streak` getting a 4th `platinum` tier for the existing 100-day mark).
3. Each achievement carries a `medal` field used purely for UI rendering (color, icon). Achievement IDs stay semantic (`streak_3d`, `tool_5k`, etc.) so they remain grep-able and migration-stable.

The existing user state migrates losslessly: every previously-unlocked achievement maps to a renamed-but-equivalent achievement ID, preserving XP and ordering.

## Architecture

### Achievement schema extension

The `AchievementDef` interface in `src/core/achievements.ts` gains one optional field:

```ts
export type Medal = "bronze" | "silver" | "gold" | "platinum";

export interface AchievementDef {
  id: AchievementId;
  name: string;
  xp: number;
  description: string;
  /**
   * Optional medal label, used by the UI for color/icon. Absent on
   * non-tiered achievements (e.g. the `hatch_*` phase ladder, where the
   * progression is the phase itself).
   */
  medal?: Medal;
}
```

Adding a future `"diamond"` tier is a one-line type change + new entries — no state migration needed.

### Hatch phase ladder (no medal)

Six achievements, each fires when the user enters the corresponding phase. The condition reads `state.progress.phase` (computed by `phaseForLevel(level)`) so the triggers stay aligned with the pet engine's phase boundaries (level 1 / 5 / 20 / 50 / 80 / 100).

| ID | Trigger | XP | Description |
|---|---|---|---|
| `hatch_egg` | level >= 1 | 50 | Spawn your pet — your first hook fired. |
| `hatch_hatchling` | level >= 5 | 500 | Your pet hatches out of the egg phase. |
| `hatch_junior` | level >= 20 | 2,000 | Your pet matures into junior. |
| `hatch_adult` | level >= 50 | 5,000 | Your pet reaches adult. |
| `hatch_elder` | level >= 80 | 10,000 | Your pet ages into elder. |
| `hatch_mythic` | level >= 100 | 25,000 | Your pet ascends to mythic — endgame. |

### Medal-based achievements (12 families)

XP per medal is fixed across families:

| Medal | XP |
|---|---|
| 🥉 bronze | 1,000 |
| 🥈 silver | 3,000 |
| 🥇 gold | 10,000 |
| 💎 platinum | 30,000 |

#### Family thresholds

| Family | bronze | silver | gold | platinum |
|---|---|---|---|---|
| `streak` | 3 days | 7 days | 30 days | 100 days |
| `tool` | 5,000 | 25,000 | 100,000 | — |
| `marathon` | 4h | 12h | 24h | — |
| `night` | 200 events | 1,000 | 5,000 | — |
| `polyglot` | 5 ext/session | 8 ext | 12 ext | — |
| `refactor` | 100 tools/session | 250 | 500 | — |
| `code_lines` (OTel) | 10K lines | 50K | 200K | — |
| `token` (OTel) | 1M tokens | 10M | 100M | — |
| `cache` (OTel) | 100K tokens @ 80% hit | 1M @ 80% | 10M @ 90% | — |
| `frugal` (OTel) | 100 prompts < $1 | 500 < $5 | 2,000 < $20 | — |
| `big_spender` (OTel) | $100 | $500 | $2,000 | — |
| `pr` (OTel) | 50 PRs | 200 | 500 | — |
| `picky` (OTel) | 50 rejects | 250 | 1,000 | — |

The `streak` family is the only one with a platinum tier in V3.2. Other platinum tiers can be added later without state migration.

### Final achievement count

- 6 phase milestones (hatch ladder)
- 12 families × 3 medals = 36 medal achievements
- 1 platinum (streak)

**Total: 43 achievements** (vs 24 in V3.1). `first_tool` and `centurion` are dropped; `tool_5k` (formerly `tool_whisperer`), `tool_25k` (formerly `tool_master`), `tool_100k` (formerly `tool_legend`), `streak_3d / 7d / 30d / 100d`, `night_owl` -> `night_200`, `nocturnal` -> `night_1k`, `marathon` -> `marathon_4h`, `ultra_marathon` -> `marathon_12h` are renamed to a uniform pattern.

### Naming convention

Approach C from brainstorming: semantic IDs + medal field.

- IDs encode the threshold: `streak_3d`, `tool_5k`, `marathon_4h`, `night_200`, `polyglot_5`, etc.
- The `medal` field carries the visual label.
- The full uniform pattern: `<family>_<threshold-shorthand>`. Examples:
  - days: `streak_3d`, `streak_7d`, `streak_30d`, `streak_100d`
  - thousands: `tool_5k`, `tool_25k`, `tool_100k`, `code_10k`, `code_50k`, `code_200k`
  - millions: `token_1m`, `token_10m`, `token_100m`
  - hours: `marathon_4h`, `marathon_12h`, `marathon_24h`
  - dollar amounts: `big_spender_100` ($100), `big_spender_500` ($500), `big_spender_2k` ($2,000) — IDs use the dollar figure for readability; internally `state.counters.otel.costUsdCents` is still in cents and the threshold check is `costUsdCents >= 10000` for `big_spender_100`
  - count-based: `night_200`, `night_1k`, `night_5k`, `pr_50`, `pr_200`, `pr_500`, `picky_50`, `picky_250`, `picky_1k`
  - per-session families: `polyglot_5`, `polyglot_8`, `polyglot_12`, `refactor_100`, `refactor_250`, `refactor_500`
  - cache (special): `cache_100k`, `cache_1m`, `cache_10m` (volume-driven; 80%/90% ratio is a side-condition)
  - frugal (special): `frugal_100p`, `frugal_500p`, `frugal_2kp` (prompt count is the spine; spend ceiling is a side-condition)

Implementation: the registry is the source of truth. The ID strings are stable IDs only — the schema doesn't enforce a structure on them.

### UI rendering

The medal field drives:

- **Web view (`src/render/web/page.ts`)**: each `<details class="ach">` gets an extra class `ach-bronze`/`ach-silver`/`ach-gold`/`ach-platinum`. CSS adds an icon (🥉🥈🥇💎) before the name and tints the achievement bar fill / mark color. Hatch ladder achievements get no medal class (they're rendered with phase color instead).
- **Ink TUI (`src/render/components/AchievementGrid.tsx`)**: the rendered name is prefixed with the medal emoji.
- The `ach-progress-label` and progress bar logic stay the same; only the visual treatment differs.

### Color palette

| Medal | Hex | Ink color |
|---|---|---|
| 🥉 bronze | `#cd7f32` | `yellow` (terminal-friendly approximation) |
| 🥈 silver | `#c9d1d9` | `white` |
| 🥇 gold | `#ffd700` | `yellow` |
| 💎 platinum | `#79c0ff` | `cyan` |

(Bronze and gold both map to `yellow` in Ink because `chalk` lacks a true bronze; the emoji and label disambiguate.)

## Migration

### State.json

No schema bump (still `schemaVersion: 2`). Achievement IDs are loose strings server-side, validated at the registry level — adding/renaming IDs requires only a code-side migration.

### ID mapping for existing unlocks

A small migration runs at startup (or on next hook fire after V3.2 ships) that rewrites `state.achievements.unlocked` according to a fixed mapping table. Same for `state.achievements.pendingUnlocks`. Idempotent — running twice is a no-op.

| V3.1 ID | V3.2 ID | Rationale |
|---|---|---|
| `hatch` | `hatch_hatchling` | Hatch ladder rename |
| `first_tool` | (dropped) | Covered by `tool_5k` family; XP retained |
| `marathon` | `marathon_4h` | Family rename |
| `ultra_marathon` | `marathon_12h` | Family rename |
| `night_owl` | `night_200` | Family rename + threshold bump (was 200 already in V3.1) |
| `nocturnal` | `night_1k` | Family rename |
| `streak_3d` | `streak_3d` | Unchanged |
| `streak_7d` | `streak_7d` | Unchanged |
| `streak_30d` | `streak_30d` | Unchanged |
| `streak_100d` | `streak_100d` | Unchanged |
| `polyglot` | `polyglot_5` | Family rename |
| `refactor_master` | `refactor_100` | Family rename |
| `tool_whisperer` | `tool_5k` | Family rename |
| `tool_master` | `tool_25k` | Family rename |
| `tool_legend` | `tool_100k` | Family rename |
| `centurion` | `hatch_mythic` | Folded into hatch ladder |
| `code_architect` | `code_10k` | Family rename + threshold restructure |
| `code_titan` | `code_50k` | Family rename + threshold restructure (silver instead of gold) |
| `token_whisperer_v2` | `token_1m` | Family rename |
| `cache_lord` | `cache_100k` | Family rename |
| `frugal_coder` | `frugal_100p` | Family rename |
| `big_spender` | `big_spender_100` | Family rename (`100` = $100) |
| `pr_machine` | `pr_50` | Family rename |
| `picky_reviewer` | `picky_50` | Family rename |

XP gained from now-renamed achievements is preserved (the XP was already added to `state.progress.xp` at the time of the original unlock).

### Backfill of newly-qualifying achievements

After the rename migration, the next hook event runs the standard achievement check loop, which evaluates ALL conditions. Any new achievement the user already qualifies for (e.g., `hatch_egg` for everyone with level >= 1) unlocks naturally on that next hook, with XP awarded.

The script that ships V3.2 (or a one-shot `petforge` startup hook) can also call `checkAllAchievements(state)` once after the rename pass so the user sees the updates immediately on next page refresh, without waiting for a Claude Code hook.

## File changes

### Modified

- `src/core/schema.ts` — `ACHIEVEMENT_IDS` rebuilt to the V3.2 list (43 entries).
- `src/core/achievements.ts` — `AchievementDef` adds optional `medal` field; `ACHIEVEMENTS` registry rebuilt with the new IDs/names/XP/descriptions/medals; `checkAchievementsForEvent` reorganized around the new family helpers (`checkStreaks`, `checkTools`, `checkNight`, `checkMarathon`, `checkPolyglot`, `checkRefactor`, `checkPhases`); the OTel-gated checks in `src/core/otel/achievements.ts` similarly reorganized.
- `src/core/state.ts` (or a new `src/core/migrations/v32-achievement-rename.ts`) — runs the rename map on `unlocked` and `pendingUnlocks` at read time, idempotently.
- `src/render/web/page.ts` — CSS adds `.ach.bronze` / `.silver` / `.gold` / `.platinum` rules; `achievementProgress(id, s)` switch case extended for the new IDs; `<details>` rendering inserts the medal emoji + class.
- `src/render/components/AchievementGrid.tsx` — name prefix with medal emoji.
- `tests/achievements.test.ts` — updated to the new IDs + thresholds; new tests cover the rename migration and the medal field presence.
- `tests/render.test.ts` — assertions on the new IDs.
- `README.md`, `CHANGELOG.md` — V3.2 entry.

### Created

- `src/core/migrations/v32-achievement-rename.ts` — pure function `renameV31ToV32(unlocked: string[]): string[]` plus matching `pendingUnlocks` helper. Reads from a fixed mapping constant. Tested against all 24 V3.1 IDs.
- `tests/migrations-v32-rename.test.ts` — one test per mapping row, plus an idempotence test (running twice yields the same output) and a "no V3.1 ID survives" guard.

### Deleted

None.

## Tests

### New

- `tests/migrations-v32-rename.test.ts` — 24 mapping rows + idempotence + V3.1 leak guard.
- `tests/achievements-medals.test.ts` — registry hygiene: every medal-tagged achievement has a matching entry in the medal XP table; every family in the threshold table has 3 (or 4 for streak) entries; mark/check function renders correctly.

### Updated

- `tests/achievements.test.ts` — IDs renamed throughout; new tests for `hatch_egg` / `hatch_junior` / `hatch_adult` / `hatch_elder` (`hatch_mythic` already covered by old centurion test, just renamed).
- `tests/hook.test.ts` — IDs renamed throughout; marathon test points to `marathon_4h`.
- `tests/render.test.ts` — DEBUGGING / PATIENCE assertions stay; achievement-related assertions updated to new IDs.

### Property-style tests added

- For every achievement in the registry, simulate state matching its threshold and assert it unlocks; simulate one less and assert it does not.
- For every medal value in the registry, assert XP matches the medal table.

## Out of scope (deferred)

- Additional platinum tiers for non-streak families. Architecture supports adding `tool_500k` / `marathon_72h` / etc. as platinum tier later by appending to the registry. Not in V3.2.
- Animations or cinematics on medal upgrade (`pendingUnlocks` already exists for this; not extending in V3.2).
- Achievement detail view in Ink TUI matching the web's `<details>` expansion. Web only for V3.2.
- Tier-related cosmetic effects on the pet itself (e.g., gold halo when 5+ gold achievements). Cosmetic-only, not core.

## Acceptance criteria

1. Existing user state with V3.1 IDs in `unlocked` migrates losslessly to V3.2 IDs on next read; no XP lost; `pendingUnlocks` migrated identically.
2. New users (no state) get the V3.2 set; `hatch_egg` unlocks on the first hook fire.
3. Web view shows medal emojis (🥉🥈🥇💎) before the achievement name and tints the progress bar / mark by medal color.
4. Ink TUI (`petforge card`, `petforge watch`) shows medal emoji prefix.
5. All 301+ existing tests pass (with renamed assertions); new migration + medal tests pass.
6. `petforge --version` reports `3.2.0`; CHANGELOG entry summarizes the medal restructure.
