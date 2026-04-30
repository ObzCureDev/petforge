import { beforeEach, describe, expect, it } from "vitest";
import { Aggregator } from "../../src/core/otel/aggregate.js";
import { createInitialOtelCounters } from "../../src/core/otel/schema.js";

describe("Aggregator", () => {
  let agg: Aggregator;
  let counters: ReturnType<typeof createInitialOtelCounters>;

  beforeEach(() => {
    agg = new Aggregator();
    counters = createInitialOtelCounters();
  });

  it("first batch establishes baseline (delta = 0)", () => {
    agg.applyMetrics(counters, [
      {
        name: "claude_code.lines_of_code.count",
        dataPoint: {
          asInt: "100",
          attributes: [{ key: "type", value: { stringValue: "added" } }],
        },
      },
    ]);
    expect(counters.linesAdded).toBe(0);
  });

  it("second batch with growing values adds the delta", () => {
    agg.applyMetrics(counters, [
      {
        name: "claude_code.lines_of_code.count",
        dataPoint: {
          asInt: "100",
          attributes: [{ key: "type", value: { stringValue: "added" } }],
        },
      },
    ]);
    agg.applyMetrics(counters, [
      {
        name: "claude_code.lines_of_code.count",
        dataPoint: {
          asInt: "150",
          attributes: [{ key: "type", value: { stringValue: "added" } }],
        },
      },
    ]);
    expect(counters.linesAdded).toBe(50);
  });

  it("a value lower than the memo is treated as new baseline (Claude restarted)", () => {
    agg.applyMetrics(counters, [
      {
        name: "claude_code.lines_of_code.count",
        dataPoint: {
          asInt: "100",
          attributes: [{ key: "type", value: { stringValue: "added" } }],
        },
      },
    ]);
    agg.applyMetrics(counters, [
      {
        name: "claude_code.lines_of_code.count",
        dataPoint: {
          asInt: "50",
          attributes: [{ key: "type", value: { stringValue: "added" } }],
        },
      },
    ]);
    expect(counters.linesAdded).toBe(0);
  });

  it("token usage maps per-model breakdown", () => {
    agg.applyMetrics(counters, [
      {
        name: "claude_code.token.usage",
        dataPoint: {
          asInt: "1000",
          attributes: [
            { key: "type", value: { stringValue: "input" } },
            { key: "model", value: { stringValue: "claude-opus-4-7" } },
          ],
        },
      },
    ]);
    agg.applyMetrics(counters, [
      {
        name: "claude_code.token.usage",
        dataPoint: {
          asInt: "1500",
          attributes: [
            { key: "type", value: { stringValue: "input" } },
            { key: "model", value: { stringValue: "claude-opus-4-7" } },
          ],
        },
      },
    ]);
    expect(counters.tokensIn).toBe(500);
    expect(counters.modelUsage["claude-opus-4-7"]?.tokensIn).toBe(500);
  });

  it("cost usage stored as cents", () => {
    agg.applyMetrics(counters, [{ name: "claude_code.cost.usage", dataPoint: { asDouble: 0.0 } }]);
    agg.applyMetrics(counters, [{ name: "claude_code.cost.usage", dataPoint: { asDouble: 4.31 } }]);
    expect(counters.costUsdCents).toBe(431);
  });

  it("edits accept/reject by attribute", () => {
    agg.applyMetrics(counters, [
      {
        name: "claude_code.code_edit_tool.decision",
        dataPoint: {
          asInt: "10",
          attributes: [{ key: "decision", value: { stringValue: "accept" } }],
        },
      },
      {
        name: "claude_code.code_edit_tool.decision",
        dataPoint: {
          asInt: "3",
          attributes: [{ key: "decision", value: { stringValue: "reject" } }],
        },
      },
    ]);
    agg.applyMetrics(counters, [
      {
        name: "claude_code.code_edit_tool.decision",
        dataPoint: {
          asInt: "20",
          attributes: [{ key: "decision", value: { stringValue: "accept" } }],
        },
      },
      {
        name: "claude_code.code_edit_tool.decision",
        dataPoint: {
          asInt: "5",
          attributes: [{ key: "decision", value: { stringValue: "reject" } }],
        },
      },
    ]);
    expect(counters.editsAccepted).toBe(10);
    expect(counters.editsRejected).toBe(2);
  });

  it("commit / pr / api error counts", () => {
    agg.applyMetrics(counters, [
      { name: "claude_code.commit.count", dataPoint: { asInt: "0" } },
      { name: "claude_code.pull_request.count", dataPoint: { asInt: "0" } },
      { name: "claude_code.api.error.count", dataPoint: { asInt: "0" } },
    ]);
    agg.applyMetrics(counters, [
      { name: "claude_code.commit.count", dataPoint: { asInt: "5" } },
      { name: "claude_code.pull_request.count", dataPoint: { asInt: "2" } },
      { name: "claude_code.api.error.count", dataPoint: { asInt: "7" } },
    ]);
    expect(counters.commitCount).toBe(5);
    expect(counters.prCount).toBe(2);
    expect(counters.apiErrorCount).toBe(7);
  });

  it("ingesterStarted set on first non-zero ingest", () => {
    expect(counters.ingesterStarted).toBe(0);
    agg.applyMetrics(counters, [
      {
        name: "claude_code.lines_of_code.count",
        dataPoint: {
          asInt: "0",
          attributes: [{ key: "type", value: { stringValue: "added" } }],
        },
      },
    ]);
    expect(counters.ingesterStarted).toBe(0);
    agg.applyMetrics(counters, [
      {
        name: "claude_code.lines_of_code.count",
        dataPoint: {
          asInt: "5",
          attributes: [{ key: "type", value: { stringValue: "added" } }],
        },
      },
    ]);
    expect(counters.ingesterStarted).toBeGreaterThan(0);
  });

  it("lastUpdate set on each apply", () => {
    const before = Date.now();
    agg.applyMetrics(counters, [
      {
        name: "claude_code.lines_of_code.count",
        dataPoint: {
          asInt: "1",
          attributes: [{ key: "type", value: { stringValue: "added" } }],
        },
      },
    ]);
    expect(counters.lastUpdate).toBeGreaterThanOrEqual(before);
  });

  it("unknown metric name is silently ignored", () => {
    agg.applyMetrics(counters, [
      { name: "claude_code.unknown.metric", dataPoint: { asInt: "100" } },
    ]);
    expect(counters.linesAdded).toBe(0);
    expect(counters.lastUpdate).toBeGreaterThan(0); // still considered an ingest
  });
});
