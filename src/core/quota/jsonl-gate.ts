/**
 * Decide whether to spend an API call. The gate returns true iff any
 * `*.jsonl` under `~/.claude/projects/` has been modified within `gateMs`.
 *
 * Large installs (thousands of archived session directories) broke the old
 * fixed-order DFS + hard visited-count cap: a real install with 6000+
 * `.jsonl` files could exhaust the 2000-file budget walking through stale
 * archives before ever reaching the handful of files an active session had
 * just touched, producing a false negative ("no activity") even while the
 * user was actively coding - the daemon would then skip probing for hours.
 *
 * Fix: explore directories best-first by their own mtime (the most
 * recently modified directory is expanded next). An actively-used
 * project's directory mtime is bumped whenever its session `.jsonl` is
 * created/updated, so this ordering surfaces the active project almost
 * immediately regardless of how many thousands of unrelated archived
 * files exist elsewhere. Each directory's own `.jsonl` files are checked
 * (with an early-exit on the first fresh one) before descending into its
 * subdirectories. The walk is bounded by a wall-clock scan budget rather
 * than a raw visited-file count, with a very high visited-count backstop
 * retained purely as a runaway guard.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Pure runaway guard - no longer the primary bound (see file header). */
const MAX_FILES_VISITED = 50_000;

/** Stop scanning once elapsed wall-clock time exceeds this. */
const DEFAULT_SCAN_BUDGET_MS = 1_000;

export interface ShouldProbeOptions {
  projectsDir?: string;
  /** epoch ms - logical cutoff basis for "is this file fresh" */
  now: number;
  gateMs: number;
  /** Wall-clock scan budget in ms. Defaults to DEFAULT_SCAN_BUDGET_MS. */
  scanBudgetMs?: number;
  /** Live wall-clock source used only to measure elapsed scan time. Defaults to Date.now. */
  clock?: () => number;
}

interface DirEntry {
  path: string;
  mtimeMs: number;
}

export function defaultProjectsDir(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

export async function shouldProbe(opts: ShouldProbeOptions): Promise<boolean> {
  const root = opts.projectsDir ?? defaultProjectsDir();
  const cutoffMs = opts.now - opts.gateMs;
  const scanBudgetMs = opts.scanBudgetMs ?? DEFAULT_SCAN_BUDGET_MS;
  const clock = opts.clock ?? Date.now;
  const startedAt = clock();

  let rootMtimeMs: number;
  try {
    rootMtimeMs = (await fs.stat(root)).mtimeMs;
  } catch {
    return false;
  }

  // Best-first frontier: always expand the most recently modified directory next.
  const frontier: DirEntry[] = [{ path: root, mtimeMs: rootMtimeMs }];
  let visited = 0;

  while (frontier.length > 0) {
    if (clock() - startedAt > scanBudgetMs) return false;

    // Pop the highest-mtime directory (small frontiers in practice; linear scan is fine).
    let bestIdx = 0;
    let best = frontier[0] as DirEntry;
    for (let i = 1; i < frontier.length; i++) {
      const candidate = frontier[i] as DirEntry;
      if (candidate.mtimeMs > best.mtimeMs) {
        bestIdx = i;
        best = candidate;
      }
    }
    const dir = (frontier.splice(bestIdx, 1)[0] as DirEntry).path;

    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    const subdirs: string[] = [];
    for (const e of entries) {
      if (++visited > MAX_FILES_VISITED) return false;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        subdirs.push(full);
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

    // Check this directory's own files before descending further; only now
    // stat subdirs to decide their priority in the best-first frontier.
    for (const sub of subdirs) {
      try {
        const stat = await fs.stat(sub);
        frontier.push({ path: sub, mtimeMs: stat.mtimeMs });
      } catch {
        // unreadable - skip
      }
    }
  }
  return false;
}
