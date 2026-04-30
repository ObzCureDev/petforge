/**
 * IdleAnim — bounded animation used by the default `petforge` command.
 *
 * Cycles SnapshotView for `totalFrames` ticks at 8 FPS, then resolves via
 * `onDone`. Self-contained: no leaks if unmounted early.
 */

import type React from "react";
import { useEffect, useState } from "react";
import type { State } from "../../core/schema.js";
import { SnapshotView } from "./SnapshotView.js";

export interface IdleAnimProps {
  state: State;
  totalFrames: number;
  onDone: () => void;
  /** Frame interval ms; default 125 (8 FPS). */
  intervalMs?: number;
}

export function IdleAnim({
  state,
  totalFrames,
  onDone,
  intervalMs = 125,
}: IdleAnimProps): React.ReactElement {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (frame >= totalFrames) {
      onDone();
      return;
    }
    const t = setTimeout(() => {
      setFrame((f) => f + 1);
    }, intervalMs);
    return (): void => {
      clearTimeout(t);
    };
  }, [frame, totalFrames, onDone, intervalMs]);

  return <SnapshotView state={state} frameIndex={frame} />;
}
