# PetForge V3.4 — Achievement Organization

**Date:** 2026-05-02
**Status:** Spec validated, awaiting plan.
**Predecessors:**
- V3.3 ([2026-05-02-petforge-v3-3-visual-restructure-design](2026-05-02-petforge-v3-3-visual-restructure-design.md)) — 4-card visual restructure with derived header.
- V3.2 ([2026-05-02-petforge-v3-2-medal-achievements-design](2026-05-02-petforge-v3-2-medal-achievements-design.md)) — 46-achievement registry with medal tiers.

V3.4 reorganizes the ACHIEVEMENTS card into 7 collapsible categories + a virtual "Near completion" group, adds a NEXT GOALS card showing top-5 in-progress achievements, replaces the V3.2 ✓/· marks with a 3-state status convention (✅ ◐ ○), and adds inline mini progress bars on in-progress achievements.

## Goal

Transform the V3.3 flat 46-entry achievement list into an organized, scannable RPG-progression view that surfaces "what can I unlock next" without requiring the user to scroll the full list. Make the difference between completed / in-progress / locked instantly visible at a glance.

## Non-goals

- No state schema bump (still `schemaVersion: 2`).
- No new persisted state field. All organization is derived client-side.
- No filter tabs (`[All]` / `[Completed]` / `[In Progress]` / `[Near]`) — Next Goals + 7 categories cover the use case. Tabs are deferred to V3.5+ if the list becomes unmanageable.
- No localStorage persistence for category open/closed state. Every page load resets to default (Evolution + Near completion open if non-empty, others closed).
- No Ink TUI changes — `petforge card` / `petforge watch` continue to use the V3.2 AchievementGrid layout.

## Architecture

V3.4 touches a single file: `src/render/web/page.ts`. Changes are restricted to:

- The HTML template literal — adds a NEXT GOALS card placeholder and reorganizes the ACHIEVEMENTS card root from a flat `<div id="achievements">` into a category-grouped structure (the inner DOM is built by CLIENT_JS each render — the HTML keeps just the empty container).
- The CSS template literal — adds `.cat-details`, `.cat-summary`, `.cat-name`, `.cat-counts`, `.caret`, `.ach-status`, `.ach-mini-bar`, `.goals-card` rules.
- The CLIENT_JS template literal — adds `categorize(id)`, `getStatus(id, state)`, `nextGoals(state)`, `nearCompletion(state)` helpers; rewrites the achievement rendering loop in `renderState` to emit grouped categories + Next Goals + Near completion blocks.

No core logic, no schema, no migration, no Ink renderer changes. The 313 existing tests should continue to pass; render-test assertions that match V3.2's `✓` / `·` literals or the flat list HTML may need a minimal update.

## Layout (final order)

```
[ PET CARD ]                            (V3.3, unchanged)
[ CURRENT RUN ]                         (V3.3, unchanged)
[ STATS ]                               (V3.3, unchanged)
[ NEXT GOALS ]                          (NEW V3.4 - skip render if empty)
  ◐ 🥈 Streak · 7 Days            57%
  █████████░░░░░░░ (mini bar)
  ◐ 🥇 Tool · 100K               44%
  ...up to 5 in-progress

[ ACHIEVEMENTS ]                        (restructured V3.4)
  ▾ Evolution                ✅ 4/6
    ✅ Hatch · Egg
    ✅ Hatch · Hatchling
    ✅ Hatch · Junior
    ◐ Hatch · Adult                 56%
    ████░░░ (mini bar)
    ○ Hatch · Elder                  0%
    ...
  ▾ Near completion          ◐ 3
    (top 5 in-progress with ratio >= 0.7, sorted desc)
  ▸ Streak                   ✅ 1/4
  ▸ Activity                 ✅ 4/9
  ▸ Time                     ✅ 4/6
  ▸ Coding                   ○ 0/9
  ▸ Economy                  ○ 0/6
  ▸ Collaboration            ○ 0/6
```

