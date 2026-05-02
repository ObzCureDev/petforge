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
  .activity { text-align: center; color: #c9d1d9; margin-top: 1rem; font-size: 0.85rem; }
  .status { text-align: center; color: #6e7681; font-size: 0.75rem; }

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
      // Hatch ladder (level)
      case "hatch_egg": return { current: p.level || 0, target: 1 };
      case "hatch_hatchling": return { current: p.level || 0, target: 5 };
      case "hatch_junior": return { current: p.level || 0, target: 20 };
      case "hatch_adult": return { current: p.level || 0, target: 50 };
      case "hatch_elder": return { current: p.level || 0, target: 80 };
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
    byId("shiny").hidden = !s.pet.shiny;
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
        statsHtml += '<div class="stat-bar"><div class="stat-bar-fill" style="width:' + bpct + '%"></div></div>';
        statsHtml += '<span class="stat-val">' + bs.value + '</span>';
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
        statsHtml += '<div class="stat-bar"><div class="stat-bar-fill" style="width:' + pct + '%"></div></div>';
        statsHtml += '<span class="stat-val">' + v + '</span>';
        statsHtml += '</div>';
      }
    }
    byId("stats").innerHTML = statsHtml;

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

    byId("activity").textContent =
      "Sessions: " + s.counters.sessionsTotal +
      " · Streak: " + s.counters.streakDays + "d" +
      " · Prompts: " + s.counters.promptsTotal +
      " · Tools: " + s.counters.toolUseTotal;

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
