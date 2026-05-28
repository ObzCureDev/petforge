# Changelog

## 3.7.7 - 2026-05-29

### Features

- **Web view SPEND row** - the Current Run card gains a third line showing
  **corrected lifetime** spend (the true total from a full `~/.claude/projects`
  JSONL scan, matching `petforge history` - not the partial OTel-since-collector
  figure) and **real today** spend (cost of messages timestamped at/after local
  midnight). Format: `Today $X.XX · Lifetime $Y.YY (API $Z)`.
- **`GET /spend` endpoint** - JSON snapshot `{ lifetimeCents, lifetimeApiCents,
  todayCents, todayApiCents, todayKey, ... }` for Home Assistant / dashboards.
  503 until the first scan warms.

### Internal

- New `src/core/spend/` module (`schema.ts` + `compute.ts`). `computeSpend()`
  reuses the history scanner with a new `todayStartMs` bucket and the new
  `rollupCostByModel` helper. **Read-only**: the snapshot is computed in the
  `serve` process and injected into the streamed state - it is NEVER persisted
  to `state.json`, so the spend feature cannot touch the pet.
- `serve` runs the scan in the background on startup and every 10 min
  (`--spendRefreshMs`-tunable, 0 disables), caches the result, and injects it
  into `/`, `/stream`, and the new `/spend`.
- `SpendSnapshot` added to the state schema as an optional, render-only field.

### Fixes

- **Root cause of the recurring pet wipe, finally fixed.** `tests/core/quota/schema.test.ts`
  ("quota state round-trip") wrote a fresh level-1 state directly to `STATE_FILE`
  with **no `PETFORGE_HOME` isolation**. Under a normal `npm test` (and therefore
  `prepublishOnly`), `STATE_FILE` resolved to the user's real
  `~/.petforge/state.json` and the test overwrote the live pet with a freshly
  generated creature - the wipe observed on 2026-05-20, -21, and -25. The test
  now sets a temp `PETFORGE_HOME`, creates its `.petforge` dir, and re-imports
  paths/state via `vi.resetModules` like every other state-touching test.
  Verified: full suite (473 tests) runs without an isolation override and leaves
  the real pet untouched.



### Features

- **`petforge history --sync-otel`** - new flag overwrites `state.counters.otel` with the real lifetime totals derived from `~/.claude/projects/**/*.jsonl`. Use this once after upgrading to recover from any pre-V3.7.4 dedup drift between the OTel collector counters and the JSONL ground truth. Without the flag, `history` stays a read-only report.

### Internal

- Rolls up V3.7.1 through V3.7.5 into the first npm-published 3.7.x release after V3.7.0. See entries below for the full diff.

## 3.7.5 - 2026-05-24

### Fixes

- **Wipe killer at `writeStateAtomic` boundary.** State writes that would zero out `pet`, `level`, or `counters` without an explicit sentinel are now refused at the lowest write level. Defense-in-depth on top of the multi-sentinel wipe protection from V3.7.3 - any subagent / script / hook path that bypasses the higher-level guards still cannot corrupt the file.

## 3.7.4 - 2026-05-23

### Fixes

- **JSONL dedup by `message.id`** - `petforge history` and the OTel ingest path now dedup by `message.id` instead of file/offset, eliminating double-counting when Claude Code rewrites a JSONL line in place (which it does during retries).
- **Daily auto-backup of `state.json`** - on the first write of each calendar day, the previous file is copied to `state.json.bak-YYYY-MM-DD`. Old backups are kept in place for manual cleanup; nothing is auto-deleted.
- **Web view surfaces API-equivalent cost.** Already in V3.7.3, but the web HTML/SSE pipeline now reflects it on the CURRENT RUN / DEV line.

## 3.7.3 - 2026-05-22

### Features

- **API-equivalent cost (no-cache rate).** `state.counters.otel.cost` and the cost columns shown in `card` / `serve` / `history` now report what the same prompts would have cost at the published API rate, ignoring cache discounts. Matches what `petforge history` reports from JSONL.

