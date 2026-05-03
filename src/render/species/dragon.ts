/**
 * Dragon — legendary. Horned, scaled, winged, crowned. The apex roll.
 *
 * All ASCII art is original to PetForge.
 */

import type { Phase } from "../../core/schema.js";

export const dragonFrames: Record<Phase, string[]> = {
  egg: [` .--.\n( ▲░▲ )\n \`--'`, ` .--.\n( ░▲░ )\n \`--'`, ` .--.\n( ▲▒▲ )\n \`--'`],
  hatchling: [
    `/^\\ /^\\\n< ° ° >\n \`vv'`,
    `/^\\ /^\\\n< - - >\n \`vv'`,
    `/^\\ /^\\\n< ° ° >\n \`~~'`,
  ],
  junior: [
    `  ♛\n /^\\ /^\\\n<  ° °  >\n(  ~~   )\n \`-vvv-'`,
    `  ♛\n /^\\ /^\\\n<  - -  >\n(  ~~   )\n \`-vvv-'`,
    `  ♛\n /^\\ /^\\\n<  ° °  >\n(  ~~~~ )\n \`-vvv-'`,
  ],
  adult: [
    `    ♛\n /^\\   /^\\\n<   °   °   >\n (    ~~    )\n (   ▓▓▓▓   )\n  \`-vvvv-'`,
    `    ♛\n /^\\   /^\\\n<   -   -   >\n (    ~~    )\n (   ▓▓▓▓   )\n  \`-vvvv-'`,
    `    ♛\n /^\\   /^\\\n<   °   °   >\n (   ~~~~   )\n (   ▓▓▓▓   )\n  \`-vvvv-'`,
  ],
  elder: [
    `      ♛\n /^\\     /^\\\n<   ◈   ◈   >\n░(    ~~    )▒\n▒(   ▓▓▓▓   )░\n░\`-vvvv-'▒\n     · · ·`,
    `      ♛\n /^\\     /^\\\n<   ◈   ◈   >\n▒(    ~~    )░\n░(   ▓▓▓▓   )▒\n▒\`-vvvv-'░\n     · · ·`,
    `      ♛\n /^\\     /^\\\n<   ◇   ◇   >\n░(   ~~~~   )▒\n▒(   ▓▓▓▓   )░\n░\`-vvvv-'▒\n     · · ·`,
  ],
  mythic: [
    `    ✧ ♛ ✧\n   ✦ ◆ ✦\n /^\\ ◆ /^\\\n<   ◇   ◇   >\n (   ◆~◆    )\n (  ◆▓▓◆▓▓◆ )\n ◆\`-vvvv-'◆\n     · · · ·`,
    `    ✦ ♛ ✦\n   ✧ ◆ ✧\n /^\\ ◆ /^\\\n<   ◇   ◇   >\n (   ~◆~    )\n (  ▓◆▓▓◆▓▓ )\n ◆\`-vvvv-'◆\n     · · · ·`,
    `    ✧ ♛ ✦\n   ✦ ◆ ✧\n /^\\ ◆ /^\\\n<   ◈   ◈   >\n (  ◆~~~~◆  )\n (  ◆◆▓▓◆◆  )\n ◆\`-vvvv-'◆\n     · · · ·`,
  ],
};
