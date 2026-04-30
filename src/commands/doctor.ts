/**
 * `petforge doctor` — diagnostic checklist.
 *
 * Prints a green/yellow/red checklist of the user's setup. Exits 0 if all
 * CRITICAL checks pass; exits 1 otherwise. Buddy failure is a warning,
 * not critical.
 */

import { promises as fs } from "node:fs";
import { detectBuddy, isClaudeOnPath } from "../core/buddy.js";
import { CLAUDE_SETTINGS_FILE, STATE_FILE } from "../core/paths.js";
import { readState, StateCorruptError, StateNotFoundError } from "../core/state.js";
import {
  ClaudeSettingsInvalidJsonError,
  detectExistingPetforgeHooks,
  readClaudeSettings,
} from "../settings/claude-config.js";

export interface CheckResult {
  name: string;
  ok: boolean;
  /** ok=false but not critical — failures here do not influence the exit code. */
  warning?: boolean;
  detail?: string;
}

const ICON_OK = "✓";
const ICON_WARN = "!";
const ICON_FAIL = "✗";

function fmt(check: CheckResult): string {
  const icon = check.ok ? ICON_OK : check.warning ? ICON_WARN : ICON_FAIL;
  const detail = check.detail ? ` — ${check.detail}` : "";
  return `  ${icon} ${check.name}${detail}`;
}

export async function runDoctor(): Promise<{ checks: CheckResult[]; exitCode: number }> {
  const checks: CheckResult[] = [];

  // Node version (critical)
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  checks.push({
    name: "Node >= 20",
    ok: nodeMajor >= 20,
    detail: `running ${process.versions.node}`,
  });

  // State file
  checks.push(await checkStateFile());

  // Claude settings file
  checks.push(await checkClaudeSettings());

  // PetForge hooks registered
  checks.push(await checkPetforgeHooksRegistered());

  // claude CLI on PATH (warning if missing)
  const onPath = await isClaudeOnPath();
  checks.push({
    name: "claude CLI on PATH",
    ok: onPath,
    warning: !onPath,
    detail: onPath ? undefined : "Buddy integration unavailable (this is OK)",
  });

  // Buddy detection (warning if fails)
  if (onPath) {
    const buddy = await detectBuddy(750);
    checks.push({
      name: "claude /buddy card",
      ok: buddy.detected,
      warning: !buddy.detected,
      detail: buddy.detected ? undefined : "Buddy not configured (this is OK)",
    });
  } else {
    checks.push({
      name: "claude /buddy card",
      ok: false,
      warning: true,
      detail: "skipped (claude not on PATH)",
    });
  }

  const criticalFails = checks.filter((c) => !c.ok && !c.warning);
  return { checks, exitCode: criticalFails.length === 0 ? 0 : 1 };
}

async function checkStateFile(): Promise<CheckResult> {
  try {
    await fs.access(STATE_FILE);
  } catch {
    // First run is OK — state is auto-created on first hook fire.
    return {
      name: "~/.petforge/state.json present",
      ok: false,
      warning: true,
      detail: "not found yet (will be created on first hook)",
    };
  }
  try {
    await readState();
    return { name: "~/.petforge/state.json present + valid", ok: true };
  } catch (err) {
    if (err instanceof StateCorruptError) {
      return {
        name: "~/.petforge/state.json valid",
        ok: false,
        detail: `corrupt: ${err.message}`,
      };
    }
    if (err instanceof StateNotFoundError) {
      return {
        name: "~/.petforge/state.json present",
        ok: false,
        warning: true,
        detail: "missing (run a hook to create)",
      };
    }
    return {
      name: "~/.petforge/state.json readable",
      ok: false,
      detail: (err as Error).message,
    };
  }
}

async function checkClaudeSettings(): Promise<CheckResult> {
  try {
    const settings = await readClaudeSettings();
    if (settings === null) {
      return {
        name: "~/.claude/settings.json present",
        ok: false,
        detail: "not found — run `petforge init` to create it",
      };
    }
    return { name: "~/.claude/settings.json present + valid JSON", ok: true };
  } catch (err) {
    if (err instanceof ClaudeSettingsInvalidJsonError) {
      return {
        name: "~/.claude/settings.json valid JSON",
        ok: false,
        detail: `invalid JSON at ${CLAUDE_SETTINGS_FILE} — fix manually`,
      };
    }
    return {
      name: "~/.claude/settings.json readable",
      ok: false,
      detail: (err as Error).message,
    };
  }
}

async function checkPetforgeHooksRegistered(): Promise<CheckResult> {
  try {
    const settings = await readClaudeSettings();
    if (settings === null) {
      return {
        name: "PetForge hooks registered",
        ok: false,
        detail: "settings.json missing — run `petforge init`",
      };
    }
    const detection = detectExistingPetforgeHooks(settings);
    if (detection.found && detection.outdated.length === 0 && detection.groupsFound.length === 5) {
      return { name: "PetForge hooks registered (all 5 groups, current)", ok: true };
    }
    if (detection.found && detection.outdated.length > 0) {
      return {
        name: "PetForge hooks registered",
        ok: false,
        warning: true,
        detail: `outdated: ${detection.outdated.join(", ")} — run \`petforge init\``,
      };
    }
    return {
      name: "PetForge hooks registered",
      ok: false,
      detail: `${detection.groupsFound.length}/5 groups present — run \`petforge init\``,
    };
  } catch (err) {
    if (err instanceof ClaudeSettingsInvalidJsonError) {
      return {
        name: "PetForge hooks registered",
        ok: false,
        detail: "settings.json has invalid JSON",
      };
    }
    return {
      name: "PetForge hooks registered",
      ok: false,
      detail: (err as Error).message,
    };
  }
}

export async function doctorCli(_argv: string[]): Promise<number> {
  process.stdout.write("PetForge doctor\n");
  process.stdout.write("───────────────\n");
  const { checks, exitCode } = await runDoctor();
  for (const c of checks) {
    process.stdout.write(`${fmt(c)}\n`);
  }
  process.stdout.write("\n");
  if (exitCode === 0) {
    process.stdout.write("All critical checks passed.\n");
  } else {
    process.stdout.write("Critical checks failed. Fix the items marked ✗ and rerun.\n");
  }
  return exitCode;
}
