/**
 * Blob — common. Amorphous round gel creature, all curves.
 *
 * All ASCII art is original to PetForge.
 */

import type { Phase } from "../../core/schema.js";

export const blobFrames: Record<Phase, string[]> = {
  egg: [` .--.\n( ░░ )\n \`--'`, ` .--.\n( ░·░ )\n \`--'`, ` .--.\n( ·░·)\n \`--'`],
  hatchling: [`.--.\n(° °)\n\`--'`, `.--.\n(- -)\n\`--'`, `.--.\n(° °)\n\`vv'`],
  junior: [
    `.----.\n(° °)\n( ‿ )\n\`----'`,
    `.----.\n(- -)\n( ‿ )\n\`----'`,
    `.----.\n(° °)\n( o )\n\`----'`,
  ],
  adult: [
    `.------.\n( °  ° )\n(  ‿‿  )\n(      )\n \`----'`,
    `.------.\n( -  - )\n(  ‿‿  )\n(      )\n \`----'`,
    `.------.\n( °  ° )\n(  oo  )\n(      )\n \`----'`,
  ],
  elder: [
    `.------.\n( ◈  ◈ )\n░(  ‿‿ )▒\n▒(     )░\n░\`----'▒\n  · ·`,
    `.------.\n( ◈  ◈ )\n▒(  ‿‿ )░\n░(     )▒\n▒\`----'░\n  · ·`,
    `.------.\n( ◇  ◇ )\n░(  oo )▒\n▒(     )░\n░\`----'▒\n  · ·`,
  ],
  mythic: [
    `  ✧ ◆ ✧\n.------.\n( ◇  ◇ )\n(  ◆◆  )\n( ◆░░◆ )\n \`----'\n  · · ·`,
    `  ✦ ◆ ✦\n.------.\n( ◇  ◇ )\n(  ◆◆  )\n( ░◆◆░ )\n \`----'\n  · · ·`,
    `  ✧ ◆ ✦\n.------.\n( ◈  ◈ )\n(  oo  )\n( ◆◆◆◆ )\n \`----'\n  · · ·`,
  ],
};
