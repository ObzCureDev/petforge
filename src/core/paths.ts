/**
 * Filesystem paths used by PetForge.
 *
 * Cross-platform via `os.homedir()` + `path.join()` only.
 *
 * Resolution model (V3.7.9 — root-cause fix for the recurring "tests ate my
 * pet" wipes):
 *
 *  - Production code MUST use the call-time getters (`getStateFile()`,
 *    `getPetforgeDir()`, …). They re-read `PETFORGE_HOME` on EVERY call, so
 *    isolation never depends on module-import order or `vi.resetModules()`.
 *
 *  - `PETFORGE_HOME`, when set, overrides `os.homedir()` for BOTH
 *    `~/.petforge/` and `~/.claude/`. The test harness forces it to a
 *    throwaway temp dir before any module loads (see tests/setup/isolation.ts).
 *
 *  - The getters run through `assertIsolatedHome`, which makes it IMPOSSIBLE
 *    for a test run to resolve the real home: under test, an unset
 *    PETFORGE_HOME — or one pointing at the real home — THROWS instead of
 *    silently writing to (and wiping) the user's real ~/.petforge.
 *
 *  - The eager `STATE_FILE` / `PETFORGE_DIR` / … consts are retained for
 *    backward compatibility (existing tests import them). They are resolved
 *    leniently at load time and never throw, so importing this module is
 *    always safe. Prefer the getters in new code.
 */

import os from "node:os";
import path from "node:path";

/** True when running under the test harness (vitest sets VITEST=true). */
export function isUnderTest(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VITEST === "true" || env.NODE_ENV === "test";
}

/** Path equality: case-insensitive on win32, exact elsewhere. */
function samePath(a: string, b: string): boolean {
  const ra = path.resolve(a);
  const rb = path.resolve(b);
  return process.platform === "win32" ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
}

/**
 * Resolve the home dir PetForge should use, enforcing test isolation.
 *
 * Production (`underTest === false`): returns `petforgeHome ?? realHome`.
 *
 * Under test: `petforgeHome` MUST be set AND must not equal `realHome`, else
 * this throws — a test must never touch the real ~/.petforge. Pure: every
 * input is injected so the policy is unit-testable without mutating env.
 */
export function assertIsolatedHome(
  petforgeHome: string | undefined,
  realHome: string,
  underTest: boolean,
): string {
  if (!underTest) return petforgeHome ?? realHome;
  if (!petforgeHome) {
    throw new Error(
      "PETFORGE_HOME must be set when running under test — refusing to resolve " +
        "the real ~/.petforge (would risk wiping your pet). Set PETFORGE_HOME to a " +
        "throwaway temp dir (tests/setup/isolation.ts does this globally).",
    );
  }
  if (samePath(petforgeHome, realHome)) {
    throw new Error(
      `PETFORGE_HOME points at your real home (${realHome}) under test — refusing ` +
        "to risk wiping your real ~/.petforge. Point it at a throwaway temp dir.",
    );
  }
  return petforgeHome;
}

// ---------- Call-time getters (preferred; guarded + lazy) ----------

export function getHomeDir(): string {
  return assertIsolatedHome(process.env.PETFORGE_HOME, os.homedir(), isUnderTest());
}
export function getPetforgeDir(): string {
  return path.join(getHomeDir(), ".petforge");
}
export function getStateFile(): string {
  return path.join(getPetforgeDir(), "state.json");
}
export function getLockFile(): string {
  return path.join(getPetforgeDir(), ".lock");
}
export function getHookErrorLog(): string {
  return path.join(getPetforgeDir(), "hook-errors.log");
}
export function getClaudeDir(): string {
  return path.join(getHomeDir(), ".claude");
}
export function getClaudeSettingsFile(): string {
  return path.join(getClaudeDir(), "settings.json");
}

// ---------- Eager consts (back-compat shims; prefer the getters above) ----------
//
// Resolved leniently at load time so importing this module never throws.
// Production code no longer reads these — it uses the guarded getters — so a
// stale capture here cannot route a real write through the wrong directory.

const eagerHome = process.env.PETFORGE_HOME ?? os.homedir();

export const HOME_DIR = eagerHome;
export const PETFORGE_DIR = path.join(eagerHome, ".petforge");
export const STATE_FILE = path.join(PETFORGE_DIR, "state.json");
export const LOCK_FILE = path.join(PETFORGE_DIR, ".lock");
export const HOOK_ERROR_LOG = path.join(PETFORGE_DIR, "hook-errors.log");
export const CLAUDE_DIR = path.join(eagerHome, ".claude");
export const CLAUDE_SETTINGS_FILE = path.join(CLAUDE_DIR, "settings.json");
