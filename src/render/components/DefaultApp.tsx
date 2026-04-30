/**
 * DefaultApp — orchestrates the default `petforge` command's stages.
 *
 * Pipeline:
 *   pendingLevelUp?  → CinematicLevelUp
 *   pendingUnlocks?  → CinematicAchievement
 *   isTTY?           → IdleAnim (16 frames)
 *   final            → SnapshotView, then onDone
 *
 * Non-TTY runs skip cinematics and idle animation and render a single
 * snapshot frame, matching the spec's "non-TTY mode does not animate" rule.
 */

import { useApp } from "ink";
import type React from "react";
import { useEffect, useState } from "react";
import type { State } from "../../core/schema.js";
import { CinematicAchievement } from "./CinematicAchievement.js";
import { CinematicLevelUp } from "./CinematicLevelUp.js";
import { IdleAnim } from "./IdleAnim.js";
import { SnapshotView } from "./SnapshotView.js";

export type DefaultAppStage = "levelup" | "achievement" | "idle" | "snapshot";

export interface DefaultAppProps {
  state: State;
  isTTY: boolean;
  /** Optional callback fired when the snapshot stage is reached. Useful for tests. */
  onDone?: () => void;
  /** Override idle frame count (tests). Default 16 frames at 8 FPS = 2.0s. */
  idleFrames?: number;
  /**
   * If true, exit the Ink app (via `useApp().exit`) once the snapshot stage
   * mounts. The default `petforge` command sets this so the process closes
   * immediately after the final frame paints.
   */
  exitOnSnapshot?: boolean;
}

function pickInitialStage(state: State, isTTY: boolean): DefaultAppStage {
  // Non-TTY shortcut: skip everything animated, including cinematics.
  if (!isTTY) return "snapshot";
  if (state.progress.pendingLevelUp) return "levelup";
  if (state.achievements.pendingUnlocks.length > 0) return "achievement";
  return "idle";
}

function nextAfterLevelUp(state: State, isTTY: boolean): DefaultAppStage {
  if (state.achievements.pendingUnlocks.length > 0) return "achievement";
  return isTTY ? "idle" : "snapshot";
}

function nextAfterAchievement(isTTY: boolean): DefaultAppStage {
  return isTTY ? "idle" : "snapshot";
}

export function DefaultApp({
  state,
  isTTY,
  onDone,
  idleFrames = 16,
  exitOnSnapshot = false,
}: DefaultAppProps): React.ReactElement | null {
  const [stage, setStage] = useState<DefaultAppStage>(() => pickInitialStage(state, isTTY));
  const { exit } = useApp();

  // Snapshot stage is terminal — fire callback and optionally exit Ink.
  useEffect(() => {
    if (stage === "snapshot") {
      onDone?.();
      if (exitOnSnapshot) {
        // Defer one tick so the final frame paints before unmount.
        const id = setTimeout(() => exit(), 50);
        return (): void => clearTimeout(id);
      }
    }
    return undefined;
  }, [stage, onDone, exitOnSnapshot, exit]);

  if (stage === "levelup") {
    return (
      <CinematicLevelUp
        level={state.progress.level}
        onDone={() => setStage(nextAfterLevelUp(state, isTTY))}
      />
    );
  }
  if (stage === "achievement") {
    return (
      <CinematicAchievement
        ids={state.achievements.pendingUnlocks}
        onDone={() => setStage(nextAfterAchievement(isTTY))}
      />
    );
  }
  if (stage === "idle") {
    return <IdleAnim state={state} totalFrames={idleFrames} onDone={() => setStage("snapshot")} />;
  }
  // snapshot
  return <SnapshotView state={state} />;
}
