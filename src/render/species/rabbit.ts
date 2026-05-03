/**
 * Rabbit — uncommon. Round body, long upright ears, whiskered face.
 *
 * All ASCII art is original to PetForge.
 */

import type { Phase } from "../../core/schema.js";

export const rabbitFrames: Record<Phase, string[]> = {
  egg: [` .--.\n( ░·░ )\n \`--'`, ` .--.\n( ·░·)\n \`--'`, ` .--.\n( ░░░ )\n \`--'`],
  hatchling: [`(\\_/)\n(° °)\n(")(")`, `(\\_/)\n(- -)\n(")(")`, `(\\_/)\n(° °)\n(")v(")`],
  junior: [
    ` (\\__/)\n ( ° ° )\n=( ‿‿  )=\n (")_(")`,
    ` (\\__/)\n ( - - )\n=( ‿‿  )=\n (")_(")`,
    ` (\\__/)\n ( ° ° )\n=( oo  )=\n (")_(")`,
  ],
  adult: [
    `  (\\__/)\n ( °  ° )\n=(  ..  )=\n (")__(")`,
    `  (\\__/)\n ( -  - )\n=(  ..  )=\n (")__(")`,
    `  (\\__/)\n ( °  ° )\n=(  vv  )=\n (")__(")`,
  ],
  elder: [
    `  (\\__/)\n ( ◈  ◈ )\n=(░ .. ▒)=\n (")__(")\n   · ·`,
    `  (\\__/)\n ( ◈  ◈ )\n=(▒ .. ░)=\n (")__(")\n   · ·`,
    `  (\\__/)\n ( ◇  ◇ )\n=(░ vv ▒)=\n (")__(")\n   · ·`,
  ],
  mythic: [
    `   ✧ ◆ ✧\n  (\\__/)\n ( ◇  ◇ )\n=(  ◆◆  )=\n (")_◆_(")\n    · ·`,
    `   ✦ ◆ ✦\n  (\\__/)\n ( ◇  ◇ )\n=( ◆..◆ )=\n (")_◆_(")\n    · ·`,
    `   ✧ ◆ ✦\n  (\\__/)\n ( ◈  ◈ )\n=(  ◆◆  )=\n (")◆◆(")\n    · ·`,
  ],
};
