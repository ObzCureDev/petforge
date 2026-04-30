/**
 * WatchView — persistent animation at 8 FPS until Ctrl+C / q / Esc.
 *
 * Used by `petforge watch`.
 *
 * - Re-renders SnapshotView every 125ms (animation tick), advancing the
 *   frame counter.
 * - Polls state.json every 500ms (live-reload tick) so XP / level /
 *   achievements update while the user codes — Claude hooks write to disk
 *   in another process and the watch picks them up on the next poll.
 * - Renders an ActivityBlock under the snapshot, mirroring `petforge card`.
 *
 * Cleans up both intervals on unmount and exits the Ink app cleanly on the
 * configured keys (Ctrl+C / q / Esc).
 */

import { performance } from "node:perf_hooks";
import { Box, useApp, useInput } from "ink";
import type React from "react";
import { useEffect, useState } from "react";
import type { State } from "../../core/schema.js";
import { readState } from "../../core/state.js";
import { ActivityBlock } from "./ActivityBlock.js";
import { SnapshotView } from "./SnapshotView.js";

export interface WatchViewProps {
  initialState: State;
  /** Frame interval in ms; default 125 (= 8 FPS). */
  intervalMs?: number;
  /** State poll interval in ms; default 500 (= 2 Hz). */
  pollMs?: number;
}

export function WatchView({
  initialState,
  intervalMs = 125,
  pollMs = 500,
}: WatchViewProps): React.ReactElement {
  const [frame, setFrame] = useState(0);
  const [state, setState] = useState<State>(initialState);
  const { exit } = useApp();

  // Animation tick.
  useEffect(() => {
    const id = setInterval(() => {
      setFrame((f) => f + 1);
    }, intervalMs);
    return (): void => {
      clearInterval(id);
    };
  }, [intervalMs]);

  // State poll: re-read state.json on a slow tick so values move while
  // Claude hooks write in another process. Errors are swallowed — a
  // momentary missing/corrupt state during a hook write should not crash
  // the watch view; the next poll retries.
  useEffect(() => {
    let cancelled = false;
    const poll = async (): Promise<void> => {
      try {
        const next = await readState();
        if (!cancelled) setState(next);
      } catch {
        // ignore — keep current state until next successful poll
      }
    };
    const id = setInterval(() => {
      void poll();
    }, pollMs);
    return (): void => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pollMs]);

  // Belt-and-suspenders: clear the perf_hooks buffer every 30s in case any
  // dependency still emits marks/measures (proper-lockfile retries, fs ops,
  // upstream React/Ink). Defensive — production-mode build is the primary
  // mitigation; this just prevents long-running watches from drifting.
  useEffect(() => {
    const id = setInterval(() => {
      performance.clearMarks();
      performance.clearMeasures();
    }, 30_000);
    return (): void => {
      clearInterval(id);
    };
  }, []);

  useInput((input, key) => {
    if (key.escape || input === "q" || (key.ctrl && input === "c")) {
      exit();
    }
  });

  return (
    <Box flexDirection="column">
      <SnapshotView state={state} frameIndex={frame} />
      <ActivityBlock state={state} />
    </Box>
  );
}
