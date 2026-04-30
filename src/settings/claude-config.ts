/**
 * Read, mutate, and persist ~/.claude/settings.json safely.
 *
 * The file is owned by the user — we ONLY add/update PetForge entries
 * and preserve everything else verbatim.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { CLAUDE_SETTINGS_FILE } from "../core/paths.js";

// Hook event groups Claude Code recognizes.
const PETFORGE_HOOK_GROUPS = [
  { groupKey: "UserPromptSubmit", event: "prompt" },
  { groupKey: "PostToolUse", event: "post_tool_use" },
  { groupKey: "Stop", event: "stop" },
  { groupKey: "SessionStart", event: "session_start" },
  { groupKey: "SessionEnd", event: "session_end" },
] as const;

export type GroupKey = (typeof PETFORGE_HOOK_GROUPS)[number]["groupKey"];

// Shape we care about (Claude's settings file may contain many other fields).
export interface ClaudeHookEntry {
  type: "command";
  command: string;
  timeout?: number;
  // Other fields preserved verbatim.
  [k: string]: unknown;
}

export interface ClaudeHookGroup {
  matcher?: string;
  hooks: ClaudeHookEntry[];
  [k: string]: unknown;
}

export interface ClaudeSettings {
  hooks?: Partial<Record<GroupKey, ClaudeHookGroup[]>> & {
    // unknown groups preserved
    [k: string]: ClaudeHookGroup[] | undefined;
  };
  [k: string]: unknown;
}

export class ClaudeSettingsInvalidJsonError extends Error {
  public readonly filePath: string;
  constructor(filePath: string, cause?: unknown) {
    super(`~/.claude/settings.json is not valid JSON: ${filePath}`, { cause });
    this.name = "ClaudeSettingsInvalidJsonError";
    this.filePath = filePath;
  }
}

/**
 * Returns the Claude settings, or `null` if the file is missing.
 * Throws ClaudeSettingsInvalidJsonError if it exists but is malformed.
 */
export async function readClaudeSettings(
  filePath: string = CLAUDE_SETTINGS_FILE,
): Promise<ClaudeSettings | null> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return null;
    throw err;
  }
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as ClaudeSettings;
  } catch (err) {
    throw new ClaudeSettingsInvalidJsonError(filePath, err);
  }
}

/**
 * Build the PetForge hook config — the 5 hook groups PetForge wants to register.
 */
export function buildPetforgeHookConfig(): Record<GroupKey, ClaudeHookGroup[]> {
  const groups: Partial<Record<GroupKey, ClaudeHookGroup[]>> = {};
  for (const { groupKey, event } of PETFORGE_HOOK_GROUPS) {
    groups[groupKey] = [
      {
        matcher: "*",
        hooks: [
          {
            type: "command",
            command: `petforge hook --event ${event}`,
            timeout: 1,
          },
        ],
      },
    ];
  }
  return groups as Record<GroupKey, ClaudeHookGroup[]>;
}

/**
 * Mark of a PetForge-managed hook entry: command begins with this prefix.
 */
function isPetforgeHookEntry(entry: ClaudeHookEntry): boolean {
  return typeof entry.command === "string" && entry.command.startsWith("petforge hook --event ");
}

export interface PetforgeHooksDetection {
  found: boolean;
  groupsFound: GroupKey[];
  /** Hooks where command matches but version differs from current. */
  outdated: GroupKey[];
}

/**
 * Inspect existing settings and return whether PetForge hooks are present
 * AND whether any of them differ from what `buildPetforgeHookConfig`
 * would produce now. "Outdated" = same group has a PetForge entry but
 * with a different command string or a different timeout.
 */
export function detectExistingPetforgeHooks(
  settings: ClaudeSettings | null,
): PetforgeHooksDetection {
  const result: PetforgeHooksDetection = { found: false, groupsFound: [], outdated: [] };
  if (!settings?.hooks) return result;
  const desired = buildPetforgeHookConfig();
  for (const { groupKey } of PETFORGE_HOOK_GROUPS) {
    const groups = settings.hooks[groupKey];
    if (!Array.isArray(groups)) continue;
    let matched = false;
    let exact = false;
    for (const group of groups) {
      if (!Array.isArray(group.hooks)) continue;
      for (const entry of group.hooks) {
        if (isPetforgeHookEntry(entry)) {
          matched = true;
          // Compare against the desired entry. There's exactly one entry per group in our config.
          const desiredEntry = desired[groupKey][0]?.hooks[0];
          if (
            desiredEntry &&
            entry.command === desiredEntry.command &&
            entry.timeout === desiredEntry.timeout
          ) {
            exact = true;
          }
        }
      }
    }
    if (matched) {
      result.found = true;
      result.groupsFound.push(groupKey);
      if (!exact) result.outdated.push(groupKey);
    }
  }
  return result;
}

/**
 * Thin alias for callers that want the outdated-only view.
 */
export function detectOutdatedPetforgeHooks(settings: ClaudeSettings | null): GroupKey[] {
  return detectExistingPetforgeHooks(settings).outdated;
}

/**
 * Merge PetForge hook config into existing settings, replacing any prior
 * PetForge entries (identified by command prefix) but preserving every
 * non-PetForge entry as-is.
 */
export function mergeHookConfig(
  existing: ClaudeSettings | null,
  petforge: Record<GroupKey, ClaudeHookGroup[]> = buildPetforgeHookConfig(),
): ClaudeSettings {
  const next: ClaudeSettings = existing ? { ...existing } : {};
  const nextHooks: Record<string, ClaudeHookGroup[]> = next.hooks
    ? { ...(next.hooks as Record<string, ClaudeHookGroup[]>) }
    : {};

  for (const { groupKey } of PETFORGE_HOOK_GROUPS) {
    const desiredGroups = petforge[groupKey];
    const existingGroups = (nextHooks[groupKey] ?? []).map((g) => ({
      ...g,
      hooks: (g.hooks ?? []).filter((h) => !isPetforgeHookEntry(h)),
    }));
    // Drop groups that became empty after stripping PetForge entries.
    const cleaned = existingGroups.filter((g) => Array.isArray(g.hooks) && g.hooks.length > 0);
    nextHooks[groupKey] = [...cleaned, ...desiredGroups];
  }

  next.hooks = nextHooks;
  return next;
}

/**
 * Write settings with backup. Backup is `<file>.bak`, or
 * `<file>.<timestamp>.bak` if the .bak slot is taken.
 *
 * Returns the path of the backup file written (or null if no backup needed
 * because the source file did not exist yet).
 */
export async function writeClaudeSettingsWithBackup(
  settings: ClaudeSettings,
  filePath: string = CLAUDE_SETTINGS_FILE,
): Promise<string | null> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  let backupPath: string | null = null;
  try {
    await fs.access(filePath);
    // Source exists: choose backup path.
    const primary = `${filePath}.bak`;
    let target = primary;
    try {
      await fs.access(primary);
      // .bak already exists; use timestamped form.
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      target = `${filePath}.${stamp}.bak`;
    } catch {
      // primary backup slot is free — use it
    }
    await fs.copyFile(filePath, target);
    backupPath = target;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== "ENOENT") throw err;
    // Source doesn't exist yet — no backup.
  }

  // Atomic write: tmp + rename
  const data = `${JSON.stringify(settings, null, 2)}\n`;
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, data, "utf8");
  await fs.rename(tmp, filePath);
  return backupPath;
}