### Fixes

- **Multi-sentinel wipe protection.** State writes that would zero out the pet, the level, or counters without one of three explicit sentinels (`PETFORGE_ALLOW_RESET`, `--force-reset`, or a same-process owner token) are refused. Caught a class of subagent-induced wipes that V3.7.1's `.initialized` marker alone didn't cover.

## 3.7.2 - 2026-05-21

### Features

- **`/claude-quota` HTTP endpoint** in `petforge serve` - JSON status of the 5h session + 7d weekly windows, designed to be polled by Home Assistant / Grafana / any local dashboard.
- **Opus weekly window** awareness - the quota tracker now distinguishes the standard 7d weekly limit from the Opus-specific weekly limit when both apply.

## 3.7.1 - 2026-05-21

### Fixes

Three back-to-back patches (V3.7.1, V3.7.1.1, V3.7.1.2 / V3.7.1.3) close every observed path that ended with a fresh-pet regeneration overwriting a real, leveled-up pet:

- **V3.7.1** - `loadState` refuses to silently regenerate the pet when `state.json` is present but parse-fails. Throws with a clear `~/.petforge/state.json.corrupt-<ts>` save-aside instead of starting over.
- **V3.7.1.1** - new `.initialized` marker file written alongside the first valid state. While the marker exists, the fresh-pet path is gated even if `state.json` is briefly absent (NTFS rename race seen on Windows during atomic writes).
- **V3.7.1.2 / V3.7.1.3** - the quota probe and state writer stop replacing the in-memory pet snapshot with a fresh-generated default on transient I/O errors. Errors are surfaced and skipped; the prior snapshot stands.

### Internal

- Quota utilization is now normalized to `0 - 100` consistently across the probe, the achievement evaluator, and the web view. The QUOTAS card has been moved above CURRENT RUN.

## 3.7.0 - 2026-05-20

### Features

- **`petforge quota enable | disable | --json`** - opt-in 5h/7d rate-limit gauge surfaced inside PetForge. One-shot CLI subcommand.
- **`petforge up --quota`** - co-orchestrates a probe daemon alongside collect + serve. Single Ctrl+C kills all three.
- **Web view QUOTAS card** - Session (5h), Weekly (7d) when on Max, burn rate, and reset countdown. Color-coded green/yellow/orange/red.
- **CLI card QuotaBlock** - `petforge card` gains a QUOTAS block when opt-in.
- **Pet mood reactivity** - when session utilization >= 80%, the pet's mood flips to "stressed"; >= 95% or status `denied` flips to "panic". Falls back to the existing activity-derived mood when calm.
- **2 new achievement families** (6 entries total): `quota_efficient_*` (close 5/20/100 consecutive 5h windows under 50% util) and `quota_marathon_*` (hit 95%+ session util 1/10/50 times). 46 -> 52 total achievements.
- **`petforge doctor`** now reports quota credentials + last-probe freshness.

### Internal

- New `src/core/quota/` module: schema, credentials resolver (file-first + macOS keychain), HTTP probe, JSONL mtime gate, mood derivation, apply-result reducer, achievement evaluators.
- New `src/commands/quota.ts` with both one-shot CLI handlers and the long-running `runQuotaDaemon` co-orchestrated by `petforge up --quota`.

### Compatibility

- **No state schema bump.** `state.counters.quota?` is additive; V3.6 state files migrate transparently via `ensureQuotaCounters`.

### Notes

- **JSONL-mtime gate** - when no `~/.claude/projects/**/*.jsonl` is touched for 10 min, the daemon skips its 5-min API call. Idle = zero cost.
- **Security:** opt-in only. OAuth token is read into a local variable, never logged, never persisted to state. The endpoint used (`POST /v1/messages` with `oauth-2025-04-20` beta header) is **undocumented** by Anthropic and may change without notice - opt-in is the contract.

