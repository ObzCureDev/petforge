/**
 * Optional runtime detection of Claude Buddy.
 *
 * PetForge never copies, persists, or parses any Buddy ASCII. We only
 * invoke `claude /buddy card` and pass its stdout straight through to the
 * renderer at display time. The state cache stores only:
 *   - whether Buddy is detected (bool)
 *   - when we last checked (epoch ms)
 *
 * Detection is cheap-but-not-free (spawn a child process), so:
 *   - if userToggle === "off": skip entirely
 *   - if userToggle === "on" or "auto": refresh at most once per 24h unless
 *     `force` is set (used by `petforge doctor`)
 *
 * On any failure (claude not on PATH, exit code non-zero, stderr-only output,
 * timeout): return { detected: false }. Never throw.
 */

import { spawn } from "node:child_process";
import os from "node:os";
import type { State } from "./schema.js";

export interface BuddyDetectionResult {
  detected: boolean;
  /** Ephemeral — used by renderer only. NOT persisted. */
  cardOutput?: string;
}

/**
 * Decide whether to display the user-imported Buddy ASCII instead of the
 * species frame. Returns the cached card text (with the cache having been
 * set explicitly via `petforge buddy import`) iff the user toggle is "on".
 *
 * The "on" gate keeps the import sticky-but-revertible: a user who imports
 * a Buddy then later runs `petforge buddy off` keeps the cache (so they
 * can re-enable later) but sees the PetForge visual in the meantime.
 */
export function pickBuddyFrame(state: State): string | undefined {
  if (state.buddy.userToggle !== "on") return undefined;
  const cache = state.buddy.cardCache;
  if (cache && cache.length > 0) return cache;
  return undefined;
}

export interface BuddyStat {
  name: string;
  value: number;
}

export interface BuddyParse {
  /** Buddy's individual name (e.g. "Huddle"). Single Title-Case token. */
  name?: string;
  /** Buddy's species/type (e.g. "OCTOPUS"). Always uppercased. */
  species?: string;
  /**
   * Lowercase rarity word as found in the card (e.g. "rare", "legendary").
   * Maps 1:1 to PetForge's rarity vocabulary when the words match.
   */
  rarity?: string;
  /** Number of `★` symbols in the rarity line (visual indicator). */
  rarityStars?: number;
  /** Stat lines parsed from the card, possibly empty. */
  stats: BuddyStat[];
}

/**
 * Parse 0..N "stat" lines out of an imported Buddy card. The shape is
 *
 *   [optional ` │ `]  NAME  [█░]+  NUMBER  [optional ` │ `]
 *
 * which matches both the boxed Anthropic /buddy card output (with `│`
 * borders) and a plain stripped variant. NAME must be at least two
 * uppercase letters; VALUE must be a 0..100 integer. Lines that don't
 * match are ignored — so the parser is lossless for non-stat content.
 *
 * Callers should treat fewer than 3 hits as "no stat block" to avoid
 * accidental matches in narrative text.
 */
const BUDDY_STAT_LINE_RE = /^\s*│?\s*([A-Z][A-Z\s]*?[A-Z]|[A-Z]{2,})\s+[█░]+\s+(\d+)\s*│?\s*$/;

export function extractBuddyStats(cardCache: string): BuddyStat[] {
  const out: BuddyStat[] = [];
  for (const line of cardCache.split("\n")) {
    const m = BUDDY_STAT_LINE_RE.exec(line);
    if (!m?.[1] || !m[2]) continue;
    const name = m[1].trim().replace(/\s+/g, " ");
    const value = Number.parseInt(m[2], 10);
    if (!Number.isFinite(value) || value < 0 || value > 100) continue;
    out.push({ name, value });
  }
  return out;
}

/**
 * Parse name / species / rarity / stats out of an imported Buddy card.
 *
 * The format produced by Anthropic's `/buddy card` is roughly:
 *
 *   ╭───────────────╮
 *   │  ★★★ RARE          OCTOPUS  │   ← rarity stars + word + species
 *   │     .----.                  │   ← visual
 *   │     ( o o )                 │
 *   │  Huddle                     │   ← Buddy's individual name
 *   │  "..."                      │   ← description (skipped)
 *   │  DEBUGGING  ████░  75       │   ← stats
 *   ╰───────────────╯
 *
 * The parser is intentionally tolerant: any subset of fields may be
 * present (e.g. a stripped-down import with just the visual + name still
 * yields `name`). Lines that don't match any pattern are ignored.
 */
