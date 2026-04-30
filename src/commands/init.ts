/**
 * `petforge init` — patch ~/.claude/settings.json to register PetForge hooks.
 *
 * The command is interactive (unlike `hook` which must be silent): it prints
 * status messages to stdout, prompts before mutating the user's settings,
 * and creates a backup before any write. Invalid JSON is reported but never
 * overwritten.
 */

import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import { CLAUDE_SETTINGS_FILE } from "../core/paths.js";
import {
  applyOtelEnv,
  buildPetforgeHookConfig,
  type ClaudeSettings,
  ClaudeSettingsInvalidJsonError,
  detectExistingPetforgeHooks,
  detectOtelEnvConflicts,
  mergeHookConfig,
  readClaudeSettings,
  stripOtelEnv,
  writeClaudeSettingsWithBackup,
} from "../settings/claude-config.js";

export interface InitOptions {
  /** Skip interactive prompt — assume "yes". */
  yes?: boolean;
  /** Override settings path (for tests). */
  settingsPath?: string;
  // V2.0 — OTel env block management
  /** Add the PetForge OTel env block to settings.json. */
  otel?: boolean;
  /** Remove the PetForge OTel env block from settings.json. */
  noOtel?: boolean;
  /** With `otel`, override conflicts on existing OTEL_* env keys. */
  force?: boolean;
}

export interface InitResult {
  status:
    | "ok-already-configured"
    | "ok-installed"
    | "ok-updated"
    | "skipped"
    | "error-invalid-json"
    | "error-conflict";
  message: string;
  backupPath?: string | null;
  /** Conflicting env keys, populated only on `error-conflict`. */
  conflicts?: string[];
}

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  try {
    const ans = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return ans === "y" || ans === "yes";
  } finally {
    rl.close();
  }
}

export async function runInit(opts: InitOptions = {}): Promise<InitResult> {
  const filePath = opts.settingsPath ?? CLAUDE_SETTINGS_FILE;

  let settings: ClaudeSettings | null;
  try {
    settings = await readClaudeSettings(filePath);
  } catch (err) {
    if (err instanceof ClaudeSettingsInvalidJsonError) {
      return {
        status: "error-invalid-json",
        message: `Invalid JSON in ${filePath}. PetForge will not overwrite it. Please fix or remove the file and retry.`,
      };
    }
    throw err;
  }

  // V2.0: detect OTel env conflicts before any work — fail fast.
  if (opts.otel && !opts.force) {
    const conflicts = detectOtelEnvConflicts(settings);
    if (conflicts.length > 0) {
      return {
        status: "error-conflict",
        message:
          `Conflicting env entries found: ${conflicts.join(", ")}. ` +
          "Re-run with --force to overwrite, or remove these from settings.json first.",
        conflicts,
      };
    }
  }

  const detection = detectExistingPetforgeHooks(settings);

  // Already configured and unchanged across all 5 groups → no-op …
  // … but only when no OTel mutation was requested. Otherwise we still
  // need to fall through to apply / strip the env block.
  if (
    detection.found &&
    detection.outdated.length === 0 &&
    detection.groupsFound.length === 5 &&
    !opts.otel &&
    !opts.noOtel
  ) {
    return {
      status: "ok-already-configured",
      message: "PetForge hooks already registered in ~/.claude/settings.json. Nothing to do.",
    };
  }

  // Outdated → require confirmation
  if (detection.found && detection.outdated.length > 0 && !opts.yes) {
    const proceed = await confirm(
      `Outdated PetForge hooks detected in: ${detection.outdated.join(", ")}. Update?`,
    );
    if (!proceed) {
      return { status: "skipped", message: "Update skipped." };
    }
  }

  // Fresh install (no hooks present) → require confirmation unless --yes
  if (!detection.found && !opts.yes) {
    const proceed = await confirm(
      `Install PetForge hooks into ${filePath}? A backup will be created.`,
    );
    if (!proceed) {
      return { status: "skipped", message: "Installation skipped." };
    }
  }

  let merged = mergeHookConfig(settings, buildPetforgeHookConfig());
  if (opts.otel) merged = applyOtelEnv(merged);
  if (opts.noOtel) merged = stripOtelEnv(merged);
  const backupPath = await writeClaudeSettingsWithBackup(merged, filePath);
  return {
    status: detection.found ? "ok-updated" : "ok-installed",
    message: detection.found
      ? "PetForge hooks updated."
      : "PetForge hooks installed. Run `petforge` to see your pet.",
    backupPath,
  };
}

/**
 * CLI shell. Prints status messages and returns exit code.
 */
export async function initCli(argv: string[]): Promise<number> {
  const yes = argv.includes("--yes") || argv.includes("-y");
  const force = argv.includes("--force");
  const otel = argv.includes("--otel");
  const noOtel = argv.includes("--no-otel");
  if (otel && noOtel) {
    process.stderr.write("--otel and --no-otel are mutually exclusive\n");
    return 1;
  }
  try {
    const result = await runInit({ yes, otel, noOtel, force });
    // `init` prints to stdout — it's interactive, unlike `hook`.
    process.stdout.write(`${result.message}\n`);
    if (result.backupPath) {
      process.stdout.write(`Backup: ${result.backupPath}\n`);
    }
    return result.status.startsWith("error-") ? 1 : 0;
  } catch (err) {
    process.stderr.write(`petforge init failed: ${(err as Error).message}\n`);
    return 1;
  }
}