## 3.6.0 - 2026-05-11

### Features

- **`petforge service install | uninstall | status`** — manage OS-native auto-start (user-mode) across Windows (Scheduled Task), macOS (LaunchAgent), and Linux (systemd `--user`). No admin or sudo required on any platform. Idempotent install (re-running updates the manifest). On Linux, a hint about `loginctl enable-linger` is printed for users who want the service to keep running while logged out.
- `petforge doctor` now reports auto-start service state as a warning-level check (optional, never critical).

### Internal

- New `src/core/service/` module exposing a per-platform `ServiceManager` interface and a `getServiceManager()` factory. All filesystem and process-spawn IO flows through a per-platform `exec` indirection object so the manager methods are unit-testable without invoking real `schtasks.exe` / `launchctl` / `systemctl`.

### Known limitations

- **Windows non-English locale**: `petforge service status` parses `schtasks` output and currently only recognizes English locale strings (`Status: Running`). On a non-English Windows host, a running task is reported as `installed-stopped`. `install` and `uninstall` are unaffected. Locale-independent detection (PowerShell `Get-ScheduledTask`) is planned for V3.6.1.

## 3.5.3 - 2026-05-03

**Two-tier prune + marathon medals saved before deletion + backfill
ordering fix.** V3.5's blanket 1h-inactivity prune was too aggressive
for users who legitimately leave Claude Code open across breaks
(lunch, sleep, returning the next day). It also silently dropped
sessions that had crossed marathon thresholds before being pruned.

### Two-tier prune (`pruneStaleSessions`)

| Session type | Prune after |
|---|---|
| `toolUseCount === 0` (likely batch noise) | **30 min** of inactivity |
| `toolUseCount > 0` (real interactive)     | **24 h** of inactivity |

Distinguishes ephemeral `claude -p` subprocesses (which never use a
tool) from real coding sessions. The latter survive lunch breaks,
overnight sleep, and "I'll come back to this tomorrow" patterns.

### Marathon medals saved at prune time

Before deletion, `pruneStaleSessions` checks if the session's lifetime
(`now - startTs`) crossed any marathon threshold (4h / 12h / 24h)
and unlocks the corresponding achievement(s) idempotently. Without
this, a 25h interactive session pruned at 24h+1min idle silently
lost its `marathon_24h` despite genuinely satisfying the requirement.

### Backfill runs BEFORE prune

`applyHookEvent` now calls `backfillEarnedAchievements` before
`pruneStaleSessions`. This gives the backfill a chance to inspect
every active session — including ones about to be pruned — for
polyglot / refactor / marathon thresholds. Defense-in-depth on top
of the in-prune marathon save.

The redundant second backfill call (post-`checkAchievementsForEvent`)
is removed; once at the top of the function is sufficient.

### Tests

- Two-tier prune: 4 cases (with-tools 23h survive / 25h prune,
  toolless 25 min survive / 35 min prune)
- Marathon-save: 25h tool-using session pruned → marathon_24h
  unlocked along with 12h/4h; short tool-less session pruned →
  no marathon
- Updated existing session_end / marathon test for the new
  XP order (backfill awards marathon BEFORE session_end → level
  cross unlocks hatch_hatchling earlier)
- Total: 336 (was 330)

No state schema bump, no migration. The `lastEventTs` field
introduced in V3.5 is unchanged.

## 3.5.2 - 2026-05-03

**Display correctness pass — hatch ladder + frugal calibration + persistent
accordions.**

Hatch ladder display
- `achievementProgress` (web view) now uses 12/30/60 for hatch_junior/
  hatch_adult/hatch_elder, matching `phaseForLevel` and the unlock
  thresholds. Pre-V3.5.2 the bars showed 48/80 for Hatch Elder while
  the description said "Reach level 60", and Hatch Adult showed 48/50
  with description "Reach level 30" — same target/text mismatch on
  three rows.
