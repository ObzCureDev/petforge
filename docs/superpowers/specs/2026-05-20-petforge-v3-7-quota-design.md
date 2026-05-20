# PetForge V3.7 — Claude Code Quota Tracking

**Date:** 2026-05-20
**Status:** Spec validated, awaiting plan.
**Predecessors:**
- V3.6 ([service install, tri-OS](../../CHANGELOG.md)) — user-mode auto-start service for `petforge up`.
- V2.0 ([2026-04-30-petforge-v2.0-otel-design](2026-04-30-petforge-v2.0-otel-design.md)) — OTel collector pattern, blueprint for an opt-in side-channel that augments hook-driven counters.

V3.7 adds a **Claude Code rate-limit gauge** to PetForge: 5-hour session window + 7-day weekly window utilization, reset countdowns, derived burn rate, opt-in pet mood reactivity ("stressed" / "panic"), and 2 new medal-tiered achievements. Mirrors what third-party VSCode extensions (Claude Code Gauge, Claude Quota Tracker, ClaudeProUsage, vscode-claude-status) surface today, but inside PetForge — same web view, same CLI card, same state file.

## Goal

Let the user see Claude Code quota state at a glance from the same surface they already use for their pet — without running a second VSCode extension, without exposing their OAuth token to a third party, and without polling the API when they're not actively coding. Quota state also feeds back into the pet's mood and unlocks 2 new achievements, so the data is not just decorative — it shapes the RPG layer.

## Non-goals

- **No quota history persistence.** We track only the current 5h/7d utilization + a 3-sample moving burn rate. The "Utilization Trend" sparkline Gauge shows is deferred to V3.8.
- **No push notifications** when approaching the limit. Deferred to V3.8.
- **No overage tracking.** PetForge assumes `org_level_disabled` (the default for personal Pro/Max plans). If org-level overage is ever exposed by Anthropic in headers, add later.
- **No state schema bump.** Still `schemaVersion: 2`. `state.counters.quota` is an optional additive field, identical migration story to `state.counters.otel`.
- **No new achievement category UI.** The 2 new achievements slot into existing categories (a new "Quota" family in the V3.4 collapsible grid).
- **No Anthropic API mutation.** Probe is a single 1-token `claude-haiku-4-5` POST whose only purpose is to provoke the rate-limit headers. Response body is discarded.
- **No re-implementation of `petforge collect`.** Quota is a separate daemon — does not share state, sockets, or lifecycle with the OTel collector beyond co-orchestration under `petforge up --quota`.

## Architecture

V3.7 adds **5 new modules** (one core directory + one command + two render leaves) and touches **4 existing files** (`schema.ts`, `state.ts`, `up.ts`, `doctor.ts`).

```
~/.claude/.credentials.json    api.anthropic.com (headers only)
        │                              ▲
        ▼                              │
   credentials.ts ──────► quota/probe.ts  (5-min cadence, JSONL-mtime gated)
                                       │
                                       ▼
                       state.counters.quota (cached)
                                       │
                  ┌────────────────────┼────────────────────┐
                  ▼                    ▼                    ▼
        petforge card (CLI)    web view (SSE)      achievements/mood
          [QUOTAS section]    [QUOTAS card]    [stressed mood + 2 achs]
```

### New modules

| Path | Role |
|---|---|
| `src/core/quota/schema.ts` | `QuotaState` type + Zod validator + `createInitialQuota()`. |
| `src/core/quota/credentials.ts` | Resolve the OAuth token. File-first (`~/.claude/.credentials.json`), then macOS Keychain fallback (`security find-generic-password`). Linux/Windows: file only. |
| `src/core/quota/probe.ts` | Single HTTPS POST to `https://api.anthropic.com/v1/messages`, parse the 5 `anthropic-ratelimit-unified-*` response headers, return a typed `ProbeResult` (success or typed failure). Pure — no state writes. |
| `src/core/quota/mood.ts` | Derive mood (`"calm" | "stressed" | "panic"`) from `QuotaState`. Pure function, unit-testable. |
| `src/core/quota/jsonl-gate.ts` | Check if any file under `~/.claude/projects/**/conversation-*.jsonl` has mtime within the last `PROBE_GATE_MS` (default 10 min). Used by the daemon to skip API calls when the user is idle. |
| `src/commands/quota.ts` | CLI subcommand: `enable`, `disable`, `status` (default), and daemon mode (started by `up`). Owns the probe loop, locks state for writes, applies achievements and mood updates inside the lock. |
| `src/render/components/QuotaBlock.tsx` | Ink component rendering the CLI quota block (added to `CardView` under STATS). |
| `src/render/web/page.ts` (touched) | Adds `<section class="card quotas-card">` between `stats-card` and `goals-card` + CSS + client JS to render quota bars from `state.counters.quota`. |

