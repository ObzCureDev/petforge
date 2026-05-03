/**
 * `petforge hook --event <name>` — internal endpoint called by Claude Code hooks.
 *
 * Constraints:
 *  - Must complete in <50ms (lock + state I/O + recompute + write)
 *  - MUST NOT print to stdout (Claude Code can inject hook stdout into its
 *    own context depending on event type — silence is mandatory)
 *  - On any error: log to ~/.petforge/hook-errors.log and exit 0
 *    (a failing hook must never break the user's Claude workflow)
 *
 * Architecture:
 *  - `applyHookEvent(state, event, payload, now)` is a pure synchronous
 *    mutator. Easy to unit-test without disk I/O or process spawning.
 *  - `runHook(event, payload, now)` is the I/O layer: locks the state,
 *    delegates to `applyHookEvent`, persists atomically.
 *  - `hookCli(argv)` is the CLI shell: parses args, reads stdin, swallows
 *    every error to the hook-error log, returns the exit code (0 on
 *    success or recoverable error).
 */

import {
  ACHIEVEMENTS,
  backfillEarnedAchievements,
  checkAchievementsForEvent,
  type HookEvent,
  isNightOwlHour,
  updateStreak,
} from "../core/achievements.js";
import type { AchievementId } from "../core/schema.js";
import { generatePet } from "../core/pet-engine.js";
import type { State } from "../core/schema.js";
import { logHookError, recoverCorruptState, withStateLock } from "../core/state.js";
import { levelForXp, phaseForLevel } from "../core/xp.js";

/** Tool names that include a file path — used for polyglot extension tracking. */
const FILE_PATH_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/**
 * V3.5.3 — two-tier inactivity threshold.
 *
 * Distinguishes batch noise from real interactive sessions by whether
 * any tool was used. A `claude -p` subprocess that never invoked a tool
 * is treated as ephemeral and pruned aggressively (30 min idle).
 * A session with at least one tool use is treated as a real coding
 * session: it survives breaks (lunch, sleep, returning the next day)
 * and only dies after 24h of total inactivity.
 *
 * This protects marathon achievements (4h / 12h / 24h) for users who
 * leave Claude Code open across breaks while still cleaning up the
 * orphan entries that V3.5 was designed to address.
 */
const TOOLLESS_PRUNE_MS = 30 * 60 * 1000; //  30 min — batch noise
const ACTIVE_PRUNE_MS = 24 * 60 * 60 * 1000; // 24h    — real sessions

const MARATHON_THRESHOLDS: ReadonlyArray<{ id: AchievementId; ms: number }> = [
  { id: "marathon_24h", ms: 24 * 60 * 60 * 1000 },
  { id: "marathon_12h", ms: 12 * 60 * 60 * 1000 },
  { id: "marathon_4h", ms: 4 * 60 * 60 * 1000 },
];

/**
 * Remove inactive activeSessions entries.
 *
 * Two-tier:
 *   - tool-less (likely batch noise) → 30 min inactivity
 *   - has tool use (real session)    → 24 h inactivity
 *
 * Before deleting, save any marathon thresholds the session crossed —
 * a long session that's about to be pruned should still award its
 * marathon medal. Without this, sessions that lived past 24h before
 * being pruned silently never unlocked marathon_24h.
 *
 * Falls back to `startTs` for pre-V3.5 sessions without `lastEventTs`.
 */
function pruneStaleSessions(state: State, now: number): void {
  for (const [sid, session] of Object.entries(state.counters.activeSessions)) {
    const ts = session.lastEventTs ?? session.startTs;
    const idle = now - ts;
    const ttl = session.toolUseCount > 0 ? ACTIVE_PRUNE_MS : TOOLLESS_PRUNE_MS;
    if (idle <= ttl) continue;

    // Save marathon medals before deletion. A session that lived past
    // any marathon threshold should still award its medal — otherwise
    // silently-pruned long sessions lost their progress. Idempotent
    // (already-unlocked entries are skipped).
    const lifetime = now - session.startTs;
    for (const m of MARATHON_THRESHOLDS) {
      if (lifetime >= m.ms && !state.achievements.unlocked.includes(m.id)) {
        state.achievements.unlocked.push(m.id);
        state.achievements.pendingUnlocks.push(m.id);
        state.progress.xp += ACHIEVEMENTS[m.id].xp;
      }
    }

    delete state.counters.activeSessions[sid];
  }
}

/**
 * V3.5+ — session_end XP scaling by duration.
 *
 * Pre-V3.5 every `session_end` awarded +50 XP unconditionally, which
 * inflated XP for batch usage (`claude -p`, eval harnesses) where a
 * 5-second non-interactive invocation looks indistinguishable from an
 * 8-hour focused coding session.
 *
 *   < 1 min  → 0  (batch noise)
 *   < 5 min  → 5  (legitimate but short)
 *  >= 5 min  → 50 (real session, original behavior)
 */
function sessionEndXp(durationMs: number | null): number {
  if (durationMs === null) return 0;
  if (durationMs < 60_000) return 0;
  if (durationMs < 300_000) return 5;
  return 50;
}

