# PetForge V3.3 — Visual Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the served web view into 4 visual cards (PET / CURRENT RUN / STATS / ACHIEVEMENTS) with a richer derived header (mood / trait / next-evolution), compact stat formatting, and split RUN/DEV footer rows. UI-only change scoped to `src/render/web/page.ts`.

**Architecture:** Single-file edit to the page renderer. HTML template literal gains `<section class="card">` wrappers + new ID nodes for the derived rows. CSS template literal gains card / kv-row / 3-column stat grid rules. CLIENT_JS template literal gains 3 pure derivation helpers (`computeMood`, `computeTrait`, `nextPhaseProgress`) inlined as JS strings (NOT a separate TS module — the helpers are small enough that manual maintenance + visual review is the YAGNI choice). No state schema bump, no migration, no Ink TUI changes, no new package dependencies.

**Tech Stack:** TypeScript strict, Vitest, Biome, ESM, Node 20+. The web view is a single hand-written template literal in `src/render/web/page.ts` — what's between the backticks is what the browser executes (the JS is inlined verbatim).

**Critical escape gotcha:** Inside the CLIENT_JS template literal, every `\` consumes one level of escaping. To get a literal `\n` (newline) or `\s` (whitespace regex class) into the browser's JS, write `\\n` and `\\s` in the TS source. We've hit this bug twice today (the XP `xp` -> `XP` regex, and the per-line strip in `renderFrame`); the plan calls out every regex/escape inline.

---

## File Structure (target end-state)

### Modified
- `src/render/web/page.ts` — HTML template literal, CSS template literal, CLIENT_JS template literal. ~150 net new lines, ~50 lines replaced.
- `tests/render.test.ts` — minimal assertion adjustments if any test relies on the old `<p class="header">` structure (most use `toMatch(/.../)` partial matchers and won't need touching).
- `package.json` — version `3.2.0` -> `3.3.0`.
- `README.md` — short note about the V3.3 visual restructure.
- `CHANGELOG.md` — `3.3.0` entry.

### Created
None (helpers are inlined in CLIENT_JS, no new files).

### Deleted
None.

---

## Task 1: HTML structure rebuild (4 cards)

**Files:**
- Modify: `src/render/web/page.ts` (the HTML template literal returned by `renderPage` only)

- [ ] **Step 1.1: Replace the `<main id="app">` body**

In `src/render/web/page.ts`, locate the HTML template literal returned by `renderPage`. Find the block:

```html
<main id="app">
  <pre id="pet" class="pet"></pre>
  <p class="header"><span id="species"></span> &middot; <span id="rarity"></span> &middot; <span id="phase"></span><span id="shiny" hidden> &#x2728;</span></p>
  <div class="xpbar">
    <div class="xpbar-track"><div id="xp-fill" class="xpbar-fill"></div></div>
    <p class="xpbar-label" id="xp-label"></p>
  </div>
  <section>
    <h2>STATS</h2>
    <div id="stats"></div>
  </section>
  <section>
    <h2>ACHIEVEMENTS</h2>
    <div id="achievements"></div>
  </section>
  <p id="activity" class="activity"></p>
  <p id="otel-activity" class="activity" hidden></p>
  <p id="status" class="status"></p>
</main>
```

Replace it ENTIRELY with:

```html
<main id="app">
  <section class="card pet-card">
    <pre id="pet" class="pet"></pre>
    <p class="header"><span id="species"></span></p>
    <p class="subheader"><span id="rarity"></span> &middot; <span id="phase"></span> &middot; LVL <span id="level"></span><span id="shiny" hidden> &#x2728;</span></p>
    <div class="xpbar">
      <div class="xpbar-track"><div id="xp-fill" class="xpbar-fill"></div></div>
      <p class="xpbar-label" id="xp-label"></p>
    </div>
    <div class="kv-row"><span class="kv-label">Mood:</span><span class="kv-value" id="mood"></span></div>
    <div class="kv-row"><span class="kv-label">Trait:</span><span class="kv-value" id="trait"></span></div>
    <div class="kv-row"><span class="kv-label">Next evolution:</span><span class="kv-value" id="next-evo"></span></div>
  </section>
  <section class="card run-card">
    <p class="card-label">Current Run</p>
    <p class="run-line"><span class="run-prefix">RUN</span><span id="activity" class="activity"></span></p>
    <p class="run-line" id="otel-row"><span class="run-prefix">DEV</span><span id="otel-activity" class="activity"></span></p>
  </section>
  <section class="card stats-card">
    <p class="card-label">Stats</p>
    <div id="stats"></div>
  </section>
  <section class="card achievements-card">
    <p class="card-label">Achievements</p>
    <div id="achievements"></div>
  </section>
  <p id="status" class="status"></p>
