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
  buildPetforgeHookConfig,
  type ClaudeSettings,
  ClaudeSettingsInvalidJsonError,
  detectExistingPetforgeHooks,
  mergeHookConfig,
  readClaudeSettings,
  writeClaudeSettingsWithBackup,
} from "../settings/claude-config.js";

export interface InitOptions {
  /** Skip interactive prompt — assume "yes". */
  yes?: boolean;
  /** Override settings path (for tests). */
  settingsPath?: string;
}

export interface InitResult {
  status:
    | "ok-already-configured"
    | "ok-installed"
    | "ok-updated"
    | "skipped"
    | "error-invalid-json";
  message: string;
  backupPath?: string | null;
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

  const detection = detectExistingPetforgeHooks(settings);

  // Already configured and unchanged across all 5 groups → no-op.
  if (detection.found && detection.outdated.length === 0 && detection.groupsFound.length === 5) {
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

  const merged = mergeHookConfig(settings, buildPetforgeHookConfig());
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
  try {
    const result = await runInit({ yes });
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
