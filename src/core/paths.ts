/**
 * Filesystem paths used by PetForge.
 *
 * Cross-platform via `os.homedir()` + `path.join()` only.
 *
 * Test isolation: when the env var `PETFORGE_HOME` is set, it overrides
 * `os.homedir()` for both `~/.petforge/` and `~/.claude/` resolution.
 * Tests call `vi.resetModules()` and re-import this module after setting
 * `PETFORGE_HOME` so the constants below recompute with the test home dir.
 */

import os from "node:os";
import path from "node:path";

function petforgeHome(): string {
  return process.env.PETFORGE_HOME ?? os.homedir();
}

export const HOME_DIR = petforgeHome();
export const PETFORGE_DIR = path.join(HOME_DIR, ".petforge");
export const STATE_FILE = path.join(PETFORGE_DIR, "state.json");
export const LOCK_FILE = path.join(PETFORGE_DIR, ".lock");
export const HOOK_ERROR_LOG = path.join(PETFORGE_DIR, "hook-errors.log");
export const CLAUDE_DIR = path.join(HOME_DIR, ".claude");
export const CLAUDE_SETTINGS_FILE = path.join(CLAUDE_DIR, "settings.json");