The `▾` / `▸` carets are part of the category summary and indicate open/closed state.

## Helpers (CLIENT_JS, pure functions)

### `categorize(id)`

Maps an achievement ID to one of 7 canonical categories via prefix detection:

```js
function categorize(id) {
  if (id.indexOf("hatch_") === 0) return "Evolution";
  if (id.indexOf("streak_") === 0) return "Streak";
  if (id.indexOf("tool_") === 0 || id.indexOf("refactor_") === 0 || id.indexOf("polyglot_") === 0) return "Activity";
  if (id.indexOf("marathon_") === 0 || id.indexOf("night_") === 0) return "Time";
  if (id.indexOf("code_") === 0 || id.indexOf("token_") === 0 || id.indexOf("cache_") === 0) return "Coding";
  if (id.indexOf("frugal_") === 0 || id.indexOf("big_spender_") === 0) return "Economy";
  if (id.indexOf("pr_") === 0 || id.indexOf("picky_") === 0) return "Collaboration";
  return "Other"; // defensive — unreachable for the V3.2 registry
}
```

7 categories, total entries: 6 (Evolution) + 4 (Streak) + 9 (Activity) + 6 (Time) + 9 (Coding) + 6 (Economy) + 6 (Collaboration) = **46**, matching the V3.2 registry exactly.

### `getStatus(id, state)`

Returns one of three states based on unlock + progress ratio:

```js
function getStatus(id, state) {
  if (state.achievements.unlocked.indexOf(id) !== -1) return "completed";
  var p = achievementProgress(id, state); // existing V3.2 helper
  if (p.target > 0 && p.current > 0 && p.current < p.target) return "in-progress";
  return "locked";
}

var STATUS_SYMBOL = { completed: "✅", "in-progress": "◐", locked: "○" };
//                                  ✅                  ◐                       ○
```

The exact code points are stored in escape form in the source to survive the TS template-literal layer; the rendered output is the standard emoji.

### `nextGoals(state)`

Returns up to 5 in-progress achievements, ordered with `ratio >= 0.5` first (preferred), then `ratio < 0.5` (fallback). The merge strategy guarantees that if no preferred are present, the top 5 of fallback fill the slots — never an empty Next Goals when in-progress items exist.

```js
function nextGoals(state) {
  var inProgress = ACHIEVEMENT_IDS
    .filter(function (id) { return getStatus(id, state) === "in-progress"; })
    .map(function (id) {
      var p = achievementProgress(id, state);
      return { id: id, ratio: p.target > 0 ? p.current / p.target : 0 };
    });

  var byRatioDesc = function (a, b) { return b.ratio - a.ratio; };
  var preferred = inProgress.filter(function (a) { return a.ratio >= 0.5; }).sort(byRatioDesc);
  var fallback = inProgress.filter(function (a) { return a.ratio < 0.5; }).sort(byRatioDesc);

  return preferred.concat(fallback).slice(0, 5);
}
```

If `inProgress` is empty, `nextGoals(state)` returns `[]` and the calling render code SKIPS the Next Goals card (does not render the block at all — no `display: none`).

### `nearCompletion(state)`

Returns up to 5 in-progress achievements with `ratio >= 0.7`, sorted descending. If none qualify, returns `[]` and the calling code skips the Near completion details (does not render at all).

```js
function nearCompletion(state) {
  var ids = ACHIEVEMENT_IDS;
  var rows = ids
    .filter(function (id) { return getStatus(id, state) === "in-progress"; })
    .map(function (id) {
      var p = achievementProgress(id, state);
      return { id: id, ratio: p.target > 0 ? p.current / p.target : 0 };
    })
    .filter(function (a) { return a.ratio >= 0.7; })
    .sort(function (a, b) { return b.ratio - a.ratio; });
  return rows.slice(0, 5);
}
```

## Achievement summary line — three states

The summary line format is `[status] [medal] [name] [pct]`. Visibility of pct + mini bar depends on status:

