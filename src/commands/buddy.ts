/**
 * `petforge buddy [on|off|auto]` — manage Buddy integration toggle.
 *
 * No arg: prints current toggle and last detection state.
 * `on`:   force runtime Buddy visual if available.
 * `off`:  always use PetForge visual.
 * `auto`: detect at session start and use if available (default).
 *
 * The toggle is persisted in state.buddy.userToggle.
 */

import { generatePet } from "../core/pet-engine.js";
import type { BuddyToggle } from "../core/schema.js";
import { recoverCorruptState, withStateLock } from "../core/state.js";

export interface BuddyCommandResult {
  toggle: BuddyToggle;
  detected: boolean;
  lastChecked: number;
  changed: boolean;
}

export async function runBuddyCommand(arg: string | undefined): Promise<BuddyCommandResult> {
  const requested = parseToggle(arg);

  return await withStateLock(
    (state) => {
      const before = state.buddy.userToggle;
      if (requested) state.buddy.userToggle = requested;
      return {
        toggle: state.buddy.userToggle,
        detected: state.buddy.detected,
        lastChecked: state.buddy.lastChecked,
        changed: requested !== undefined && requested !== before,
      };
    },
    { onMissingOrCorrupt: () => recoverCorruptState(generatePet) },
  );
}

function parseToggle(s: string | undefined): BuddyToggle | undefined {
  if (s === undefined) return undefined;
  if (s === "on" || s === "off" || s === "auto") return s;
  return undefined;
}

export async function buddyCli(argv: string[]): Promise<number> {
  const arg = argv[0];
  if (arg !== undefined && arg !== "on" && arg !== "off" && arg !== "auto") {
    process.stderr.write(`Unknown buddy mode: ${arg}\n`);
    process.stderr.write("Usage: petforge buddy [on|off|auto]\n");
    return 1;
  }
  try {
    const result = await runBuddyCommand(arg);
    if (result.changed) {
      process.stdout.write(`Buddy mode set to: ${result.toggle}\n`);
    } else if (arg === undefined) {
      process.stdout.write(`Buddy mode: ${result.toggle}\n`);
      const detectedLabel = result.detected ? "detected" : "not detected";
      const checkedLabel = result.lastChecked
        ? new Date(result.lastChecked).toISOString()
        : "never";
      process.stdout.write(`Last detection: ${detectedLabel} (checked ${checkedLabel})\n`);
    } else {
      process.stdout.write(`Buddy mode: ${result.toggle} (no change)\n`);
    }
    return 0;
  } catch (err) {
    process.stderr.write(`petforge buddy failed: ${(err as Error).message}\n`);
    return 1;
  }
}