- Completed achievements no longer print a misleading "current /
  target" line ("48 / 5 unlocked" looked broken). Just "unlocked
  (+xp)" now.

Frugal calibration
- Cost ceilings 10x: 100p < $10 (was $1), 500p < $50 (was $5),
  2000p < $200 (was $20). Original $0.01/prompt threshold was
  unreachable — even cache-heavy mixed-model usage lands around
  $0.05-0.15/prompt. New $0.10/prompt target is achievable for
  the majority of users while still rewarding economy.
- New `failed` status for terminally-violated side conditions.
  Frugal achievements where cost exceeds the ceiling now render as
  ✗ "failed" with `text-decoration: line-through`, removed from
  Next Goals + Near completion (those filter to in-progress only).
  Prior behaviour: stayed at "99% in-progress" forever despite
  being mathematically dead.

Marathon
- `>` -> `>=` on the unlock check for display consistency. At
  exactly 4h the bar showed 100% but the unlock didn't fire (it
  needed strictly > 4h). Edge case but inconsistent.

Persistent accordions
- `<details>` open/closed state survives SSE-driven re-renders.
  Each category and each individual achievement gets a stable
  `data-cat` / `data-ach-id` attribute; the renderer captures
  open state into a transient JS object before innerHTML
  replacement and restores it after. No more "I clicked open
  but it snapped shut on next push".

Tests
- New: hatch boundary regression (12/30/60), marathon at exactly
  4h, frugal at $10/$50/$200 ceilings.
- Updated: legacy "marathon does NOT fire at 4h" was asserting
  the bug — replaced with "fires at exactly 4h" and a sub-4h
  negative case.
- Total: 330 (was 315).

No state schema bump, no migration. Pure UX correctness pass.

## 3.5.1 - 2026-05-03

**Cache token counters fixed.** The OTel collector was checking for
`type=cache_read` and `type=cache_creation` (snake_case) on the
`claude_code.token.usage` metric, but Claude Code 2.1+ emits these as
camelCase: `cacheRead` and `cacheCreation`. Result: `tokensCacheRead`
and `tokensCacheCreation` stayed at 0 for the entire history of the
project, so:

- Stats card "Cache: 0%" no matter how cache-friendly your usage was
- The CURRENT RUN dev line "Cache: 0%" same issue
- Three OTel-gated achievements unreachable: `cache_100k`, `cache_1m`,
  `cache_10m` (volume gate was visible because volume = tokensIn +
  tokensCacheRead, but the ratio gate >= 80% was impossible to clear
  with cacheRead == 0)

The fix accepts both formats — `cache_read` (legacy / docs) and
`cacheRead` (Claude Code 2.1+) — so existing setups and future
versions both work without further patches.

The collector takes effect on the next ingest tick (every 30 s by
default). After that, `tokensCacheRead` will start growing and the
stats card percentage becomes meaningful.

## 3.5.0 - 2026-05-03

**XP rebalance for batch usage + 1h-inactivity session prune.**
Real-usage data showed `session_end` events from short non-interactive
`claude -p` invocations (batch runners, eval harnesses) inflating XP
~3-4× faster than designed: a 5-second subprocess awarded the same
+50 XP as an 8-hour focused coding session.

### A — `session_end` XP tiered by duration

| Duration | XP |
|---|---:|
| < 1 min  | 0   |
| 1-5 min  | 5   |
| ≥ 5 min  | 50  |

Sub-minute sessions (the bulk of `claude -p` batch noise) award
nothing. Short legitimate sessions get a small reward. Real coding
sessions keep the original +50.

If `activeSessions[sessionId]` is missing at session_end (start was
pruned, or never fired), duration can't be computed → 0 XP. This
also prevents XP inflation from "phantom" SessionEnd events with no
matching start.

### C — Active sessions pruned after 1h of inactivity

- New optional `lastEventTs` field on `ActiveSession` (additive schema
  change, V3.4 states load fine without it).
- Updated on every per-session hook event (prompt, post_tool_use,
  stop, session_start).
