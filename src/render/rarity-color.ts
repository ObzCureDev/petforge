/**
 * Map a rarity tier to its Ink-renderer color name.
 *
 * Mirrors the web view's `.rarity-tag-*` palette so the colored rarity word
 * looks consistent across `petforge card`, `petforge watch`, and the served
 * web page. Common is gray (low-key), legendary is yellow/gold (highest tier).
 */

export type RarityColor = "gray" | "green" | "blue" | "magenta" | "yellow";

export function rarityColor(rarity: string): RarityColor {
  switch (rarity) {
    case "uncommon":
      return "green";
    case "rare":
      return "blue";
    case "epic":
      return "magenta";
    case "legendary":
      return "yellow";
    default:
      return "gray";
  }
}
