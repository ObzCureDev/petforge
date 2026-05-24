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
import { migrateV1ToV2, type V1State } from "./migrations/v1-to-v2.js";
import { migrateV31Achievements } from "./migrations/v32-achievement-rename.js";
import { HOOK_ERROR_LOG, LOCK_FILE, PETFORGE_DIR, STATE_FILE } from "./paths.js";
import { generatePet } from "./pet-engine.js";
import { createInitialState, type Pet, type State, StateSchema } from "./schema.js";
import { createInitialQuota } from "./quota/schema.js";

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

/**
 * V3.7.1.3: ENOENT-strict existence check.
 *
 * The previous "any error means missing" semantics caused pet wipes on
 * Windows when antivirus/indexer/OneDrive briefly held a handle on a
 * .petforge file. `fs.access` would throw EPERM/EBUSY -> `fileExists`
 * returned false -> recoverCorruptState fell into the "first install"
 * branch and regenerated a rabbit on top of Huddle.
 *
 * Now we only treat ENOENT as confirmed-missing. Anything else (EPERM,
 * EBUSY, EACCES, EMFILE, unknown) is a transient I/O state - we assume
 * the file is present to prevent silent regeneration. Cost: a "first
 * install" with a permission-denied directory will be misidentified as
 * "already initialized" and the operation will throw instead of
 * bootstrapping. That's the right trade.
 */
async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return false;
    return true;
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

  // V1 -> V2 transparent migration. The on-disk file stays V1-shaped until
  // the next withStateLock cycle rewrites it.
  const v1 = looksLikeV1(parsed);
  if (v1) {
    const migrated = migrateV1ToV2(v1, () => generatePet());
    // V1 states may contain V3.1 achievement IDs that need renaming too.
    const v32Achievements = migrateV31Achievements({
      unlocked: migrated.achievements.unlocked,
      pendingUnlocks: migrated.achievements.pendingUnlocks,
    });
    migrated.achievements.unlocked = v32Achievements.unlocked;
    migrated.achievements.pendingUnlocks = v32Achievements.pendingUnlocks;
    return migrated;
  }

  // V3.1 -> V3.2 achievement ID rename. schemaVersion is still 2 for both
  // V3.1 and V3.2; only the contents of `unlocked` / `pendingUnlocks` change.
  // Idempotent: running on already-V3.2 state is a no-op.
  if (typeof parsed === "object" && parsed !== null) {
    const obj = parsed as { achievements?: { unlocked?: unknown; pendingUnlocks?: unknown } };
    const a = obj.achievements;
    if (a && Array.isArray(a.unlocked) && Array.isArray(a.pendingUnlocks)) {
      const v32 = migrateV31Achievements({
        unlocked: a.unlocked.filter((x): x is string => typeof x === "string"),
        pendingUnlocks: a.pendingUnlocks.filter((x): x is string => typeof x === "string"),
      });
      a.unlocked = v32.unlocked;
      a.pendingUnlocks = v32.pendingUnlocks;
    }
  }

  const result = StateSchema.safeParse(parsed);
  if (!result.success) {
    throw new StateCorruptError("state.json failed schema validation", result.error);
  }
  return result.data;
}

/**
 * Quick structural check to identify a V1 state file. We only verify the
 * minimum needed before delegating to the migration function — V1 was
 * previously written by us, so deep validation is unnecessary.
 */
function looksLikeV1(parsed: unknown): V1State | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const v = parsed as Record<string, unknown>;
  if (v.schemaVersion !== 1) return null;
  if (typeof v.pet !== "object" || v.pet === null) return null;
  if (typeof v.progress !== "object" || v.progress === null) return null;
  return v as unknown as V1State;
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
 * Materialise a fresh State for a FIRST INSTALL only.
 *
 * V3.7.1 hardening: this function REFUSES to overwrite an existing
 * state.json. If state.json is present but failed to parse, it makes a
 * timestamped `.corrupt.*` backup and then throws StateCorruptError so
 * the caller can decide what to do. Previously this silently regenerated
 * a fresh pet when called against a corrupt-on-disk state, which produced
 * the "overnight Windows-write-tear nukes my pet" failure mode reported
 * twice in 2026-05 (Dan's Huddle the octopus level 72 wiped to rabbit
 * level 1, immediately re-buffed to ~level 10 by OTel-driven achievement
 * unlocks — so the wipe was not even visibly "fresh").
 *
 * Behavior:
 *   - state.json MISSING (first install ever)  -> return fresh State.
 *   - state.json EXISTS (assumed corrupt)       -> copy to .corrupt.*.json,
 *                                                  then throw StateCorruptError.
 *
 * Callers that previously relied on silent regeneration now propagate the
 * error. The CLI (hook handler in particular) wraps and logs it; the user
 * fixes the pet via a manual restore from a backup.
 */
/**
 * Sentinel marker written once on first install. Its presence guarantees
 * we've ever bootstrapped a pet for this host, regardless of whether
 * state.json currently exists. Used to defeat the Windows NTFS
 * `MoveFileEx` race where the destination is briefly absent during a
 * concurrent atomic rename - a hook event firing in that window would
 * otherwise see "state missing" and regenerate a fresh pet on top of
 * the user's progress.
 */