- Prune now triggers when `now - lastEventTs > 1h` (was 24h based on
  `startTs` — too lax, batch sessions accumulated indefinitely).
- Falls back to `startTs` for pre-V3.5 sessions.
- Marathon achievements still work for actively-used long sessions
  (events keep `lastEventTs` fresh). A real "afk for hours" session
  with zero events between start and end gets pruned — that was
  always edge-case and `marathon_*` is meant to reward sustained
  activity, not just leaving Claude open.

### Migration

No state schema bump (still V2). XP already accumulated under V3.4.x
stays as-is — this is a calibration change, not a backfill. From
V3.5 onwards, batch-heavy users will see XP accrue at a much more
reasonable pace.



**Hatch ladder alignment + 100% display only when truly unlocked.**
Two display bugs that paint achievements as further along than they
really are.

- Hatch ladder thresholds 20/50/80 -> 12/30/60 to match
  `phaseForLevel`. The level header used to read "ADULT" at level 30
  while the matching `hatch_adult` achievement waited until level 50;
  same gap between Junior (display 12, ach 20) and Elder (display
  60, ach 80). Now `phaseForLevel` and the achievement registry agree.
  The V3.4 backfill catches existing pets whose phase boundary was
  already crossed but whose achievement was never unlocked under
  the old thresholds.
- Percentage cap: only an entry in `state.achievements.unlocked`
  renders as 100% / completed. Anything else is floored AND capped at
  99%. Previously `Math.round(0.99980 * 100)` rounded 999_803 /
  1_000_000 up to "100%" while the achievement was still ungated
  (and `getStatus` itself treated `current >= target` as completed,
  which gave false positives on compound achievements like
  `cache_*` (volume + ratio) and `frugal_*` (prompts + cost
  ceiling)).

No state schema bump, no migration. Pure UX correctness fix.

## 3.4.1 - 2026-05-03

**Hook timeout 1s -> 5s.** Concurrent Claude Code subprocesses (batch
runners, parallel `claude -p` invocations, eval harnesses) caused
`SessionEnd hook [petforge hook --event session_end] failed: Hook
cancelled` stderr noise on every call. Root cause: the lock retry
budget (~6 s under contention) overran Claude Code's 1 s hook timeout,
so Claude Code killed `petforge hook` mid-acquire. Bumping the
registered timeout to 5 s aligns with the lock retry envelope and
silences the noise without changing PetForge's exit-code contract
(still always 0).

- `petforge init` now writes `timeout: 5` for every hook entry.
- `petforge init` (or `petforge init --otel`) on a v3.4.0 install
  flags the existing `timeout: 1` entries as outdated and rewrites
  them in-place with the new value. No state migration, no schema
  bump, no behaviour change beyond the timeout.
- The hook itself was never the actual cause of batch failures (it
  always returned 0); the noise was purely cosmetic. Real `claude`
  exit-1 failures in batch runs come from API rate limits or
  network errors, not PetForge.

Run `petforge init` once after upgrading to pick up the new timeout.

## 3.4.0 - 2026-05-02

**Achievement organization** - the 46-entry list reorganized into 7 collapsible categories + a virtual "Near completion" group, plus a new top-of-list NEXT GOALS card.

- 7 categories (prefix-mapped): Evolution / Streak / Activity / Time /
  Coding / Economy / Collaboration. Each is a collapsible <details>
  showing a status symbol + unlocked/total counts in the summary row.
- "Near completion" virtual category appears at the top of the
  achievements card when any in-progress achievement has ratio >= 0.7.
  Top 5 sorted descending. Hidden entirely (DOM-absent) when empty.
- NEXT GOALS card sits between STATS and ACHIEVEMENTS: top 5 in-progress
  with preferred ratio >= 0.5, fallback to < 0.5 - merged so the slice
  always fills when any in-progress achievement exists. Card hidden via
  the standard hidden attribute (DOM-absent for layout) when empty.
