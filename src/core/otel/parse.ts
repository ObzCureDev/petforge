import type { OtlpDataPoint, OtlpExportMetricsRequest } from "./types.js";

export interface ClaudeMetricDataPoint {
  name: string;
  dataPoint: OtlpDataPoint;
}

const PREFIX = "claude_code.";

/**
 * Walk an OTLP/HTTP/JSON payload and extract every data point whose
 * containing metric name starts with `claude_code.`. Returns a flat list.
 *
 * Survives missing fields gracefully — never throws on shape weirdness.
 * Anything not matching the prefix is silently dropped.
 */
export function extractClaudeMetrics(payload: OtlpExportMetricsRequest): ClaudeMetricDataPoint[] {
  const out: ClaudeMetricDataPoint[] = [];
  const rms = payload.resourceMetrics ?? [];
  for (const rm of rms) {
    const sms = rm.scopeMetrics ?? [];
    for (const sm of sms) {
      const metrics = sm.metrics ?? [];
      for (const metric of metrics) {
        if (typeof metric.name !== "string" || !metric.name.startsWith(PREFIX)) {
          continue;
        }
        const dps = metric.sum?.dataPoints ?? metric.gauge?.dataPoints ?? [];
        for (const dp of dps) {
          out.push({ name: metric.name, dataPoint: dp });
        }
      }
    }
  }
  return out;
}
