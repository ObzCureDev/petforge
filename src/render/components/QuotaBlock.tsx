/**
 * QuotaBlock - Ink rendering of `state.counters.quota` in `petforge card`.
 * Hidden when quota is undefined or opt-out. Spec §"Surface - CLI card".
 */

import { Box, Text } from "ink";
import type React from "react";
import type { QuotaState } from "../../core/quota/schema.js";

export interface QuotaBlockProps {
  quota: QuotaState | undefined;
}

export function QuotaBlock({ quota }: QuotaBlockProps): React.ReactElement | null {
  if (!quota?.optIn) return null;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>QUOTAS</Text>
      {quota.session5h ? (
        <QuotaBar
          label="Session (5h)"
          util={quota.session5h.utilization}
          resetTs={quota.session5h.resetTs}
        />
      ) : (
        <Text dimColor>(no data yet)</Text>
      )}
      {quota.weekly7d ? (
        <QuotaBar
          label="Weekly  (7d)"
          util={quota.weekly7d.utilization}
          resetTs={quota.weekly7d.resetTs}
        />
      ) : null}
      {quota.lastProbeOk ? null : (
        <Text color="red">last probe: {quota.lastError ?? "failed"}</Text>
      )}
    </Box>
  );
}

function QuotaBar({
  label,
  util,
  resetTs,
}: {
  label: string;
  util: number;
  resetTs: number;
}): React.ReactElement {
  const pct = Math.max(0, Math.min(100, util));
  const filled = Math.round(pct / 5);
  const bar = "█".repeat(filled).padEnd(20, "░");
  const color = pct >= 95 ? "red" : pct >= 80 ? "yellow" : pct >= 60 ? "magenta" : "green";
  return (
    <Box>
      <Box width={14}>
        <Text>{label}</Text>
      </Box>
      <Text color={color}>
        [{bar}] {pct.toFixed(0)}% · resets {formatResetIn(resetTs)}
      </Text>
    </Box>
  );
}

function formatResetIn(resetTsSec: number): string {
  const deltaSec = resetTsSec - Math.floor(Date.now() / 1000);
  if (deltaSec <= 0) return "now";
  const h = Math.floor(deltaSec / 3600);
  const m = Math.floor((deltaSec % 3600) / 60);
  if (h >= 24) return `in ${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `in ${h}h ${m}m`;
  return `in ${m}m`;
}
