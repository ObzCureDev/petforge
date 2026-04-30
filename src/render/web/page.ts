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
<title>PetForge</title>
<style>${CSS}</style>
</head>
<body>
<main id="app">
  <pre id="pet" class="pet"></pre>
  <p class="header"><span id="species"></span> &middot; <span id="rarity"></span><span id="shiny" hidden> &#x2728;</span></p>
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
    <ul id="achievements"></ul>
  </section>
  <p id="activity" class="activity"></p>
  <p id="otel-activity" class="activity" hidden></p>
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
    color: #c9d1d9;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    margin: 0;
    padding: 1rem;
    min-height: 100vh;
  }
  main { max-width: 480px; margin: 0 auto; }
  .pet {
    font-size: 1.1rem;
    line-height: 1.1;
    white-space: pre;
    margin: 1rem auto;
    width: fit-content;
    min-height: 8em;
  }
  .header { text-align: center; opacity: 0.85; text-transform: uppercase; letter-spacing: 0.05em; }
  .xpbar { margin: 1.5rem 0; }
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
  .xpbar-label { text-align: center; opacity: 0.7; margin: 0.25rem 0; }
  h2 {
    font-size: 0.85rem;
    letter-spacing: 0.1em;
    opacity: 0.6;
    margin: 1rem 0 0.5rem;
  }
  .stat { display: flex; align-items: center; gap: 0.5rem; margin: 0.25rem 0; }
  .stat-name { width: 6em; opacity: 0.8; font-size: 0.85rem; }
  .stat-bar {
    flex: 1;
    background: #21262d;
    height: 0.6rem;
    border-radius: 0.2rem;
    overflow: hidden;
  }
  .stat-bar-fill { background: #2ea043; height: 100%; width: 0; transition: width 0.4s; }
  .stat-val { width: 2em; text-align: right; opacity: 0.7; }
  ul { list-style: none; padding: 0; margin: 0; columns: 2; gap: 1rem; }
  li { padding: 0.15rem 0; opacity: 0.5; }
  li.unlocked { opacity: 1; color: #3fb950; }
  .activity { text-align: center; opacity: 0.7; margin-top: 1rem; font-size: 0.85rem; }
  .status { text-align: center; opacity: 0.4; font-size: 0.75rem; }

  /* rarity glows */
  .rarity-uncommon  { text-shadow: 0 0 6px rgba(63,185,80,0.6); }
  .rarity-rare      { text-shadow: 0 0 8px rgba(88,166,255,0.7); }
  .rarity-epic      { text-shadow: 0 0 10px rgba(188,140,253,0.7); }
  .rarity-legendary { text-shadow: 0 0 12px rgba(255,215,0,0.8); animation: legendary-pulse 2s infinite; }
  @keyframes legendary-pulse { 0%,100% { filter: brightness(1); } 50% { filter: brightness(1.3); } }

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

  function render() {
    var s = currentState;
    var pet = byId("pet");
    if (!s) {
      pet.textContent = "(no state yet — open Claude Code to spawn your pet)";
      pet.className = "pet";
      byId("status").textContent = "waiting for first hook";
      return;
    }
    var phase = s.progress.phase;
    var species = s.pet.species;
    var speciesFrames = (FRAMES[species] && FRAMES[species][phase]) || [];
    var buddyOverride =
      s.buddy && s.buddy.userToggle === "on" && s.buddy.cardCache ? s.buddy.cardCache : null;
    var buddy = buddyOverride ? parseBuddyCard(buddyOverride) : { stats: [] };
    var frame = buddyOverride
      ? buddyOverride
      : (speciesFrames.length > 0 ? speciesFrames[frameIdx % speciesFrames.length] : "");
    pet.textContent = frame;
    var displayRarity = buddy.rarity || s.pet.rarity;
    pet.className = "pet phase-" + phase + " rarity-" + displayRarity + (s.pet.shiny ? " shiny" : "");

    byId("species").textContent = (buddy.name || species).toUpperCase();
    byId("rarity").textContent = displayRarity;
    byId("shiny").hidden = !s.pet.shiny;

    var prog = nextLevelProgress(s.progress.xp, s.progress.level);
    byId("xp-fill").style.width = (prog.ratio * 100) + "%";
    byId("xp-label").textContent = "L" + s.progress.level + "  " + prog.label;

    var useBuddyStats = buddy.stats && buddy.stats.length >= 3;
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
      var statKeys = ["focus", "grit", "flow", "craft", "spark"];
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
      achHtml += '<li class="' + (unlocked ? 'unlocked' : '') + '">';
      achHtml += (unlocked ? '✓' : '·') + ' ' + def.name;
      achHtml += '</li>';
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
    byId("status").textContent = "live · phase: " + phase;
  }

  // Animation tick — 8 FPS
  setInterval(function () { frameIdx++; render(); }, 125);

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
