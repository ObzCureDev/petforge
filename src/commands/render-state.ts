/**
 * Shared state-loading helpers for the render commands.
 *
 * Two flavours:
 *
 * - `loadAndConsumeState`: used by `petforge` (default command). Captures
 *   a snapshot of state for the renderer with pending flags intact, then
 *   clears `progress.pendingLevelUp` and `achievements.pendingUnlocks`
 *   on disk so cinematics fire exactly once.
 *
 * - `loadStateForView`: used by `petforge card` and `petforge watch`.
 *   Reads state without consuming any pending flags — these commands
 *   are non-destructive views.
 *
 * Both helpers tolerate a missing or corrupt state file by recovering via
 * the pet engine, exactly like the hook handler.
 */

import { generatePet } from "../core/pet-engine.js";
import type { State } from "../core/schema.js";
import { recoverCorruptState, withStateLock } from "../core/state.js";

/** Deep-clone a state object so renderer mutations don't affect on-disk shape. */
function cloneState(s: State): State {
  return JSON.parse(JSON.stringify(s)) as State;
}

/**
 * Load state for the default `petforge` command.
 *
 * The returned snapshot is a deep clone of state at lock time (with
 * pending flags still set, so cinematics know what to play). The
 * on-disk state has those pending flags cleared atomically before the
 * lock is released.
 */
export async function loadAndConsumeState(): Promise<State> {
  return await withStateLock(
    (s) => {
      const captured = cloneState(s);
      s.progress.pendingLevelUp = false;
      s.achievements.pendingUnlocks = [];
      return captured;
    },
    { onMissingOrCorrupt: () => recoverCorruptState(generatePet) },
  );
}

/**
 * Load state without consuming any pending flags (read-only views).
 *
 * Still goes through the lock so we don't read a half-written file
 * during a concurrent hook write.
 */
export async function loadStateForView(): Promise<State> {
  return await withStateLock((s) => cloneState(s), {
    onMissingOrCorrupt: () => recoverCorruptState(generatePet),
  });
}