const INITIALIZED_MARKER = path.join(PETFORGE_DIR, ".initialized");

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
    throw new StateCorruptError(
      `state.json exists but failed to parse - refusing to silently regenerate. ` +
        `A backup was copied to ${backup} (if writable). ` +
        `Restore from one of your ~/.petforge/state.json.bak-* files manually.`,
    );
  }
  // File truly missing. But was this install bootstrapped before?
  // We check MULTIPLE sentinel files because any single one (including the
  // .initialized marker) can be transiently invisible during AV/Defender
  // scans on Windows. If ANY of these exist, this is not a virgin install
  // and we refuse to regenerate.
  const sentinels = [
    INITIALIZED_MARKER,
    path.join(PETFORGE_DIR, "buddy-card.txt"),
    path.join(PETFORGE_DIR, "hook-errors.log"),
    path.join(PETFORGE_DIR, "up.log"),
  ];
  for (const s of sentinels) {
    if (await fileExists(s)) {
      throw new StateCorruptError(
        "state.json appears missing but the install is NOT virgin " +
          `(sentinel present: ${s}). This is almost certainly the Windows ` +
          "atomic-rename race or a transient AV scan - retry the operation. " +
          "If state.json is genuinely missing, restore from a backup at " +
          "~/.petforge/state.json.bak-*.",
      );
    }
  }
  // Also reject if there's even a backup snapshot lying around - this
  // proves the install has run before, regardless of marker state.
  try {
    const entries = await fs.readdir(PETFORGE_DIR);
    if (entries.some((n) => n.startsWith("state.json.bak-") || n.startsWith("state.corrupt."))) {
      throw new StateCorruptError(
        "state.json missing but ~/.petforge/ contains backup snapshots from " +
          "a previous install. Refusing to regenerate to protect prior progress.",
      );
    }
  } catch (err) {
    if (err instanceof StateCorruptError) throw err;
    // EACCES / EPERM on readdir = treat as "directory might have content,
    // don't risk a wipe."
    throw new StateCorruptError(
      "could not list ~/.petforge/ to verify virgin install - refusing to " +
        "regenerate. Resolve the directory permission and retry.",
    );
  }
  // V3.7.2 - last-chance double check. Before declaring "first install"
  // (irreversible: wipes user data if wrong), wait 150ms and re-verify
  // BOTH files are still gone. This catches the case where:
  //   - state.json is mid-MoveFileEx and briefly absent (NTFS race)
  //   - marker file's writeFile failed silently for AV reasons but the
  //     marker actually exists on disk (we want to err on the side of
  //     "do not wipe" - throw rather than create).
  // Also covers Windows Defender / OneDrive sync briefly making the dir
  // entries invisible. Cost: 150ms latency on legitimate first install.
  await new Promise<void>((r) => setTimeout(r, 150));
  if ((await fileExists(STATE_FILE)) || (await fileExists(INITIALIZED_MARKER))) {
    throw new StateCorruptError(
      "state.json reappeared (or marker did) during recovery window - " +
        "aborting fresh pet creation. This is the Windows atomic-rename race - " +
        "the caller should retry the operation.",
    );
  }
  // True first install - bootstrap and drop the marker so this code path
  // never silently wipes a previously initialized pet.
  const fresh = createInitialState(petGenerator(), Date.now());
  try {
    await fs.writeFile(INITIALIZED_MARKER, "1", "utf8");
  } catch {
    // best-effort - if marker write fails the install will work but the
    // race protection is weaker. Caller still wrote state.json.
  }
  return fresh;
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

  // Retry budget tuned to stay under the hook timeout (5 s registered in
  // ~/.claude/settings.json since v3.4.1). Sum of waits with these
  // params caps at ~2.4 s (13 ramp retries reaching maxTimeout, then 7
  // flat × 200 ms), leaving headroom for the actual lock-acquire I/O.
  // If contention exceeds that budget, the hook silently logs and exits
  // 0 instead of being killed by Claude Code mid-acquire — the dropped
  // event costs at most a few XP. Stale at 5 s reclaims orphaned locks.
  const release = await lockfile.lock(LOCK_FILE, {
    realpath: false,
    stale: 5000,
    retries: { retries: 20, factor: 1.2, minTimeout: 20, maxTimeout: 200 },
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

    ensureQuotaCounters(state);

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
 * Ensure `state.counters.quota` is populated.
 *
 * V3.6 state files do not contain the `quota` block. After loading + validating
 * a state via `StateSchema` (which keeps `quota` optional), call this to
 * synthesize a fresh opt-out QuotaState if absent. Achievement evaluation
 * gates on `quota.optIn === true && quota.lastProbeTs > 0`, so a synthesized
 * block is inert until the user runs `petforge quota enable`.
 */
export function ensureQuotaCounters(state: State): void {
  if (!state.counters.quota) {
    state.counters.quota = createInitialQuota();
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
