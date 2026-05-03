# Buddy Registry — Discovery (2026-05-02)

Research compiled to align PetForge's default schema with Claude Code Buddy. **Read-only research, no code changes implied.** Used to inform the V3 design decisions.

## What was found (public, verifiable)

### 1. Species roster — 18 buddies, all common nouns

| Species   | Rarity     | Default Hat |
|-----------|------------|-------------|
| Duck      | Common     | -           |
| Goose     | Common     | -           |
| Blob      | Common     | -           |
| Turtle    | Common     | -           |
| Snail     | Common     | -           |
| Mushroom  | Common     | -           |
| Chonk     | Common     | -           |
| Octopus   | Uncommon   | -           |
| Penguin   | Uncommon   | Beanie      |
| Cactus    | Uncommon   | -           |
| Rabbit    | Uncommon   | -           |
| Cat       | Rare       | Wizard Hat  |
| Owl       | Rare       | Top Hat     |
| Capybara  | Rare       | Tiny Duck   |
| Robot     | Rare       | -           |
| Ghost     | Epic       | Halo        |
| Axolotl   | Epic       | Propeller   |
| Dragon    | Legendary  | Crown       |

Total: 7 Common + 4 Uncommon + 4 Rare + 2 Epic + 1 Legendary = 18.

Source: [FiroYu/Claude-Code-Buddy-Collection](https://github.com/FiroYu/Claude-Code-Buddy-Collection), confirmed by [DEV Community guide](https://dev.to/damon_bb9e4bba1285afe2fcd/claude-buddy-the-complete-guide-to-your-ai-terminal-pet-all-18-species-rarities-hidden-22da).

### 2. Stats — 5 names, constant across all buddies

`DEBUGGING`, `PATIENCE`, `CHAOS`, `WISDOM`, `SNARK` (0-100 each).

### 3. Rarity distribution

| Rarity     | Probability |
|------------|-------------|
| Common     | 60%         |
| Uncommon   | 25%         |
| Rare       | 10%         |
| Epic       | 4%          |
| Legendary  | 1%          |

**Identical to PetForge's current `RARITY_TABLE`.** No change needed.

### 4. Generation algorithm

- Account UUID concatenated with salt `friend-2026-401`
- Hashed to 32-bit int (Bun's wyhash in prod, FNV-1a in Node fallback)
- Seeds Mulberry32 PRNG which drives species/rarity/stats/eyes/hat
- 1% independent shiny roll

PetForge currently uses `sha256(username + hostname)` -> bytes. Different mechanism, but same property: deterministic per machine. **Decision pending:** keep PetForge's seed (no breaking change for existing users) vs. adopt Anthropic's seed (continuity if user reinstalls Claude Code with same userId).

### 5. Stat rolling

- Each buddy gets 1 peak stat (rarity floor + 50 + random, capped at 100)
- 1 dump stat (near rarity floor)
- 3 scattered values between floor and peak
- Floor scales with rarity: Legendary ~50, Common ~5

Exact formula not in public sources. Acceptable to approximate.

### 6. Cosmetic extras

- 6 eye variants: `·` `✦` `×` `◉` `@` `°`
- 7 hats: Crown, Top Hat, Propeller, Halo, Wizard, Beanie, Tiny Duck

### 7. ASCII art for the 18 buddies

**Not in this doc.** Available as visual reference at:
- [FiroYu/Claude-Code-Buddy-Collection](https://github.com/FiroYu/Claude-Code-Buddy-Collection)
- [Claude Buddy Web Gallery](https://buddy.yadongxie.com/) (SPA, view in browser)
- Or run `claude /buddy` repeatedly with different test accounts to see them

PetForge **draws its own** 5-phase variants per species using these as visual reference only, never redistributes Anthropic's frames.

## What was NOT found

- Exact stat-rolling pseudocode (only narrative description)
- The full hex-decoded species table from `cli.js` (data is split across multiple minified locations and partially hex-encoded; not worth deeper extraction since public sources cover what we need)
- Per-species ASCII frames in machine-readable form (gallery is JS-rendered; would need browser scrape)

## Legal posture

| Element                                       | Status |
|------------------------------------------------|--------|
| 18 species names (common English nouns)        | OK to use |
| 5 stat names (descriptive English words)       | OK to use |
| Rarity tier names (industry-standard RPG)      | OK to use, already in PetForge |
| Rarity probabilities                           | OK, same as PetForge |
| Generation concept (deterministic per user)    | OK, same as PetForge |
| **Buddy ASCII art (per phase, per species)**   | **Do NOT redistribute.** Use as visual reference for our own drawings only. |
| Word "Buddy" in PetForge naming                | Avoid (already avoided per V1 spec) |
| Claim of Anthropic affiliation                 | Never |

The original V1 stance ("trademark-clean, Apache 2.0, zero Anthropic file copied") **stays valid** under this design as long as PetForge ships its own ASCII art. The 18 species names and 5 stat names are not trademarks, just shared vocabulary.

## Implications for PetForge V3 design

### Schema changes

```ts
// Before
species: "pixel" | "glitch" | "daemon" | "spark" | "blob"
stats: { focus, grit, flow, craft, spark }  // numeric values

// After
species: "duck" | "goose" | "blob" | ... // 18 values
stats: { debugging, patience, chaos, wisdom, snark }
```

`schemaVersion` bump from 1 to 2.

### Migration strategy options

- **A. Hard reset.** Re-seed every existing user's pet on first hook after upgrade. Simple, breaks continuity. Shipped users (incl. Dan) lose their current pet.
- **B. Soft map.** Keep current seed, map 5 old species -> 5 new species (e.g. blob -> blob, others -> a chosen mapping), regenerate stats with new names. Continuity preserved for early adopters.
- **C. Versioned coexistence.** Old `schemaVersion: 1` pets keep their old display; new users get V2. Visible inconsistency in the user base.

Recommended: **B**, with `blob` mapping trivially since it's the only name shared between old and new rosters.

### Asset production

- 18 species × 5 phases (egg, hatchling, adult, elder, mythic) = **90 frame sets** if drawn from scratch.
- Junior phase displays the user's imported Buddy card when present, otherwise a neutral PetForge "junior" frame for that species.
- Egg phase can be shared across all species (generic egg) -> drops to 18 × 4 + 1 generic = 73 frame sets.
- Optional: share visual silhouettes between similar species (Octopus / general aquatic, Cat / Capybara mammals) -> further reduction.

This is a multi-week ASCII art project regardless. Suggest doing it as a parallel track or community contribution.

### Buddy-import behaviour (already shipped in V2.1)

- User runs `petforge buddy import --from=card.txt`
- Card is parsed: name, rarity, stats, art -> stored in `buddy.cardCache`
- When `buddy.userToggle === "on"` and `cardCache` is set, the card replaces the rendered visual at junior phase + stats + rarity + name everywhere PetForge displays the pet.
- This logic already exists in [page.ts:294-323](src/render/web/page.ts#L294-L323) and the equivalent Ink renderer.

Under V3, this remains the same; it just becomes the canonical "true form" mechanism rather than a side feature.

## Open decisions for Dan

1. **Migration:** A / B / C above? (Default reco: B.)
2. **Seed:** keep `sha256(username+hostname)` or move to Mulberry32 with Anthropic-style salt? (Recommend keep current — no functional benefit to changing, breaks reproducibility for existing users.)
3. **Asset production:** parallel solo work, community PRs, or hire? (No code answer; project-management call.)
4. **Junior fallback art:** when no card is imported, what does junior phase show? Options: same as adult (skip junior visual), neutral "growing-up" silhouette, or an "import your buddy here" placeholder.

## Sources

- [Claude Buddy Complete Guide (DEV.to)](https://dev.to/damon_bb9e4bba1285afe2fcd/claude-buddy-the-complete-guide-to-your-ai-terminal-pet-all-18-species-rarities-hidden-22da)
- [FiroYu/Claude-Code-Buddy-Collection (GitHub)](https://github.com/FiroYu/Claude-Code-Buddy-Collection)
- [How I Reverse-Engineered Claude Code's Hidden Pet System](https://dev.to/picklepixel/how-i-reverse-engineered-claude-codes-hidden-pet-system-8l7)
- [Claude Buddy April Fools Tamagotchi (claudefa.st)](https://claudefa.st/blog/guide/mechanics/claude-buddy)
- [Claude Buddy Web Gallery](https://buddy.yadongxie.com/)
- [1270011/claude-buddy MCP server (GitHub)](https://github.com/1270011/claude-buddy)
