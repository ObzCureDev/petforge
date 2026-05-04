/**
 * Web page renderer for `petforge serve`.
 *
 * Returns a fully self-contained HTML document — no external assets, no
 * network calls. Embeds:
 *   - the initial state (server-rendered, so the page works even without JS),
 *   - the species frame registry (so the client can animate at 8 FPS),
 *   - the achievements registry and ids (so the client can render the grid),
 *   - the level-curve boundaries (so the client can compute the XP bar).
 *
 * The inline JS opens an EventSource on `/stream` and re-renders on every
 * push. It auto-reconnects on disconnect with exponential backoff.
 */

import { ACHIEVEMENTS } from "../../core/achievements.js";
import { ACHIEVEMENT_IDS, type State } from "../../core/schema.js";
import { LEVEL_BOUNDARIES } from "../../core/xp.js";
import { SPECIES_FRAMES } from "../species/index.js";
import { ICON_JPEG_B64, ICON_PNG_B64 } from "./icon-data.js";

/**
 * Escape any character that could break out of an inline `<script>` block,
 * with or without the JSON also being parsed via `JSON.parse`. The big
 * three are `<`, `>`, and `&` — `</script>` is the obvious break-out, and
 * U+2028 / U+2029 are JSON-legal but JS-source-illegal line terminators.
 *
 * The replacement strings are the *six-character* text `<` etc. (a
 * literal backslash followed by `u003c`) — JSON parsers turn these back
 * into the original character at parse time, but the inline script tag
 * stays parser-safe.
 */
function safeJson(value: unknown): string {
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);
  const BS = String.fromCharCode(0x5c); // backslash
  return JSON.stringify(value)
    .split("<")
    .join(`${BS}u003c`)
    .split(">")
    .join(`${BS}u003e`)
    .split("&")
    .join(`${BS}u0026`)
    .split(LS)
    .join(`${BS}u2028`)
    .split(PS)
    .join(`${BS}u2029`);
}

