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
import { getHookErrorLog, getLockFile, getPetforgeDir, getStateFile } from "./paths.js";
import { generatePet } from "./pet-engine.js";
import { createInitialQuota } from "./quota/schema.js";
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
  await fs.mkdir(getPetforgeDir(), { recursive: true });
}

/**
 * Read and validate state.json. Throws:
 *  - StateNotFoundError when the file is missing
 *  - StateCorruptError on JSON parse failure or schema mismatch
 */
export async function readState(): Promise<State> {
  let raw: string;
  try {
    raw = await fs.readFile(getStateFile(), "utf8");
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

  // V3.7.5 - WIPE KILLER: the last-line defense at the write boundary.
  //
  // Five upstream protections (V3.7.1 refuse-corrupt, V3.7.1.1 marker,
  // V3.7.1.3 ENOENT-strict, V3.7.2 150ms double-check, V3.7.3 multi-
  // sentinel) all failed to stop the recurring wipe. Marker mtime
  // forensics proved `recoverCorruptState`'s fresh path was never
  // reached. Some unknown caller is constructing a fresh-shaped State
  // and handing it to writeStateAtomic, bypassing recoverCorruptState
  // entirely.
  //
  // This guard intercepts at the absolute last step before the rename:
  // if we are about to write a State that looks brand-new
  // (progress.xp == 0 && lastActiveDate empty && no active sessions)
  // AND the on-disk state.json currently holds a non-fresh State,
  // REFUSE the write. The caller gets an error; the pet stays alive.
  //
  // Also dumps a full stack trace to ~/.petforge/wipe-investigation.log
  // so we can finally see which call site is doing this.
  if (looksLikeFreshState(state)) {
    const existing = await tryReadStateRaw();
    if (existing && !looksLikeFreshState(existing)) {
      const trace = new Error("wipe-killer activated").stack ?? "(no stack)";
      await logWipeAttempt(state, existing, trace);
      throw new StateCorruptError(
        "WIPE KILLER: refused to overwrite a non-fresh state.json with a " +
          "fresh pet. See ~/.petforge/wipe-investigation.log for the caller " +
          "stack. Existing pet preserved.",
      );
    }
  }

  // V3.7.4 - opportunistic daily snapshot. If no `state.json.bak-daily-*`
  // exists for today, copy the current state.json (the BEFORE-image of
  // this write) to a date-stamped backup. One stat() and at most one
  // copyFile() per day on the busiest write path - negligible cost vs
  // the value of always having a yesterday-or-newer pet snapshot to
  // restore from after a wipe.
  await opportunisticDailyBackup();

  const stateFile = getStateFile();
  const tmp = `${stateFile}.tmp`;
  const data = JSON.stringify(state, null, 2);
  const fd = await fs.open(tmp, "w");
  try {
    await fd.writeFile(data, "utf8");
    await fd.sync();
  } finally {
    await fd.close();
  }
  await renameWithRetry(tmp, stateFile);
}

/**
 * True when the State looks like a brand-new install: zero XP, level 1,
 * egg phase, no streak, no sessions ever recorded, no OTel data.
 * Whichever surface created this State, it carries no user progress.
 */
function looksLikeFreshState(s: State): boolean {
  return (
    s.progress.xp === 0 &&
    s.progress.level === 1 &&
    s.progress.phase === "egg" &&
    s.counters.promptsTotal === 0 &&
    s.counters.toolUseTotal === 0 &&
    s.counters.sessionsTotal === 0 &&
    s.counters.streakDays === 0 &&
    s.counters.lastActiveDate === "" &&
    Object.keys(s.counters.activeSessions).length === 0
  );
}

async function tryReadStateRaw(): Promise<State | null> {
  try {
    const raw = await fs.readFile(getStateFile(), "utf8");
    const parsed = JSON.parse(raw) as State;
    if (typeof parsed !== "object" || parsed === null) return null;
    if (!parsed.progress || !parsed.counters) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function logWipeAttempt(incoming: State, existing: State, trace: string): Promise<void> {
  try {
    await ensurePetforgeDir();
    const logFile = path.join(getPetforgeDir(), "wipe-investigation.log");
    const ts = new Date().toISOString();
    const summary =
      `${ts} WIPE KILLER fired\n` +
      `  Existing: species=${existing.pet?.species} ` +
      `rarity=${existing.pet?.rarity} ` +
      `level=${existing.progress?.level} xp=${existing.progress?.xp} ` +
      `prompts=${existing.counters?.promptsTotal} ` +
      `tools=${existing.counters?.toolUseTotal} ` +
      `streak=${existing.counters?.streakDays}\n` +
      `  Incoming: species=${incoming.pet?.species} ` +
      `rarity=${incoming.pet?.rarity} ` +
      `level=${incoming.progress?.level} xp=${incoming.progress?.xp}\n` +
      `  Stack:\n${trace}\n\n`;
    await fs.appendFile(logFile, summary, "utf8");
  } catch {
    // best-effort
  }
}

async function opportunisticDailyBackup(): Promise<void> {
  try {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const stateFile = getStateFile();
    const backupPath = path.join(getPetforgeDir(), `state.json.bak-daily-${today}`);
    if (await fileExists(backupPath)) return; // already done today
    if (!(await fileExists(stateFile))) return; // nothing to back up
    await fs.copyFile(stateFile, backupPath);
  } catch {
    // Best-effort - a failed backup must never block the actual write.
    // We deliberately don't logHookError here either to keep this path
    // silent on transient AV/locking issues.
  }
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
function initializedMarker(): string {
  return path.join(getPetforgeDir(), ".initialized");
}

export async function recoverCorruptState(petGenerator: () => Pet): Promise<State> {
  const STATE_FILE = getStateFile();
  const PETFORGE_DIR = getPetforgeDir();
  const INITIALIZED_MARKER = initializedMarker();
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

/**
 * `onCompromised` handler for the state lock (see the detailed rationale
 * comment at the `lockfile.lock(...)` call site inside `withStateLock`).
 *
 * Contract: MUST NOT throw or reject — proper-lockfile invokes this from its
 * own internal setInterval, well outside any try/catch we could wrap around
 * `lock()` or the critical section, so a throw here is an uncaught exception
 * that kills the whole host process. `logHookError` is async but swallows
 * every error it can hit internally, so its returned promise never rejects
 * either — calling it without awaiting (`void`) is safe and cannot produce
 * an unhandled rejection.
 */
export function onStateLockCompromised(err: Error): void {
  void logHookError("state lock compromised — continuing without exclusive lock", err);
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

  const LOCK_FILE = getLockFile();

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
    // V3.7.11 — never let a compromised lock kill the long-running daemon.
    //
    // proper-lockfile refreshes the lock file's mtime on an internal
    // setInterval (period = stale/2) to prove liveness to any other
    // process racing for the same lock. ECOMPROMISED fires when a refresh
    // can't land inside the `stale` window above (5 s) — e.g. the OS
    // suspended this process (laptop sleep/resume) long enough that the
    // refresh timer starved, or another process (the very short-lived
    // per-hook `petforge` invocation) judged this lock stale and stole it
    // while `up`'s daemon was still legitimately holding it.
    //
    // proper-lockfile's DEFAULT `onCompromised` is `(err) => { throw err;
    // }`, and that throw fires from INSIDE its own setInterval callback —
    // i.e. it is an uncaught exception on a tick of the event loop that is
    // completely outside any try/catch we could wrap around `lock()` or the
    // mutator below. For a one-shot CLI invocation that is merely
    // annoying (the process was about to exit anyway); for `petforge up`
    // (which hosts the OTel collector + web server + quota probe daemon in
    // one long-running process) it is FATAL — the entire host process
    // dies, every subsystem it hosts dies with it, and quota tracking
    // silently stops until the user notices and restarts. This is exactly
    // the crash pattern seen in production err.log: `[Error: ENOENT: ...
    // stat '...\.petforge\.lock.lock'] { code: 'ECOMPROMISED' }` /
    // "Unable to update lock within the stale threshold".
    //
    // The trade-off we accept by swallowing instead of throwing: after a
    // compromise, the CURRENT critical section (whatever `mutator` does
    // before `writeStateAtomic` below) may finish without a
    // provably-exclusive lock, so in the rare case where another process
    // also holds/steals the lock at the same instant, writes could
    // interleave. That is acceptable because the real data-integrity
    // backstop is not this lock — it is `writeStateAtomic`'s tmp-write +
    // fsync + rename (never a partially-written state.json on disk) plus
    // its WIPE-KILLER guard (refuses to overwrite a populated pet with an
    // empty/zeroed one). Worst case under a genuine double-write is
    // "last writer wins" on an otherwise structurally-valid state.json —
    // recoverable, and far cheaper than crashing the daemon and losing
    // quota tracking outright. Do NOT "fix" this by touching
    // `stale`/`retries`/`realpath` — the actual fix is narrowly "never let
    // onCompromised crash the process."
    onCompromised: onStateLockCompromised,
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
    await fs.appendFile(getHookErrorLog(), line, "utf8");
  } catch {
    // swallow — hooks must not crash
  }
}