### Touched files

| Path | Change |
|---|---|
| `src/core/schema.ts` | Add `QuotaStateSchema`, embed as optional `quota?: QuotaState` in `CountersSchema`. Add 2 new IDs to `ACHIEVEMENT_IDS`: `quota_efficient` (3 tiers) + `quota_marathon` (3 tiers). |
| `src/core/state.ts` | Add `ensureQuotaCounters(state)` helper (parallels `ensureOtelCounters`). Idempotent: synthesizes `createInitialQuota()` if `state.counters.quota` is missing. Called by `withStateLock` after schema parse. |
| `src/core/achievements.ts` | Register 6 new achievement entries (3 medal tiers × 2 families) — `quota_efficient_bronze/silver/gold` and `quota_marathon_bronze/silver/gold`. Add their evaluators (gated on `state.counters.quota?.optIn === true && lastProbeTs > 0`, exactly like the OTel gate). |
| `src/commands/up.ts` | New `--quota` flag. When set, fork the quota daemon alongside `collect` and `serve`. Same lifecycle (one Ctrl+C kills all). |
| `src/commands/doctor.ts` | New check: if `quota.optIn === true`, verify credentials resolvable, `lastProbeTs` within last 15 min, `lastProbeOk === true`. Warning (not error) if stale; error if `optIn` but credentials missing. |
| `src/index.ts` | Wire `petforge quota` subcommand. |
| `README.md` + `CHANGELOG.md` | Document opt-in flow, fragile-endpoint disclaimer, security model. |

### Data flow

1. User runs `petforge quota enable` once. Command:
   - resolves credentials (errors with a clear message + path if missing);
   - performs one synchronous probe to validate the token;
   - flips `state.counters.quota.optIn = true`, writes the first probe result, prints a confirmation.
2. User runs `petforge up --quota` (or `petforge quota` daemon directly).
3. Quota daemon loop every `PROBE_INTERVAL_MS` (default 5 min):
   - `jsonlGate.shouldProbe()` — if no JSONL touched in `PROBE_GATE_MS`, skip the API call entirely, sleep.
   - Else `probe()` → parse headers → compute new `burnRatePctPerMin` (rolling 3-sample) → `withStateLock` write quota block + re-evaluate quota achievements.
4. State write triggers the existing `fsWatch` in `serve.ts` → SSE broadcast → web view re-renders QUOTAS card.
5. `petforge card` and `petforge watch` render the same data via `QuotaBlock` (CLI Ink component).

## QuotaState schema

