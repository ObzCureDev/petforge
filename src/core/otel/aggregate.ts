import type { ClaudeMetricDataPoint } from "./parse.js";
import type { OtelCounters } from "./schema.js";
import { type OtlpAttribute, readAttr, readNumber } from "./types.js";

/**
 * In-memory stateful aggregator for cumulative OTel metrics.
 *
 * Claude Code emits monotonic counters. Each batch contains the absolute
 * value, not the delta. We track previous values per (metric, attrs) tuple
 * and only add the delta to PetForge counters.
 *
 * On Claude Code restart counters reset to 0 — we detect "value < memo"
 * and treat that batch as a new baseline (delta = 0, memo updated).
 *
 * The aggregator's memo is in-memory only (not persisted in state.json).
 * On `petforge collect` restart, the first batch establishes a fresh
 * baseline. Acceptable: at worst we miss one batch's data per restart.
 */
export class Aggregator {
  private memo = new Map<string, number>();

  applyMetrics(counters: OtelCounters, items: ClaudeMetricDataPoint[]): void {
    let touched = false;
    let nonZero = false;

    for (const item of items) {
      const value = readNumber(item.dataPoint);
      const key = memoKey(item.name, item.dataPoint.attributes);
      const previous = this.memo.get(key);
      let delta: number;
      if (previous === undefined || value < previous) {
        delta = 0;
      } else {
        delta = value - previous;
      }
      this.memo.set(key, value);

      if (value > 0) nonZero = true;
      touched = true;

      this.dispatch(counters, item, delta);
    }

    if (touched) counters.lastUpdate = Date.now();
    if (nonZero && counters.ingesterStarted === 0) {
      counters.ingesterStarted = Date.now();
    }
  }

  private dispatch(counters: OtelCounters, item: ClaudeMetricDataPoint, delta: number): void {
    if (delta <= 0) return;
    const dp = item.dataPoint;
    const type = readAttr(dp, "type");
    const decision = readAttr(dp, "decision");

    switch (item.name) {
      case "claude_code.lines_of_code.count":
        if (type === "added") counters.linesAdded += delta;
        else if (type === "removed") counters.linesRemoved += delta;
        break;

      case "claude_code.token.usage": {
        const model = readAttr(dp, "model");
        if (type === "input") {
          counters.tokensIn += delta;
          if (model) addModel(counters, model, "tokensIn", delta);
        } else if (type === "output") {
          counters.tokensOut += delta;
          if (model) addModel(counters, model, "tokensOut", delta);
        } else if (type === "cache_read") {
          counters.tokensCacheRead += delta;
        } else if (type === "cache_creation") {
          counters.tokensCacheCreation += delta;
        }
        break;
      }

      case "claude_code.cost.usage":
        // Cost reported in USD. Convert to cents (round) to keep integer math.
        counters.costUsdCents += Math.round(delta * 100);
        break;

      case "claude_code.code_edit_tool.decision":
        if (decision === "accept") counters.editsAccepted += delta;
        else if (decision === "reject") counters.editsRejected += delta;
        break;

      case "claude_code.tool_decision":
        if (decision === "accept") counters.toolDecisionsAccepted += delta;
        else if (decision === "reject") counters.toolDecisionsRejected += delta;
        break;

      case "claude_code.commit.count":
        counters.commitCount += delta;
        break;

      case "claude_code.pull_request.count":
        counters.prCount += delta;
        break;

      case "claude_code.api.error.count":
        counters.apiErrorCount += delta;
        break;

      // claude_code.session.count: ignored (we track sessions via hooks)
      // unknown metrics: ignored
      default:
        break;
    }
  }
}

function memoKey(name: string, attrs?: OtlpAttribute[]): string {
  if (!attrs || attrs.length === 0) return name;
  const sorted = [...attrs]
    .map((a) => `${a.key}=${a.value?.stringValue ?? ""}`)
    .sort()
    .join(",");
  return `${name}::${sorted}`;
}

function addModel(
  counters: OtelCounters,
  model: string,
  field: "tokensIn" | "tokensOut",
  delta: number,
): void {
  const current = counters.modelUsage[model] ?? {
    tokensIn: 0,
    tokensOut: 0,
    sessions: 0,
  };
  current[field] += delta;
  counters.modelUsage[model] = current;
}
