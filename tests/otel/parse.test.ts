import { describe, expect, it } from "vitest";
import { extractClaudeMetrics } from "../../src/core/otel/parse.js";
import type { OtlpExportMetricsRequest } from "../../src/core/otel/types.js";

function fixturePayload(): OtlpExportMetricsRequest {
  return {
    resourceMetrics: [
      {
        resource: { attributes: [{ key: "service.name", value: { stringValue: "claude-code" } }] },
        scopeMetrics: [
          {
            scope: { name: "claude_code" },
            metrics: [
              {
                name: "claude_code.lines_of_code.count",
                sum: {
                  dataPoints: [
                    {
                      asInt: "42",
                      attributes: [{ key: "type", value: { stringValue: "added" } }],
                      timeUnixNano: "1730000000000000000",
                    },
                  ],
                },
              },
              {
                name: "claude_code.token.usage",
                sum: {
                  dataPoints: [
                    {
                      asInt: "1000",
                      attributes: [
                        { key: "type", value: { stringValue: "input" } },
                        { key: "model", value: { stringValue: "claude-opus-4-7" } },
                      ],
                    },
                  ],
                },
              },
              {
                name: "external.unrelated.metric",
                sum: { dataPoints: [{ asInt: "999" }] },
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("extractClaudeMetrics", () => {
  it("returns flat list of claude_code.* data points only", () => {
    const list = extractClaudeMetrics(fixturePayload());
    expect(list.length).toBe(2);
    expect(list.map((m) => m.name)).toEqual([
      "claude_code.lines_of_code.count",
      "claude_code.token.usage",
    ]);
  });

  it("each entry exposes name + datapoint with attrs accessible", () => {
    const list = extractClaudeMetrics(fixturePayload());
    const lines = list.find((m) => m.name === "claude_code.lines_of_code.count");
    expect(lines?.dataPoint.asInt).toBe("42");
  });

  it("survives empty / malformed envelopes", () => {
    expect(extractClaudeMetrics({})).toEqual([]);
    expect(extractClaudeMetrics({ resourceMetrics: [] })).toEqual([]);
    expect(extractClaudeMetrics({ resourceMetrics: [{ scopeMetrics: [{}] }] })).toEqual([]);
  });

  it("handles gauge as well as sum", () => {
    const payload: OtlpExportMetricsRequest = {
      resourceMetrics: [
        {
          scopeMetrics: [
            {
              metrics: [
                {
                  name: "claude_code.cost.usage",
                  gauge: { dataPoints: [{ asDouble: 0.42 }] },
                },
              ],
            },
          ],
        },
      ],
    };
    const list = extractClaudeMetrics(payload);
    expect(list).toHaveLength(1);
    expect(list[0]?.dataPoint.asDouble).toBe(0.42);
  });
});
