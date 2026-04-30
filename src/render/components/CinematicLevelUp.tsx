/**
 * CinematicLevelUp — figlet "LEVEL UP!" banner with rotating colour.
 *
 * Resolves via `onDone` after ~1.5s. Always uses figlet's bundled
 * "Standard" font (synchronously loaded — no async I/O at runtime).
 */

import figlet from "figlet";
import { Box, Text } from "ink";
import type React from "react";
import { useEffect, useMemo, useState } from "react";

const COLORS = ["yellow", "magenta", "cyan", "green"] as const;
type CinematicColor = (typeof COLORS)[number];

export interface CinematicLevelUpProps {
  level: number;
  onDone: () => void;
  /** Override duration (ms) — defaults to 1500. */
  durationMs?: number;
  /** Override tick interval (ms) — defaults to 100. */
  tickMs?: number;
}

export function CinematicLevelUp({
  level,
  onDone,
  durationMs = 1500,
  tickMs = 100,
}: CinematicLevelUpProps): React.ReactElement {
  const [tick, setTick] = useState(0);

  const banner = useMemo(() => {
    try {
      return figlet.textSync("LEVEL UP!", { font: "Standard" });
    } catch {
      // figlet font load failure is exotic; fall back gracefully.
      return "*** LEVEL UP! ***";
    }
  }, []);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setTick((t) => t + 1);
    }, tickMs);
    const doneId = setTimeout(() => {
      onDone();
    }, durationMs);
    return (): void => {
      clearInterval(intervalId);
      clearTimeout(doneId);
    };
  }, [onDone, durationMs, tickMs]);

  const idx = ((tick % COLORS.length) + COLORS.length) % COLORS.length;
  const color = COLORS[idx] as CinematicColor;

  return (
    <Box flexDirection="column">
      <Text color={color}>{banner}</Text>
      <Text>Reached level {level}!</Text>
    </Box>
  );
}
