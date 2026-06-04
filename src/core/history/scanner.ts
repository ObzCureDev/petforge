/**
 * Historical usage scanner - parses every JSONL file under
 * ~/.claude/projects/ and accumulates per-model token usage with
 * timestamps. Pure read-only.
 *
 * Claude Code persists every conversation message on disk. Each assistant
 * message line contains `message.usage` (input/output/cache tokens) and
 * `message.model`. By scanning all JSONL files we can compute the entire
 * cost history of a user's Claude Code activity, not just what PetForge
 * has been collecting since install.
 *
 * Performance note: large installs may have tens of thousands of JSONL
 * files totaling hundreds of MB. We stream line-by-line and only keep
 * aggregates - no per-message retention. Bounded by file count (10k by
 * default) so a runaway scan can't hang indefinitely.
 */

import { createReadStream, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

export interface ModelUsage {
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheCreation: number;
  messageCount: number;
}

export interface ProjectUsage extends ModelUsage {
  /** Folder name under .claude/projects (path-encoded slashes/dots). */
  projectKey: string;
  byModel: Record<string, ModelUsage>;
  /** Epoch ms of the earliest assistant message in this project. */
  oldestTs: number;
  /** Epoch ms of the latest. */
  newestTs: number;
}

export interface HistoricalTotals {
  /** Sum across every model and every project. */
  total: ModelUsage;
  /** Sum per model, all projects merged. */
  byModel: Record<string, ModelUsage>;
  /** Per-project breakdown. */
  byProject: ProjectUsage[];
  /**
   * Usage from messages whose timestamp is >= `todayStartMs`, per model.
   * Empty unless `todayStartMs` was passed to the scan. Lets callers price
   * "today's" spend without a second pass over the JSONL.
   */
  todayByModel: Record<string, ModelUsage>;
  /** Assistant messages counted into `todayByModel`. */
  todayMessageCount: number;
  /**
   * V3.7.8 - usage from messages strictly newer than `sinceTs`, per model.
   * Empty unless `sinceTs` was passed. The persisted-lifetime daemon uses
   * this to compute the delta since the previous scan's `newestTs` so the
   * lifetime total grows monotonically across JSONL archival.
   */
  sinceByModel: Record<string, ModelUsage>;
  /** Assistant messages counted into `sinceByModel`. */
  sinceMessageCount: number;
  /** Epoch ms of the earliest assistant message anywhere. */
  oldestTs: number;
  /** Epoch ms of the latest. */
  newestTs: number;
  /** Files scanned. */
  filesScanned: number;
  /** Lines parsed (any type). */
  linesScanned: number;
  /** Lines with extractable usage (assistant messages). */
  usageLinesScanned: number;
}

export interface ScanOptions {
  projectsDir?: string;
  /** Hard cap on JSONL files visited. Default 10 000. */
  maxFiles?: number;
  /**
   * Epoch ms marking the start of "today" (local midnight). When set, the
   * scan also accumulates messages with `ts >= todayStartMs` into
   * `totals.todayByModel`. Messages without a parseable timestamp never
   * count toward today.
   */
  todayStartMs?: number;
  /**
   * V3.7.8 - epoch ms. Messages with `ts > sinceTs` (strictly) are also
   * accumulated into `totals.sinceByModel`. Used by the additive-lifetime
   * daemon to extract the new-messages-only delta versus the previous scan.
   * Messages without a parseable timestamp never count toward the bucket.
   */
  sinceTs?: number;
}

const DEFAULT_MAX_FILES = 10_000;

function emptyUsage(): ModelUsage {
  return { tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheCreation: 0, messageCount: 0 };
}

export function defaultProjectsDir(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

export async function scanAllJsonl(opts: ScanOptions = {}): Promise<HistoricalTotals> {
  const root = opts.projectsDir ?? defaultProjectsDir();
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
  // null disables the today bucket entirely (avoids any ts comparison).
  const todayStartMs = opts.todayStartMs ?? null;
  // null disables the sinceTs bucket. 0 would mean "include everything",
  // which the daemon uses on its very first scan (no prior persisted state).
  const sinceTs = opts.sinceTs ?? null;

  const totals: HistoricalTotals = {
    total: emptyUsage(),
    byModel: {},
    byProject: [],
    todayByModel: {},
    todayMessageCount: 0,
    sinceByModel: {},
    sinceMessageCount: 0,
    oldestTs: 0,
    newestTs: 0,
    filesScanned: 0,
    linesScanned: 0,
    usageLinesScanned: 0,
  };

  // Find all JSONL files grouped by project (top-level dir under root).
  const byProject: Map<string, string[]> = new Map();
  const stack: { dir: string; projectKey: string | null }[] = [{ dir: root, projectKey: null }];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur) break;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(cur.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur.dir, e.name);
      if (e.isDirectory()) {
        // If we're directly under `root`, this directory's name IS the
        // project key. Otherwise we inherit the existing project key
        // (subdirs under a project, e.g. subagents).
        const childKey = cur.projectKey ?? e.name;
        stack.push({ dir: full, projectKey: childKey });
      } else if (e.isFile() && full.endsWith(".jsonl") && cur.projectKey !== null) {
        const list = byProject.get(cur.projectKey) ?? [];
        list.push(full);
        byProject.set(cur.projectKey, list);
      }
    }
  }

  // Stream each project's files and accumulate. `seenIds` is shared
  // across all files: Claude Code's subagent JSONL files reference the
  // same message ids as their parent conversation, so dedup must be
  // global to avoid double-counting.
  const seenIds = new Set<string>();
  for (const [projectKey, files] of byProject) {
    const pu: ProjectUsage = {
      projectKey,
      ...emptyUsage(),
      byModel: {},
      oldestTs: 0,
      newestTs: 0,
    };
    for (const file of files) {
      if (totals.filesScanned >= maxFiles) break;
      totals.filesScanned++;
      await accumulateFile(file, pu, totals, seenIds, todayStartMs, sinceTs);
    }
    if (pu.messageCount > 0) totals.byProject.push(pu);
    if (totals.filesScanned >= maxFiles) break;
  }

  totals.byProject.sort((a, b) => b.newestTs - a.newestTs);
  return totals;
}

