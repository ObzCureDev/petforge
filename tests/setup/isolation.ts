/**
 * Global test isolation — registered as a vitest `setupFiles`, so it runs
 * before any test module (and therefore before any src module) is imported.
 *
 * It forces `PETFORGE_HOME` to a throwaway temp dir, guaranteeing that
 * neither the eager path consts nor the call-time getters in src/core/paths.ts
 * can ever resolve the user's real ~/.petforge. This is the root-cause guard
 * against the recurring "running the test suite wiped my real pet" incidents
 * (state.json truncated to 0 bytes by a dev/test run that hit the real home).
 *
 * Individual tests still set their own per-test PETFORGE_HOME (the existing
 * pattern). This only guarantees a SAFE, non-real default if any test — now
 * or in the future — forgets to isolate.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function pointsAtRealHome(dir: string | undefined): boolean {
  if (!dir) return false;
  const a = path.resolve(dir).toLowerCase();
  const b = path.resolve(os.homedir()).toLowerCase();
  return a === b;
}

// Replace an unset OR real-home PETFORGE_HOME with a fresh temp dir. Leave an
// already-safe override (a test's own temp dir) untouched.
if (!process.env.PETFORGE_HOME || pointsAtRealHome(process.env.PETFORGE_HOME)) {
  process.env.PETFORGE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "petforge-test-"));
}