| Status | Status symbol | Medal emoji | Name | Pct shown? | Mini bar shown? |
|---|---|---|---|---|---|
| `completed` | ✅ | yes (if applicable) | yes | **NO** (status carries the info) | NO |
| `in-progress` | ◐ | yes (if applicable) | yes | YES (right-aligned %) | **YES** (thin bar below summary) |
| `locked` | ○ | yes (if applicable) | yes | YES (`0%` or partial — partial may exist if user is at 1 of 5 ext, etc.) | NO |

Hatch ladder achievements have no medal — render a 1.5em-wide gap so the name column stays aligned.

Mini bar is a thin (`height: 0.25rem`) bar element that lives inside the `<details>` summary row, on its own visual row below the status/medal/name/pct line. Hidden via CSS for non-in-progress states.

## Render flow (renderState)

Pseudocode for the new achievement-rendering section:

```js
// 1. Build NEXT GOALS card (or skip).
var ng = nextGoals(s);
if (ng.length > 0) {
  // Render <section class="card goals-card"> with up to 5 in-progress
  // achievements (full summary lines, mini bars, expandable details).
  // The card includes a "Next Goals" .card-label header.
  renderGoalsCard(ng, s);
} else {
  // No DOM emitted for goals-card. Pure absence.
  clearGoalsCard();
}

// 2. Build ACHIEVEMENTS card with categories.
var byCategory = groupByCategory(ACHIEVEMENT_IDS); // { Evolution: [...], Streak: [...], ... }

// Order categories canonically (matches the spec layout).
var CATEGORY_ORDER = ["Evolution", "Streak", "Activity", "Time", "Coding", "Economy", "Collaboration"];

var html = "";

// 2a. Near completion virtual category (only if non-empty).
var nc = nearCompletion(s);
if (nc.length > 0) {
  html += renderCategoryDetails("Near completion", nc.map(function (a) { return a.id; }), s, /*open*/ true, /*virtual*/ true);
}

// 2b. The 7 real categories.
for (var i = 0; i < CATEGORY_ORDER.length; i++) {
  var name = CATEGORY_ORDER[i];
  var ids = byCategory[name] || [];
  var isOpen = name === "Evolution"; // only Evolution open by default
  html += renderCategoryDetails(name, ids, s, isOpen, /*virtual*/ false);
}
byId("achievements").innerHTML = html;
```

`renderCategoryDetails(name, ids, state, isOpen, virtual)` returns a `<details>` block:
- `<summary class="cat-summary">` with caret + name + counts (or count-only marker for virtual).
- Body: each id rendered via the existing per-achievement HTML emitter (status symbol + medal + name + pct + mini bar + `<details>` for description).

For the real categories, counts are `{unlockedInCat}/{totalInCat}` with a status symbol prefix (✅ if any unlocked, ◐ if any in-progress, ○ if all locked).

For the Near completion virtual category, the summary just shows `◐ {n}` (count of items).

## CSS additions

