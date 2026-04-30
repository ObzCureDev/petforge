/**
 * OtelLine — second activity line (V2.0).
 *
 * Shown only when the OTel collector has ingested at least one push
 * (i.e. `state.counters.otel.lastUpdate > 0`). V1.x users without OTel
 * see nothing — the line is hidden completely.
 *
 * Layout: `Lines: +A / -B · Tokens: X · Cost: $Y · Cache: Z%`.
 */

import { Text } from "ink";
import type React from "react";
import type { State } from "../../core/schema.js";

export function OtelLine({ state }: { state: State }): React.ReactElement | null {
  const o = state.counters.otel;
  if (!o || o.lastUpdate === 0) return null;

  const lines = `+${formatThousands(o.linesAdded)} / -${formatThousands(o.linesRemoved)}`;
  const tokens = formatCompact(o.tokensIn + o.tokensOut);
  const cost = `$${(o.costUsdCents / 100).toFixed(2)}`;
  const cacheVolume = o.tokensIn + o.tokensCacheRead;
  const cachePct = cacheVolume > 0 ? Math.round((o.tokensCacheRead / cacheVolume) * 100) : 0;

  return (
    <Text dimColor>
      Lines: {lines} · Tokens: {tokens} · Cost: {cost} · Cache: {cachePct}%
    </Text>
  );
}

function formatThousands(n: number): string {
  return n.toLocaleString("en-US");
}

function formatCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
