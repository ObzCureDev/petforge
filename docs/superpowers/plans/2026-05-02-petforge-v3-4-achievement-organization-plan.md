# PetForge V3.4 — Achievement Organization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the 46-entry V3.2 achievement list into 7 collapsible categories + virtual "Near completion" + a top-of-list "Next Goals" card. Replace V3.2's `✓` / `·` marks with a 3-state status convention (✅ ◐ ○) and add inline mini progress bars on in-progress items only.

**Architecture:** Single-file edit to `src/render/web/page.ts`. CLIENT_JS gains 4 pure helpers (`categorize`, `getStatus`, `nextGoals`, `nearCompletion`) and the achievement-rendering loop is rewritten to emit a category-grouped DOM. CSS adds `.cat-details`, `.cat-summary`, `.ach-status`, `.ach-mini-bar`, `.goals-card`. HTML adds an empty `<section class="card goals-card">` placeholder that CLIENT_JS fills or removes. No state schema bump, no migration, no new package dependencies, no Ink TUI changes.

**Tech Stack:** TypeScript strict, Vitest, Biome, ESM, Node 20+. The web view is a hand-written template literal in `src/render/web/page.ts` — what's between the backticks is what the browser executes.

**Critical escape gotcha:** Inside the CLIENT_JS template literal, every `\` consumes one level of escaping. To get a literal `\n` or `\s` into the browser's JS, write `\\n` and `\\s` in the TS source. THIS task uses ZERO regex with backslash classes — the new helpers use only `Array#filter`, `Array#sort`, `Array#concat`, `Array#slice`, `Array#map`, `String#indexOf`, plain string concatenation. Don't introduce regex while you're there.

---

## File Structure (target end-state)

### Modified
- `src/render/web/page.ts` — HTML template (1 new `<section>` placeholder), CSS template (~50 new lines), CLIENT_JS template (4 new helpers ~40 lines, achievement render rewrite ~70 lines).
- `tests/render.test.ts` — only if existing assertions match V3.2 marks `✓` / `·` literally; replace with V3.4 symbols.
- `package.json` — version `3.3.0` -> `3.4.0`.
- `README.md` — V3.4 summary line + version badge bump.
- `CHANGELOG.md` — `3.4.0` entry.

### Created
None.

### Deleted
None.

---

## Task 1: HTML — add Next Goals card placeholder

**Files:**
- Modify: `src/render/web/page.ts` (the HTML template literal returned by `renderPage` only)

- [ ] **Step 1.1: Insert the goals card between STATS and ACHIEVEMENTS**

In `src/render/web/page.ts`, locate the `<main id="app">` block. Find the end of the stats card and the start of the achievements card:

```html
  <section class="card stats-card">
    <p class="card-label">Stats</p>
    <div id="stats"></div>
  </section>
  <section class="card achievements-card">
```

Insert a new `<section>` BETWEEN the closing `</section>` of stats-card and the opening `<section class="card achievements-card">`:

```html
  <section class="card stats-card">
    <p class="card-label">Stats</p>
    <div id="stats"></div>
  </section>
  <section class="card goals-card" id="goals-card" hidden>
    <p class="card-label">Next Goals</p>
    <div id="goals"></div>
  </section>
  <section class="card achievements-card">
```

The `hidden` attribute on the goals-card section means it's invisible by default (no JS yet to populate it). Task 3's CLIENT_JS toggles `.hidden` based on whether `nextGoals(state)` is empty. If the runtime list is empty, `hidden` STAYS true and the section is collapsed by the browser (cleaner than `display: none` in CSS — closer to the "don't render the block at all" rule from the spec, since `hidden` makes the element behave as if it were absent for layout purposes).

- [ ] **Step 1.2: Verify HTML structure**

Run:

```bash
cd "C:/Users/Dan/Repo/petforge"
grep -c 'id="goals-card"' src/render/web/page.ts
grep -c 'id="goals"' src/render/web/page.ts
grep -c 'class="card goals-card"' src/render/web/page.ts
```

Expected: each prints `1`.

- [ ] **Step 1.3: Run typecheck**