const HOOK_EVENTS: ReadonlySet<HookEvent> = new Set<HookEvent>([
  "prompt",
  "post_tool_use",
  "stop",
  "session_start",
  "session_end",
]);

interface HookArgs {
  event: HookEvent;
}

export interface ClaudeHookPayload {
  session_id?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  // Other Claude-supplied fields (cwd, transcript_path, etc.) intentionally ignored.
}

function parseArgs(argv: string[]): HookArgs | null {
  // Expected: `--event <name>` somewhere in argv.
  const idx = argv.indexOf("--event");
  if (idx === -1 || idx + 1 >= argv.length) return null;
  const event = argv[idx + 1];
  if (!event) return null;
  if (!HOOK_EVENTS.has(event as HookEvent)) return null;
  return { event: event as HookEvent };
}

function extractFilePath(input: Record<string, unknown> | undefined): string | null {
  if (!input) return null;
  const candidates = ["file_path", "path", "notebook_path"];
  for (const k of candidates) {
    const v = input[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function fileExtension(filePath: string): string | null {
  const m = /\.[^./\\]+$/.exec(filePath);
  return m ? m[0].toLowerCase() : null;
}

/**
 * Read up to ~64KB from a stream and return as utf-8 text.
 *
 * Defaults to `process.stdin`. Tests can pass any readable stream. If stdin
 * is a TTY (no pipe attached), returns "" immediately. A 500ms hard timeout
 * protects against pathological cases where the producer never closes the
 * pipe.
 */
export async function readStdin(stream: NodeJS.ReadableStream = process.stdin): Promise<string> {
  // No data piped in — return empty fast.
  if ((stream as NodeJS.ReadStream).isTTY) return "";

  return new Promise((resolve) => {
    let buf = "";
    let resolved = false;
    const finish = () => {
      if (!resolved) {
        resolved = true;
        resolve(buf);
      }
    };

    if (typeof (stream as NodeJS.ReadStream).setEncoding === "function") {
      (stream as NodeJS.ReadStream).setEncoding("utf8");
    }
    stream.on("data", (chunk: string | Buffer) => {
      buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      if (buf.length > 65536) {
        // Payload is unexpectedly huge — stop reading and use what we have.
        try {
          (stream as NodeJS.ReadStream).pause?.();
        } catch {
          // ignore
        }
      }
    });
    stream.on("end", finish);
    stream.on("error", finish);

    // Hard timeout: 500ms. The hook must complete fast; any longer and we
    // bail with whatever we've buffered (or "").
    const t = setTimeout(finish, 500);
    if (typeof t.unref === "function") t.unref();
  });
}

export function parsePayload(raw: string): ClaudeHookPayload {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ClaudeHookPayload;
    }
  } catch {
    // ignore — malformed JSON is treated as empty payload
  }
  return {};
}

/**
 * Apply a hook event to `state`. Pure, synchronous, deterministic for given
 * inputs. Mutates state in place.
 *
 * Order of operations matters:
 *   1. Counters and active-session bookkeeping
 *   2. Recompute level/phase (so achievement checks see the new level)
 *   3. Achievement checks (must run BEFORE the session_end delete because
 *      `marathon` reads `activeSessions[sessionId].startTs`)
 *   4. session_end cleanup: delete activeSessions[sessionId]
 */
export function applyHookEvent(
  state: State,
  event: HookEvent,
  payload: ClaudeHookPayload,
  now: number,
): void {
  // V3.5.3 — backfill BEFORE prune. The prune may delete sessions that
  // crossed a marathon threshold; pruneStaleSessions itself preserves
  // those medals via the in-prune save loop, but running backfill first
  // gives backfillEarnedAchievements a chance to inspect every
  // pre-prune session for polyglot/refactor too.
  backfillEarnedAchievements(state, now);
  pruneStaleSessions(state, now);
  const sessionId = payload.session_id ?? "unknown";
  const oldLevel = state.progress.level;

  // 1) Counters and active-session bookkeeping
  switch (event) {
    case "prompt": {
      state.counters.promptsTotal += 1;
      if (isNightOwlHour(now)) state.counters.nightOwlEvents += 1;
      state.progress.xp += 5;
      // Lazy-init the activeSession in case session_start never fired (some
      // Claude Code versions / IDE integrations skip it). This lets per-session
      // achievements (Polyglot, Refactor Master) eventually unlock from
      // post_tool_use events that follow.
      let session = state.counters.activeSessions[sessionId];
      if (!session) {
        session = { startTs: now, toolUseCount: 0, fileExtensions: [] };
        state.counters.activeSessions[sessionId] = session;
      }
      session.lastEventTs = now;
      // Defensive: also update streak on prompt. Idempotent same-day.
      // session_start is the canonical streak driver, but prompts without
      // a preceding session_start (legacy / standalone hook firing) would
      // otherwise miss streak increments.
      updateStreak(state, now);
      break;
    }
    case "post_tool_use": {
      state.counters.toolUseTotal += 1;
      state.progress.xp += 1;
      if (isNightOwlHour(now)) state.counters.nightOwlEvents += 1;
      // Lazy-init like in `prompt`. Without this, every per-session counter
      // and Polyglot/Refactor Master would never accrue when session_start
      // fails to fire.
      let session = state.counters.activeSessions[sessionId];
      if (!session) {
        session = { startTs: now, toolUseCount: 0, fileExtensions: [] };
        state.counters.activeSessions[sessionId] = session;
      }
      session.toolUseCount += 1;
      session.lastEventTs = now;
      if (payload.tool_name && FILE_PATH_TOOLS.has(payload.tool_name)) {
        const fp = extractFilePath(payload.tool_input);
        if (fp) {
          const ext = fileExtension(fp);
          if (ext && !session.fileExtensions.includes(ext)) {
            session.fileExtensions.push(ext);
          }
        }
      }
      break;
    }
    case "stop": {
      state.progress.xp += 10;
      const stopSession = state.counters.activeSessions[sessionId];
      if (stopSession) stopSession.lastEventTs = now;
      break;
    }
    case "session_start": {
      state.counters.activeSessions[sessionId] = {
        startTs: now,
        toolUseCount: 0,
        fileExtensions: [],
        lastEventTs: now,
      };
      updateStreak(state, now);
      break;
    }
    case "session_end": {
      // V3.5+ — XP tiered by session duration to neutralise batch noise
      // (`claude -p` calls, eval harnesses) where every short subprocess
      // would otherwise award the full +50 XP regardless of work done.
      const endSession = state.counters.activeSessions[sessionId];
      const durationMs = endSession ? now - endSession.startTs : null;
      state.progress.xp += sessionEndXp(durationMs);
      state.counters.sessionsTotal += 1;
      // NB: deletion of activeSessions[sessionId] happens AFTER the
      // achievement check below — marathon reads startTs.
      break;
    }
  }

  // 2) Recompute level / phase BEFORE the achievement check so centurion
  //    sees the freshly-crossed level=100 boundary.
  const newLevel = levelForXp(state.progress.xp);
  if (newLevel > oldLevel) {
    state.progress.pendingLevelUp = true;
  }
  state.progress.level = newLevel;
  state.progress.phase = phaseForLevel(newLevel);

  // 3) Achievement checks. Must run BEFORE session_end deletion below
  // because the marathon check reads activeSessions[sessionId].startTs.
  // Backfill already ran at the top of this function (V3.5.3 reorder).
  checkAchievementsForEvent(state, event, { sessionId, now });

  // Achievement XP can itself cross level boundaries — recompute again so
  // the persisted level/phase reflects unlocked-achievement XP, and so a
  // newly-crossed level still flags pendingLevelUp.
  const postAchievementLevel = levelForXp(state.progress.xp);
  if (postAchievementLevel > oldLevel) {
    state.progress.pendingLevelUp = true;
  }
  state.progress.level = postAchievementLevel;
  state.progress.phase = phaseForLevel(postAchievementLevel);

  // 4) session_end cleanup
  if (event === "session_end") {
    delete state.counters.activeSessions[sessionId];
  }
}

/**
 * Apply a hook event to disk: lock state, mutate, write atomically.
 *
 * Recovers gracefully from a missing or corrupt state file by
 * initialising a fresh state with the deterministic pet for this user.
 */
export async function runHook(
  event: HookEvent,
  payload: ClaudeHookPayload,
  now: number = Date.now(),
): Promise<void> {
  await withStateLock(
    (state) => {
      applyHookEvent(state, event, payload, now);
    },
    {
      onMissingOrCorrupt: () => recoverCorruptState(generatePet),
    },
  );
}

/**
 * CLI entry. ALWAYS resolves to 0 — the hook must never break the user's
 * Claude workflow. Errors are logged to ~/.petforge/hook-errors.log.
 *
 * `argv` should be the args after `petforge hook` (e.g. `["--event",
 * "prompt"]`). The CLI router in src/index.ts is responsible for
 * stripping the leading `node`, binary, and command name.
 */
export async function hookCli(argv: string[]): Promise<number> {
  try {
    const args = parseArgs(argv);
    if (!args) {
      await logHookError(`hook: invalid or missing --event arg: ${JSON.stringify(argv)}`);
      return 0;
    }

    let raw = "";
    try {
      raw = await readStdin();
    } catch (err) {
      // Should be unreachable — readStdin never rejects — but defensive.
      await logHookError("hook: stdin read failed", err);
    }
    const payload = parsePayload(raw);

    try {
      await runHook(args.event, payload, Date.now());
    } catch (err) {
      // Lock timeout, disk error, etc. Skip mutation, log, exit 0.
      await logHookError(`hook: state mutation failed for event=${args.event}`, err);
    }
    return 0;
  } catch (err) {
    // Last-resort catch — never let the hook crash.
    await logHookError("hook: unexpected error", err);
    return 0;
  }
}