```css
/* Category groups */
.cat-details { margin: 0.5rem 0; }
.cat-summary {
  display: grid;
  grid-template-columns: 1em 1fr auto;
  gap: 0.5rem;
  cursor: pointer;
  list-style: none;
  padding: 0.4rem 0.5rem;
  background: #161b22;
  border-radius: 4px;
  user-select: none;
  align-items: center;
}
.cat-summary::-webkit-details-marker { display: none; }
.cat-summary::marker { content: ''; }
.cat-summary .caret { color: #6e7681; font-size: 0.8rem; }
.cat-summary .cat-name {
  color: #e6edf3;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-size: 0.8rem;
}
.cat-summary .cat-counts {
  color: #8b949e;
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
}
.cat-body {
  padding: 0.25rem 0.5rem 0.25rem 1.5rem;
}

/* Achievement summary status cell */
.ach-summary {
  /* V3.2 was display: flex; V3.4 keeps flex but adds a status cell as the
     first child; the medal cell stays after. */
}
.ach-status {
  width: 1.2em;
  flex-shrink: 0;
  font-size: 0.95rem;
  color: #8b949e;
}
.ach.completed .ach-status,
.ach[data-status="completed"] .ach-status { color: #3fb950; }
.ach.in-progress .ach-status,
.ach[data-status="in-progress"] .ach-status { color: #58a6ff; }
.ach.locked .ach-status,
.ach[data-status="locked"] .ach-status { color: #6e7681; }

/* Hide pct for completed (status symbol carries the info) */
.ach[data-status="completed"] .ach-pct { visibility: hidden; }

/* Mini bar (in-progress only) */
.ach-mini-bar {
  margin: 0.2rem 0 0;
  background: #21262d;
  height: 0.25rem;
  border-radius: 2px;
  overflow: hidden;
  display: none;
}
.ach[data-status="in-progress"] .ach-mini-bar { display: block; }
.ach-mini-bar-fill {
  background: #58a6ff;
  height: 100%;
  transition: width 0.4s;
}
.ach[data-status="in-progress"].medal-bronze .ach-mini-bar-fill { background: #cd7f32; }
.ach[data-status="in-progress"].medal-silver .ach-mini-bar-fill { background: #c9d1d9; }
.ach[data-status="in-progress"].medal-gold .ach-mini-bar-fill { background: #ffd700; }
.ach[data-status="in-progress"].medal-platinum .ach-mini-bar-fill { background: #79c0ff; }

/* Goals card */
.goals-card { /* inherits from .card */ }
.goals-card .ach-summary { padding: 0.4rem 0.25rem; }
```

The `.ach-summary` flex children get a new first child (`<span class="ach-status">`) holding the status symbol. The existing V3.2 children (`.ach-mark`, `.ach-medal`, `.ach-name`, `.ach-pct`) stay; `.ach-mark` is REMOVED in V3.4 since the status symbol replaces it.

## DOM structure per achievement (V3.4)

```html
<details class="ach medal-silver in-progress" data-status="in-progress">
  <summary class="ach-summary">
    <span class="ach-status">◐</span>
    <span class="ach-medal">🥈</span>
    <span class="ach-name">Streak · 7 Days</span>
    <span class="ach-pct">57%</span>
    <div class="ach-mini-bar"><div class="ach-mini-bar-fill" style="width: 57%"></div></div>
  </summary>
  <div class="ach-detail">
    <p class="ach-desc">Use Claude Code on 7 consecutive days.</p>
    <div class="ach-bar-track"><div class="ach-bar-fill" style="width: 57%"></div></div>
    <p class="ach-progress-label">4 / 7</p>
  </div>
</details>
```

Three things to note:

- The `data-status` attribute drives CSS rules (mini bar visibility, pct visibility for completed).
- The `.ach-mini-bar` lives INSIDE the `<summary>` so it's visible when the details is closed.
- The full-width `.ach-bar-track` inside `.ach-detail` is the V3.2 expanded bar — kept as-is for the open state.

## Tests

### Existing tests to potentially adjust

- `tests/render.test.ts` — any assertion on the V3.2 marks `✓` / `·` needs updating to V3.4 status symbols `✅` / `◐` / `○`. Existing assertions on family names (`/HATCH/`, `/STREAK/`) keep working.

### New helper tests (recommended, not blocking)

A new file `tests/web-page-v34-helpers.test.ts` (since the helpers live inline in CLIENT_JS, the test would need a small extraction step OR use `eval` of the inlined string — defer to the implementation plan). Suggested coverage:

