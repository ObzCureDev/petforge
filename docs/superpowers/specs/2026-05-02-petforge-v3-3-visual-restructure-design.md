# PetForge V3.3 — Visual Restructure

**Date:** 2026-05-02
**Status:** Spec validated, awaiting plan.
**Predecessor:** V3.2 ([2026-05-02-petforge-v3-2-medal-achievements-design](2026-05-02-petforge-v3-2-medal-achievements-design.md)) — V3.2 introduced the 46-achievement registry with medal tiers + the V3.1 -> V3.2 ID rename. V3.3 is a pure UI overhaul on top.
**Deferred to V3.4** (out of this spec): collapsible achievement categories, Next Goals filter, status symbols, mini progress bars per achievement.

## Goal

Restructure the served web view (`petforge serve`) into clearly separated visual cards with stronger hierarchy, reorganized stat formatting, and a richer header that surfaces mood / trait / next-evolution information derived from existing state. The current view is a long uniform stream that lacks visual hierarchy; V3.3 makes the screen scannable in one glance on mobile while staying within the terminal-aesthetic vocabulary.

Out of scope (deferred to V3.4): achievement categories collapsible by family group, Next Goals filter (top 5 in-progress achievements), status-symbol convention, mini progress bars per achievement.

## Non-goals

- No state schema bump (still `schemaVersion: 2`).
- No new persisted state field (`mood` and `trait` are pure derivations).
- No Ink TUI changes — `petforge card` / `petforge watch` stay as-is.
- No achievement re-grouping (deferred to V3.4).

## Architecture

V3.3 touches a single file: `src/render/web/page.ts`. Changes are restricted to:

- The HTML template literal (root container of the served page) — adds `<section class="card">` wrappers.
- The `CSS` template literal — adds `.card`, `.card-label` rules and reformats `.stat` to a 3-column grid.
- The `CLIENT_JS` template literal — adds three pure derivation helpers (`computeMood`, `computeTrait`, `nextPhaseProgress`) and reorders the existing `renderState` DOM updates to populate the new card-internal nodes.

No core logic, no schema, no migration, no Ink renderer changes. The 313 existing tests should continue to pass; render-test assertions that rely on specific HTML wrappers (e.g. `<p class="header">`) may need a minimal update if the wrapper element changes.

## Layout (final order)

```
HEADER (PWA-managed, untouched)

[ PET CARD ]
  ASCII pet (centered, animated)
  HUDDLE (display name)
  Rare * Junior * Level 28
  ████████░░░░░░ 1,932 / 2,299 XP
  Mood:           Night Owl
  Trait:          Debugging Aura
  Next evolution: Adult * 56%

[ CURRENT RUN ]
  RUN  Sessions 9 * Streak 3d * Prompts 109 * Tools 2,194
  DEV  +8,951 / -579 lines * 651.1K tokens * $39.54 * Cache 0%

[ STATS ]
  DEBUGGING   75  ███████████░
  PATIENCE    61  █████████░░░
  CHAOS       25  ███░░░░░░░░░
  WISDOM      63  █████████░░░
  SNARK       29  ████░░░░░░░░

[ ACHIEVEMENTS ]                         (unchanged in V3.3)
  ... existing 46-entry list, one <details> each ...
```

(The `*` glyph above is a placeholder for the rendered middle dot `·` — same separator the current header already uses.)

## Components

### PET CARD

The pet card combines what V3.2 currently renders as the `<pre id="pet">` + `<p class="header">` + xpbar block, plus 3 new derivation lines.

#### Display

- ASCII pet (`<pre id="pet">`) — unchanged from V3.2 (animated frames, centered via `text-align: center`).
- Display name on its own line — `buddy.name || species.toUpperCase()`.
- Sub-line `Rarity * Phase * Level N` (use the V3.2-introduced rarity color span).
- XP bar + label (existing, format `LVL X - into / total XP`).
- Three derived rows: Mood, Trait, Next evolution. Each is a 2-column row with a label on the left (8em fixed width, muted color) and the value on the right (default text color).

#### Derivations

