/**
 * Decide whether to spend an API call. The gate returns true iff any
 * `*.jsonl` under `~/.claude/projects/` has been modified within `gateMs`.
 *
 * Bound by `MAX_FILES_VISITED` to avoid pathological walks. We early-exit
 * on the first fresh file - most installs find one immediately.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const MAX_FILES_VISITED = 2_000;

export interface ShouldProbeOptions {
  projectsDir?: string;
  /** epoch ms */
  now: number;
  gateMs: number;
}

export function defaultProjectsDir(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

export async function shouldProbe(opts: ShouldProbeOptions): Promise<boolean> {
  const root = opts.projectsDir ?? defaultProjectsDir();
  const cutoffMs = opts.now - opts.gateMs;
  let visited = 0;
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (++visited > MAX_FILES_VISITED) return false;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!e.isFile() || !full.endsWith(".jsonl")) continue;
      try {
        const stat = await fs.stat(full);
        if (stat.mtimeMs >= cutoffMs) return true;
      } catch {
        // unreadable - keep scanning
      }
    }
  }
  return false;
}