- Status symbols replace V3.2 marks: completed checkmark, in-progress
  half-circle, locked empty circle. Pct hidden for completed (the
  status symbol carries the info). Locked items show pct without bar.
- Inline mini progress bars (0.25rem high) under each in-progress
  achievement summary, tinted by medal color (bronze/silver/gold/
  platinum). Hidden for completed and locked.
- No state schema bump, no migration, no Ink TUI changes, no filter
  tabs (deferred to V3.5+).

## 3.3.0 - 2026-05-02

**Visual restructure** - web view re-laid in 4 distinct cards.

- PET card: ASCII pet + display name + rarity/phase/level sub-line + XP bar +
  3 derived rows (Mood, Trait, Next evolution).
- CURRENT RUN card: split into RUN line (sessions / streak / prompts / tools)
  and DEV line (OTel-derived: lines / tokens / cost / cache hit %). DEV row
  hides cleanly when no OTel data is available.
- STATS card: 3-column grid (name | value | bar) instead of name | bar | value.
- ACHIEVEMENTS card: existing 46-entry list wrapped in the new card style;
  internal contents unchanged in V3.3.
- Mood derivation: Night Owl > Coding > Resting > Focused (priority order).
  Trait derivation: top stat + " Aura", canonical-order tie-break (NOT
  alphabetical). Next evolution: percent toward next phase boundary,
  clamped to [0, 100], "MAX - ascended" at level 100.
- No state schema bump, no migration. Pure UI overhaul on top of V3.2.

Deferred to V3.4: collapsible achievement categories, Next Goals filter,
status symbols (completed / in-progress / locked), per-achievement mini bars.

## 3.2.0 — 2026-05-02

**Achievement restructure** — 24 → 46 achievements with bronze/silver/gold medal tiers.

- Hatch becomes a 6-milestone phase ladder (egg / hatchling / junior / adult /
  elder / mythic), unlocked by the corresponding level boundary. Centurion is
  folded into hatch_mythic.
- 13 medal-tagged families (streak / tool / marathon / night / polyglot /
  refactor / code / token / cache / frugal / big_spender / pr / picky) each
  expose bronze/silver/gold tiers; streak adds a platinum tier at 100 days.
- New `medal` field on `AchievementDef`. UI renders 🥉🥈🥇💎 emoji prefix
  in both the web view and the Ink TUI; the web view tints the progress
  bar / mark by medal color.
- V3.1 -> V3.2 ID rename runs transparently in `readState`. `first_tool`
  is dropped (tool family covers it); existing XP is preserved verbatim.
- Bumps the previously-too-easy thresholds (tool 1K -> 5K, night 50 -> 200,
  marathon 1h -> 4h) and adds tiers above (tool 100K, night 5K, marathon 24h).
- Registry-hygiene tests assert the 46-entry total + per-medal XP scale.

## 2.1.0 — 2026-05-01

### Features

- **`petforge up [--lan] [--port=N] [--collect-port=N] [--token=XXX] [--forward=URL]`** — one-command launcher that starts the OTel collector AND the web view in the same process. Prefixed output (`[serve]` / `[collect]` / `[up]`), single Ctrl+C kills both, clean abort if either fails to bind. Solves the "I have to remember two terminals" friction and avoids the stale-collector strip bug below.
- **`petforge buddy import [--from=FILE] [--clear]`** — manually pin a Buddy ASCII as your pet's visual. Reads from stdin by default, `--from=FILE` for a file, or `--clear` to wipe. Auto-flips `userToggle` to `on` so the import appears immediately. Stored in `state.buddy.cardCache` (new optional schema field — V2.0 states without it parse fine).
- **Buddy card parser** — when the imported card matches Anthropic's `/buddy card` shape, PetForge auto-extracts:
  - **Name** (Title-Case word, e.g. `Huddle`) → replaces `DAEMON` in the card header
  - **Species** (UPPERCASE, e.g. `OCTOPUS`) → kept for future use
  - **Rarity** word + ★ count → replaces `common` and drives the rarity glow
  - **Stat lines** (`NAME ████ N`) → when ≥ 3 found, replaces FOCUS/GRIT/FLOW/CRAFT/SPARK on the right with the Buddy's own stats (DEBUGGING, PATIENCE, etc.). Auto-strips those same lines from the rendered visual so they don't appear twice.