```ts
describe("categorize", () => {
  it("maps each V3.2 ID to a known category");
  it("Evolution captures all 6 hatch IDs");
  it("Activity captures tool/refactor/polyglot");
  it("Time captures marathon/night");
  it("Coding captures code/token/cache");
  it("Economy captures frugal/big_spender");
  it("Collaboration captures pr/picky");
  it("returns Other for unknown IDs (defensive)");
});

describe("getStatus", () => {
  it("returns completed when id is in unlocked");
  it("returns in-progress when current > 0 and current < target");
  it("returns locked when current === 0");
  it("returns locked when target is 0 (defensive)");
});

describe("nextGoals", () => {
  it("returns at most 5 entries");
  it("preferred (ratio >= 0.5) come first, sorted desc");
  it("fallback (ratio < 0.5) come after preferred, sorted desc");
  it("returns [] when no in-progress achievements");
});

describe("nearCompletion", () => {
  it("filters to ratio >= 0.7");
  it("returns at most 5");
  it("sorted by ratio desc");
  it("returns [] when none qualify");
});
```

## File changes summary

### Modified
- `src/render/web/page.ts` — HTML adds a `<section class="card goals-card">` placeholder (kept empty server-side; renderState fills or clears it). CSS adds category + status + mini-bar rules. CLIENT_JS adds 4 helpers + rewrites the achievement rendering loop.

### Created (optional)
- `tests/web-page-v34-helpers.test.ts` — only if extracting helpers to a testable module is feasible. Otherwise skip.

### Unchanged
- All core files (`schema.ts`, `achievements.ts`, `state.ts`, `pet-engine.ts`, OTel files, hook handler, migrations, Ink renderers).
- V3.3 cards (PET / CURRENT RUN / STATS) remain visually identical.
- V3.2 achievement registry, medal logic, and migration code untouched.

## Acceptance criteria

1. Achievements render in 7 collapsible categories (Evolution / Streak / Activity / Time / Coding / Economy / Collaboration) plus a virtual "Near completion" group when any in-progress achievement has ratio >= 0.7.
2. Evolution opens by default; Near completion opens by default when present (skipped from DOM entirely when empty); the 6 other categories are closed by default.
3. NEXT GOALS card sits between STATS and ACHIEVEMENTS, contains up to 5 entries (preferred ratio >= 0.5 first, fallback < 0.5 after, merged then sliced to 5). Card not rendered at all when no in-progress achievements exist.
4. Each achievement summary shows status symbol (✅ ◐ ○) replacing V3.2's ✓ / ·, followed by the medal emoji (where present), name, and pct.
5. Pct visible for in-progress and locked; HIDDEN for completed (the ✅ already conveys it).
6. Mini progress bar (thin, 0.25rem high) visible under the summary line FOR IN-PROGRESS ONLY. Locked items show pct without bar; completed items show neither.
7. All 313 V3.2/V3.3 tests still pass after V3.4. Render assertions on V3.2 marks updated to V3.4 status symbols where they exist.
8. `petforge --version` reports `3.4.0`.

## Risks

- Render-test coupling to V3.2 mark literals — if any test asserts on `✓` or `·` literally, it must be updated. Mitigation: grep for those characters in `tests/render.test.ts` during the implementation plan.
- Mini-bar inside `<summary>`: native `<details>` semantics treat the `<summary>` as a click target. Putting a `<div>` inside the summary may cause click events to behave inconsistently across browsers. Mitigation: the mini bar is purely visual (no pointer events); CSS `pointer-events: none` on `.ach-mini-bar` prevents any click-handling weirdness.
- Categorization assumes V3.2 ID prefixes. If a future achievement uses a non-prefix-matching ID, it falls into "Other" and would need explicit handling. Mitigation: the optional `categorize` test asserts every V3.2 ID resolves to a known category.

## Out of scope (V3.5+ candidates)

- Filter tabs (`[All]` / `[Completed]` / `[In Progress]` / `[Near]`) — only if list management becomes painful at >100 achievements.
- Persisted category open/closed state across sessions (localStorage).
- Achievement timestamps (when unlocked) for a real "Recent" category.
- Achievement-related cinematics or animations.
- Ink TUI mirroring of the V3.4 web layout (currently the AchievementGrid is flat).