```ts
// src/core/quota/schema.ts

export interface QuotaWindow {
  /** Utilization percentage 0-100 from anthropic-ratelimit-unified-Nh-utilization */
  utilization: number;
  /** Unix seconds, from anthropic-ratelimit-unified-Nh-reset */
  resetTs: number;
}

export interface QuotaState {
  /** Hard opt-in gate. Probe disabled, web card hidden, achievements inert when false. */
  optIn: boolean;

  session5h: QuotaWindow | null;
  /** Only populated when the response includes the 7d header (Max plans). null otherwise. */
  weekly7d: QuotaWindow | null;

  /** "allowed" | "allowed_warning" | "denied" — verbatim from anthropic-ratelimit-unified-5h-status */
  status: string;

  /** Average %/min increase across the last 3 probes. 0 until enough samples. */
  burnRatePctPerMin: number;
  /** Ring of the last 3 (ts, utilization) samples used to derive burnRatePctPerMin. */
  recentSamples: Array<{ ts: number; utilization: number }>;

  /** epoch ms */
  lastProbeTs: number;
  lastProbeOk: boolean;
  /** Human-readable reason when lastProbeOk === false. Never includes the token. */
  lastError?: string;

  /** epoch ms — daemon process start, lets the UI display "uptime". */
  daemonStarted: number;

  /** Achievement counters — see "Achievements" section. */
  consecutiveEfficient: number;
  marathonCount: number;
  /**
   * Last observed `session5h.resetTs`. The daemon detects a "window closed"
   * event by spotting `resetTs` advancing between probes — used to decide
   * whether to increment `consecutiveEfficient` (utilization < 50% at close)
   * or reset it to 0.
   */
  lastObservedResetTs: number;
}
```

Validator mirrors `OtelCountersSchema` style (`z.number().nonnegative()` for percentages and timestamps, `z.string().optional()` for `lastError`).

## Probe contract

```ts
// src/core/quota/probe.ts

export type ProbeResult =
  | { kind: "ok"; session5h: QuotaWindow; weekly7d: QuotaWindow | null; status: string }
  | { kind: "auth-error"; httpStatus: number }      // 401, 403
  | { kind: "rate-limited"; httpStatus: 429; retryAfterSec?: number }
  | { kind: "server-error"; httpStatus: number }    // 5xx
  | { kind: "network-error"; cause: string };       // ECONNRESET, ENOTFOUND, timeout

export async function probe(token: string, opts?: {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;  // default 10s
}): Promise<ProbeResult>;
```

Request (verbatim, copied from validated source):

```
POST https://api.anthropic.com/v1/messages
Authorization: Bearer <token>
anthropic-version: 2023-06-01
anthropic-beta: oauth-2025-04-20
content-type: application/json

{"model":"claude-haiku-4-5-20251001","max_tokens":1,"messages":[{"role":"user","content":"."}]}
```

The probe **discards the response body** — we only care about response headers. Cost per probe: ~9 input tokens of haiku-4.5 → effectively free on any paid plan.

## Mood derivation

```ts
// src/core/quota/mood.ts

export type QuotaMood = "calm" | "stressed" | "panic";

export function deriveQuotaMood(q: QuotaState): QuotaMood {
  if (!q.optIn || !q.lastProbeOk || !q.session5h) return "calm";
  const u = q.session5h.utilization;
  if (u >= 95 || q.status === "denied") return "panic";
  if (u >= 80 || q.status === "allowed_warning") return "stressed";
  return "calm";
}
```

`CardView` and `page.ts` already render a `Mood` line in the PET card (V3.3). V3.7 modifies the mood resolution so that when `optIn === true` and `deriveQuotaMood()` returns `"stressed"` or `"panic"`, the quota-derived mood **overrides** the activity-derived mood. When `deriveQuotaMood()` returns `"calm"` (the default), the activity-derived mood renders unchanged. This means opt-in users see no behavior change in their pet's mood until quota pressure builds — at which point the pet visibly reacts. No new Mood line; same slot, additive precedence.

## Achievements

Two new families, both gated on `state.counters.quota?.optIn === true && lastProbeTs > 0` (parallel to the OTel gate).

| ID | Trigger | Notes |
|---|---|---|
| `quota_efficient_bronze` | 5 consecutive 5h windows closed (reset event) with `utilization < 50%` at reset | Tracks a separate `consecutiveEfficient` counter in `QuotaState`, incremented at probe time when we observe `resetTs` advancing. |
| `quota_efficient_silver` | 20 consecutive | |
| `quota_efficient_gold` | 100 consecutive | |
| `quota_marathon_bronze` | Observed `utilization >= 95%` once | Tracks a `marathonCount` counter. |
| `quota_marathon_silver` | 10 times | |
| `quota_marathon_gold` | 50 times | |

