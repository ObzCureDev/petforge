/**
 * State I/O for PetForge.
 *
 * Responsibilities:
 *  - ensure ~/.petforge/ exists
 *  - read/parse/validate state.json
 *  - atomic write (tmp + fsync + rename)
 *  - inter-process locking via proper-lockfile
 *  - corrupt-state recovery (back up + recreate, never crash)
 *
 * Design notes:
 *  - `state.meta.updatedAt` is owned by `writeStateAtomic` — callers do not
 *    need to set it manually.
 *  - The lock target is always `LOCK_FILE` (a dedicated sentinel inside
 *    PETFORGE_DIR). Using a fixed target — independent of state.json's
 *    existence — avoids a first-run race where two processes would
 *    otherwise pick different lock files (`.petforge.lock` vs
 *    `state.json.lock`) and both enter the critical section.
 *    proper-lockfile requires the target to exist, so we touch it first.
 *  - `withStateLock` accepts an optional `onMissingOrCorrupt` initialiser:
 *    when provided, missing/corrupt state is silently recovered and the
 *    mutator runs against the fresh state. When absent, the original error
 *    is rethrown.
 */

import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import lockfile from "proper-lockfile";
import { HOOK_ERROR_LOG, LOCK_FILE, PETFORGE_DIR, STATE_FILE } from "./paths.js";
import { createInitialState, type Pet, type State, StateSchema } from "./schema.js";

// ---------- Errors ----------

export class StateNotFoundError extends Error {
  constructor(message = "state.json not found") {
    super(message);
    this.name = "StateNotFoundError";
  }
}

export class StateCorruptError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "StateCorruptError";
  }
}

// ---------- Helpers ----------

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

const RETRYABLE_RENAME_CODES = new Set(["EPERM", "EBUSY", "ENOENT", "EACCES"]);
const RENAME_RETRY_DELAYS_MS = [50, 150, 400] as const;

/**
 * `fs.rename` retry helper for Windows-specific transient failures.
 *
 * Antivirus (Defender), file-sync indexers (OneDrive), and other shell
 * services sometimes hold a brief handle on the destination right after
 * write, causing EPERM on the atomic rename. We retry with exponential
 * backoff before giving up.
 *
 * Total wait if all 3 retries fail: ~600ms — well under hook timeout (1s).
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RENAME_RETRY_DELAYS_MS.length; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      lastError = err;
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt === RENAME_RETRY_DELAYS_MS.length || !code || !RETRYABLE_RENAME_CODES.has(code)) {
        throw err;
      }
      const delay = RENAME_RETRY_DELAYS_MS[attempt] ?? 400;
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }
  // unreachable; satisfy TS
  throw lastError;
}

// ---------- Public API ----------

export async function ensurePetforgeDir(): Promise<void> {
  await fs.mkdir(PETFORGE_DIR, { recursive: true });
}

/**
 * Read and validate state.json. Throws:
 *  - StateNotFoundError when the file is missing
 *  - StateCorruptError on JSON parse failure or schema mismatch
 */
export async function readState(): Promise<State> {
  let raw: string;
  try {
    raw = await fs.readFile(STATE_FILE, "utf8");
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      throw new StateNotFoundError();
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new StateCorruptError("state.json is not valid JSON", err);
  }

  const result = StateSchema.safeParse(parsed);
  if (!result.success) {
    throw new StateCorruptError("state.json failed schema validation", result.error);
  }
  return result.data;
}

/**
 * Atomically write state.json:
 *   1. write to state.json.tmp
 *   2. fsync
 *   3. close
 *   4. rename to state.json
 *
 * Updates `state.meta.updatedAt` immediately before serialisation.
 */
export async function writeStateAtomic(state: State): Promise<void> {
  state.meta.updatedAt = Date.now();
  const tmp = `${STATE_FILE}.tmp`;
  const data = JSON.stringify(state, null, 2);
  const fd = await fs.open(tmp, "w");
  try {
    await fd.writeFile(data, "utf8");
    await fd.sync();
  } finally {
    await fd.close();
  }
  await renameWithRetry(tmp, STATE_FILE);
}

/**
 * Materialise a fresh State, backing up any existing (presumably corrupt)
 * state.json to `state.corrupt.<timestamp>.<rand>.json` first.
 *
 * Safe to call when state.json is merely missing — the backup step is
 * skipped silently in that case. The caller is responsible for writing
 * the returned state.
 */
export async function recoverCorruptState(petGenerator: () => Pet): Promise<State> {
  if (await fileExists(STATE_FILE)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const suffix = crypto.randomBytes(3).toString("hex");
    const backup = path.join(PETFORGE_DIR, `state.corrupt.${stamp}.${suffix}.json`);
    try {
      await fs.copyFile(STATE_FILE, backup);
    } catch {
      // best-effort backup; never crash hook execution
    }
  }
  return createInitialState(petGenerator(), Date.now());
}

export interface WithStateLockOptions {
  /**
   * Called when state.json is missing or corrupt to materialise a fresh State.
   * If omitted, the original error is rethrown.
   *
   * For corrupt files, the caller should also have arranged a backup
   * (e.g. by delegating to `recoverCorruptState`).
   */
  onMissingOrCorrupt?: () => State | Promise<State>;
}

/**
 * Acquire the state lock, run `mutator` against the current state, and
 * write the (possibly mutated) state back atomically.
 *
 * The mutator may mutate `state` in place; whatever it returns is the
 * resolved value of `withStateLock`.
 */
export async function withStateLock<T>(
  mutator: (state: State) => T | Promise<T>,
  opts: WithStateLockOptions = {},
): Promise<T> {
  await ensurePetforgeDir();

  // proper-lockfile derives `<target>.lock` from the target path, so we
  // need a stable, always-existing target. Touch the dedicated lock file
  // (no-op if already present) before acquiring.
  const fd = await fs.open(LOCK_FILE, "a");
  await fd.close();

  // Retry budget tuned for plausible contention: with all callers now
  // funnelled through a single lock target (vs. the previous racy
  // ternary that sometimes split traffic across two lock files), hooks
  // fired in parallel — e.g. multiple Claude Code terminals on the
  // same machine — can stack up a dozen waiters. minTimeout stays
  // small so a freshly-released lock is picked up promptly;
  // maxTimeout caps late retries so a starved waiter doesn't sleep
  // for seconds while the lock is free. Stale at 5s reclaims a truly
  // orphaned lock.
  const release = await lockfile.lock(LOCK_FILE, {
    realpath: false,
    stale: 5000,
    retries: { retries: 30, factor: 1.2, minTimeout: 20, maxTimeout: 200 },
  });

  try {
    let state: State;
    try {
      state = await readState();
    } catch (err) {
      if (
        (err instanceof StateNotFoundError || err instanceof StateCorruptError) &&
        opts.onMissingOrCorrupt
      ) {
        state = await opts.onMissingOrCorrupt();
      } else {
        throw err;
      }
    }

    const result = await mutator(state);
    await writeStateAtomic(state);
    return result;
  } finally {
    try {
      await release();
    } catch {
      // best-effort release; never crash hook execution
    }
  }
}

/**
 * Append a structured error line to the hook error log. Best-effort —
 * never throws.
 */
export async function logHookError(message: string, err?: unknown): Promise<void> {
  try {
    await ensurePetforgeDir();
    const ts = new Date().toISOString();
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? "");
    const line = `${ts} ${message}${detail ? ` — ${detail}` : ""}\n`;
    await fs.appendFile(HOOK_ERROR_LOG, line, "utf8");
  } catch {
    // swallow — hooks must not crash
  }
}