async function accumulateFile(
  filePath: string,
  pu: ProjectUsage,
  totals: HistoricalTotals,
  seenIds: Set<string>,
  todayStartMs: number | null,
  sinceTs: number | null,
): Promise<void> {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
  for await (const line of rl) {
    totals.linesScanned++;
    if (line.length === 0) continue;
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const u = extractUsage(row);
    if (!u) continue;
    // V3.7.4 - Claude Code logs each assistant turn across multiple
    // JSONL entries (text part + tool_use + status events) and copies
    // the same `usage` block into each. Deduplicate by Anthropic's
    // `message.id` to count each API call exactly once.
    if (u.messageId) {
      if (seenIds.has(u.messageId)) continue;
      seenIds.add(u.messageId);
    }
    totals.usageLinesScanned++;
    applyUsage(totals.total, u);
    let totalsBucket = totals.byModel[u.model];
    if (!totalsBucket) {
      totalsBucket = emptyUsage();
      totals.byModel[u.model] = totalsBucket;
    }
    applyUsage(totalsBucket, u);
    applyUsage(pu, u);
    let projectBucket = pu.byModel[u.model];
    if (!projectBucket) {
      projectBucket = emptyUsage();
      pu.byModel[u.model] = projectBucket;
    }
    applyUsage(projectBucket, u);
    if (todayStartMs !== null && u.ts >= todayStartMs) {
      let todayBucket = totals.todayByModel[u.model];
      if (!todayBucket) {
        todayBucket = emptyUsage();
        totals.todayByModel[u.model] = todayBucket;
      }
      applyUsage(todayBucket, u);
      totals.todayMessageCount += 1;
    }
    if (sinceTs !== null && u.ts > sinceTs) {
      let sinceBucket = totals.sinceByModel[u.model];
      if (!sinceBucket) {
        sinceBucket = emptyUsage();
        totals.sinceByModel[u.model] = sinceBucket;
      }
      applyUsage(sinceBucket, u);
      totals.sinceMessageCount += 1;
    }
    if (u.ts > 0) {
      if (totals.oldestTs === 0 || u.ts < totals.oldestTs) totals.oldestTs = u.ts;
      if (u.ts > totals.newestTs) totals.newestTs = u.ts;
      if (pu.oldestTs === 0 || u.ts < pu.oldestTs) pu.oldestTs = u.ts;
      if (u.ts > pu.newestTs) pu.newestTs = u.ts;
    }
  }
}

interface ExtractedUsage {
  model: string;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheCreation: number;
  /** epoch ms */
  ts: number;
  /** Anthropic message id (msg_*) for dedup. */
  messageId: string | null;
}

function extractUsage(row: unknown): ExtractedUsage | null {
  if (typeof row !== "object" || row === null) return null;
  const r = row as Record<string, unknown>;
  const msg = (r.message ?? r) as Record<string, unknown> | undefined;
  if (!msg || typeof msg !== "object") return null;
  const usage = msg.usage as Record<string, unknown> | undefined;
  if (!usage || typeof usage !== "object") return null;
  const model = typeof msg.model === "string" ? msg.model : "unknown";
  const messageId = typeof msg.id === "string" ? msg.id : null;
  const num = (k: string): number => {
    const v = usage[k];
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  };
  const tokensIn = num("input_tokens");
  const tokensOut = num("output_tokens");
  const cacheRead = num("cache_read_input_tokens");
  const cacheCreation = num("cache_creation_input_tokens");
  // Skip rows that have a usage block but zero everywhere (defensive - some
  // tool_result rows include an empty usage shell).
  if (tokensIn + tokensOut + cacheRead + cacheCreation === 0) return null;
  const tsRaw = (r.timestamp ?? msg.timestamp) as string | number | undefined;
  let ts = 0;
  if (typeof tsRaw === "string") {
    const parsed = Date.parse(tsRaw);
    if (Number.isFinite(parsed)) ts = parsed;
  } else if (typeof tsRaw === "number" && Number.isFinite(tsRaw)) {
    ts = tsRaw;
  }
  return { model, tokensIn, tokensOut, cacheRead, cacheCreation, ts, messageId };
}

function applyUsage(target: ModelUsage, u: ExtractedUsage): void {
  target.tokensIn += u.tokensIn;
  target.tokensOut += u.tokensOut;
  target.cacheRead += u.cacheRead;
  target.cacheCreation += u.cacheCreation;
  target.messageCount += 1;
}