`QuotaState` gains 2 derived counters: `consecutiveEfficient: number` and `marathonCount: number`. Both initialized to 0; updated only inside the daemon's `withStateLock`. Both reset to 0 if `optIn` flips false (purge semantics).

The 6 achievement IDs append to `ACHIEVEMENT_IDS` after the existing list — no renumbering, no migration needed. Total achievements: 46 + 6 = **52**.

## Security model

| Concern | Mitigation |
|---|---|
| Undocumented endpoint changes shape | Hard opt-in. `petforge quota enable` is a deliberate user action. README states "fragile — Anthropic may change at any time." Fail-soft on parse: keep `optIn` true but flag `lastProbeOk = false` with `lastError`. |
| OAuth token exfiltration | Token is read into a local variable, passed only to `probe()`, never logged, never written to state, never serialized. Token lifetime = single probe call. |
| Token theft from disk | Out of scope — `~/.claude/.credentials.json` is already on disk; we just read it. macOS Keychain path uses `security find-generic-password` with the Claude Code service name + no `-w` echo to anything other than stdin of the probe. |
| Logging the token by accident | Probe wraps the `Authorization` header construction in a function that returns the headers object; errors `throw new Error(\`probe failed: ${httpStatus}\`)` — no header dump in catch. Unit test: capture all `console.*` and `logger.*` calls during a forced-error probe, assert none contain `"Bearer "`. |
| Replay if state.json is leaked | Quota block contains no token, only utilization numbers + reset timestamps. Same sensitivity as `state.counters.otel`. |
| Probing while no work is happening | JSONL mtime gate (`shouldProbe()`) — if no `~/.claude/projects/**/conversation-*.jsonl` was touched in the last `PROBE_GATE_MS`, skip. Idle PetForge → zero API calls. |
| Probe storms on retry | Single probe per cycle. On `rate-limited` or `server-error`, the daemon waits `PROBE_INTERVAL_MS` like normal — no exponential retry, no burst. |

## Surface — CLI

| Command | Effect |
|---|---|
| `petforge quota enable` | Resolve credentials, test-probe synchronously, on success: flip `optIn=true`, write first sample, print "Quota tracking enabled". On failure: print actionable error (path, status code, suggested fix), exit 1, do NOT flip `optIn`. |
| `petforge quota disable` | Flip `optIn=false`, zero out `consecutiveEfficient` + `marathonCount` + samples (purge), print "Quota tracking disabled". Existing achievements stay unlocked (not retroactively revoked). |
| `petforge quota` (no arg) | One-shot probe + formatted print. Equivalent to one daemon tick. Errors with hint if `optIn=false`. |
| `petforge quota --json` | Same as above, but prints `state.counters.quota` as JSON for scripting. |
| `petforge up --quota` | Adds the quota daemon to the up orchestration. Single Ctrl+C still kills all 3 processes (collect, serve, quota). |
| `petforge doctor` | Section "Quota tracking" — shows opt-in, credentials reachable, last probe age, last error. Warning if probe is stale > 15 min while optIn = true; error if optIn true but credentials missing. |

## Surface — Web view

New `<section class="card quotas-card">` inserted after `stats-card`, before `goals-card`. Hidden via `hidden` attribute when `state.counters.quota?.optIn !== true`.

Layout (matching V3.3 card aesthetic):

```
┌─ QUOTAS ──────────────────────────────────────┐
│ Session (5h)    [█████████░░░░░░░] 59%        │
│ Resets in 3h 3m · burn 0.51%/min              │
│                                               │
│ Weekly (7d)     [████░░░░░░░░░░░░] 20%        │
│ Resets in 4d 9h                               │
└───────────────────────────────────────────────┘
```

Bar colors: green < 60%, yellow 60-79%, orange 80-94%, red ≥ 95% or status `denied`. The pet's mood badge inherits the same color (existing PET card Mood field).

When `weekly7d === null` (non-Max plan), the second bar is hidden — only Session (5h) renders.

## Surface — CLI card

`CardView` (Ink) gains a new `<QuotaBlock state={state} />` rendered between `STATS` and `ACHIEVEMENTS` columns, but only when `state.counters.quota?.optIn === true`. Same color thresholds, ASCII bars via the existing `StatBar` primitive (or a sibling `QuotaBar` if `StatBar`'s API doesn't fit).