export function renderPage(state: State | null): string {
  const initialState = state ? safeJson(state) : "null";
  const framesJson = safeJson(SPECIES_FRAMES);
  const achievementsJson = safeJson(ACHIEVEMENTS);
  const achievementIdsJson = safeJson(ACHIEVEMENT_IDS);
  const boundariesJson = safeJson(LEVEL_BOUNDARIES);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0d1117">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="PetForge">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" type="image/png" sizes="512x512" href="/icon-512.png?v=2">
<link rel="apple-touch-icon" sizes="512x512" href="/icon-512.png?v=2">
<link rel="alternate icon" type="image/jpeg" href="/icon.jpg?v=2">
<title>PetForge</title>
<style>${CSS}</style>
</head>
<body>
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
  <section class="card goals-card" id="goals-card" hidden>
    <p class="card-label">Next Goals</p>
    <div id="goals"></div>
  </section>
  <section class="card achievements-card">
    <p class="card-label">Achievements</p>
    <div id="achievements"></div>
  </section>
  <p id="status" class="status"></p>
</main>
<script id="initial-state" type="application/json">${initialState}</script>
<script id="frames" type="application/json">${framesJson}</script>
<script id="achievements-data" type="application/json">${achievementsJson}</script>
<script id="achievement-ids" type="application/json">${achievementIdsJson}</script>
<script id="boundaries" type="application/json">${boundariesJson}</script>
<script>${CLIENT_JS}</script>
</body>
</html>`;
}

const CSS = `
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

  /* Legacy ul/li (unused in V3.3 but kept harmless) */
  ul { list-style: none; padding: 0; margin: 0; }
  li { padding: 0.15rem 0; color: #8b949e; }
  li.unlocked { color: #3fb950; }

  /* Achievement detail (clickable) */
  .ach {
    border-bottom: 1px solid #21262d;
    padding: 0;
    color: #8b949e;
  }
  .ach.unlocked { color: #e6edf3; }
  .ach-summary {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0;
    cursor: pointer;
    list-style: none;
    user-select: none;
  }
  .ach-summary::-webkit-details-marker { display: none; }
  .ach-summary::marker { content: ''; }
  .ach-mark { width: 1em; flex-shrink: 0; color: #6e7681; font-weight: bold; }
  .ach.unlocked .ach-mark { color: #3fb950; }
  .ach-name { flex: 1; font-size: 0.95rem; }
  .ach-pct { color: #58a6ff; font-size: 0.8rem; min-width: 3em; text-align: right; font-weight: 600; }
  .ach.unlocked .ach-pct { color: #3fb950; }
  .ach-detail {
    padding: 0.4rem 0 0.85rem 1.5em;
    font-size: 0.85rem;
  }
  .ach-desc { margin: 0 0 0.5rem 0; color: #c9d1d9; line-height: 1.4; }
  .ach-bar-track {
    background: #21262d;
    height: 0.4rem;
    border-radius: 0.2rem;
    overflow: hidden;
    margin: 0.25rem 0;
  }
  .ach-bar-fill {
    background: #58a6ff;
    height: 100%;
    transition: width 0.4s;
  }
  .ach.unlocked .ach-bar-fill { background: #3fb950; }
  /* Medal-specific tints (overrides .ach.unlocked default). */
  .ach.medal-bronze.unlocked .ach-bar-fill   { background: #cd7f32; }
  .ach.medal-bronze.unlocked .ach-pct        { color: #cd7f32; }
  .ach.medal-bronze.unlocked .ach-mark       { color: #cd7f32; }
  .ach.medal-silver.unlocked .ach-bar-fill   { background: #c9d1d9; }
  .ach.medal-silver.unlocked .ach-pct        { color: #c9d1d9; }
  .ach.medal-silver.unlocked .ach-mark       { color: #c9d1d9; }
  .ach.medal-gold.unlocked .ach-bar-fill     { background: #ffd700; }
  .ach.medal-gold.unlocked .ach-pct          { color: #ffd700; }
  .ach.medal-gold.unlocked .ach-mark         { color: #ffd700; }
  .ach.medal-platinum.unlocked .ach-bar-fill { background: #79c0ff; }
  .ach.medal-platinum.unlocked .ach-pct      { color: #79c0ff; }
  .ach.medal-platinum.unlocked .ach-mark     { color: #79c0ff; }
  .ach-progress-label { margin: 0.2rem 0 0; color: #8b949e; font-size: 0.8rem; }
  .status { text-align: center; color: #6e7681; font-size: 0.75rem; }

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
  /* V3.5.2 - failed = terminal side-condition violation (frugal cost over ceiling). */
  .ach[data-status="failed"] .ach-status { color: #f85149; }
  .ach[data-status="failed"] .ach-pct    { color: #f85149; font-weight: 600; }
  .ach[data-status="failed"] .ach-name   { color: #8b949e; text-decoration: line-through; }
  .ach[data-status="failed"] .ach-bar-fill { background: #6e7681; }

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

  /* rarity glows on the pet ASCII (text-shadow only, body color unchanged) */
  .rarity-uncommon  { text-shadow: 0 0 6px rgba(63,185,80,0.6); }
  .rarity-rare      { text-shadow: 0 0 8px rgba(88,166,255,0.7); }
  .rarity-epic      { text-shadow: 0 0 10px rgba(188,140,253,0.7); }
  .rarity-legendary { text-shadow: 0 0 12px rgba(255,215,0,0.8); animation: legendary-pulse 2s infinite; }
  @keyframes legendary-pulse { 0%,100% { filter: brightness(1); } 50% { filter: brightness(1.3); } }

  /* rarity colors on the header word (independent of pet glow) */
  .rarity-tag-common    { color: #8b949e; }
  .rarity-tag-uncommon  { color: #3fb950; }
  .rarity-tag-rare      { color: #58a6ff; }
  .rarity-tag-epic      { color: #bc8cfd; }
  .rarity-tag-legendary { color: #ffd700; text-shadow: 0 0 4px rgba(255,215,0,0.4); }

  /* shiny rainbow */
  .shiny { animation: shiny-cycle 4s linear infinite; }
  @keyframes shiny-cycle {
    0%,100% { color: #ff6b6b; }
    25%     { color: #feca57; }
    50%     { color: #48dbfb; }
    75%     { color: #ff9ff3; }
  }

  /* phase effects */
  .phase-egg     { animation: egg-wobble 2.5s ease-in-out infinite; }
  .phase-junior  { text-shadow: 0 0 8px rgba(255,215,0,0.5); }
  .phase-elder   { animation: shimmer 3s ease-in-out infinite; }
  .phase-mythic  { animation: mythic-pulse 2s ease-in-out infinite; }
  @keyframes shimmer       { 0%,100% { filter: brightness(1); } 50% { filter: brightness(1.4); } }
  @keyframes mythic-pulse  { 0%,100% { transform: scale(1); } 50% { transform: scale(1.05); } }
  @keyframes egg-wobble    { 0%,100% { transform: rotate(0deg); } 25% { transform: rotate(-1deg); } 75% { transform: rotate(1deg); } }
`;

// NB: the inline client script uses string concatenation rather than nested
// template literals to keep escaping sane. The browser sees plain JS.
const CLIENT_JS = `
(function () {
  var byId = function (id) { return document.getElementById(id); };
  var initialEl = byId("initial-state");
  var initial = initialEl && initialEl.textContent ? JSON.parse(initialEl.textContent) : null;
  var FRAMES = JSON.parse(byId("frames").textContent);
  var ACH = JSON.parse(byId("achievements-data").textContent);
  var ACH_IDS = JSON.parse(byId("achievement-ids").textContent);
  var BOUNDARIES = JSON.parse(byId("boundaries").textContent);

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

  /**
   * V3.5.2 — detect achievements whose side condition has been
   * permanently violated and can no longer unlock.
   *
   * Currently only covers Frugal: the prompt count grows monotonically,
   * but the cost ceiling is one-way too — once cost crosses the cap,
   * the achievement is dead forever (no way to give back money).
   *
   * Cache_* are NOT terminal: hit ratio can recover with more cache reads.
   * Marathon, streak, etc. are not terminal either.
   */
  function isTerminallyFailed(id, state) {
    var c = state.counters || {};
    var o = c.otel || {};
    var costCents = o.costUsdCents || 0;
    if (id === "frugal_100p") return costCents > 1000;   // > $10
    if (id === "frugal_500p") return costCents > 5000;   // > $50
    if (id === "frugal_2kp") return costCents > 20000;   // > $200
    return false;
  }

  function getStatus(id, state) {
    // Single source of truth: only the unlocked array marks an achievement
    // as completed. Compound achievements (cache_*, frugal_*) can have
    // current >= target on volume but still be ungated; the achievement is
    // only completed when the engine has run all gates and pushed the id
    // into unlocked. The next hook event runs backfillEarnedAchievements,
    // which catches simple thresholds; OTel-gated ones get caught by the
    // next collect tick.
    if (state.achievements.unlocked.indexOf(id) !== -1) return "completed";
    if (isTerminallyFailed(id, state)) return "failed";
    var p = achievementProgress(id, state);
    if (p.target > 0 && p.current > 0) return "in-progress";
    return "locked";
  }

  var STATUS_SYMBOL = {
    "completed": "✅",
    "in-progress": "◐",
    "locked": "○",
    "failed": "✗",
  };

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

  function xpForLevel(level) {
    if (level <= 1) return 0;
    if (level >= 100) return 1000000;
    var upperIdx = -1;
    for (var i = 0; i < BOUNDARIES.length; i++) {
      if (level <= BOUNDARIES[i].level) { upperIdx = i; break; }
    }
    if (upperIdx <= 0) return 0;
    var upper = BOUNDARIES[upperIdx];
    var lower = BOUNDARIES[upperIdx - 1];
    var t = (level - lower.level) / (upper.level - lower.level);
    var curved = Math.pow(t, 1.55);
    return Math.floor(lower.xp + (upper.xp - lower.xp) * curved);
  }

  function compact(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return String(n);
  }

  // Per-achievement progress used by the click-to-expand details. Mirrors the
  // unlock conditions in src/core/achievements.ts and src/core/otel/achievements.ts.
  function achievementProgress(id, s) {
    var c = s.counters || {};
    var p = s.progress || {};
    var o = c.otel || {};
    function maxOver(field) {
      var max = 0;
      var as = c.activeSessions || {};
      for (var k in as) {
        var v = as[k] && as[k][field];
        if (typeof v === "number" && v > max) max = v;
        if (Array.isArray(v) && v.length > max) max = v.length;
      }
      return max;
    }
    // Active-session duration in ms (max across all open sessions).
    function activeSessionDurationMs() {
      var as = c.activeSessions || {};
      var max = 0;
      var nowMs = Date.now();
      for (var k in as) {
        var ts = as[k] && as[k].startTs;
        if (typeof ts === "number") {
          var d = nowMs - ts;
          if (d > max) max = d;
        }
      }
      return max;
    }
    var FOUR_H = 4 * 60 * 60 * 1000;
    var TWELVE_H = 12 * 60 * 60 * 1000;
    var TWENTYFOUR_H = 24 * 60 * 60 * 1000;
    switch (id) {
      // Hatch ladder (level) — must match phaseForLevel (xp.ts).
      case "hatch_egg": return { current: p.level || 0, target: 1 };
      case "hatch_hatchling": return { current: p.level || 0, target: 5 };
      case "hatch_junior": return { current: p.level || 0, target: 12 };
      case "hatch_adult": return { current: p.level || 0, target: 30 };
      case "hatch_elder": return { current: p.level || 0, target: 60 };
      case "hatch_mythic": return { current: p.level || 0, target: 100 };
      // Streak
      case "streak_3d": return { current: c.streakDays || 0, target: 3 };
      case "streak_7d": return { current: c.streakDays || 0, target: 7 };
      case "streak_30d": return { current: c.streakDays || 0, target: 30 };
      case "streak_100d": return { current: c.streakDays || 0, target: 100 };
      // Tool
      case "tool_5k": return { current: c.toolUseTotal || 0, target: 5000 };
      case "tool_25k": return { current: c.toolUseTotal || 0, target: 25000 };
      case "tool_100k": return { current: c.toolUseTotal || 0, target: 100000 };
      // Marathon
      case "marathon_4h": return { current: Math.min(FOUR_H, activeSessionDurationMs()), target: FOUR_H };
      case "marathon_12h": return { current: Math.min(TWELVE_H, activeSessionDurationMs()), target: TWELVE_H };
      case "marathon_24h": return { current: Math.min(TWENTYFOUR_H, activeSessionDurationMs()), target: TWENTYFOUR_H };
      // Night
      case "night_200": return { current: c.nightOwlEvents || 0, target: 200 };
      case "night_1k": return { current: c.nightOwlEvents || 0, target: 1000 };
      case "night_5k": return { current: c.nightOwlEvents || 0, target: 5000 };
      // Polyglot (max distinct extensions across active sessions)
      case "polyglot_5": return { current: maxOver("fileExtensions"), target: 5 };
      case "polyglot_8": return { current: maxOver("fileExtensions"), target: 8 };
      case "polyglot_12": return { current: maxOver("fileExtensions"), target: 12 };
      // Refactor (max tool count across active sessions)
      case "refactor_100": return { current: maxOver("toolUseCount"), target: 100 };
      case "refactor_250": return { current: maxOver("toolUseCount"), target: 250 };
      case "refactor_500": return { current: maxOver("toolUseCount"), target: 500 };
      // Code lines (OTel)
      case "code_10k": return { current: o.linesAdded || 0, target: 10000 };
      case "code_50k": return { current: o.linesAdded || 0, target: 50000 };
      case "code_200k": return { current: o.linesAdded || 0, target: 200000 };
      // Token (OTel)
      case "token_1m": return { current: (o.tokensIn || 0) + (o.tokensOut || 0), target: 1000000 };
      case "token_10m": return { current: (o.tokensIn || 0) + (o.tokensOut || 0), target: 10000000 };
      case "token_100m": return { current: (o.tokensIn || 0) + (o.tokensOut || 0), target: 100000000 };
      // Cache (OTel) - show volume progress; ratio is a side-condition
      case "cache_100k": return { current: (o.tokensIn || 0) + (o.tokensCacheRead || 0), target: 100000 };
      case "cache_1m": return { current: (o.tokensIn || 0) + (o.tokensCacheRead || 0), target: 1000000 };
      case "cache_10m": return { current: (o.tokensIn || 0) + (o.tokensCacheRead || 0), target: 10000000 };
      // Frugal (OTel) - show prompt progress; cost ceiling is a side-condition
      case "frugal_100p": return { current: c.promptsTotal || 0, target: 100 };
      case "frugal_500p": return { current: c.promptsTotal || 0, target: 500 };
      case "frugal_2kp": return { current: c.promptsTotal || 0, target: 2000 };
      // Big spender (OTel) - costUsdCents in cents; thresholds in cents
      case "big_spender_100": return { current: o.costUsdCents || 0, target: 10000 };
      case "big_spender_500": return { current: o.costUsdCents || 0, target: 50000 };
      case "big_spender_2k": return { current: o.costUsdCents || 0, target: 200000 };
      // PR (OTel)
      case "pr_50": return { current: o.prCount || 0, target: 50 };
      case "pr_200": return { current: o.prCount || 0, target: 200 };
      case "pr_500": return { current: o.prCount || 0, target: 500 };
      // Picky (OTel)
      case "picky_50": return { current: o.editsRejected || 0, target: 50 };
      case "picky_250": return { current: o.editsRejected || 0, target: 250 };
      case "picky_1k": return { current: o.editsRejected || 0, target: 1000 };
      default: return { current: 0, target: 1 };
    }
  }

  function stripBuddyStatLines(cache) {
    if (!cache) return cache;
    var statRe = /^\\s*\\u2502?\\s*([A-Z][A-Z\\s]*?[A-Z]|[A-Z]{2,})\\s+[\\u2588\\u2591]+\\s+(\\d+)\\s*\\u2502?\\s*$/;
    var emptyBoxRe = /^[\\s\\u2502]*$/;
    var lines = String(cache).split("\\n").filter(function (l) { return !statRe.test(l); });
    var out = [];
    var prevEmpty = false;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      var cur = emptyBoxRe.test(l) && l.indexOf("\\u2502") !== -1;
      if (cur && prevEmpty) continue;
      out.push(l);
      prevEmpty = cur;
    }
    return out.join("\\n");
  }

  function parseBuddyCard(cache) {
    if (!cache) return { stats: [] };
    var stats = [];
    var statRe = /^\\s*\\u2502?\\s*([A-Z][A-Z\\s]*?[A-Z]|[A-Z]{2,})\\s+[\\u2588\\u2591]+\\s+(\\d+)\\s*\\u2502?\\s*$/;
    var raritySpeciesRe = /^([\\u2605\\u2606\\u2726\\u2727]+)\\s+([A-Z]+)\\s+([A-Z]+)$/;
    var rarityOnlyRe = /^([\\u2605\\u2606\\u2726\\u2727]+)\\s+([A-Z]{3,})$/;
    var nameRe = /^([A-Z][a-z][A-Za-z'-]+)$/;
    var name, species, rarity, rarityStars;
    var lines = String(cache).split("\\n");
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      var ms = statRe.exec(raw);
      if (ms) {
        var v = parseInt(ms[2], 10);
        if (isFinite(v) && v >= 0 && v <= 100) {
          stats.push({ name: ms[1].replace(/\\s+/g, " ").trim(), value: v });
        }
        continue;
      }
      var line = raw.replace(/^[\\s\\u2502]+/, "").replace(/[\\s\\u2502]+$/, "");
      if (line.length === 0) continue;
      if (rarity === undefined) {
        var both = raritySpeciesRe.exec(line);
        if (both) { rarityStars = both[1].length; rarity = both[2].toLowerCase(); species = both[3]; continue; }
        var only = rarityOnlyRe.exec(line);
        if (only) { rarityStars = only[1].length; rarity = only[2].toLowerCase(); continue; }
      }
      if (name === undefined) {
        var nm = nameRe.exec(line);
        if (nm) { name = nm[1]; continue; }
      }
    }
    return { name: name, species: species, rarity: rarity, rarityStars: rarityStars, stats: stats };
  }

  function nextLevelProgress(xp, level) {
    if (level >= 100) {
      return { ratio: 1, isMaxed: true, label: "MAX (" + xp.toLocaleString() + " xp)" };
    }
    var cur = xpForLevel(level);
    var nxt = xpForLevel(level + 1);
    var into = xp - cur;
    var total = nxt - cur;
    var ratio = total > 0 ? into / total : 0;
    return {
      ratio: ratio,
      isMaxed: false,
      label: into.toLocaleString() + " / " + total.toLocaleString() + " xp"
    };
  }

  var frameIdx = 0;
  var currentState = initial;

  // Cached per-state derived values, refreshed by renderState(). renderFrame
  // reads from this cache so the animation tick never re-parses the buddy
  // card or rebuilds the species lookup.
  var derived = { species: null, frames: [], className: "pet" };

  function computeDerived(s) {
    var phase = s.progress.phase;
    var buddyOn = s.buddy && s.buddy.userToggle === "on" && s.buddy.cardCache;
    var buddy = buddyOn ? parseBuddyCard(s.buddy.cardCache) : { stats: [] };
    var matchedSpecies =
      buddy.species && FRAMES[buddy.species.toLowerCase()] ? buddy.species.toLowerCase() : null;
    var species = matchedSpecies || s.pet.species;
    var frames = (FRAMES[species] && FRAMES[species][phase]) || [];
    var displayRarity = buddy.rarity || s.pet.rarity;
    return {
      buddy: buddy,
      buddyOn: !!buddyOn,
      phase: phase,
      species: species,
      frames: frames,
      displayRarity: displayRarity,
      className: "pet phase-" + phase + " rarity-" + displayRarity + (s.pet.shiny ? " shiny" : ""),
    };
  }

  // Animation-only update: cycles the pet frame from the cached species
  // frames. Does NOT touch any other DOM, so user-opened <details> elements
  // (achievements) stay open across the 8 FPS tick.
  function renderFrame() {
    var pet = byId("pet");
    if (!currentState) {
      pet.textContent = "(no state yet — open Claude Code to spawn your pet)";
      pet.className = "pet";
      return;
    }
    var fr = derived.frames;
    if (fr.length > 0) {
      // Strip per-line leading/trailing whitespace so CSS text-align: center
      // can center each line individually. NB: this code lives inside a TS
      // template literal — backslashes must be DOUBLE-escaped so the browser
      // sees a real \\n separator and a real \\s regex class.
      var raw = fr[frameIdx % fr.length];
      var trimmed = raw.split("\\n").map(function (l) { return l.replace(/^\\s+|\\s+$/g, ""); }).join("\\n");
      pet.textContent = trimmed;
    }
    pet.className = derived.className;
  }

  // Data update: runs on every SSE push. Refreshes the derived cache and
  // the static-but-data-driven elements (header, xp bar, stats panel,
  // achievements list, activity, otel block).
  function renderState() {
    var s = currentState;
    if (!s) {
      byId("status").textContent = "waiting for first hook";
      return;
    }
    derived = computeDerived(s);
    var phase = derived.phase;
    var species = derived.species;
    var buddy = derived.buddy;
    var displayRarity = derived.displayRarity;

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
    var useBuddyStats = buddy.stats && buddy.stats.length >= 3;

    var prog = nextLevelProgress(s.progress.xp, s.progress.level);
    byId("xp-fill").style.width = (prog.ratio * 100) + "%";
    // Plain string replace (single occurrence per label) — avoids regex
    // escape pitfalls when this source ships through biome / TS template literal.
    var xpText = prog.label.replace("xp", "XP");
    byId("xp-label").textContent = "LVL " + s.progress.level + " - " + xpText;

    var statsHtml = "";
    if (useBuddyStats) {
      for (var bi = 0; bi < buddy.stats.length; bi++) {
        var bs = buddy.stats[bi];
        var bpct = Math.max(0, Math.min(100, bs.value));
        statsHtml += '<div class="stat">';
        statsHtml += '<span class="stat-name">' + bs.name + '</span>';
        statsHtml += '<span class="stat-val">' + bs.value + '</span>';
        statsHtml += '<div class="stat-bar"><div class="stat-bar-fill" style="width:' + bpct + '%"></div></div>';
        statsHtml += '</div>';
      }
    } else {
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
    }
    byId("stats").innerHTML = statsHtml;

    function renderAchievementRow(id, state) {
      var def = ACH[id];
      var status = getStatus(id, state);
      var prog = achievementProgress(id, state);
      var ratio = prog.target > 0 ? Math.min(1, prog.current / prog.target) : 0;
      // Only "completed" rounds to 100%. Anything in-progress or locked is
      // floored AND capped at 99% so a near-target ratio (e.g. 999_803 /
      // 1_000_000 = 99.9803%) doesn't render as "100%" before the unlock
      // is actually persisted to state.achievements.unlocked.
      var pctStr;
      if (status === "completed") {
        pctStr = "100%";
      } else if (status === "failed") {
        pctStr = "failed";
      } else {
        var rawPct = Math.floor(ratio * 100);
        pctStr = Math.min(99, rawPct) + "%";
      }
      var progressLabel = prog.current.toLocaleString() + " / " + prog.target.toLocaleString();
      var medal = def.medal || "";
      var medalEmoji = medal === "bronze" ? "🥉"
        : medal === "silver" ? "🥈"
        : medal === "gold" ? "🥇"
        : medal === "platinum" ? "💎"
        : "";
      var classes = "ach " + status + (medal ? " medal-" + medal : "");
      var symbol = STATUS_SYMBOL[status];

      var html = '<details class="' + classes + '" data-status="' + status + '" data-ach-id="' + id + '">';
      html += '<summary class="ach-summary">';
      html += '<span class="ach-status">' + symbol + '</span> ';
      if (medalEmoji) html += '<span class="ach-medal">' + medalEmoji + '</span> ';
      else html += '<span class="ach-medal" style="visibility:hidden">.</span> ';
      html += '<span class="ach-name">' + def.name + '</span>';
      html += '<span class="ach-pct">' + (status === "completed" ? "" : pctStr) + '</span>';
      // The summary mini-bar is hidden for completed AND failed (failed
      // would show a misleading partial progress).
      var barPct = status === "completed" ? 100 : Math.min(99, Math.floor(ratio * 100));
      html += '<div class="ach-mini-bar"><div class="ach-mini-bar-fill" style="width:' + barPct + '%"></div></div>';
      html += '</summary>';
      html += '<div class="ach-detail">';
      html += '<p class="ach-desc">' + def.description + '</p>';
      html += '<div class="ach-bar-track"><div class="ach-bar-fill" style="width:' + barPct + '%"></div></div>';
      // Completed: just the unlocked tag (no current/target — it's
      // confusing for hatch_* where current = current level and the user
      // long since blew past the threshold, e.g. "48 / 5 unlocked").
      // Failed: explain why (frugal cost ceiling exceeded).
      var labelHtml;
      if (status === "completed") {
        labelHtml = "unlocked (+" + def.xp + " xp)";
      } else if (status === "failed") {
        labelHtml = progressLabel + " · spend ceiling exceeded — no longer reachable";
      } else {
        labelHtml = progressLabel;
      }
      html += '<p class="ach-progress-label">' + labelHtml + '</p>';
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

      var html = '<details class="cat-details" data-cat="' + name + '"' + (isOpen ? ' open' : '') + '>';
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
    // V3.5.2 — capture which <details> are open right before we blow
    // away the DOM, so we can restore them afterwards. Without this, any
    // SSE-driven re-render snaps every accordion shut.
    function captureOpenState(rootEl) {
      var openAch = {};
      var openCat = {};
      if (!rootEl) return { ach: openAch, cat: openCat };
      var detailsList = rootEl.querySelectorAll("details");
      for (var i = 0; i < detailsList.length; i++) {
        var d = detailsList[i];
        if (!d.open) continue;
        var aid = d.getAttribute("data-ach-id");
        if (aid) openAch[aid] = true;
        var cn = d.getAttribute("data-cat");
        if (cn) openCat[cn] = true;
      }
      return { ach: openAch, cat: openCat };
    }
    function restoreOpenState(rootEl, state) {
      if (!rootEl) return;
      var detailsList = rootEl.querySelectorAll("details");
      for (var i = 0; i < detailsList.length; i++) {
        var d = detailsList[i];
        var aid = d.getAttribute("data-ach-id");
        if (aid && state.ach[aid]) d.open = true;
        var cn = d.getAttribute("data-cat");
        if (cn && state.cat[cn]) d.open = true;
      }
    }
    var goalsRoot = byId("goals");
    var achievementsRoot = byId("achievements");
    var prevOpen = {
      goals: captureOpenState(goalsRoot),
      ach: captureOpenState(achievementsRoot),
    };

    var ng = nextGoals(s);
    var goalsCard = byId("goals-card");
    if (ng.length > 0) {
      var goalsHtml = "";
      for (var gi = 0; gi < ng.length; gi++) goalsHtml += renderAchievementRow(ng[gi].id, s);
      goalsRoot.innerHTML = goalsHtml;
      goalsCard.hidden = false;
    } else {
      goalsRoot.innerHTML = "";
      goalsCard.hidden = true;
    }

    // 2. Achievements card body: Near completion (if any) + 7 real categories.
    var achHtml = "";
    var nc = nearCompletion(s);
    if (nc.length > 0) {
      var ncIds = nc.map(function (a) { return a.id; });
      achHtml += renderCategorySection("Near completion", ncIds, s, true, nc.length);
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
    achievementsRoot.innerHTML = achHtml;

    // Restore previously-open accordions (categories + individual rows).
    restoreOpenState(goalsRoot, prevOpen.goals);
    restoreOpenState(achievementsRoot, prevOpen.ach);

    byId("activity").textContent =
      "Sessions " + s.counters.sessionsTotal.toLocaleString() +
      " · Streak " + s.counters.streakDays + "d" +
      " · Prompts " + s.counters.promptsTotal.toLocaleString() +
      " · Tools " + s.counters.toolUseTotal.toLocaleString();

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
    byId("status").textContent = "live";
  }

  // Initial paint: full state + first frame.
  function render() { renderState(); renderFrame(); }

  // Animation tick — 8 FPS, frame-only (preserves user-opened <details>).
  setInterval(function () { frameIdx++; renderFrame(); }, 125);

  // SSE
  var backoff = 500;
  function connect() {
    var tokenMatch = location.search.match(/token=([^&]+)/);
    var fullUrl = "/stream" + (tokenMatch ? "?token=" + tokenMatch[1] : "");
    var es = new EventSource(fullUrl);
    es.onmessage = function (ev) {
      try {
        currentState = JSON.parse(ev.data);
        backoff = 500;
        render();
      } catch (_) {}
    };
    es.onerror = function () {
      es.close();
      byId("status").textContent = "reconnecting...";
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 10000);
    };
  }

  render();
  if (typeof EventSource !== "undefined") {
    connect();
  } else {
    byId("status").textContent = "live updates not supported in this browser";
  }
})();
`;

/**
 * PWA icons as Buffers ready to serve. Sources in `src/render/web/assets/`,
 * inlined via base64 so the bundled CLI stays self-contained.
 *  - PNG 512x512 (square, dark padding) is the primary icon: iOS
 *    apple-touch-icon, Android web manifest. Standard PWA size.
 *  - JPEG 531x477 is the original artwork, kept as a fallback.
 */
export const ICON_PNG_BUFFER = Buffer.from(ICON_PNG_B64, "base64");
export const ICON_PNG_TYPE = "image/png";
export const ICON_JPEG_BUFFER = Buffer.from(ICON_JPEG_B64, "base64");
export const ICON_JPEG_TYPE = "image/jpeg";

/**
 * Cache-busting suffix for icon URLs. Bump when the icon assets change so
 * iOS / Android re-fetch the updated PWA icon on next "Add to Home Screen".
 */
export const ICON_VERSION = "2";

/**
 * Web manifest enabling install-to-home-screen on iOS / Android. Standalone
 * display strips the browser chrome so the served page feels like an app.
 */
export const MANIFEST_JSON = JSON.stringify(
  {
    name: "PetForge",
    short_name: "PetForge",
    description: "Local-first RPG progression layer for AI coding companions",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0d1117",
    theme_color: "#0d1117",
    icons: [
      {
        src: "/icon-512.png?v=2",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png?v=2",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  },
  null,
  2,
);