const BUDDY_RARITY_SPECIES_RE = /^([★✦✧☆]+)\s+([A-Z]+)\s+([A-Z]+)$/;
const BUDDY_RARITY_ONLY_RE = /^([★✦✧☆]+)\s+([A-Z]{3,})$/;
const BUDDY_NAME_RE = /^([A-Z][a-z][A-Za-z'-]+)$/;

export function parseBuddyCard(cardCache: string): BuddyParse {
  const stats = extractBuddyStats(cardCache);
  let name: string | undefined;
  let species: string | undefined;
  let rarity: string | undefined;
  let rarityStars: number | undefined;

  for (const rawLine of cardCache.split("\n")) {
    // Strip leading/trailing box borders + whitespace for matching.
    const line = rawLine.replace(/^[\s│]+/, "").replace(/[\s│]+$/, "");
    if (line.length === 0) continue;

    if (rarity === undefined) {
      const both = BUDDY_RARITY_SPECIES_RE.exec(line);
      if (both?.[1] && both[2] && both[3]) {
        rarityStars = both[1].length;
        rarity = both[2].toLowerCase();
        species = both[3];
        continue;
      }
      const only = BUDDY_RARITY_ONLY_RE.exec(line);
      if (only?.[1] && only[2]) {
        rarityStars = only[1].length;
        rarity = only[2].toLowerCase();
        continue;
      }
    }

    if (name === undefined) {
      const m = BUDDY_NAME_RE.exec(line);
      if (m?.[1]) {
        name = m[1];
      }
    }
  }

  return { name, species, rarity, rarityStars, stats };
}

const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Check whether `claude` is on PATH. Cross-platform: tries `where claude`
 * on Windows and `command -v claude` on POSIX.
 *
 * Returns false on any failure. Never throws.
 */
export async function isClaudeOnPath(timeoutMs = 1500): Promise<boolean> {
  const isWindows = os.platform() === "win32";
  const cmd = isWindows ? "where" : "command";
  const args = isWindows ? ["claude"] : ["-v", "claude"];

  return await runChild(cmd, args, timeoutMs)
    .then((res) => res.code === 0 && res.stdout.trim().length > 0)
    .catch(() => false);
}

/**
 * Run `claude /buddy card` and capture stdout. Return both detected flag
 * and the raw stdout so the caller can either persist just the bool
 * (cache update) or pass the stdout to the renderer (live invocation).
 *
 * Timeout is critical — `claude` may hang if not configured. Default 750ms
 * matches the spec.
 */
export async function getBuddyCardOutput(timeoutMs = 750): Promise<BuddyDetectionResult> {
  try {
    const res = await runChild("claude", ["/buddy", "card"], timeoutMs);
    if (res.code === 0 && res.stdout.trim().length > 0) {
      return { detected: true, cardOutput: res.stdout };
    }
    return { detected: false };
  } catch {
    return { detected: false };
  }
}

/**
 * Detect whether Buddy is available. Returns just the bool — does NOT
 * include the cardOutput so callers can't accidentally persist it.
 *
 * If `claude` is not on PATH, skips the spawn entirely.
 */
export async function detectBuddy(timeoutMs = 750): Promise<{ detected: boolean }> {
  const onPath = await isClaudeOnPath();
  if (!onPath) return { detected: false };
  const result = await getBuddyCardOutput(timeoutMs);
  return { detected: result.detected };
}

/**
 * Decide whether to re-run detection given the current cached state.
 *
 * Rules:
 *  - userToggle "off" → never detect
 *  - force = true → always detect (used by `doctor`)
 *  - lastChecked + 24h < now → re-detect
 *  - otherwise: use cached
 */
export function shouldRefreshDetection(
  buddy: { lastChecked: number; userToggle: "auto" | "on" | "off" },
  now: number,
  force = false,
): boolean {
  if (buddy.userToggle === "off") return false;
  if (force) return true;
  return now - buddy.lastChecked > REFRESH_INTERVAL_MS;
}

// ---------- Internal: child-process runner ----------

interface ChildResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runChild(cmd: string, args: string[], timeoutMs: number): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      // ENOENT = command not on PATH. Fail soft.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        resolve({ code: 127, stdout: "", stderr: "" });
        return;
      }
      reject(err);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      resolve({ code: code ?? 0, stdout, stderr });
    });

    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      resolve({ code: 124, stdout, stderr });
    }, timeoutMs);
    if (typeof t.unref === "function") t.unref();
  });
}
