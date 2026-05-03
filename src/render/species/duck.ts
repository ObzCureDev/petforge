/**
 * Duck — common. Side-profile waterbird with a flat bill and webbed feet.
 *
 * All ASCII art is original to PetForge.
 */

import type { Phase } from "../../core/schema.js";

export const duckFrames: Record<Phase, string[]> = {
  egg: [` .--.\n( ░░ )\n \`--'`, ` .--.\n( ░·░ )\n \`--'`, ` .--.\n( ·░ )\n \`--'`],
  hatchling: [`<(° )_\n  \`--'`, `<(- )_\n  \`--'`, `<(° )_\n  \`v-'`],
  junior: [
    `   __\n <(° )_\n  (  )\n   \`--'`,
    `   __\n <(- )_\n  (  )\n   \`--'`,
    `   __\n <(° )_\n  ( o)\n   \`--'`,
  ],
  adult: [
    `    __\n  <(° )___\n   (  ._>\n    \`---'`,
    `    __\n  <(- )___\n   (  ._>\n    \`---'`,
    `    __\n  <(° )___\n   (  o >\n    \`---'`,
  ],
  elder: [
    `    __\n ░<(◈ )___\n  ▒(  ._>░\n    \`---'\n     · ·`,
    `    __\n ▒<(◈ )___\n  ░(  ._>▒\n    \`---'\n     · ·`,
    `    __\n ░<(◇ )___\n  ▒(  o >░\n    \`---'\n     · ·`,
  ],
  mythic: [
    `   ✧ ◆ ✧\n     __\n   <(◇ )___\n    (  ._◆>\n     \`---'\n      · ·`,
    `   ✦ ◆ ✦\n     __\n   <(◇ )___\n    (  o ◆>\n     \`---'\n      · ·`,
    `   ✧ ◆ ✦\n     __\n   <(◈ )___\n    (  ._◆>\n     \`---'\n      · ·`,
  ],
};
