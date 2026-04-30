/**
 * WatchView — persistent animation at 8 FPS until Ctrl+C / q / Esc.
 *
 * Used by `petforge watch`. Re-renders SnapshotView every 125ms, advancing
 * the frame counter. Cleans up the interval on unmount and exits the Ink
 * app cleanly on the configured keys.
 */

import { useApp, useInput } from "ink";
import type React from "react";
import { useEffect, useState } from "react";
import type { State } from "../../core/schema.js";
import { SnapshotView } from "./SnapshotView.js";

export interface WatchViewProps {
  initialState: State;
  /** Frame interval in ms; default 125 (= 8 FPS). */
  intervalMs?: number;
}

export function WatchView({ initialState, intervalMs = 125 }: WatchViewProps): React.ReactElement {
  const [frame, setFrame] = useState(0);
  const { exit } = useApp();

  useEffect(() => {
    const id = setInterval(() => {
      setFrame((f) => f + 1);
    }, intervalMs);
    return (): void => {
      clearInterval(id);
    };
  }, [intervalMs]);

  useInput((input, key) => {
    if (key.escape || input === "q" || (key.ctrl && input === "c")) {
      exit();
    }
  });

  return <SnapshotView state={initialState} frameIndex={frame} />;
}
