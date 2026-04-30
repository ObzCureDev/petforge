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
  checkAchievementsForEvent,
  type HookEvent,
  isNightOwlHour,
  unlockAchievement,
  updateStreak,
} from "../core/achievements.js";
import { generatePet } from "../core/pet-engine.js";
import type { State } from "../core/schema.js";
import { logHookError, recoverCorruptState, withStateLock } from "../core/state.js";
import { levelForXp, phaseForLevel } from "../core/xp.js";

/** Tool names that include a file path — used for polyglot extension tracking. */
const FILE_PATH_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

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
  const sessionId = payload.session_id ?? "unknown";
  const oldLevel = state.progress.level;

  // 1) Counters and active-session bookkeeping
  switch (event) {
    case "prompt": {
      state.counters.promptsTotal += 1;
      if (isNightOwlHour(now)) state.counters.nightOwlEvents += 1;
      state.progress.xp += 5;
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
      const session = state.counters.activeSessions[sessionId];
      if (session) {
        session.toolUseCount += 1;
        if (payload.tool_name && FILE_PATH_TOOLS.has(payload.tool_name)) {
          const fp = extractFilePath(payload.tool_input);
          if (fp) {
            const ext = fileExtension(fp);
            if (ext && !session.fileExtensions.includes(ext)) {
              session.fileExtensions.push(ext);
            }
          }
        }
      }
      break;
    }
    case "stop": {
      state.progress.xp += 10;
      break;
    }
    case "session_start": {
      state.counters.activeSessions[sessionId] = {
        startTs: now,
        toolUseCount: 0,
        fileExtensions: [],
      };
      updateStreak(state, now);
      break;
    }
    case "session_end": {
      state.progress.xp += 50;
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

  // 3) Achievement checks. Must run BEFORE session_end deletion below.
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

  // Defensive centurion check for events `checkAchievementsForEvent` does
  // not cover (prompt / post_tool_use / session_start). The function
  // already handles stop & session_end.
  if (state.progress.level >= 100 && !state.achievements.unlocked.includes("centurion")) {
    unlockAchievement(state, "centurion");
    // Centurion's XP can itself be level-relevant; recompute one last time.
    const finalLevel = levelForXp(state.progress.xp);
    state.progress.level = finalLevel;
    state.progress.phase = phaseForLevel(finalLevel);
  }

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
