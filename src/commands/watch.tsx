/**
 * `petforge watch` — persistent 8 FPS animation until the user exits.
 *
 * Requires a TTY (stdin must be raw-mode capable for Ink's useInput hook).
 * Refuses with exit 1 if invoked in a piped/non-TTY context.
 */

import { render } from "ink";
import { WatchView } from "../render/components/WatchView.js";
import { loadStateForView } from "./render-state.js";

export async function watchCli(): Promise<number> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    process.stderr.write("petforge watch requires an interactive terminal.\n");
    return 1;
  }
  const state = await loadStateForView();
  const { waitUntilExit } = render(<WatchView initialState={state} />);
  await waitUntilExit();
  return 0;
}
