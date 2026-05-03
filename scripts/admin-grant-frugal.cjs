#!/usr/bin/env node
/**
 * One-shot admin override: unlock the three Frugal achievements on the
 * local user's state.json. Awards their XP, recomputes level/phase, and
 * adds the IDs to pendingUnlocks so the cinematic plays.
 *
 * Uses proper-lockfile against the same target as the hook handler so it
 * is safe to run while `petforge up` / hooks are firing.
 */
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const lockfile = require(path.join(__dirname, "..", "node_modules", "proper-lockfile"));

const PETFORGE_DIR = path.join(os.homedir(), ".petforge");
const STATE_FILE = path.join(PETFORGE_DIR, "state.json");
const LOCK_FILE = path.join(PETFORGE_DIR, ".lock");

const FRUGAL_IDS = ["frugal_100p", "frugal_500p", "frugal_2kp"];
const FRUGAL_XP = { frugal_100p: 1000, frugal_500p: 3000, frugal_2kp: 10000 };

const LEVEL_BOUNDARIES = [
  { level: 1, xp: 0 },
  { level: 12, xp: 2000 },
  { level: 30, xp: 30000 },
  { level: 60, xp: 100000 },
  { level: 100, xp: 1000000 },
];

function xpForLevel(level) {
  if (level <= 1) return 0;
  if (level >= 100) return 1000000;
  const upperIndex = LEVEL_BOUNDARIES.findIndex((b) => level <= b.level);
  const upper = LEVEL_BOUNDARIES[upperIndex];
  const lower = LEVEL_BOUNDARIES[upperIndex - 1];
  const t = (level - lower.level) / (upper.level - lower.level);
  return Math.floor(lower.xp + (upper.xp - lower.xp) * Math.pow(t, 1.55));
}

function levelForXp(xp) {
  if (xp <= 0) return 1;
  for (let l = 100; l >= 1; l--) {
    if (xpForLevel(l) <= xp) return l;
  }
  return 1;
}

function phaseForLevel(level) {
  if (level >= 100) return "mythic";
  if (level >= 60) return "elder";
  if (level >= 30) return "adult";
  if (level >= 12) return "junior";
  if (level >= 5) return "hatchling";
  return "egg";
}

(async () => {
  // Touch lock target if absent (proper-lockfile requires it to exist).
  fs.appendFileSync(LOCK_FILE, "");
  const release = await lockfile.lock(LOCK_FILE, {
    realpath: false,
    stale: 5000,
    retries: { retries: 30, factor: 1.2, minTimeout: 20, maxTimeout: 200 },
  });

  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    const before = {
      xp: state.progress.xp,
      level: state.progress.level,
      phase: state.progress.phase,
      unlocked: state.achievements.unlocked.length,
    };

    let xpAwarded = 0;
    const newlyUnlocked = [];
    for (const id of FRUGAL_IDS) {
      if (!state.achievements.unlocked.includes(id)) {
        state.achievements.unlocked.push(id);
        state.achievements.pendingUnlocks.push(id);
        state.progress.xp += FRUGAL_XP[id];
        xpAwarded += FRUGAL_XP[id];
        newlyUnlocked.push(id);
      }
    }

    if (newlyUnlocked.length === 0) {
      console.log("✓ All 3 Frugal already unlocked, no change.");
      return;
    }

    const newLevel = levelForXp(state.progress.xp);
    if (newLevel > state.progress.level) state.progress.pendingLevelUp = true;
    state.progress.level = newLevel;
    state.progress.phase = phaseForLevel(newLevel);
    state.meta.updatedAt = Date.now();

    // Atomic write
    const tmp = STATE_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, STATE_FILE);

    console.log("=== Frugal admin grant ===");
    console.log("Before: xp=" + before.xp + " level=" + before.level + " phase=" + before.phase + " unlocked=" + before.unlocked);
    console.log("Granted: " + newlyUnlocked.join(", ") + " (+" + xpAwarded + " xp)");
    console.log("After:  xp=" + state.progress.xp + " level=" + state.progress.level + " phase=" + state.progress.phase + " unlocked=" + state.achievements.unlocked.length);
  } finally {
    try { await release(); } catch {}
  }
})().catch((err) => {
  console.error("FAIL:", err.message);
  process.exit(1);
});