- **Daemon visual rework** — Junior, Adult, Elder, Mythic phases redrawn with a pyramid silhouette (no more "crushed-feet" look) and stable per-line indentation across animation frames.

### Fixes

- **Web pet centering** — the `<pre>` no longer uses `text-align: center`, which was re-centering each line individually and pushing the head/feet right of the body. `width: fit-content` + `margin: auto` keeps the ASCII art's leading spaces working as intended (head stays above the body's middle).

### Compatibility

No schema-breaking changes. `state.buddy.cardCache` is optional, V2.0.x states load and write back without it. The OTel block, hooks, achievements, and pet identity are all preserved across upgrade.

### Known operational issue (documented)

Long-running `petforge collect` processes started **before** an upgrade hold the old schema in memory and silently strip unknown fields (like `cardCache`) from `state.json` on every metrics push. Symptom: `petforge buddy import` prints success but the visual never appears. Fix: kill stale collectors before retesting (`petforge up` avoids this entirely — single process, clean shutdown). Documented in the README troubleshooting section.

## 2.0.2 — 2026-04-30

### Balance
- **Junior phase doubled**: `xpForLevel(30)` is now `30_000` (was `15_000`). The Junior phase (levels 12–29) is twice as long to better match the spec promise of "Junior in a couple of weeks of regular use" — early-game progression was running ~2× too fast in real-world tests. Adult / Elder / Mythic boundaries unchanged.

### Migration
Existing states are unaffected at rest. Users currently in the Junior range will recompute to a slightly lower level on the next hook event (e.g. someone at xp=8000 was level 22 under the old curve, will be level 20 under the new one). XP cumulative, achievements, and pet identity are preserved.

## 2.0.1 — 2026-04-30

### Fixes
- **Windows EPERM rename retry**: hooks no longer lose XP when Windows Defender / OneDrive / antivirus briefly holds a handle on `state.json` post-write. `fs.rename` now retries on `EPERM` / `EBUSY` / `ENOENT` / `EACCES` with exponential backoff (50ms / 150ms / 400ms, max 4 attempts in ~600ms — within the hook 1s timeout).
- **Lazy `activeSessions` init**: per-session achievements (Polyglot, Refactor Master, Marathon) now reachable on Claude Code versions where `SessionStart` / `SessionEnd` hooks don't fire. The `prompt` and `post_tool_use` handlers now create an `activeSessions[sessionId]` entry on demand if absent.
- **Auto-prune stale activeSessions**: entries with `startTs` older than 24h are removed on every hook event, preventing unbounded growth when `SessionEnd` never fires.
- **Doctor warning**: detects the "many prompts but 0 sessions" pattern and surfaces it as a warning so the user understands what's happening.

### No breaking changes
State schema, achievement IDs, hook payloads — all unchanged.

## 2.0.0 — 2026-04-30

### Features
- New `petforge collect` command: long-running OTLP/HTTP/JSON collector that ingests Claude Code metrics into PetForge state.
- 8 new OTel-gated achievements: Code Architect (10K lines), Code Titan (100K lines), Token Whisperer ⚡ (1M tokens), Cache Lord (≥80% cache hit ratio), Frugal Coder (100 prompts ≤ $1), Big Spender ($100 cumulative), PR Machine (50 PRs), Picky Reviewer (50 edits rejected).
- New `petforge init --otel` / `--no-otel` flags: one-command setup of Claude Code OTel env vars in `~/.claude/settings.json`.
- New OTel activity line in `petforge card` / `serve` / `watch`: lines added/removed, total tokens, cost, cache hit ratio. Shown only when OTel data has been ingested.
- New `petforge doctor` checks: OTel env presence, collector reachable, recent ingest.
- Optional fan-out via `PETFORGE_OTEL_FORWARD=URL` (or `--forward=URL`): chain to existing OTel collectors (Datadog, Honeycomb, Grafana).

