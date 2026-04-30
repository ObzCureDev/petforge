/**
 * Minimal OTLP/HTTP/JSON shape we care about.
 *
 * We only consume metrics in V2.0 (logs deferred to V2.1).
 * See: https://opentelemetry.io/docs/specs/otlp/#otlphttp
 */

export interface OtlpAttributeValue {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
}

export interface OtlpAttribute {
  key: string;
  value?: OtlpAttributeValue;
}

export interface OtlpDataPoint {
  attributes?: OtlpAttribute[];
  asInt?: string | number;
  asDouble?: number;
  timeUnixNano?: string | number;
  startTimeUnixNano?: string | number;
}

export interface OtlpSum {
  dataPoints: OtlpDataPoint[];
  isMonotonic?: boolean;
  aggregationTemporality?: number;
}

export interface OtlpGauge {
  dataPoints: OtlpDataPoint[];
}

export interface OtlpMetric {
  name: string;
  description?: string;
  unit?: string;
  sum?: OtlpSum;
  gauge?: OtlpGauge;
}

export interface OtlpScopeMetrics {
  scope?: { name?: string; version?: string };
  metrics?: OtlpMetric[];
}

export interface OtlpResourceMetrics {
  resource?: { attributes?: OtlpAttribute[] };
  scopeMetrics?: OtlpScopeMetrics[];
}

export interface OtlpExportMetricsRequest {
  resourceMetrics?: OtlpResourceMetrics[];
}

/**
 * Convenience helper: read a numeric data-point value safely.
 *
 * OTLP/JSON encodes 64-bit integers as strings to avoid JS precision loss;
 * we coerce both string and number forms uniformly.
 */
export function readNumber(dp: OtlpDataPoint): number {
  if (typeof dp.asInt === "string") return Number.parseInt(dp.asInt, 10);
  if (typeof dp.asInt === "number") return dp.asInt;
  if (typeof dp.asDouble === "number") return dp.asDouble;
  return 0;
}

/**
 * Convenience helper: read a string attribute by key.
 */
export function readAttr(dp: OtlpDataPoint, key: string): string | undefined {
  for (const a of dp.attributes ?? []) {
    if (a.key === key) return a.value?.stringValue;
  }
  return undefined;
}