</main>
```

Notes:
- Display name (`#species`) and rarity/phase/level get split: name on its own H1-ish line, rarity+phase+level on a sub-line. Keeps the V3.2 rarity color span working (the `#rarity` span still exists; CSS adds class).
- `#level` is a NEW span that holds just the level number — currently the CLIENT_JS embeds level inside the xp-label string. Step 3.5 also writes to this span.
- `#mood`, `#trait`, `#next-evo` are 3 new span IDs, populated by Task 3 helpers.
- `#otel-row` is a NEW wrapping `<p>` ID so the entire DEV row (label + content) can be hidden together when `otel.lastUpdate === 0`. Previously only the inner `<span id="otel-activity">` was hidden, leaving an orphan label visible.
- The `<p id="status">` stays OUTSIDE the cards (footer-style "live" indicator).

- [ ] **Step 1.2: Run typecheck to verify TS still compiles**

Run: `npx tsc --noEmit`

Expected: clean. The HTML change is inside a template literal string, so TypeScript only validates the surrounding code (which is unchanged at this step).

- [ ] **Step 1.3: Smoke-render the page once**

Run from the project root:

```bash
node -e "import('./dist/index.js').catch(()=>{}); const { renderPage } = require('./dist/render/web/page.js'); console.log(renderPage(null).slice(0, 2000));"
```

Expected: HTML output shows the 4 cards (`<section class="card pet-card">`, etc.) and the new IDs (`#mood`, `#trait`, `#next-evo`, `#level`). If the file path or import shape doesn't match (V3.2 builds `dist/index.js` as a single bundle), skip the verification — Task 4 ships a full smoke test.

If `dist/` is stale, rebuild first: `npm run build`.

- [ ] **Step 1.4: Commit**

