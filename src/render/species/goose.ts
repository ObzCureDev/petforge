/**
 * Goose — common. Long-necked side profile, sharper bill than duck.
 *
 * All ASCII art is original to PetForge.
 */

import type { Phase } from "../../core/schema.js";

export const gooseFrames: Record<Phase, string[]> = {
  egg: [` .--.\n( ░░ )\n \`--'`, ` .--.\n( ·░░)\n \`--'`, ` .--.\n( ░·░)\n \`--'`],
  hatchling: [`(°>\n ||`, `(->\n ||`, `(°>\n /|`],
  junior: [`(°>\n ||\n_(_)_\n  ^^`, `(->\n ||\n_(_)_\n  ^^`, `(°>\n /|\n_(_)_\n  ^^`],
  adult: [
    `(° >\n  ||\n  ||\n_(__)_\n  ^^^^`,
    `(- >\n  ||\n  ||\n_(__)_\n  ^^^^`,
    `(° >\n  /|\n  ||\n_(__)_\n  ^^^^`,
  ],
  elder: [
    `(◈ >\n  ||\n ░||▒\n_(__)_\n  ^^^^\n   · ·`,
    `(◈ >\n  ||\n ▒||░\n_(__)_\n  ^^^^\n   · ·`,
    `(◇ >\n  /|\n ░||▒\n_(__)_\n  ^^^^\n   · ·`,
  ],
  mythic: [
    `  ✧ ◆\n(◇ >\n  ||\n  ||◆\n_(__)_\n  ^^^^\n   · ·`,
    `  ✦ ◆\n(◇ >\n  ||\n ◆||\n_(__)_\n  ^^^^\n   · ·`,
    `  ✧ ✦\n(◈ >\n  /|\n  ||◆\n_(__)_\n  ^^^^\n   · ·`,
  ],
};
