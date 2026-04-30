/**
 * `petforge buddy [on|off|auto|import [--from FILE] [--clear]]`
 *
 * No arg: prints current toggle, last detection, and import status.
 * `on`:     force runtime Buddy visual if available (or imported).
 * `off`:    always use PetForge visual.
 * `auto`:   detect at session start and use if available (default).
 * `import`: store a Buddy ASCII visual the renderer will use whenever the
 *           toggle is `on`. Reads from stdin by default, `--from FILE` for
 *           a file, or `--clear` to wipe the cache.
 *
 * The toggle is persisted in state.buddy.userToggle. The imported ASCII is
 * persisted in state.buddy.cardCache — set only by an explicit user action
 * (this command), never by auto-detection.
 */

import { promises as fs } from "node:fs";
import { generatePet } from "../core/pet-engine.js";
import type { BuddyToggle } from "../core/schema.js";
import { recoverCorruptState, withStateLock } from "../core/state.js";

export interface BuddyCommandResult {
  toggle: BuddyToggle;
  detected: boolean;
  lastChecked: number;
  hasCard: boolean;
  cardLines: number;
  changed: boolean;
}

export async function runBuddyCommand(arg: string | undefined): Promise<BuddyCommandResult> {
  const requested = parseToggle(arg);

  return await withStateLock(
    (state) => {
      const before = state.buddy.userToggle;
      if (requested) state.buddy.userToggle = requested;
      const card = state.buddy.cardCache ?? null;
      return {
        toggle: state.buddy.userToggle,
        detected: state.buddy.detected,
        lastChecked: state.buddy.lastChecked,
        hasCard: card !== null && card.length > 0,
        cardLines: card ? card.split("\n").length : 0,
        changed: requested !== undefined && requested !== before,
      };
    },
    { onMissingOrCorrupt: () => recoverCorruptState(generatePet) },
  );
}

export interface BuddyImportOptions {
  /** Either "stdin" (read process.stdin) or a file path. */
  source: "stdin" | { file: string };
  /** When true, ignore source and clear the existing cache instead. */
  clear?: boolean;
}

export interface BuddyImportResult {
  cleared: boolean;
  bytesStored: number;
  lines: number;
  toggle: BuddyToggle;
}

const MAX_CARD_BYTES = 32 * 1024;

export async function runBuddyImport(opts: BuddyImportOptions): Promise<BuddyImportResult> {
  let payload: string | null;

  if (opts.clear) {
    payload = null;
  } else if (opts.source === "stdin") {
    payload = await readStdin();
  } else {
    payload = await fs.readFile(opts.source.file, "utf8");
  }

  if (payload !== null) {
    if (payload.length === 0) {
      throw new Error("input is empty — nothing to import");
    }
    if (payload.length > MAX_CARD_BYTES) {
      throw new Error(
        `input is ${payload.length} bytes (max ${MAX_CARD_BYTES}). Refusing to store oversized Buddy.`,
      );
    }
    // Strip a trailing newline (almost always present from `claude /buddy
    // card | petforge buddy import`) but preserve everything else verbatim.
    if (payload.endsWith("\n")) payload = payload.slice(0, -1);
  }

  return await withStateLock(
    (state) => {
      state.buddy.cardCache = payload;
      // Auto-flip toggle to "on" on first successful import so the user
      // sees their Buddy immediately. Don't touch on clear.
      if (payload !== null && state.buddy.userToggle !== "on") {
        state.buddy.userToggle = "on";
      }
      return {
        cleared: payload === null,
        bytesStored: payload?.length ?? 0,
        lines: payload ? payload.split("\n").length : 0,
        toggle: state.buddy.userToggle,
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

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error(
      "no stdin detected — pipe a Buddy card in (e.g. `claude /buddy card | petforge buddy import`) " +
        "or use `--from FILE`",
    );
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function buddyCli(argv: string[]): Promise<number> {
  const arg = argv[0];

  // ---- import sub-command ----
  if (arg === "import") {
    const sub = argv.slice(1);
    let from: string | undefined;
    let clear = false;
    for (const a of sub) {
      if (a === "--clear") {
        clear = true;
      } else if (a.startsWith("--from=")) {
        from = a.slice("--from=".length);
      } else if (a === "--from") {
        // Unsupported space-form to keep flag parsing simple.
        process.stderr.write("Use `--from=FILE` (with =), not `--from FILE`.\n");
        return 1;
      } else {
        process.stderr.write(`Unknown buddy import flag: ${a}\n`);
        return 1;
      }
    }
    try {
      const res = await runBuddyImport({
        source: from ? { file: from } : "stdin",
        clear,
      });
      if (res.cleared) {
        process.stdout.write("Buddy import cleared. Toggle unchanged.\n");
      } else {
        process.stdout.write(
          `Buddy imported: ${res.lines} lines, ${res.bytesStored} bytes. Toggle: ${res.toggle}.\n`,
        );
      }
      return 0;
    } catch (err) {
      process.stderr.write(`petforge buddy import failed: ${(err as Error).message}\n`);
      return 1;
    }
  }

  // ---- toggle / status ----
  if (arg !== undefined && arg !== "on" && arg !== "off" && arg !== "auto") {
    process.stderr.write(`Unknown buddy mode: ${arg}\n`);
    process.stderr.write("Usage: petforge buddy [on|off|auto|import [--from=FILE] [--clear]]\n");
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
      const cardLabel = result.hasCard
        ? `imported (${result.cardLines} lines)`
        : "none — pipe `claude /buddy card | petforge buddy import` to set one";
      process.stdout.write(`Imported card: ${cardLabel}\n`);
    } else {
      process.stdout.write(`Buddy mode: ${result.toggle} (no change)\n`);
    }
    return 0;
  } catch (err) {
    process.stderr.write(`petforge buddy failed: ${(err as Error).message}\n`);
    return 1;
  }
}