```bash
git add src/render/web/page.ts
git commit -m "$(cat <<'EOF'
feat(web): V3.3 - wrap content in 4 cards with new ID nodes

Splits the old monolithic <main> into pet-card / run-card / stats-card /
achievements-card. Adds #mood / #trait / #next-evo / #level / #otel-row
nodes that subsequent tasks will populate. Display name and
rarity/phase/level now live on separate lines for stronger hierarchy.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: CSS rules — card style + compact stats grid + kv-row

**Files:**
- Modify: `src/render/web/page.ts` (the `const CSS` template literal only)

- [ ] **Step 2.1: Replace the `.pet` rule and add card system**

In the `const CSS = ` template literal, locate the `.pet { ... }` rule. Replace the segment from `body { ... }` through the existing `li.unlocked { ... }` line with a clean V3.3 stylesheet that adds card primitives and reformats stats. The full block to replace is large; rewrite it as follows.

Find the block that starts with `body {` (line ~104 in V3.2) and ends just before the `/* Achievement detail (clickable) */` comment. Replace ALL of that with:

```css
  body {
    background: #0d1117;
    color: #e6edf3;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    margin: 0;
    padding: 1rem;
    min-height: 100vh;
  }
  main { max-width: 480px; margin: 0 auto; }

  /* Card system */
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

  /* Pet card */
  .pet {
    font-size: 1.1rem;
    line-height: 1.1;
    white-space: pre;
    text-align: center;
    margin: 0 auto 0.75rem;
    min-height: 8em;
  }
  .header {
    text-align: center;
    color: #e6edf3;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 600;
    font-size: 1.1rem;
    margin: 0.25rem 0;
  }
  .subheader {
    text-align: center;
    color: #8b949e;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-size: 0.85rem;
    margin: 0 0 0.75rem;
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

  /* XP bar */
  .xpbar { margin: 0.75rem 0; }
  .xpbar-track {
    background: #21262d;
    height: 1rem;
    border-radius: 0.25rem;
    overflow: hidden;
  }
  .xpbar-fill {
    background: linear-gradient(90deg, #58a6ff, #2ea043);
    height: 100%;
    width: 0;
    transition: width 0.4s;
  }
  .xpbar-label { text-align: center; color: #c9d1d9; margin: 0.25rem 0; font-size: 0.9rem; }

  /* Run card */
  .run-line {
    display: grid;
    grid-template-columns: 3em 1fr;
    gap: 0.5rem;
    margin: 0.3rem 0;
    font-size: 0.85rem;
    line-height: 1.4;
  }
  .run-prefix {
    color: #6e7681;
    font-weight: 600;
    letter-spacing: 0.1em;
  }
  .activity { color: #c9d1d9; margin: 0; }

  /* Stats card - 3-column grid: name | value | bar */
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
  .stat-bar-fill { background: #2ea043; height: 100%; width: 0; transition: width 0.4s; }

  /* Achievements card (legacy ul/li - kept for backward compatibility, unused in V3.3 but harmless) */
  ul { list-style: none; padding: 0; margin: 0; }
  li { padding: 0.15rem 0; color: #8b949e; }
  li.unlocked { color: #3fb950; }
```

Then leave the rest of the CSS (the `/* Achievement detail (clickable) */` section and below — `.ach`, `.ach-summary`, `.ach-mark`, etc., all the way down through `.rarity-tag-*` rules) UNCHANGED.

Two important deletions inside the `.pet` rule that are intentional and required for the centered ASCII to behave correctly:
- `width: fit-content` removed (so `text-align: center` can act on each line individually).
- The status rule (`.status`) is left where it was lower in the CSS — don't move it.

- [ ] **Step 2.2: Verify CSS contains exactly one `.card` rule**

Run: `grep -c "^  \.card {" src/render/web/page.ts`

Expected output: `1`

If higher, you accidentally duplicated. Open the file and remove the dupe.

- [ ] **Step 2.3: Smoke-render check the CSS embeds**

```bash
node -e "import('./dist/index.js').catch(()=>{}); const { renderPage } = require('./dist/render/web/page.js'); const html = renderPage(null); console.log(html.includes('.card {') ? 'CSS card present' : 'MISSING'); console.log(html.includes('grid-template-columns: 7em 2.5em 1fr') ? 'Stats grid present' : 'MISSING');"
```

Expected: both lines print `present`. If `dist/` is stale, run `npm run build` first.

- [ ] **Step 2.4: Commit**

```bash
git add src/render/web/page.ts
git commit -m "$(cat <<'EOF'
feat(web): V3.3 - add card / kv-row / 3-col stats grid CSS

Card system: 1px border, rounded 6px, dark background, uppercase label.
kv-row: 8em label column + 1fr value (used by mood/trait/next-evo).
run-line: 3em prefix column + 1fr content (RUN / DEV labels).
stat: 3-col grid (name | value | bar) instead of the old name+bar+value.

Pet card style adjusted: removed width: fit-content so text-align: center
can re-center each line inside the .pet container.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: CLIENT_JS — derivation helpers + renderState integration

**Files:**
- Modify: `src/render/web/page.ts` (the `const CLIENT_JS` template literal only)

This task is the bulk of V3.3. It adds 3 derivation helpers, splits the activity rendering into RUN/DEV rows, reorders the stat row HTML, populates the new card-internal nodes (`#mood`, `#trait`, `#next-evo`, `#level`), and hides `#otel-row` (the wrapping `<p>`) instead of the inner span.

**CRITICAL escape rule (re-read every time you write a regex or `\n` inside CLIENT_JS):**

The CLIENT_JS contents live inside a TS template literal. Backslashes consume one escape level. To get a single backslash through to the browser, write `\\` in the TS source. So:

| Browser sees | Write in TS |
|---|---|
| `"\n"` (newline string) | `"\\n"` |
| `/^\s+/` (whitespace regex) | `/^\\s+/` |
| `\\u003c` inside JSON | already double-escaped in `safeJson` |

We've hit this bug twice today. Do not write `"\n"` or `/\s/` directly inside CLIENT_JS — always double-escape.

- [ ] **Step 3.1: Add derivation helpers at the top of CLIENT_JS**

In the `const CLIENT_JS = ` template literal, locate the opening IIFE: `(function () {`. Right after `var initial = initialEl ...` near the top, insert the three derivation helpers + `STAT_ORDER` + `PHASE_BOUNDARIES` constants. The exact insertion point is just BEFORE the existing `function xpForLevel(level) { ... }` block.

Insert this block:

```js
  var STAT_ORDER = ["debugging", "patience", "chaos", "wisdom", "snark"];
  var PHASE_BOUNDARIES = [
    { phase: "egg", level: 1 },
    { phase: "hatchling", level: 5 },
    { phase: "junior", level: 20 },
    { phase: "adult", level: 50 },
    { phase: "elder", level: 80 },
    { phase: "mythic", level: 100 }
  ];

  function activeSessionCount(s) {
    var as = s && s.counters && s.counters.activeSessions;
    if (!as) return 0;
    return Object.keys(as).length;
  }

  function isoDay(t) {
    return new Date(t).toISOString().slice(0, 10);
  }

  function computeMood(s, nowMs) {
    var active = activeSessionCount(s);
    var hour = new Date(nowMs).getHours();
    var isNightHour = hour >= 22 || hour < 2;

    // Priority order: Night Owl > Coding > Resting > Focused.
    if (active > 0 && isNightHour) return "Night Owl";
    if (active > 0) return "Coding";

    // Resting requires NO active session AND recent activity (today/yesterday).
    var lastActive = s && s.counters && s.counters.lastActiveDate;
    var streakDays = (s && s.counters && s.counters.streakDays) || 0;
    var today = isoDay(nowMs);
    var yesterday = isoDay(nowMs - 24 * 60 * 60 * 1000);
    var recent = lastActive === today || lastActive === yesterday;
    if (active === 0 && streakDays > 0 && recent) return "Resting";

    return "Focused";
  }

  function computeTrait(pet) {
    if (!pet || !pet.stats) return "";
    var topName = STAT_ORDER[0];
    var topValue = pet.stats[topName] || 0;
    for (var i = 0; i < STAT_ORDER.length; i++) {
      var name = STAT_ORDER[i];
      var v = pet.stats[name] || 0;
      // Strict > preserves canonical-order tie-break (NOT alphabetical):
      // earlier-in-STAT_ORDER stats win when values are equal.
      if (v > topValue) {
        topName = name;
        topValue = v;
      }
    }
    return topName.charAt(0).toUpperCase() + topName.slice(1) + " Aura";
  }

  function nextPhaseProgress(level) {
    if (level >= 100) return { nextPhase: null, percent: 100, label: "MAX - ascended" };
    var current = PHASE_BOUNDARIES[0];
    var next = PHASE_BOUNDARIES[1];
    for (var i = 0; i < PHASE_BOUNDARIES.length - 1; i++) {
      if (level >= PHASE_BOUNDARIES[i].level && level < PHASE_BOUNDARIES[i + 1].level) {
        current = PHASE_BOUNDARIES[i];
        next = PHASE_BOUNDARIES[i + 1];
        break;
      }
    }
    var ratio = (level - current.level) / (next.level - current.level);
    var percent = Math.max(0, Math.min(100, Math.round(ratio * 100)));
    return { nextPhase: next.phase, percent: percent, label: next.phase + " - " + percent + "%" };
  }
```

The `-` in `"MAX - ascended"` and `next.phase + " - " + percent` is an ASCII hyphen (no em-dash). The function names match the spec exactly.

- [ ] **Step 3.2: Update `renderState` to populate the new nodes**

Find the body of `renderState()` (or the equivalent function — the V3.2 plan named it `renderState`, predecessor versions called it `render`). Look for the block that currently sets `species`, `rarity`, `phase`, `shiny`, `xp-label`, etc. The block looks like:

```js
    byId("species").textContent = (buddy.name || species).toUpperCase();
    var rarityEl = byId("rarity");
    rarityEl.textContent = displayRarity;
    rarityEl.className = "rarity-tag-" + displayRarity;
    byId("phase").textContent = phase;
    byId("shiny").hidden = !s.pet.shiny;
```

Update it to ALSO populate the new `#level`, `#mood`, `#trait`, `#next-evo` nodes. Replace the block with:

```js
    byId("species").textContent = (buddy.name || species).toUpperCase();
    var rarityEl = byId("rarity");
    rarityEl.textContent = displayRarity;
    rarityEl.className = "rarity-tag-" + displayRarity;
    byId("phase").textContent = phase;
    byId("level").textContent = String(s.progress.level);
    byId("shiny").hidden = !s.pet.shiny;

    // V3.3 derived header rows.
    byId("mood").textContent = computeMood(s, Date.now());
    byId("trait").textContent = computeTrait(s.pet);
    var evo = nextPhaseProgress(s.progress.level);
    byId("next-evo").textContent = evo.label;
```

- [ ] **Step 3.3: Split activity into RUN + DEV rows**

Find the existing block that sets `#activity`:

```js
    byId("activity").textContent =
      "Sessions: " + s.counters.sessionsTotal +
      " · Streak: " + s.counters.streakDays + "d" +
      " · Prompts: " + s.counters.promptsTotal +
      " · Tools: " + s.counters.toolUseTotal;
```

Replace with the V3.3 RUN line (no `Sessions:` / `Streak:` labels, just values + bullets — the `RUN` prefix already lives in the HTML):

```js
    byId("activity").textContent =
      "Sessions " + s.counters.sessionsTotal.toLocaleString() +
      " · Streak " + s.counters.streakDays + "d" +
      " · Prompts " + s.counters.promptsTotal.toLocaleString() +
      " · Tools " + s.counters.toolUseTotal.toLocaleString();
```

Then find the OTel block:

```js
    var o = s.counters && s.counters.otel;
    var otelEl = byId("otel-activity");
    if (o && o.lastUpdate > 0) {
      var lines = "+" + (o.linesAdded || 0).toLocaleString() + " / -" + (o.linesRemoved || 0).toLocaleString();
      var tokens = compact((o.tokensIn || 0) + (o.tokensOut || 0));
      var cost = "$" + ((o.costUsdCents || 0) / 100).toFixed(2);
      var cv = (o.tokensIn || 0) + (o.tokensCacheRead || 0);
      var cachePct = cv > 0 ? Math.round((o.tokensCacheRead / cv) * 100) : 0;
      otelEl.textContent = "Lines: " + lines + " · Tokens: " + tokens + " · Cost: " + cost + " · Cache: " + cachePct + "%";
      otelEl.hidden = false;
    } else {
      otelEl.hidden = true;
    }
```

Replace with (note: hides the entire ROW `#otel-row`, not just the inner span):

```js
    var o = s.counters && s.counters.otel;
    var otelRow = byId("otel-row");
    var otelEl = byId("otel-activity");
    if (o && o.lastUpdate > 0) {
      var lines = "+" + (o.linesAdded || 0).toLocaleString() + " / -" + (o.linesRemoved || 0).toLocaleString();
      var tokens = compact((o.tokensIn || 0) + (o.tokensOut || 0));
      var cost = "$" + ((o.costUsdCents || 0) / 100).toFixed(2);
      var cv = (o.tokensIn || 0) + (o.tokensCacheRead || 0);
      var cachePct = cv > 0 ? Math.round((o.tokensCacheRead / cv) * 100) : 0;
      otelEl.textContent =
        lines + " lines · " + tokens + " tokens · " + cost + " · Cache " + cachePct + "%";
      otelRow.hidden = false;
    } else {
      otelRow.hidden = true;
    }
```

- [ ] **Step 3.4: Reorder the stats grid HTML to `name | value | bar`**

Find the block that builds the stats panel HTML. It appears twice (once for buddy stats, once for petforge stats). Both currently emit:

```js
        statsHtml += '<div class="stat">';
        statsHtml += '<span class="stat-name">' + name + '</span>';
        statsHtml += '<div class="stat-bar"><div class="stat-bar-fill" style="width:' + pct + '%"></div></div>';
        statsHtml += '<span class="stat-val">' + value + '</span>';
        statsHtml += '</div>';
```

Reorder to `name | value | bar` so the value sits in the 2nd column of the grid:

For the `useBuddyStats` branch:

```js
      for (var bi = 0; bi < buddy.stats.length; bi++) {
        var bs = buddy.stats[bi];
        var bpct = Math.max(0, Math.min(100, bs.value));
        statsHtml += '<div class="stat">';
        statsHtml += '<span class="stat-name">' + bs.name + '</span>';
        statsHtml += '<span class="stat-val">' + bs.value + '</span>';
        statsHtml += '<div class="stat-bar"><div class="stat-bar-fill" style="width:' + bpct + '%"></div></div>';
        statsHtml += '</div>';
      }
```

For the petforge stats branch:

```js
      var statKeys = ["debugging", "patience", "chaos", "wisdom", "snark"];
      for (var i = 0; i < statKeys.length; i++) {
        var k = statKeys[i];
        var v = s.pet.stats[k];
        var pct = Math.max(0, Math.min(100, v));
        statsHtml += '<div class="stat">';
        statsHtml += '<span class="stat-name">' + k.toUpperCase() + '</span>';
        statsHtml += '<span class="stat-val">' + v + '</span>';
        statsHtml += '<div class="stat-bar"><div class="stat-bar-fill" style="width:' + pct + '%"></div></div>';
        statsHtml += '</div>';
      }
```

The CSS grid order in Task 2 (`grid-template-columns: 7em 2.5em 1fr`) maps the 1st child to the name column, 2nd to value, 3rd to bar — which matches this DOM order.

- [ ] **Step 3.5: Run typecheck + build the bundle**

```bash
npx tsc --noEmit
npm run build
```

Expected: typecheck clean, build produces `dist/index.js`.

- [ ] **Step 3.6: Smoke-test the served HTML**

Start a temporary local server and curl the page:

```bash
node -e "
const { startServer } = require('./dist/index.js');
" 2>/dev/null || true

# Direct render test:
node -e "
const { renderPage } = require('./dist/index.js');
const fakeState = {
  schemaVersion: 2,
  pet: { species: 'duck', rarity: 'common', shiny: false, stats: { debugging: 75, patience: 61, chaos: 25, wisdom: 63, snark: 29 }, seed: 'a'.repeat(64) },
  progress: { xp: 1932, level: 28, phase: 'junior', pendingLevelUp: false },
  counters: {
    promptsTotal: 109, toolUseTotal: 2194, sessionsTotal: 9,
    activeSessions: { s1: { startTs: Date.now() - 1000, toolUseCount: 50, fileExtensions: ['.ts', '.tsx'] } },
    streakDays: 3, lastActiveDate: new Date().toISOString().slice(0,10),
    nightOwlEvents: 12,
    otel: { lastUpdate: Date.now(), linesAdded: 8951, linesRemoved: 579, tokensIn: 651100, tokensOut: 0, tokensCacheRead: 0, tokensCacheCreated: 0, costUsdCents: 3954, prCount: 0, editsRejected: 0, filesEdited: 0 }
  },
  achievements: { unlocked: [], pendingUnlocks: [] },
  buddy: { detected: false, lastChecked: 0, userToggle: 'off' },
  meta: { createdAt: 0, updatedAt: 0 }
};
const html = renderPage(fakeState);
console.log('contains card class:', html.includes('class=\"card pet-card\"'));
console.log('contains mood node:', html.includes('id=\"mood\"'));
console.log('contains trait node:', html.includes('id=\"trait\"'));
console.log('contains next-evo node:', html.includes('id=\"next-evo\"'));
console.log('contains run-prefix:', html.includes('class=\"run-prefix\"'));
console.log('contains computeMood fn:', html.includes('function computeMood'));
console.log('contains STAT_ORDER:', html.includes('var STAT_ORDER'));
"
```

Expected: 7 lines, all `true`.

If any returns `false`, the corresponding step's edit didn't apply correctly. Re-read the file at the relevant line range and fix.

- [ ] **Step 3.7: Commit**

```bash
git add src/render/web/page.ts
git commit -m "$(cat <<'EOF'
feat(web): V3.3 - mood/trait/next-evolution + RUN/DEV split + stats grid

CLIENT_JS gains computeMood / computeTrait / nextPhaseProgress helpers
(canonical STAT_ORDER tie-break, [0,100] clamp on next-phase percent).
renderState populates #mood, #trait, #next-evo, #level. RUN line drops
the verbose 'Sessions: X' labels (the RUN prefix in HTML labels the
whole row); DEV row hides the wrapping <p> instead of just the span
when otel.lastUpdate is 0. Stats grid HTML reordered to name | value |
bar to match the new CSS 3-column grid.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Render test adjustments + version 3.3.0 release

**Files:**
- Modify: `tests/render.test.ts` (potentially — only if existing assertions break)
- Modify: `package.json`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 4.1: Run the full test suite**

Run: `npx vitest run`

Expected: all 313+ tests pass. If a test fails, read the failure carefully:

- A test that asserts `<p class="header">` literal HTML may need adjusting to match the new `<section class="card pet-card">` structure. Use a partial matcher (`expect(html).toMatch(/HUDDLE/)` or similar) to keep the test resilient.
- A test that asserts on `.activity` text format ("Sessions: X · Streak: Yd") needs updating to the new format ("Sessions X · Streak Yd" — no colon).
- A test that asserts `id="otel-activity"` is hidden may need to assert on `id="otel-row"` instead.

If `npx vitest run` reports a transient "Vitest failed to find the runner" on the first attempt, run again — vitest 4.x flakes here.

For each failing test, make the smallest change that restores the assertion's intent under the new structure. Do NOT delete tests.

- [ ] **Step 4.2: Bump package version to 3.3.0**

In `package.json`, change `"version": "3.2.0"` to `"version": "3.3.0"`.

- [ ] **Step 4.3: Update README**

In `README.md`, find the "What" intro and bump the version mention from 3.2.0 to 3.3.0. Append a brief note describing the V3.3 visual restructure. Locate any text that describes the web view's layout and add or update it to mention the 4-card structure.

If the README has a `## Changelog` or `## Recent` section, add:

```markdown
- **V3.3** (2026-05-02) — visual restructure: web view in 4 cards (PET / RUN / STATS / ACHIEVEMENTS), header now shows derived mood / trait / next-evolution, stats compacted to name | value | bar, RUN/DEV footer split. UI-only — no schema bump.
```

If the README has no such section, skip this — the CHANGELOG entry covers it.

- [ ] **Step 4.4: Add CHANGELOG entry**

Prepend to `CHANGELOG.md` directly under the top header (above the V3.2.0 entry):

```markdown
## 3.3.0 — 2026-05-02

**Visual restructure** — web view re-laid in 4 distinct cards.

- PET card: ASCII pet + display name + rarity/phase/level sub-line + XP bar +
  3 derived rows (Mood, Trait, Next evolution).
- CURRENT RUN card: split into RUN line (sessions / streak / prompts / tools)
  and DEV line (OTel-derived: lines / tokens / cost / cache hit %). DEV row
  hides cleanly when no OTel data is available.
- STATS card: 3-column grid (name | value | bar) instead of name | bar | value.
- ACHIEVEMENTS card: existing 46-entry list wrapped in the new card style;
  internal contents unchanged in V3.3.
- Mood derivation: Night Owl > Coding > Resting > Focused (priority order).
  Trait derivation: top stat + " Aura", canonical-order tie-break (NOT
  alphabetical). Next evolution: percent toward next phase boundary,
  clamped to [0, 100], "MAX - ascended" at level 100.
- No state schema bump, no migration. Pure UI overhaul on top of V3.2.

Deferred to V3.4: collapsible achievement categories, Next Goals filter,
status symbols (completed / in-progress / locked), per-achievement mini bars.
```

- [ ] **Step 4.5: Run full validation**

```bash
npx vitest run
npx tsc --noEmit
```

Expected: 313+ tests pass, typecheck clean. (`npx biome check .` is intentionally NOT run because the repo has a pre-existing CRLF condition unrelated to V3.3 — running `biome check src/render/web/page.ts package.json README.md CHANGELOG.md` to scope it to your touched files is fine if you want a sanity check.)

- [ ] **Step 4.6: Build + global install**

```bash
npm run build
npm install -g .
petforge --version
```

Expected: build succeeds, `petforge --version` reports `3.3.0`.

- [ ] **Step 4.7: STOP — do not run `petforge up --lan`**

The main session restarts the running server for the smoke test. Your task ends at the version verification.

- [ ] **Step 4.8: Commit**

```bash
git add tests/render.test.ts package.json README.md CHANGELOG.md
git commit -m "$(cat <<'EOF'
release(v3.3.0): visual restructure - 4 cards + derived header

Bumps to 3.3.0. README and CHANGELOG describe the V3.3 web view
restructure. Render tests adjusted minimally for the new HTML wrappers.
Build + reinstall global verified to report 3.3.0.

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
| 4 visual cards (PET / RUN / STATS / ACHIEVEMENTS) | Task 1 (HTML), Task 2 (CSS) |
| `.card` + `.card-label` style | Task 2 (CSS) |
| PET card: name on its own line, rarity/phase/level sub-line | Task 1 (HTML), Task 3.2 (level node) |
| Mood derivation (Night Owl > Coding > Resting > Focused with explicit Resting guard) | Task 3.1 (`computeMood`) |
| Trait derivation with canonical STAT_ORDER tie-break (NOT alphabetical) | Task 3.1 (`computeTrait`) |
| Next evolution with [0, 100] clamp + MAX state at level 100 | Task 3.1 (`nextPhaseProgress`) |
| RUN / DEV footer split, hide DEV row when no OTel | Task 1 (HTML), Task 3.3 (CLIENT_JS) |
| Stats grid: name \| value \| bar 3-col grid | Task 2 (CSS), Task 3.4 (HTML emission) |
| ACHIEVEMENTS card wraps existing V3.2 list unchanged | Task 1 (HTML wrapping) |
| `text-align: center` on `.pet` (and `width: fit-content` removed) | Task 2 (CSS) |
| No state schema bump | Implicit — no schema files touched |
| No Ink TUI changes | Implicit — Ink files not in any task |
| Version 3.3.0 + README + CHANGELOG | Task 4 |

**Placeholder scan:** No "TBD", "implement later", "fill in details". Every code block is complete. Every command has expected output. Every test that might break (Task 4.1) has explicit guidance on how to repair it.

**Type consistency:**
- `computeMood(s, nowMs)` signature in Task 3.1 matches its single caller in Task 3.2.
- `computeTrait(pet)` signature in Task 3.1 matches caller in Task 3.2.
- `nextPhaseProgress(level)` signature + return shape `{ nextPhase, percent, label }` in Task 3.1 matches caller in Task 3.2 (uses `evo.label`).
- HTML IDs introduced in Task 1 (`#mood`, `#trait`, `#next-evo`, `#level`, `#otel-row`) all populated/manipulated in Task 3.
- CSS class names in Task 2 (`.card`, `.card-label`, `.kv-row`, `.kv-label`, `.kv-value`, `.run-line`, `.run-prefix`, `.stat-name`, `.stat-val`, `.stat-bar`, `.stat-bar-fill`, `.subheader`) all referenced by HTML in Task 1 or HTML emission in Task 3.

**Escape rule reminder:** Task 3 explicitly flags the `\\n` / `\\s` double-escape pattern at the top, but no regex with backslash classes is needed in this task (the helpers use `String#charAt`, `String#slice`, `Math.min/max`, `Date#toISOString`, `Date#getHours` — no regex anywhere in the new code). The existing CLIENT_JS regexes (in `parseBuddyCard`, etc.) are untouched.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-02-petforge-v3-3-visual-restructure-plan.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review per task, 4 dispatches total. Same approach as V3.2 — proven workflow on this plan size.

**2. Inline Execution** — execute in this session via `superpowers:executing-plans`, batch with checkpoints between tasks.

Which approach?