### Architecture
- New `state.counters.otel` block (cumulative counters). Optional in schema — V1.x states migrate transparently.
- Collector binds **strictly to 127.0.0.1**. No `--lan` flag (payload contains user prompts and file paths).
- OTLP/HTTP JSON only — no protobuf dependency.
- Cumulative-delta aggregator with in-memory memo per (metric, attrs) tuple.

### Migration
V1.x → V2.0: state.json gains `counters.otel` automatically on first read. `schemaVersion` unchanged at 1. Existing achievements / hooks behaviour unchanged.

### Out of scope (future)
- V2.1: append-only event store (`events.ndjson`), heatmap in `serve`, insights generation
- V2.2: cinematic milestones, WISDOM cosmetic stat

## 1.2.0 — 2026-04-30

### Features
- New `petforge serve [--port=7878] [--lan] [--token=XXX]` command:
  starts a local HTTP server with a mobile-friendly web view of your pet.
  Live updates via Server-Sent Events; reconnects automatically on disconnect.
  Default binds to `127.0.0.1` (local-only). `--lan` exposes on `0.0.0.0`
  for phone access on the same Wi-Fi. Optional `--token` for shared networks.

### Why
Some users want to glance at their pet from a phone or second screen
without keeping a terminal open. The web view is read-only — it streams
state, never mutates.

## 1.1.0 — 2026-04-30

### Changes
- New "Egg" phase: pet starts as an egg (level 1-4, 0-500 XP) with progressive cracks. Hatchling phase moved to level 5-11.
- Recurved level boundaries for slower early-game evolution: Junior at 12, Adult at 30, Elder at 60, Mythic at 100.
- `Hatch` achievement now triggers when the egg hatches (level ≥ 5) instead of the first prompt — narrative moment with cinematic.
- `petforge watch` now live-reloads state.json every 500ms — XP/level/achievements update while you code.
- `petforge watch` now displays the Activity line (Sessions / Streak / Prompts / Tools) — same as `petforge card`.
- New `ActivityBlock` component shared between `card` and `watch` views.

### Migration
Existing V1.0 states (state.json) remain valid — phase recomputes from level on next hook event. Users still on level < 5 will revert to the new "egg" phase visually but keep all progress.

## 1.0.0 — 2026-04-30

Initial release.

### Features
- 5 deterministic species (Pixel, Glitch, Daemon, Spark, Blob)
- 5 rarities (Common 60% / Uncommon 25% / Rare 10% / Epic 4% / Legendary 1%)
- 5 evolution phases (Hatchling / Junior / Adult / Elder / Mythic)
- 1% shiny rainbow overlay
- 5 stats (FOCUS, GRIT, FLOW, CRAFT, SPARK)
- 10 achievements: Hatch, First Tool, Marathon, Night Owl, Streak 3d, Streak 7d, Polyglot, Refactor Master, Tool Whisperer, Centurion
- 7 CLI commands: `petforge`, `petforge init`, `petforge card`, `petforge watch`, `petforge buddy`, `petforge doctor`, `petforge hook`
- 5 Claude Code hook integrations (UserPromptSubmit, PostToolUse, Stop, SessionStart, SessionEnd)
- Optional runtime Buddy detection (zero persistence of Buddy ASCII)
- Local-first, zero telemetry, cross-platform (Node ≥ 20)
- Atomic state writes with `proper-lockfile`
- 189 tests covering core engines, hooks, settings integration, rendering

### Tech stack
- TypeScript 5.9 strict, ESM, Node 20+
- Ink + React 19 for terminal UI
- chalk + figlet for effects
- Vitest + Biome for QA
