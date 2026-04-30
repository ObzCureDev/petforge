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
  PETFORGE_OTEL_ENV,
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

  // V2.0 — three OTel-related checks. All warnings, never critical.
  checks.push(await checkOtelEnv());
  checks.push(await checkCollectorReachable());
  checks.push(await checkRecentOtelIngest());

  // V2.0.1 — detect "many prompts but 0 sessions" pattern (SessionStart/End
  // hooks not firing on this Claude Code version). Warning, never critical.
  checks.push(await checkSessionHooksFiring());

  const criticalFails = checks.filter((c) => !c.ok && !c.warning);
  return { checks, exitCode: criticalFails.length === 0 ? 0 : 1 };
}

async function checkSessionHooksFiring(): Promise<CheckResult> {
  try {
    const { readState } = await import("../core/state.js");
    const state = await readState();
    const prompts = state.counters.promptsTotal;
    const sessions = state.counters.sessionsTotal;
    if (prompts > 50 && sessions === 0) {
      return {
        name: "SessionStart / SessionEnd hooks firing",
        ok: false,
        warning: true,
        detail:
          `${prompts} prompts but 0 sessions ended — your Claude Code version may not fire SessionStart/SessionEnd. ` +
          "Polyglot / Refactor Master / Marathon are still reachable via lazy-init (since v2.0.1).",
      };
    }
    return { name: "SessionStart / SessionEnd hooks firing", ok: true };
  } catch {
    return { name: "SessionStart / SessionEnd hooks firing", ok: false, warning: true };
  }
}

async function checkOtelEnv(): Promise<CheckResult> {
  try {
    const settings = await readClaudeSettings();
    const env = (settings?.env ?? {}) as Record<string, unknown>;
    const ok = Object.entries(PETFORGE_OTEL_ENV).every(([k, v]) => env[k] === v);
    return {
      name: "OTel env vars in ~/.claude/settings.json",
      ok,
      warning: !ok,
      detail: ok ? undefined : "run `petforge init --otel` to register",
    };
  } catch {
    return {
      name: "OTel env vars in ~/.claude/settings.json",
      ok: false,
      warning: true,
    };
  }
}

async function checkCollectorReachable(): Promise<CheckResult> {
  const port = process.env.PETFORGE_OTEL_PORT ?? "7879";
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 500);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: ctrl.signal });
      const ok = res.ok;
      return {
        name: `OTel collector reachable on 127.0.0.1:${port}`,
        ok,
        warning: !ok,
        detail: ok ? undefined : "run `petforge collect` (start the daemon)",
      };
    } finally {
      clearTimeout(t);
    }
  } catch {
    return {
      name: `OTel collector reachable on 127.0.0.1:${port}`,
      ok: false,
      warning: true,
      detail: "run `petforge collect`",
    };
  }
}

async function checkRecentOtelIngest(): Promise<CheckResult> {
  try {
    const state = await readState();
    const lastUpdate = state.counters.otel?.lastUpdate ?? 0;
    if (lastUpdate === 0) {
      return {
        name: "Recent OTel ingest",
        ok: false,
        warning: true,
        detail: "no OTel data ingested yet",
      };
    }
    const age = Date.now() - lastUpdate;
    const within24h = age < 24 * 60 * 60 * 1000;
    return {
      name: "Recent OTel ingest",
      ok: within24h,
      warning: !within24h,
      detail: within24h
        ? `last batch ${Math.floor(age / 60_000)}m ago`
        : `stale: last batch ${Math.floor(age / 3_600_000)}h ago — is petforge collect running?`,
    };
  } catch {
    return { name: "Recent OTel ingest", ok: false, warning: true };
  }
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
