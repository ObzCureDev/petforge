/**
 * `petforge` (default command) — show the pet.
 *
 * TTY: play any pending level-up / achievement cinematics, then run a
 * 16-frame idle animation, then render a final static snapshot.
 *
 * Non-TTY: render a single SnapshotView frame and exit. No animations,
 * no cinematics. Pending flags remain on disk so they will play next
 * time the user opens an interactive terminal.
 *
 * State consumption: pending flags are cleared on disk only when the
 * cinematics are actually played (TTY path). The non-TTY path uses the
 * read-only loader to avoid silently swallowing a level-up the user
 * never saw.
 */

import { render } from "ink";
import { DefaultApp } from "../render/components/DefaultApp.js";
import { loadAndConsumeState, loadStateForView } from "./render-state.js";

export interface DefaultCliOptions {
  /** Override TTY detection (tests). Defaults to `process.stdout.isTTY`. */
  isTTY?: boolean;
  /** Override idle animation length in frames (tests). */
  idleFrames?: number;
}

export async function defaultCli(opts: DefaultCliOptions = {}): Promise<number> {
  const isTTY = opts.isTTY ?? Boolean(process.stdout.isTTY);

  // Non-TTY: don't consume pending flags — keep them for the next interactive run.
  if (!isTTY) {
    const state = await loadStateForView();
    const { waitUntilExit } = render(
      <DefaultApp state={state} isTTY={false} exitOnSnapshot={true} />,
    );
    await waitUntilExit();
    return 0;
  }

  // TTY: consume pending flags so cinematics fire exactly once.
  const state = await loadAndConsumeState();
  const { waitUntilExit } = render(
    <DefaultApp
      state={state}
      isTTY={true}
      idleFrames={opts.idleFrames ?? 16}
      exitOnSnapshot={true}
    />,
  );
  await waitUntilExit();
  return 0;
}
