/**
 * `petforge card` — full status view (pet, XP bar, stats, achievements).
 *
 * Static, non-mutating. Works in both TTY and non-TTY mode (Ink renders
 * the final frame either way; we just don't animate).
 */

import { render } from "ink";
import { CardView } from "../render/components/CardView.js";
import { loadStateForView } from "./render-state.js";

export async function cardCli(): Promise<number> {
  const state = await loadStateForView();
  const { waitUntilExit } = render(<CardView state={state} />);
  await waitUntilExit();
  return 0;
}