```ts
// Implemented client-side inside CLIENT_JS as plain JS (the page is a
// hand-written template literal, not a transpiled module).

function activeSessionCount(state) {
  return Object.keys(state.counters.activeSessions ?? {}).length;
}

function computeMood(state, nowMs) {
  const active = activeSessionCount(state);
  const hour = new Date(nowMs).getHours();
  const isNightHour = hour >= 22 || hour < 2;

  // Order matters: Night Owl > Coding > Resting > Focused.
  if (active > 0 && isNightHour) return "Night Owl";
  if (active > 0) return "Coding";

  // Resting: explicitly require no active session AND a recent activity day.
  // Even though the priority order makes the active==0 part implicit, the
  // explicit check guards against future helper reuse outside this order.
  const lastActive = state.counters.lastActiveDate; // YYYY-MM-DD
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const yesterday = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const recent = lastActive === today || lastActive === yesterday;
  if (active === 0 && state.counters.streakDays > 0 && recent) return "Resting";

  return "Focused";
}

const STAT_ORDER = ["debugging", "patience", "chaos", "wisdom", "snark"];

function computeTrait(pet) {
  // Top stat by value. Tie-break by canonical STAT_ORDER (NOT alphabetical),
  // so Chaos doesn't unfairly dominate ties.
  let topName = STAT_ORDER[0];
  let topValue = pet.stats[topName] ?? 0;
  for (const name of STAT_ORDER) {
    const v = pet.stats[name] ?? 0;
    if (v > topValue) {
      topName = name;
      topValue = v;
    }
  }
  const display = topName.charAt(0).toUpperCase() + topName.slice(1);
  return display + " Aura";
}

const PHASE_BOUNDARIES = [
  { phase: "egg", level: 1 },
  { phase: "hatchling", level: 5 },
  { phase: "junior", level: 20 },
  { phase: "adult", level: 50 },
  { phase: "elder", level: 80 },
  { phase: "mythic", level: 100 },
];

function nextPhaseProgress(level) {
  // At max phase, return a static MAX state.
  if (level >= 100) return { nextPhase: null, percent: 100, label: "MAX - ascended" };

  // Find current and next boundary.
  let current = PHASE_BOUNDARIES[0];
  let next = PHASE_BOUNDARIES[1];
  for (let i = 0; i < PHASE_BOUNDARIES.length - 1; i++) {
    if (level >= PHASE_BOUNDARIES[i].level && level < PHASE_BOUNDARIES[i + 1].level) {
      current = PHASE_BOUNDARIES[i];
      next = PHASE_BOUNDARIES[i + 1];
      break;
    }
  }

  const ratio = (level - current.level) / (next.level - current.level);
  const percent = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  return { nextPhase: next.phase, percent, label: next.phase + " - " + percent + "%" };
}
```

The `*` and `-` characters in display strings are ASCII; the rendered HTML uses `&middot;` (U+00B7) for separators consistent with the rest of the page.

Header label width is 8em (fits "Mood:", "Trait:", "Next evolution:" left-aligned). Value text uses the default body color (`#e6edf3`). Label uses muted color (`#8b949e`).

### CURRENT RUN card

Two lines, each prefixed with a 4-character label (`RUN ` / `DEV `):

- `RUN` line: `Sessions {n} · Streak {d}d · Prompts {p} · Tools {t}` — always visible.
- `DEV` line: `+{added} / -{removed} lines · {tokens} tokens · ${cost} · Cache {pct}%` — visible only when `state.counters.otel?.lastUpdate > 0`. When OTel data is missing, the line is hidden (display: none) so the card just shows RUN.

Numeric formatting:
- Counts: `toLocaleString()` (commas for thousands).
- Tokens: compact form (`compact()` helper already exists in CLIENT_JS — `1,234,567` → `1.2M`).
- Cost: `$` + `(costUsdCents / 100).toFixed(2)`.
- Cache pct: `cacheRead / (tokensIn + cacheRead) * 100` rounded.

Replaces the current `<p id="activity">` + `<p id="otel-activity">` paragraphs with two structured rows inside a single card.

### STATS card

Replaces the current `<section><h2>STATS</h2><div id="stats"></div></section>` with a card-wrapped version.

The stats grid changes from `name | bar | value` to `name | value | bar`. Implementation:

```css
.stat {
  display: grid;
  grid-template-columns: 7em 2.5em 1fr;
  gap: 0.5rem;
  align-items: center;
  margin: 0.3rem 0;
}
.stat-name { color: #c9d1d9; font-size: 0.85rem; }
.stat-val { color: #c9d1d9; font-size: 0.85rem; text-align: right; }
.stat-bar {
  background: #21262d;
  height: 0.6rem;
  border-radius: 0.2rem;
  overflow: hidden;
}
.stat-bar-fill { background: #2ea043; height: 100%; transition: width 0.4s; }
```

Order in DOM: name span, value span, then the bar div. Both PetForge stats and parsed-buddy stats use the same structure.

### ACHIEVEMENTS card

