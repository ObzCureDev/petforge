/**
 * Tests for parseBuddyCard / extractBuddyStats in src/core/buddy.ts.
 *
 * The parser is render-time, side-effect-free, and must be tolerant of
 * varied formatting (boxed Anthropic /buddy card, stripped variants).
 */

import { describe, expect, it } from "vitest";
import { extractBuddyStats, parseBuddyCard } from "../src/core/buddy.js";

const FULL_BOXED_CARD = `╭──────────────────────────────────────╮
│                                      │
│  ★★★ RARE                   OCTOPUS  │
│                                      │
│     .----.                           │
│    ( °  ° )                          │
│    (______)                          │
│    /\\/\\/\\/\\                          │
│                                      │
│  Huddle                              │
│                                      │
│  "Silently wraps a tentacle around   │
│  your logic bugs and methodically    │
│  unwraps them, never explaining the  │
│   fix, just leaving you staring at   │
│  the corrected code with confused    │
│  gratitude."                         │
│                                      │
│  DEBUGGING  ████████░░  75           │
│  PATIENCE   ██████░░░░  61           │
│  CHAOS      ███░░░░░░░  25           │
│  WISDOM     ██████░░░░  63           │
│  SNARK      ███░░░░░░░  29           │
│                                      │
╰──────────────────────────────────────╯`;

const STRIPPED_NAME_ONLY = `   .----.
  ( °  ° )
  (______)
  /\\/\\/\\/\\
   Huddle`;

const STRIPPED_STATS_NO_BOX = `Huddle

DEBUGGING  ████████░░  75
PATIENCE   ██████░░░░  61
CHAOS      ███░░░░░░░  25`;

describe("extractBuddyStats", () => {
  it("parses 5 stats from the full Anthropic boxed card", () => {
    const stats = extractBuddyStats(FULL_BOXED_CARD);
    expect(stats).toEqual([
      { name: "DEBUGGING", value: 75 },
      { name: "PATIENCE", value: 61 },
      { name: "CHAOS", value: 25 },
      { name: "WISDOM", value: 63 },
      { name: "SNARK", value: 29 },
    ]);
  });

  it("parses stats without box borders", () => {
    const stats = extractBuddyStats(STRIPPED_STATS_NO_BOX);
    expect(stats).toHaveLength(3);
    expect(stats[0]).toEqual({ name: "DEBUGGING", value: 75 });
  });

  it("returns [] for non-stat content", () => {
    expect(extractBuddyStats("just a visual\n   .----.")).toEqual([]);
    expect(extractBuddyStats("")).toEqual([]);
  });

  it("rejects out-of-range values", () => {
    expect(extractBuddyStats("FOO ████ 150")).toEqual([]);
    expect(extractBuddyStats("FOO ████ -5")).toEqual([]);
  });

  it("does NOT match all-uppercase narrative text without bars", () => {
    expect(extractBuddyStats("HELLO WORLD 42")).toEqual([]);
  });
});

describe("parseBuddyCard", () => {
  it("parses name + species + rarity + 5 stars + 5 stats from the full card", () => {
    const r = parseBuddyCard(FULL_BOXED_CARD);
    expect(r.name).toBe("Huddle");
    expect(r.species).toBe("OCTOPUS");
    expect(r.rarity).toBe("rare");
    expect(r.rarityStars).toBe(3);
    expect(r.stats).toHaveLength(5);
  });

  it("parses just the name from a stripped visual + name", () => {
    const r = parseBuddyCard(STRIPPED_NAME_ONLY);
    expect(r.name).toBe("Huddle");
    expect(r.species).toBeUndefined();
    expect(r.rarity).toBeUndefined();
    expect(r.stats).toEqual([]);
  });

  it("returns all-undefined fields and empty stats for empty input", () => {
    const r = parseBuddyCard("");
    expect(r.name).toBeUndefined();
    expect(r.species).toBeUndefined();
    expect(r.rarity).toBeUndefined();
    expect(r.rarityStars).toBeUndefined();
    expect(r.stats).toEqual([]);
  });

  it("ignores ASCII art lines that aren't a single Title-Case word", () => {
    const r = parseBuddyCard("   .----.\n  ( °  ° )\n  /\\/\\/\\/\\");
    expect(r.name).toBeUndefined();
  });

  it("only captures the first matching name (no overwrite on multi-word lines)", () => {
    const r = parseBuddyCard("First\nSecond\n");
    expect(r.name).toBe("First");
  });

  it("handles a 4-star ✦ rarity variant (legendary-ish)", () => {
    const r = parseBuddyCard("✦✦✦✦ LEGENDARY              DRAGON");
    expect(r.rarity).toBe("legendary");
    expect(r.rarityStars).toBe(4);
    expect(r.species).toBe("DRAGON");
  });

  it("handles rarity-only line without species on the same line", () => {
    const r = parseBuddyCard("★★ UNCOMMON\n  Buddy\n");
    expect(r.rarity).toBe("uncommon");
    expect(r.species).toBeUndefined();
    expect(r.name).toBe("Buddy");
  });
});
