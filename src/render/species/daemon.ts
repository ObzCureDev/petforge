/**
 * Daemon — process pun creature.
 *
 * Visual cue: devil-like silhouette with code overlay (`{}`, `;`, `()`),
 * little horns. The "daemon" pun riffs on the unix background process.
 *
 * Frame design rules:
 *  - Each frame has a stable per-line indentation across all 3 frames of
 *    a phase (only character content changes for animation).
 *  - Pyramid silhouette top→body→feet, body widest, no abrupt narrowing
 *    (avoids the "crushed" look).
 *  - Plain ASCII + a few stable Unicode glyphs (`ʌ`, `·`, `⌃`, `⌄`, `▲`,
 *    `░`, `▒`, `♛`). No ambiguous-width emoji.
 *  - Frame count grows with phase to convey size.
 *
 * All ASCII art is original to PetForge.
 */

import type { Phase } from "../../core/schema.js";

export const daemonFrames: Record<Phase, string[]> = {
  egg: [
    `   ___\n  /; ;\\\n  | _ |\n  \\___/`,
    `   ___\n  /;/;\\\n  | _ |\n  \\___/`,
    `   _╱_\n  /;╲;\\\n  |╱_ |\n  \\___/`,
  ],
  hatchling: [
    `   ʌ   ʌ\n  /·\\ /·\\\n  | ; ; |\n  \\ {_} /\n   \`v v\`\n    ⌃`,
    `   ʌ   ʌ\n  /·\\ /·\\\n  | : ; |\n  \\ {_} /\n   \`v v\`\n    ⌄`,
    `   ʌ   ʌ\n  /·\\ /·\\\n  | ; : |\n  \\ (_) /\n   \`v v\`\n    ⌃`,
  ],
  junior: [
    `     ʌ_ʌ\n    /o o\\\n   /  ;  \\\n  | { _ } |\n  | (___) |\n   \\,___,/\n    \\v v/\n     ⌃ ⌃`,
    `     ʌ_ʌ\n    /- -\\\n   /  ;  \\\n  | { _ } |\n  | (___) |\n   \\,___,/\n    \\v v/\n     ⌃ ⌃`,
    `     ʌ_ʌ\n    /o o\\\n   /  :  \\\n  | { _ } |\n  | (^_^) |\n   \\,___,/\n    \\v v/\n     ⌄ ⌃`,
  ],
  adult: [
    `      ʌ_ʌ_ʌ\n     /o   o\\\n    /  \\;/  \\\n   /   ___   \\\n  | < { _ } > |\n  |  /\\___/\\  |\n   \\,_,___,_,/\n    \\\\v   v//\n     |     |\n     ⌃     ⌃`,
    `      ʌ_ʌ_ʌ\n     /-   -\\\n    /  \\;/  \\\n   /   ___   \\\n  | < ( _ ) > |\n  |  /\\___/\\  |\n   \\,_,___,_,/\n    \\\\v   v//\n     |     |\n     ⌃     ⌃`,
    `      ʌ_ʌ_ʌ\n     /o   o\\\n    /  \\:/  \\\n   /   ___   \\\n  | < { _ } > |\n  |  /\\^_^/\\  |\n   \\,_,___,_,/\n    \\\\v   v//\n     |     |\n     ⌄     ⌃`,
  ],
  elder: [
    `   ░    ▲    ░\n     ʌ_ʌ_ʌ_ʌ\n    /o     o\\\n   /   \\;/   \\\n  /    ___    \\\n |  < { _ } >  |\n |   /\\___/\\   |\n  \\,_,_,_,_,_,/\n   \\\\v     v//\n    ░|     |░\n     ⌃     ⌃`,
    `   ▒    ▲    ▒\n     ʌ_ʌ_ʌ_ʌ\n    /-     -\\\n   /   \\;/   \\\n  /    ___    \\\n |  < ( _ ) >  |\n |   /\\___/\\   |\n  \\,_,_,_,_,_,/\n   \\\\v     v//\n    ▒|     |▒\n     ⌃     ⌃`,
    `   ░    ▲    ░\n     ʌ_ʌ_ʌ_ʌ\n    /o     o\\\n   /   \\:/   \\\n  /    ___    \\\n |  < { _ } >  |\n |   /\\^_^/\\   |\n  \\,_,_,_,_,_,/\n   \\\\v     v//\n    ░|     |░\n     ⌄     ⌃`,
  ],
  mythic: [
    `      ✦  ♛  ✦\n   ░  ʌ_ʌ_ʌ_ʌ  ░\n     /o     o\\\n    /   \\▲/   \\\n   /    ___    \\\n  |  < { _ } >  |\n  |   /\\_◆_/\\   |\n   \\,_,_,_,_,_,/\n    \\\\v     v//\n     ░|     |░\n      ⌃     ⌃`,
    `      ✧  ♛  ✧\n   ▒  ʌ_ʌ_ʌ_ʌ  ▒\n     /-     -\\\n    /   \\▲/   \\\n   /    ___    \\\n  |  < ( _ ) >  |\n  |   /\\_◆_/\\   |\n   \\,_,_,_,_,_,/\n    \\\\v     v//\n     ▒|     |▒\n      ⌃     ⌃`,
    `      ✦  ♛  ✧\n   ░  ʌ_ʌ_ʌ_ʌ  ░\n     /o     o\\\n    /   \\▲/   \\\n   /    ___    \\\n  |  < { _ } >  |\n  |   /\\_◆_/\\   |\n   \\,_,_,_,_,_,/\n    \\\\v     v//\n     ░|     |░\n      ⌄     ⌃`,
  ],
};