When opt-out, the block is omitted entirely — no "tracking disabled" placeholder. The card visual stays identical to V3.6 for users who don't enable quota.

## Testing

### Unit (Vitest)

- `credentials.ts`: file-present, file-absent, file-malformed, macOS Keychain success, macOS Keychain failure → falls back to file, Linux/Windows skip Keychain.
- `probe.ts`: mocked `fetch` returning canned response headers — happy path (5h + 7d), happy path (5h only, no 7d header → `weekly7d: null`), `401` → `auth-error`, `429` with `retry-after` → `rate-limited`, `500` → `server-error`, `fetch` throws `ECONNRESET` → `network-error`, timeout via `AbortController`. Assert `Authorization: Bearer <token>` header is set with the exact token passed in. **Assert no `console.*` call during error paths contains the substring `"Bearer "`.**
- `mood.ts`: every threshold boundary, opt-out short-circuit, stale `lastProbeOk=false` short-circuit, `status === "denied"` always panic.
- `jsonl-gate.ts`: directory missing → don't probe; all files older than gate → don't probe; one file fresh → probe; nested project dirs traversed.
- `schema.ts`: round-trip parse, optional field absence on V3.6-shaped state, `optIn === false` with non-zero counters is valid (we never throw on legacy data).
- Achievement evaluators: each of the 6 tier transitions fires exactly once, gated correctly when `optIn=false` or `lastProbeTs=0`.

### Integration

- Daemon loop with `PROBE_INTERVAL_MS=100ms`, `PROBE_GATE_MS=50ms`, mocked `fetch`. Assert N probes within M ms. Assert no probe when no JSONL touched. Assert state writes round-trip through `readState()`.
- `petforge quota enable` happy path on a fixture credentials file, then `disable`, then `enable` again — counters preserved? (Yes — only `optIn`/samples are reset on disable, not the achievement unlock list. Test asserts this.)
- SSE broadcast: `serve.ts` running, daemon writes a new probe → SSE client receives a `data:` frame whose JSON contains the new `counters.quota`.

### Live testing

**None.** Every test mocks `fetch`. We do not consume real haiku-4.5 tokens in CI.

### Manual smoke test (Dan only, pre-release)

1. `petforge quota enable` — see "Quota tracking enabled".
2. `petforge up --quota` — see all 3 daemons start in one process group.
3. Open web view — QUOTAS card appears with real numbers.
4. Trigger one Claude Code prompt — within 5 min, see utilization tick up, burn rate populate.
5. `Ctrl+C` once — all 3 daemons stop.
6. `petforge quota disable` — card disappears, daemon does nothing on next `up`.

## Migration

- State `schemaVersion` stays `2`. No bump.
- `ensureQuotaCounters()` synthesizes `createInitialQuota()` (opt-out, zero samples) on first read of a V3.6 state file. Idempotent.
- The 6 new achievement IDs are appended to `ACHIEVEMENT_IDS`; existing serialized state files (`state.achievements.unlocked: string[]`) parse unchanged. No `pendingUnlocks` are auto-injected.
- Hooks are untouched. `petforge init` is untouched. Users who do not enable quota see zero behavior change.

## Open questions (deferred, not blocking)

1. **macOS Keychain access** may prompt the user the first time `security find-generic-password` runs. Acceptable for V3.7 (we document it in the enable flow). If it becomes a UX papercut, switch to "file-only" + tell macOS users to copy the token out of Keychain once.
2. **Plan detection.** The presence/absence of `anthropic-ratelimit-unified-7d-reset` tells us if the user is on Max. We could surface a `plan: "pro" | "max" | "unknown"` field. Out of scope for V3.7 — re-evaluate after first user feedback.
3. **Endpoint drift mitigation.** If Anthropic ships a documented quota endpoint, swap `probe.ts` internals; `QuotaState` stays stable. The fact that `QuotaState` is fully decoupled from the probe means this is a localized change.