Run: `npx tsc --noEmit`

Expected: clean. The HTML change is inside a template literal; TypeScript only validates the surrounding TS code.

- [ ] **Step 1.4: Commit**

```bash
git add src/render/web/page.ts
git commit -m "$(cat <<'EOF'
feat(web): V3.4 - add Next Goals card placeholder between STATS and ACHIEVEMENTS

Empty <section class="card goals-card" hidden> — Task 3 will toggle the
hidden attribute based on nextGoals(state) being non-empty and populate
the inner #goals div. The section uses the standard hidden attribute
rather than display: none so layout treats the element as absent when
empty (matching the spec rule "do not render the block at all").

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: CSS — category groups + status cell + mini bar + goals card

**Files:**
- Modify: `src/render/web/page.ts` (the `const CSS = ` template literal only)

- [ ] **Step 2.1: Add the V3.4 CSS rules**

In the `const CSS = ` template literal, append the V3.4 rules. The cleanest insertion point is just BEFORE the existing `/* rarity glows on the pet ASCII ... */` comment (so the V3.4 rules sit grouped after the V3.2 medal tints but before the rarity-tag rules). Read the file to confirm the exact insertion line.

Insert this block:

```css
  /* V3.4 - category groups */
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
  .cat-body { padding: 0.25rem 0.5rem 0.25rem 1.5rem; }

  /* V3.4 - achievement status cell (replaces V3.2 .ach-mark) */
  .ach-status {
    width: 1.2em;
    flex-shrink: 0;
    font-size: 0.95rem;
    color: #8b949e;
  }
  .ach[data-status="completed"] .ach-status { color: #3fb950; }
  .ach[data-status="in-progress"] .ach-status { color: #58a6ff; }
  .ach[data-status="locked"] .ach-status { color: #6e7681; }

  /* V3.4 - hide pct for completed (status symbol carries the info) */
  .ach[data-status="completed"] .ach-pct { visibility: hidden; }

  /* V3.4 - mini bar (in-progress only) */
  .ach-mini-bar {
    margin: 0.2rem 0 0;
    background: #21262d;
    height: 0.25rem;
    border-radius: 2px;
    overflow: hidden;
    display: none;
    pointer-events: none;
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

  /* V3.4 - goals card spacing */
  .goals-card .ach-summary { padding: 0.4rem 0.25rem; }

```

(Trailing blank line preserved so the existing rarity-glows block keeps its leading whitespace consistent.)

The `pointer-events: none` on `.ach-mini-bar` is important — the mini bar lives inside `<summary>`, and we don't want clicks on the bar to be eaten as "clicked the bar" instead of "toggled the details".

- [ ] **Step 2.2: Verify the CSS embeds**

```bash
grep -c "^  \.cat-summary {" src/render/web/page.ts
grep -c "^  \.ach-status {" src/render/web/page.ts
grep -c "^  \.ach-mini-bar {" src/render/web/page.ts
grep -c "data-status=\"completed\"" src/render/web/page.ts
grep -c "data-status=\"in-progress\"" src/render/web/page.ts
grep -c "data-status=\"locked\"" src/render/web/page.ts
grep -c "pointer-events: none" src/render/web/page.ts
```

Expected: each prints `1` for the first 3 (single rule definitions). The `data-status` lines should each return `>= 1` (used in selectors). `pointer-events: none` returns `1`.

- [ ] **Step 2.3: Run typecheck + build**

```bash
npx tsc --noEmit
npm run build 2>&1 | tail -2
```

Expected: typecheck clean, build succeeds.

- [ ] **Step 2.4: Commit**

```bash
git add src/render/web/page.ts
git commit -m "$(cat <<'EOF'
feat(web): V3.4 - CSS for category groups + status cell + mini bar

cat-details / cat-summary / cat-name / cat-counts: collapsible
category headers with 3-col grid (caret | name | counts), background
#161b22 to distinguish from achievement rows.

ach-status replaces V3.2 .ach-mark; data-status attribute on .ach
drives status color (green/blue/gray) and visibility of .ach-pct
(hidden for completed) and .ach-mini-bar (visible only for in-progress,
tinted by medal class).

ach-mini-bar uses pointer-events: none so clicks pass through to the
parent <summary> for native <details> toggle behavior.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: CLIENT_JS — helpers + render integration (the bulk of V3.4)

**Files:**
- Modify: `src/render/web/page.ts` (the `const CLIENT_JS = ` template literal only)

This task adds the 4 derivation helpers and rewrites the achievement-rendering loop in `renderState` to emit categories + Next Goals + Near completion.

- [ ] **Step 3.1: Add the 4 derivation helpers near the top of CLIENT_JS**

Locate the `const CLIENT_JS = ` template literal. Inside the IIFE, find the V3.3 helpers added previously (`STAT_ORDER`, `PHASE_BOUNDARIES`, `computeMood`, `computeTrait`, `nextPhaseProgress`). Just AFTER `function nextPhaseProgress(level) { ... }` and BEFORE the existing `function xpForLevel(level) { ... }` block, INSERT the V3.4 helpers + the canonical category order:

```js
  var CATEGORY_ORDER = ["Evolution", "Streak", "Activity", "Time", "Coding", "Economy", "Collaboration"];

  function categorize(id) {
    if (id.indexOf("hatch_") === 0) return "Evolution";
    if (id.indexOf("streak_") === 0) return "Streak";
    if (id.indexOf("tool_") === 0 || id.indexOf("refactor_") === 0 || id.indexOf("polyglot_") === 0) return "Activity";
    if (id.indexOf("marathon_") === 0 || id.indexOf("night_") === 0) return "Time";
    if (id.indexOf("code_") === 0 || id.indexOf("token_") === 0 || id.indexOf("cache_") === 0) return "Coding";
    if (id.indexOf("frugal_") === 0 || id.indexOf("big_spender_") === 0) return "Economy";
    if (id.indexOf("pr_") === 0 || id.indexOf("picky_") === 0) return "Collaboration";
    return "Other";
  }

  function getStatus(id, state) {
    if (state.achievements.unlocked.indexOf(id) !== -1) return "completed";
    var p = achievementProgress(id, state);
    if (p.target > 0 && p.current > 0 && p.current < p.target) return "in-progress";
    return "locked";
  }

  var STATUS_SYMBOL = { "completed": "✅", "in-progress": "◐", "locked": "○" };

  function ratioOf(id, state) {
    var p = achievementProgress(id, state);
    return p.target > 0 ? p.current / p.target : 0;
  }

  function nextGoals(state) {
    var inProgress = ACH_IDS
      .filter(function (id) { return getStatus(id, state) === "in-progress"; })
      .map(function (id) { return { id: id, ratio: ratioOf(id, state) }; });
    var byRatioDesc = function (a, b) { return b.ratio - a.ratio; };
    var preferred = inProgress.filter(function (a) { return a.ratio >= 0.5; }).sort(byRatioDesc);
    var fallback = inProgress.filter(function (a) { return a.ratio < 0.5; }).sort(byRatioDesc);
    return preferred.concat(fallback).slice(0, 5);
  }

  function nearCompletion(state) {
    return ACH_IDS
      .filter(function (id) { return getStatus(id, state) === "in-progress"; })
      .map(function (id) { return { id: id, ratio: ratioOf(id, state) }; })
      .filter(function (a) { return a.ratio >= 0.7; })
      .sort(function (a, b) { return b.ratio - a.ratio; })
      .slice(0, 5);
  }
```

`ACH_IDS` is the existing const defined earlier in CLIENT_JS (parsed from the `<script id="achievement-ids">` tag). `achievementProgress` is the existing V3.2 helper. Both are already in scope.

The status-symbol literals `✅`, `◐`, `○` are standard Unicode and live cleanly in a UTF-8 source file.

- [ ] **Step 3.2: Extract a per-achievement render helper**

The existing achievement loop in `renderState` builds each row via inline string concatenation. Refactor that loop body into a reusable function that we'll call from THREE places (Next Goals card, Near completion virtual category, real categories).

Find the existing achievement loop. It looks like:

```js
    var achHtml = "";
    for (var j = 0; j < ACH_IDS.length; j++) {
      var id = ACH_IDS[j];
      var def = ACH[id];
      var unlocked = s.achievements.unlocked.indexOf(id) !== -1;
      var prog = achievementProgress(id, s);
      var ratio = prog.target > 0 ? Math.min(1, prog.current / prog.target) : 0;
      var pctStr = Math.round(ratio * 100) + "%";
      var progressLabel = prog.current.toLocaleString() + " / " + prog.target.toLocaleString();
      var medal = def.medal || "";
      var medalEmoji = medal === "bronze" ? "🥉"
        : medal === "silver" ? "🥈"
        : medal === "gold" ? "🥇"
        : medal === "platinum" ? "💎"
        : "";
      var classes = "ach" + (unlocked ? " unlocked" : "") + (medal ? " medal-" + medal : "");
      achHtml += '<details class="' + classes + '">';
      achHtml += '<summary class="ach-summary">';
      achHtml += '<span class="ach-mark">' + (unlocked ? "✓" : "·") + '</span> ';
      if (medalEmoji) achHtml += '<span class="ach-medal">' + medalEmoji + '</span> ';
      achHtml += '<span class="ach-name">' + def.name + '</span>';
      achHtml += '<span class="ach-pct">' + (unlocked ? "" : pctStr) + '</span>';
      achHtml += '</summary>';
      achHtml += '<div class="ach-detail">';
      achHtml += '<p class="ach-desc">' + def.description + '</p>';
      achHtml += '<div class="ach-bar-track"><div class="ach-bar-fill" style="width:' + (ratio * 100) + '%"></div></div>';
      achHtml += '<p class="ach-progress-label">' + progressLabel + (unlocked ? " · unlocked (+" + def.xp + " xp)" : "") + '</p>';
      achHtml += '</div>';
      achHtml += '</details>';
    }
    byId("achievements").innerHTML = achHtml;
```

Replace the ENTIRE loop body (from `var achHtml = "";` through `byId("achievements").innerHTML = achHtml;`) with a refactored version that:

1. Defines `renderAchievementRow(id, state)` returning the HTML for ONE achievement (with V3.4 status / mini bar logic).
2. Renders Next Goals card (or hides it).
3. Renders the achievements card body grouped by category, with Near completion at the top when non-empty.

Insert this code in place of the old loop:

```js
    function renderAchievementRow(id, state) {
      var def = ACH[id];
      var status = getStatus(id, state); // "completed" | "in-progress" | "locked"
      var prog = achievementProgress(id, state);
      var ratio = prog.target > 0 ? Math.min(1, prog.current / prog.target) : 0;
      var pctStr = Math.round(ratio * 100) + "%";
      var progressLabel = prog.current.toLocaleString() + " / " + prog.target.toLocaleString();
      var medal = def.medal || "";
      var medalEmoji = medal === "bronze" ? "🥉"
        : medal === "silver" ? "🥈"
        : medal === "gold" ? "🥇"
        : medal === "platinum" ? "💎"
        : "";
      var classes = "ach " + status + (medal ? " medal-" + medal : "");
      var symbol = STATUS_SYMBOL[status];

      var html = '<details class="' + classes + '" data-status="' + status + '">';
      html += '<summary class="ach-summary">';
      html += '<span class="ach-status">' + symbol + '</span> ';
      if (medalEmoji) html += '<span class="ach-medal">' + medalEmoji + '</span> ';
      else html += '<span class="ach-medal" style="visibility:hidden">.</span> ';
      html += '<span class="ach-name">' + def.name + '</span>';
      html += '<span class="ach-pct">' + (status === "completed" ? "" : pctStr) + '</span>';
      html += '<div class="ach-mini-bar"><div class="ach-mini-bar-fill" style="width:' + (ratio * 100) + '%"></div></div>';
      html += '</summary>';
      html += '<div class="ach-detail">';
      html += '<p class="ach-desc">' + def.description + '</p>';
      html += '<div class="ach-bar-track"><div class="ach-bar-fill" style="width:' + (ratio * 100) + '%"></div></div>';
      html += '<p class="ach-progress-label">' + progressLabel + (status === "completed" ? " · unlocked (+" + def.xp + " xp)" : "") + '</p>';
      html += '</div>';
      html += '</details>';
      return html;
    }

    function renderCategorySection(name, ids, state, isOpen, virtualCount) {
      var unlocked = 0;
      var anyInProgress = false;
      for (var i = 0; i < ids.length; i++) {
        var st = getStatus(ids[i], state);
        if (st === "completed") unlocked++;
        else if (st === "in-progress") anyInProgress = true;
      }
      var headSym = unlocked > 0 ? STATUS_SYMBOL["completed"]
        : anyInProgress ? STATUS_SYMBOL["in-progress"]
        : STATUS_SYMBOL["locked"];
      var counts = virtualCount !== undefined
        ? (headSym + " " + virtualCount)
        : (headSym + " " + unlocked + "/" + ids.length);

      var html = '<details class="cat-details"' + (isOpen ? ' open' : '') + '>';
      html += '<summary class="cat-summary">';
      html += '<span class="caret">' + (isOpen ? '▾' : '▸') + '</span>';
      html += '<span class="cat-name">' + name + '</span>';
      html += '<span class="cat-counts">' + counts + '</span>';
      html += '</summary>';
      html += '<div class="cat-body">';
      for (var j = 0; j < ids.length; j++) html += renderAchievementRow(ids[j], state);
      html += '</div>';
      html += '</details>';
      return html;
    }

    // 1. Next Goals card.
    var ng = nextGoals(s);
    var goalsCard = byId("goals-card");
    if (ng.length > 0) {
      var goalsHtml = "";
      for (var gi = 0; gi < ng.length; gi++) goalsHtml += renderAchievementRow(ng[gi].id, s);
      byId("goals").innerHTML = goalsHtml;
      goalsCard.hidden = false;
    } else {
      byId("goals").innerHTML = "";
      goalsCard.hidden = true;
    }

    // 2. Achievements card body: Near completion (if any) + 7 real categories.
    var achHtml = "";
    var nc = nearCompletion(s);
    if (nc.length > 0) {
      var ncIds = nc.map(function (a) { return a.id; });
      achHtml += renderCategorySection("Near completion", ncIds, s, /*isOpen*/ true, /*virtualCount*/ nc.length);
    }
    var byCategory = {};
    for (var ck = 0; ck < CATEGORY_ORDER.length; ck++) byCategory[CATEGORY_ORDER[ck]] = [];
    for (var ai = 0; ai < ACH_IDS.length; ai++) {
      var aid = ACH_IDS[ai];
      var cat = categorize(aid);
      if (byCategory[cat]) byCategory[cat].push(aid);
    }
    for (var ci = 0; ci < CATEGORY_ORDER.length; ci++) {
      var cname = CATEGORY_ORDER[ci];
      var cids = byCategory[cname];
      var openByDefault = cname === "Evolution";
      achHtml += renderCategorySection(cname, cids, s, openByDefault, undefined);
    }
    byId("achievements").innerHTML = achHtml;
```

Notes on the embedded helpers:

- `renderAchievementRow` always emits the `.ach-mini-bar` div, but CSS hides it for non-in-progress rows. Simpler than conditional emission and matches the spec DOM template.
- The empty-medal case uses `<span class="ach-medal" style="visibility:hidden">.</span>` (a hidden placeholder dot) so the grid column stays its expected width — without it, hatch-ladder rows would compress and shift the name column horizontally relative to medal-tagged rows.
- `renderCategorySection(name, ids, state, isOpen, virtualCount)`: when `virtualCount` is passed (used by Near completion), the counts cell shows `◐ N` instead of `unlocked/total`. When undefined, it shows `<headSym> <unlocked>/<total>`.

- [ ] **Step 3.3: Run typecheck + build**

```bash
npx tsc --noEmit
npm run build 2>&1 | tail -2
```

Expected: typecheck clean, build succeeds.

- [ ] **Step 3.4: Smoke-render check**

```bash
node -e "
const { renderPage } = require('./dist/index.js');
const fakeState = {
  schemaVersion: 2,
  pet: { species: 'duck', rarity: 'common', shiny: false, stats: { debugging: 75, patience: 61, chaos: 25, wisdom: 63, snark: 29 }, seed: 'a'.repeat(64) },
  progress: { xp: 5000, level: 28, phase: 'junior', pendingLevelUp: false },
  counters: {
    promptsTotal: 109, toolUseTotal: 2194, sessionsTotal: 9,
    activeSessions: { s1: { startTs: Date.now() - 1000, toolUseCount: 50, fileExtensions: ['.ts','.tsx'] } },
    streakDays: 3, lastActiveDate: new Date().toISOString().slice(0,10),
    nightOwlEvents: 12,
    otel: { lastUpdate: Date.now(), linesAdded: 8951, linesRemoved: 579, tokensIn: 651100, tokensOut: 0, tokensCacheRead: 0, tokensCacheCreated: 0, costUsdCents: 3954, prCount: 0, editsRejected: 0, filesEdited: 0 }
  },
  achievements: { unlocked: ['hatch_egg', 'hatch_hatchling', 'hatch_junior', 'streak_3d', 'tool_5k'], pendingUnlocks: [] },
  buddy: { detected: false, lastChecked: 0, userToggle: 'off' },
  meta: { createdAt: 0, updatedAt: 0 }
};
const html = renderPage(fakeState);
const checks = [
  ['function categorize', html.includes('function categorize')],
  ['function getStatus', html.includes('function getStatus')],
  ['function nextGoals', html.includes('function nextGoals')],
  ['function nearCompletion', html.includes('function nearCompletion')],
  ['function renderAchievementRow', html.includes('function renderAchievementRow')],
  ['function renderCategorySection', html.includes('function renderCategorySection')],
  ['CATEGORY_ORDER constant', html.includes('var CATEGORY_ORDER')],
  ['STATUS_SYMBOL constant', html.includes('var STATUS_SYMBOL')],
  ['goals-card placeholder', html.includes('id=\"goals-card\"')],
  ['cat-details CSS', html.includes('.cat-details {')],
  ['ach-status CSS', html.includes('.ach-status {')],
  ['ach-mini-bar CSS', html.includes('.ach-mini-bar {')],
  ['data-status attribute hook', html.includes('data-status=\"')],
];
for (const [name, ok] of checks) console.log((ok ? 'OK ' : 'FAIL ') + name);
"
```

Expected: all 13 lines start with `OK`.

- [ ] **Step 3.5: Commit**

```bash
git add src/render/web/page.ts
git commit -m "$(cat <<'EOF'
feat(web): V3.4 - achievement organization (categories + Next Goals)

CLIENT_JS gains 4 derivation helpers:
  - categorize(id): prefix-based mapping to one of 7 categories.
  - getStatus(id, state): "completed" | "in-progress" | "locked".
  - nextGoals(state): top 5 in-progress, prefer ratio >= 0.5 then
    fallback to < 0.5, merged so the slice always fills if any
    in-progress exist.
  - nearCompletion(state): top 5 in-progress with ratio >= 0.7.

Render flow rewritten:
  - Next Goals card visible only when nextGoals returns a non-empty
    list; toggled via the section's hidden attribute.
  - Achievements card body emits Near completion virtual category at
    the top (only when non-empty), then the 7 real categories. Only
    Evolution opens by default; the rest are closed.
  - Each achievement row uses the new V3.4 status symbol (✅ ◐ ○),
    medal emoji (with hidden placeholder for non-medal rows so columns
    stay aligned), and a mini bar that CSS reveals only on in-progress.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Render test fixes + 3.4.0 release

**Files:**
- Modify: `tests/render.test.ts` (potentially — only if existing assertions break)
- Modify: `package.json`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 4.1: Run the full test suite**

```bash
cd "C:/Users/Dan/Repo/petforge"
npx vitest run
```

Expected: all 313 tests pass.

If a test fails, the most likely cause is an assertion on V3.2's `✓` or `·` mark literals that V3.4 replaces with `✅` / `◐` / `○`. Fix by updating the literal in the test (replace `✓` with `✅`, `·` with `○`). If a test asserts on the FLAT achievement HTML structure (no categories), update it to match the new grouped DOM — typically by switching from a strict structural matcher to a partial `toMatch(/<details/)` or `toContain('Hatch · Egg')`.

If `npx vitest run` reports "Vitest failed to find the runner" on the first attempt, run again — vitest 4.x flakes here.

If existing tests need adjustments, make the smallest change that preserves the assertion's intent. Do NOT delete tests.

- [ ] **Step 4.2: Bump package version to 3.4.0**

In `package.json`, change `"version": "3.3.0"` to `"version": "3.4.0"`.

- [ ] **Step 4.3: Update README**

In `README.md`, find the version mention near the top and bump from `3.3.0` to `3.4.0`. If the README has a "Recent" or "Changelog" inline section, prepend:

```markdown
- **V3.4** (2026-05-02) - achievement organization: 7 collapsible categories + virtual "Near completion", new NEXT GOALS card (top 5 in-progress), 3-state status symbols (✅ ◐ ○), inline mini progress bars on in-progress only.
```

If the README has no such inline summary section, leave it — the CHANGELOG covers the V3.4 details. The version-badge bump is the only mandatory part.

- [ ] **Step 4.4: Add CHANGELOG entry**

Prepend to `CHANGELOG.md` directly under the top header (above the existing `## 3.3.0` entry):

```markdown
## 3.4.0 - 2026-05-02

**Achievement organization** - the 46-entry list reorganized into 7 collapsible categories + a virtual "Near completion" group, plus a new top-of-list NEXT GOALS card.

- 7 categories (prefix-mapped): Evolution / Streak / Activity / Time /
  Coding / Economy / Collaboration. Each is a collapsible <details>
  showing a status symbol + unlocked/total counts in the summary row.
- "Near completion" virtual category appears at the top of the
  achievements card when any in-progress achievement has ratio >= 0.7.
  Top 5 sorted descending. Hidden entirely (DOM-absent) when empty.
- NEXT GOALS card sits between STATS and ACHIEVEMENTS: top 5 in-progress
  with preferred ratio >= 0.5, fallback to < 0.5 — merged so the slice
  always fills when any in-progress achievement exists. Card hidden via
  the standard hidden attribute (DOM-absent for layout) when empty.
- Status symbols replace V3.2 marks: completed checkmark, in-progress
  half-circle, locked empty circle. Pct hidden for completed (the
  status symbol carries the info). Locked items show pct without bar.
- Inline mini progress bars (0.25rem high) under each in-progress
  achievement summary, tinted by medal color (bronze/silver/gold/
  platinum). Hidden for completed and locked.
- No state schema bump, no migration, no Ink TUI changes, no filter
  tabs (deferred to V3.5+).
```

- [ ] **Step 4.5: Run full validation**

```bash
npx vitest run
npx tsc --noEmit
```

Expected: 313 tests pass, typecheck clean.

Don't run `npx biome check .` — the repo has a pre-existing CRLF condition unrelated to this task. If you want a sanity check: `npx biome check src/render/web/page.ts package.json README.md CHANGELOG.md`.

- [ ] **Step 4.6: Build + global install**

```bash
npm run build
npm install -g .
petforge --version
```

Expected: build succeeds; `petforge --version` reports `3.4.0`.

- [ ] **Step 4.7: STOP — do not run `petforge up --lan`**

The main session restarts the running server for the smoke test. Your task ends at the version verification.

- [ ] **Step 4.8: Commit**

```bash
git add tests/render.test.ts package.json README.md CHANGELOG.md
git commit -m "$(cat <<'EOF'
release(v3.4.0): achievement organization - categories + Next Goals

Bumps to 3.4.0. README and CHANGELOG describe the V3.4 reorganization
(7 collapsible categories + virtual Near completion + NEXT GOALS card +
3-state status symbols + mini progress bars on in-progress only).
Render tests adjusted minimally if any V3.2 mark literals broke.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

If `tests/render.test.ts` was not touched (no assertions broke), drop it from the `git add`.

---

## Self-Review

**Spec coverage:**

| Spec point | Task |
|---|---|
| 7 categories with prefix-based mapping | Task 3.1 (`categorize`) + Task 3.2 (`renderCategorySection`) |
| Categories collapsible | Task 2.1 (CSS `.cat-summary`) + Task 3.2 (`<details>` emission) |
| Virtual "Near completion" group | Task 3.1 (`nearCompletion`) + Task 3.2 (renders only when non-empty) |
| Default open: Evolution + Near completion (when non-empty) | Task 3.2 (`isOpen` flag passed per category) |
| 3-state status symbols (✅ ◐ ○) | Task 3.1 (`STATUS_SYMBOL`) + Task 3.2 (`renderAchievementRow`) |
| Pct hidden for completed | Task 2.1 (CSS `[data-status="completed"] .ach-pct`) + Task 3.2 (empty pct text) |
| Locked items show pct without bar | Task 2.1 (CSS hides mini bar for non-in-progress) + Task 3.2 (always emits pct unless completed) |
| Mini bar visible only on in-progress | Task 2.1 (CSS) + Task 3.2 (always emits the div, CSS hides via `display: none`) |
| Mini bar tinted by medal | Task 2.1 (CSS `.medal-bronze/silver/gold/platinum.in-progress` selectors) |
| NEXT GOALS card placement (between STATS and ACHIEVEMENTS) | Task 1.1 (HTML insertion point) |
| Next Goals algorithm: prefer >= 0.5 first, fallback < 0.5, slice 5 | Task 3.1 (`nextGoals`) |
| NEXT GOALS hidden when empty (no DOM render) | Task 1.1 (`hidden` attr default) + Task 3.2 (toggle `goalsCard.hidden`) |
| Empty Near completion: not rendered | Task 3.2 (`if (nc.length > 0) ...`) |
| Categories grouped from V3.2 IDs | Task 3.2 (`byCategory` aggregation) |
| Status drives DOM via `data-status` attribute | Task 3.2 (`renderAchievementRow` writes `data-status`) |
| All 313 tests pass | Task 4.1 |
| Version 3.4.0 + README + CHANGELOG | Task 4 |

**Placeholder scan:** No "TBD", "implement later", "fill in details". Every code block is complete; every command has expected output; every test repair step (4.1) has explicit guidance.

**Type consistency:**
- `categorize(id)` returns one of `"Evolution" | "Streak" | "Activity" | "Time" | "Coding" | "Economy" | "Collaboration" | "Other"`. The 7 first match `CATEGORY_ORDER`. `"Other"` is a defensive default.
- `getStatus(id, state)` returns `"completed" | "in-progress" | "locked"` — these are also the three CSS attribute values used in selectors (Task 2.1) and the keys of `STATUS_SYMBOL` (Task 3.1).
- `renderAchievementRow(id, state)` reads `def.medal` (V3.2 registry field, optional `"bronze" | "silver" | "gold" | "platinum"`) — matches the V3.2 `Medal` type.
- HTML IDs introduced in Task 1 (`#goals-card`, `#goals`) are populated/manipulated in Task 3.
- CSS class names in Task 2 (`.cat-details`, `.cat-summary`, `.cat-name`, `.cat-counts`, `.caret`, `.cat-body`, `.ach-status`, `.ach-mini-bar`, `.ach-mini-bar-fill`, `.goals-card`) all referenced by the HTML emission in Task 3.

**Escape rule reminder:** Task 3 explicitly avoids regex with backslash classes. The new helpers use `Array#filter`, `Array#sort`, `Array#concat`, `Array#slice`, `Array#map`, `String#indexOf`, plain string concat — no `\n` or `\s` needed. The existing CLIENT_JS regexes in `parseBuddyCard` etc. are untouched.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-02-petforge-v3-4-achievement-organization-plan.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review per task, 4 dispatches total. Same proven workflow as V3.2 / V3.3.

**2. Inline Execution** — execute in this session via `superpowers:executing-plans`, batch with checkpoints between tasks.

Which approach?