Wrap the existing `<section><h2>ACHIEVEMENTS</h2><div id="achievements"></div></section>` in a `.card` div with the same `card-label` pattern as STATS / CURRENT RUN. The achievement list itself (the 46 `<details>` elements emitted by V3.2's `renderState`) is unchanged.

V3.4 will replace the flat `<details>` list with collapsible category groups + a Next Goals card above it.

## Style (cards)

```css
.card {
  border: 1px solid #21262d;
  border-radius: 6px;
  padding: 0.75rem 1rem;
  margin: 0.75rem 0;
  background: #0d1117;
}
.card-label {
  font-size: 0.7rem;
  letter-spacing: 0.15em;
  color: #6e7681;
  text-transform: uppercase;
  margin: 0 0 0.5rem;
  font-weight: 600;
}
.kv-row {
  display: grid;
  grid-template-columns: 8em 1fr;
  gap: 0.5rem;
  margin: 0.2rem 0;
  font-size: 0.9rem;
}
.kv-label { color: #8b949e; }
.kv-value { color: #e6edf3; }
```

CSS borders (`1px solid #21262d`) instead of Unicode box-drawing characters: responsive across viewport widths, no manual character-grid alignment, plays nicely with mobile rotation. Border color matches the existing `.xpbar-track` background for visual cohesion.

## Tests

### Existing render tests (potential adjustments)

- `tests/render.test.ts` — assertions on `<p class="header">` may need to follow the new structure if the test asserts on the wrapper. Most assertions use partial matchers (`toMatch(/HUDDLE/)`) which keep working. Update only the tests that explicitly assert structural HTML.

### New unit tests (recommended, not blocking)

Three pure-helper test cases for the derivations. These can live in a new `tests/web-page-helpers.test.ts` file, since they're simple JS functions defined inline in CLIENT_JS but logically pure:

```ts
describe("computeMood", () => {
  it("returns Night Owl when active session in [22h, 2h)", () => { ... });
  it("returns Coding when active session outside night hours", () => { ... });
  it("returns Resting when no active session but recent activity (within 24h)", () => { ... });
  it("returns Focused as default", () => { ... });
});

describe("computeTrait", () => {
  it("returns top stat name + Aura suffix", () => { ... });
  it("uses canonical order for tie-break (not alphabetical)", () => {
    const pet = { stats: { debugging: 50, patience: 50, chaos: 50, wisdom: 50, snark: 50 }};
    expect(computeTrait(pet)).toBe("Debugging Aura"); // first in canonical order
  });
});

describe("nextPhaseProgress", () => {
  it("returns hatchling - 0% at level 1", () => { ... });
  it("returns adult - 50% at level 35 (junior boundary 20, adult 50, ratio 15/30)", () => { ... });
  it("clamps to [0, 100] for out-of-range levels", () => {
    expect(nextPhaseProgress(-5).percent).toBe(0);
    expect(nextPhaseProgress(150).percent).toBe(100);
    expect(nextPhaseProgress(150).nextPhase).toBeNull();
  });
});
```

Adding these requires extracting the helpers from CLIENT_JS into a small testable module that the page renderer can `import` and re-embed via the existing inline-string strategy. Acceptable trade-off: 3 helpers, ~50 lines, plus a test file.

## File changes summary

### Modified
- `src/render/web/page.ts` — HTML template literal, CSS template literal, CLIENT_JS template literal. Adds card structure, derivation helpers, reformatted stats grid, RUN/DEV split footer.

### Created
- `src/render/web/page-helpers.ts` (optional, for testability) — `computeMood(state, nowMs)`, `computeTrait(pet)`, `nextPhaseProgress(level)`. Re-embedded into CLIENT_JS via the same string-injection pattern used for `LEVEL_BOUNDARIES`.
- `tests/web-page-helpers.test.ts` (optional) — unit tests for the three helpers.

### Unchanged
- All core files (`schema.ts`, `achievements.ts`, `state.ts`, `pet-engine.ts`, OTel files, hook handler, migrations, Ink renderers).

## Acceptance criteria

1. Existing user state renders without changes; no migration runs.
2. Page is laid out in 4 visual cards on mobile (375px viewport): PET CARD, CURRENT RUN, STATS, ACHIEVEMENTS — each with a labeled top header and a 1px border.
3. PET CARD shows mood / trait / next-evolution rows derived from state. Mood follows the priority order Night Owl > Coding > Resting > Focused.
4. STATS card uses the new `name | value | bar` 3-column format.
5. CURRENT RUN card shows two prefixed lines (`RUN` always, `DEV` only when OTel has data).
6. ACHIEVEMENTS card wraps the existing 46-entry V3.2 list unchanged.
7. All 313 V3.2 tests still pass. Optional new helper tests pass.
8. The Ink TUI (`petforge card` / `petforge watch`) is unchanged and visually identical to V3.2.
9. `petforge --version` reports `3.3.0`.

## Risks

- Render tests asserting on specific wrapper elements (`<p class="header">` or similar) may break and need adjustment. Mitigation: read those tests first when implementing, update assertions to match the new card structure.
- Mood derivation depends on local time of day; tests must inject `nowMs` to avoid clock-related flakiness.
- `computeTrait` returning "Patience Aura" / "Chaos Aura" / etc. is purely cosmetic; if a future version wants to gate gameplay on trait, the canonical-order tie-break should be revisited (currently chosen for stability over fairness).

## Out of scope (V3.4 candidates)

For reference — these are explicitly NOT in V3.3:

- Achievement categories collapsible (Evolution / Streak / Activity / Time / Coding / Economy / Collaboration — 7 groups).
- Next Goals filter (top 5 in-progress, prefer ratio >= 0.5, fallback to all in-progress).
- Status symbol convention (✅ / ◐ / ○).
- Mini progress bars per achievement (currently only on `<details>` open).
- Mood "+12%" numeric bonus or any gameplay tie-in.
