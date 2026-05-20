# PetForge V3.7 — Claude Code Quota Tracking · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

| | |
|---|---|
| **Date** | 2026-05-20 |
| **Project** | PetForge V3.7 |
| **Spec** | [`docs/superpowers/specs/2026-05-20-petforge-v3-7-quota-design.md`](../specs/2026-05-20-petforge-v3-7-quota-design.md) |
| **Status** | Approved — ready for execution |

**Goal:** Ship an opt-in Claude Code rate-limit gauge inside PetForge (web QUOTAS card + CLI block + pet mood reactivity + 2 medal achievement families), polling `anthropic-ratelimit-unified-*` response headers via a 1-token haiku probe gated on JSONL activity.

**Architecture:** New `src/core/quota/` directory (schema, credentials, probe, mood, jsonl-gate) + new `src/commands/quota.ts` (enable/disable/status/daemon) + new web `quotas-card` section + new Ink `QuotaBlock`. Additive to `state.counters.quota?` (no schemaVersion bump). Quota daemon co-orchestrated under `petforge up --quota`, parallel pattern to existing `collect`.

**Tech Stack:** TypeScript strict · Node 20+ built-in `fetch` · Zod · Ink/React · Vitest · existing `withStateLock`/`proper-lockfile` infrastructure.

---

# Task 1 — Quota schema

**Files:**
- Create: `src/core/quota/schema.ts`
- Test: `tests/core/quota/schema.test.ts`

- [ ] **Step 1.1: Create the failing schema test**

Write `tests/core/quota/schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createInitialQuota,
  QuotaStateSchema,
  type QuotaState,
} from "../../../src/core/quota/schema.js";

describe("quota/schema", () => {
  it("creates a valid initial quota state", () => {
    const q = createInitialQuota(1_700_000_000_000);
    expect(QuotaStateSchema.safeParse(q).success).toBe(true);
    expect(q.optIn).toBe(false);
    expect(q.session5h).toBeNull();
    expect(q.weekly7d).toBeNull();
    expect(q.consecutiveEfficient).toBe(0);
    expect(q.marathonCount).toBe(0);
    expect(q.lastObservedResetTs).toBe(0);
    expect(q.lastProbeTs).toBe(0);
    expect(q.lastProbeOk).toBe(false);
    expect(q.daemonStarted).toBe(1_700_000_000_000);
    expect(q.recentSamples).toEqual([]);
    expect(q.burnRatePctPerMin).toBe(0);
    expect(q.status).toBe("");
  });

  it("validates a populated quota state", () => {
    const q: QuotaState = {
      optIn: true,
      session5h: { utilization: 42, resetTs: 1_700_000_500 },
      weekly7d: { utilization: 20, resetTs: 1_700_600_000 },
      status: "allowed",
      burnRatePctPerMin: 0.3,
      recentSamples: [{ ts: 1, utilization: 40 }],
      lastProbeTs: 100,
      lastProbeOk: true,
      daemonStarted: 50,
      consecutiveEfficient: 3,
      marathonCount: 0,
      lastObservedResetTs: 1_700_000_500,
    };
    expect(QuotaStateSchema.safeParse(q).success).toBe(true);
  });

  it("rejects negative utilization", () => {
    const q = createInitialQuota(0);
    (q as unknown as { session5h: { utilization: number; resetTs: number } }).session5h = {
      utilization: -1,
      resetTs: 0,
    };
    expect(QuotaStateSchema.safeParse(q).success).toBe(false);
  });
});
```

- [ ] **Step 1.2: Run the test — expect FAIL**

```
npx vitest run tests/core/quota/schema.test.ts
```

Expected: file-not-found error on the import (module does not exist yet).

- [ ] **Step 1.3: Implement the schema module**

Create `src/core/quota/schema.ts`:

```ts
/**
 * Quota tracking schema — V3.7.
 *
 * Mirrors spec §"QuotaState schema". Additive to state.counters.quota.
 * V3.6 state files parse unchanged (the parent schema marks `quota` optional);
 * `ensureQuotaCounters()` in state.ts synthesizes a fresh block when absent.
 */

import { z } from "zod";

export interface QuotaWindow {
  /** 0-100, from anthropic-ratelimit-unified-{5h|7d}-utilization. */
  utilization: number;
  /** Unix seconds, from anthropic-ratelimit-unified-{5h|7d}-reset. */
  resetTs: number;
}

export interface QuotaSample {
  /** epoch ms */
  ts: number;
  utilization: number;
}

export interface QuotaState {
  optIn: boolean;
  session5h: QuotaWindow | null;
  weekly7d: QuotaWindow | null;
  status: string;
  burnRatePctPerMin: number;
  recentSamples: QuotaSample[];
  lastProbeTs: number;
  lastProbeOk: boolean;
  lastError?: string;
  daemonStarted: number;
  consecutiveEfficient: number;
  marathonCount: number;
  lastObservedResetTs: number;
}

const nn = z.number().nonnegative();

export const QuotaWindowSchema = z.object({
  utilization: nn,
  resetTs: nn,
});

export const QuotaSampleSchema = z.object({
  ts: nn,
  utilization: nn,
});

export const QuotaStateSchema = z.object({
  optIn: z.boolean(),
  session5h: QuotaWindowSchema.nullable(),
  weekly7d: QuotaWindowSchema.nullable(),
  status: z.string(),
  burnRatePctPerMin: nn,
  recentSamples: z.array(QuotaSampleSchema),
  lastProbeTs: nn,
  lastProbeOk: z.boolean(),
  lastError: z.string().optional(),
  daemonStarted: nn,
  consecutiveEfficient: nn,
  marathonCount: nn,
  lastObservedResetTs: nn,
});

export function createInitialQuota(now: number = Date.now()): QuotaState {
  return {
    optIn: false,
    session5h: null,
    weekly7d: null,
    status: "",
    burnRatePctPerMin: 0,
    recentSamples: [],
    lastProbeTs: 0,
    lastProbeOk: false,
    daemonStarted: now,
    consecutiveEfficient: 0,
    marathonCount: 0,
    lastObservedResetTs: 0,
  };
}
```

- [ ] **Step 1.4: Run the test — expect PASS**

```
npx vitest run tests/core/quota/schema.test.ts
```

Expected: 3 passing.

- [ ] **Step 1.5: Wire `quota?` into `CountersSchema`**

Edit `src/core/schema.ts`. At the top, add to the imports near the existing OTel import:

```ts
import {
  createInitialQuota,
  type QuotaState,
  QuotaStateSchema,
} from "./quota/schema.js";
```

In the `Counters` interface, append after `otel?: OtelCounters;`:

```ts
  /** V3.7 quota tracking (opt-in, additive). */
  quota?: QuotaState;
```

In `CountersSchema`, append after `otel: OtelCountersSchema.optional(),`:

```ts
  quota: QuotaStateSchema.optional(),
```

Leave `createInitialState` alone — fresh installs default to `quota` absent (synthesized lazily by `ensureQuotaCounters`).

- [ ] **Step 1.6: Add `ensureQuotaCounters` to state.ts**

Edit `src/core/state.ts`. Add to the import block:

```ts
import { createInitialQuota } from "./quota/schema.js";
```

After the existing `ensureOtelCounters` export (search for `export function ensureOtelCounters`), append:

```ts
/**
 * Ensure `state.counters.quota` is populated.
 *
 * V3.6 state files do not contain the `quota` block. After loading + validating
 * a state via `StateSchema` (which keeps `quota` optional), call this to
 * synthesize a fresh opt-out QuotaState if absent. Achievement evaluation
 * gates on `quota.optIn === true && quota.lastProbeTs > 0`, so a synthesized
 * block is inert until the user runs `petforge quota enable`.
 */
export function ensureQuotaCounters(state: State): void {
  if (!state.counters.quota) {
    state.counters.quota = createInitialQuota();
  }
}
```

Find the place `ensureOtelCounters(state)` is called inside `readState` / `withStateLock` and add a sibling call to `ensureQuotaCounters(state)` on the next line. Grep first:

```
git grep -n "ensureOtelCounters" src/core/state.ts
```

For each call site, append `ensureQuotaCounters(state);` immediately after.

- [ ] **Step 1.7: Verify state-load round-trip**

Add to `tests/core/quota/schema.test.ts`:

```ts
import { readState, withStateLock } from "../../../src/core/state.js";
import { generatePet } from "../../../src/core/pet-engine.js";
import { createInitialState } from "../../../src/core/schema.js";
import { promises as fs } from "node:fs";
import { STATE_FILE } from "../../../src/core/paths.js";

describe("quota state round-trip", () => {
  it("legacy state without quota block parses and synthesizes one", async () => {
    const pet = generatePet({ username: "test", hostname: "ci" });
    const legacy = createInitialState(pet, 0);
    delete (legacy.counters as { quota?: unknown }).quota;
    await fs.writeFile(STATE_FILE, JSON.stringify(legacy), "utf8");
    const loaded = await readState();
    expect(loaded.counters.quota).toBeUndefined();
    await withStateLock(async (s) => {
      expect(s.counters.quota).toBeDefined();
      expect(s.counters.quota?.optIn).toBe(false);
    });
  });
});
```

Run: `npx vitest run tests/core/quota/schema.test.ts`. Expected: 4 passing.

- [ ] **Step 1.8: Commit**

```
git add src/core/quota/schema.ts src/core/schema.ts src/core/state.ts tests/core/quota/schema.test.ts
git commit -m "feat(quota): V3.7 schema + ensureQuotaCounters migration helper"
```

---

# Task 2 — Credentials resolver

**Files:**
- Create: `src/core/quota/credentials.ts`
- Test: `tests/core/quota/credentials.test.ts`

- [ ] **Step 2.1: Write failing test**

Create `tests/core/quota/credentials.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveOAuthToken } from "../../../src/core/quota/credentials.js";

describe("quota/credentials", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pf-creds-"));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("reads token from ~/.claude/.credentials.json (file-first)", async () => {
    const credPath = path.join(tmp, ".credentials.json");
    await fs.writeFile(
      credPath,
      JSON.stringify({ claudeAiOauth: { accessToken: "sk-xxx" } }),
      "utf8",
    );
    const tok = await resolveOAuthToken({ credentialsPath: credPath, platform: "linux" });
    expect(tok).toEqual({ kind: "ok", token: "sk-xxx", source: "file" });
  });

  it("returns missing when file does not exist (linux/win)", async () => {
    const tok = await resolveOAuthToken({
      credentialsPath: path.join(tmp, "absent.json"),
      platform: "linux",
    });
    expect(tok.kind).toBe("missing");
  });

  it("returns malformed when JSON is unparseable", async () => {
    const credPath = path.join(tmp, ".credentials.json");
    await fs.writeFile(credPath, "{not json", "utf8");
    const tok = await resolveOAuthToken({ credentialsPath: credPath, platform: "linux" });
    expect(tok.kind).toBe("malformed");
  });

  it("returns missing when JSON has no accessToken", async () => {
    const credPath = path.join(tmp, ".credentials.json");
    await fs.writeFile(credPath, JSON.stringify({ other: "value" }), "utf8");
    const tok = await resolveOAuthToken({ credentialsPath: credPath, platform: "linux" });
    expect(tok.kind).toBe("malformed");
  });

  it("falls back to macOS Keychain when file missing on darwin", async () => {
    const exec = vi.fn(async () => ({ stdout: "sk-keychain\n", stderr: "" }));
    const tok = await resolveOAuthToken({
      credentialsPath: path.join(tmp, "absent.json"),
      platform: "darwin",
      execImpl: exec,
    });
    expect(tok).toEqual({ kind: "ok", token: "sk-keychain", source: "keychain" });
    expect(exec).toHaveBeenCalledOnce();
  });

  it("returns missing on darwin when both file and keychain fail", async () => {
    const exec = vi.fn(async () => {
      throw new Error("keychain: item not found");
    });
    const tok = await resolveOAuthToken({
      credentialsPath: path.join(tmp, "absent.json"),
      platform: "darwin",
      execImpl: exec,
    });
    expect(tok.kind).toBe("missing");
  });
});
```

- [ ] **Step 2.2: Run — expect FAIL (module missing)**

```
npx vitest run tests/core/quota/credentials.test.ts
```

- [ ] **Step 2.3: Implement credentials.ts**

Create `src/core/quota/credentials.ts`:

```ts
/**
 * Resolve the Claude Code OAuth token used to provoke rate-limit response
 * headers. Spec §"Security model": never logs the token, never persists it
 * to state.
 *
 * Resolution order:
 *  1. `~/.claude/.credentials.json` -> `claudeAiOauth.accessToken`
 *  2. (darwin only) macOS Keychain via `security find-generic-password
 *     -s "Claude Code-credentials" -a $USER -w`
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export type ResolveResult =
  | { kind: "ok"; token: string; source: "file" | "keychain" }
  | { kind: "missing" }
  | { kind: "malformed"; reason: string };

export interface ResolveOptions {
  /** Default: `~/.claude/.credentials.json`. */
  credentialsPath?: string;
  /** Default: process.platform. */
  platform?: NodeJS.Platform;
  /** For tests. */
  execImpl?: typeof execFileP;
}

export function defaultCredentialsPath(): string {
  return path.join(os.homedir(), ".claude", ".credentials.json");
}

export async function resolveOAuthToken(opts: ResolveOptions = {}): Promise<ResolveResult> {
  const credPath = opts.credentialsPath ?? defaultCredentialsPath();
  const platform = opts.platform ?? process.platform;

  // 1. File path.
  let raw: string | null = null;
  try {
    raw = await fs.readFile(credPath, "utf8");
  } catch {
    raw = null;
  }

  if (raw !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return { kind: "malformed", reason: `invalid JSON: ${(e as Error).message}` };
    }
    const token = extractAccessToken(parsed);
    if (typeof token === "string" && token.length > 0) {
      return { kind: "ok", token, source: "file" };
    }
    return { kind: "malformed", reason: "claudeAiOauth.accessToken missing or empty" };
  }

  // 2. Keychain (darwin only).
  if (platform === "darwin") {
    const exec = opts.execImpl ?? execFileP;
    try {
      const { stdout } = await exec("security", [
        "find-generic-password",
        "-s",
        "Claude Code-credentials",
        "-a",
        os.userInfo().username,
        "-w",
      ]);
      const token = stdout.trim();
      if (token.length > 0) {
        return { kind: "ok", token, source: "keychain" };
      }
    } catch {
      // fall through to missing
    }
  }

  return { kind: "missing" };
}

function extractAccessToken(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object") return null;
  const root = parsed as Record<string, unknown>;
  // canonical shape: { claudeAiOauth: { accessToken: string } }
  const oauth = root.claudeAiOauth as Record<string, unknown> | undefined;
  if (oauth && typeof oauth.accessToken === "string") return oauth.accessToken;
  // legacy shape some installations use: { accessToken: string }
  if (typeof root.accessToken === "string") return root.accessToken;
  return null;
}
```

- [ ] **Step 2.4: Run — expect PASS**

```
npx vitest run tests/core/quota/credentials.test.ts
```

Expected: 6 passing.

- [ ] **Step 2.5: Commit**

```
git add src/core/quota/credentials.ts tests/core/quota/credentials.test.ts
git commit -m "feat(quota): OAuth token resolver (file-first + macOS keychain fallback)"
```

---

# Task 3 — Probe function

**Files:**
- Create: `src/core/quota/probe.ts`
- Test: `tests/core/quota/probe.test.ts`

- [ ] **Step 3.1: Write the failing test**

Create `tests/core/quota/probe.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { probe } from "../../../src/core/quota/probe.js";

function mkResponse(opts: {
  status: number;
  headers?: Record<string, string>;
  body?: string;
}): Response {
  return new Response(opts.body ?? "{}", {
    status: opts.status,
    headers: opts.headers,
  });
}

describe("quota/probe", () => {
  it("parses both 5h and 7d headers on success", async () => {
    const fetchImpl = vi.fn(async () =>
      mkResponse({
        status: 200,
        headers: {
          "anthropic-ratelimit-unified-5h-utilization": "59",
          "anthropic-ratelimit-unified-5h-reset": "1700000500",
          "anthropic-ratelimit-unified-5h-status": "allowed",
          "anthropic-ratelimit-unified-7d-utilization": "20",
          "anthropic-ratelimit-unified-7d-reset": "1700600000",
        },
      }),
    );
    const result = await probe("sk-test", { fetchImpl });
    expect(result).toEqual({
      kind: "ok",
      session5h: { utilization: 59, resetTs: 1_700_000_500 },
      weekly7d: { utilization: 20, resetTs: 1_700_600_000 },
      status: "allowed",
    });
  });

  it("returns weekly7d = null when 7d header absent (Pro plan)", async () => {
    const fetchImpl = vi.fn(async () =>
      mkResponse({
        status: 200,
        headers: {
          "anthropic-ratelimit-unified-5h-utilization": "10",
          "anthropic-ratelimit-unified-5h-reset": "1700000500",
          "anthropic-ratelimit-unified-5h-status": "allowed",
        },
      }),
    );
    const result = await probe("sk-test", { fetchImpl });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.weekly7d).toBeNull();
    }
  });

  it("sends Authorization: Bearer + required headers + minimal body", async () => {
    const captured: { url?: string; init?: RequestInit } = {};
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      captured.url = url;
      captured.init = init;
      return mkResponse({ status: 401 });
    });
    await probe("sk-secret-xyz", { fetchImpl });
    expect(captured.url).toBe("https://api.anthropic.com/v1/messages");
    expect(captured.init?.method).toBe("POST");
    const h = new Headers(captured.init?.headers);
    expect(h.get("authorization")).toBe("Bearer sk-secret-xyz");
    expect(h.get("anthropic-version")).toBe("2023-06-01");
    expect(h.get("anthropic-beta")).toBe("oauth-2025-04-20");
    expect(h.get("content-type")).toBe("application/json");
    expect(JSON.parse(captured.init?.body as string)).toEqual({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1,
      messages: [{ role: "user", content: "." }],
    });
  });

  it("returns auth-error on 401", async () => {
    const fetchImpl = vi.fn(async () => mkResponse({ status: 401 }));
    const result = await probe("sk-bad", { fetchImpl });
    expect(result).toEqual({ kind: "auth-error", httpStatus: 401 });
  });

  it("returns rate-limited on 429 with retry-after", async () => {
    const fetchImpl = vi.fn(async () =>
      mkResponse({ status: 429, headers: { "retry-after": "30" } }),
    );
    const result = await probe("sk-test", { fetchImpl });
    expect(result).toEqual({ kind: "rate-limited", httpStatus: 429, retryAfterSec: 30 });
  });

  it("returns server-error on 500", async () => {
    const fetchImpl = vi.fn(async () => mkResponse({ status: 500 }));
    const result = await probe("sk-test", { fetchImpl });
    expect(result).toEqual({ kind: "server-error", httpStatus: 500 });
  });

  it("returns network-error when fetch throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const result = await probe("sk-test", { fetchImpl });
    expect(result.kind).toBe("network-error");
    if (result.kind === "network-error") {
      expect(result.cause).toContain("ECONNRESET");
    }
  });

  it("never logs the token on any error path", async () => {
    const logs: string[] = [];
    const spies = [
      vi.spyOn(console, "log").mockImplementation((...a) => logs.push(a.join(" "))),
      vi.spyOn(console, "error").mockImplementation((...a) => logs.push(a.join(" "))),
      vi.spyOn(console, "warn").mockImplementation((...a) => logs.push(a.join(" "))),
      vi.spyOn(console, "info").mockImplementation((...a) => logs.push(a.join(" "))),
    ];
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    await probe("sk-SECRET-DO-NOT-LEAK", { fetchImpl });
    for (const s of spies) s.mockRestore();
    expect(logs.join("\n")).not.toContain("sk-SECRET-DO-NOT-LEAK");
    expect(logs.join("\n")).not.toContain("Bearer ");
  });

  it("respects timeoutMs by aborting", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const result = await probe("sk-test", { fetchImpl, timeoutMs: 10 });
    expect(result.kind).toBe("network-error");
  });
});
```

- [ ] **Step 3.2: Run — expect FAIL**

```
npx vitest run tests/core/quota/probe.test.ts
```

- [ ] **Step 3.3: Implement probe.ts**

Create `src/core/quota/probe.ts`:

```ts
/**
 * Single-shot probe of api.anthropic.com to provoke rate-limit response
 * headers. The response body is intentionally discarded — only headers
 * carry the data we want.
 *
 * Spec §"Probe contract". Token is passed in, never read from disk here.
 */

import type { QuotaWindow } from "./schema.js";

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const PROBE_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_TIMEOUT_MS = 10_000;

export type ProbeResult =
  | { kind: "ok"; session5h: QuotaWindow; weekly7d: QuotaWindow | null; status: string }
  | { kind: "auth-error"; httpStatus: number }
  | { kind: "rate-limited"; httpStatus: 429; retryAfterSec?: number }
  | { kind: "server-error"; httpStatus: number }
  | { kind: "network-error"; cause: string };

export interface ProbeOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function probe(token: string, opts: ProbeOptions = {}): Promise<ProbeResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: buildHeaders(token),
      body: JSON.stringify({
        model: PROBE_MODEL,
        max_tokens: 1,
        messages: [{ role: "user", content: "." }],
      }),
      signal: ac.signal,
    });
  } catch (e) {
    // Strip anything secret-shaped before stringifying. The message is `e.message`
    // from fetch/abort — by construction it does not contain the token, but we
    // still defensively scrub `Bearer` substrings.
    const cause = scrubSecrets(String((e as Error).message ?? e));
    return { kind: "network-error", cause };
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    return { kind: "auth-error", httpStatus: response.status };
  }
  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after");
    const retryAfterSec = retryAfter ? Number.parseInt(retryAfter, 10) : undefined;
    return {
      kind: "rate-limited",
      httpStatus: 429,
      ...(Number.isFinite(retryAfterSec) ? { retryAfterSec: retryAfterSec as number } : {}),
    };
  }
  if (response.status >= 500) {
    return { kind: "server-error", httpStatus: response.status };
  }

  // 200 / 4xx-non-auth / other 2xx — try to extract headers. If a required
  // header is missing, treat as server-error (Anthropic shipped a shape we
  // don't understand).
  const u5 = response.headers.get("anthropic-ratelimit-unified-5h-utilization");
  const r5 = response.headers.get("anthropic-ratelimit-unified-5h-reset");
  const s5 = response.headers.get("anthropic-ratelimit-unified-5h-status");
  if (u5 === null || r5 === null) {
    return { kind: "server-error", httpStatus: response.status };
  }

  const session5h: QuotaWindow = {
    utilization: Number.parseFloat(u5),
    resetTs: Number.parseInt(r5, 10),
  };

  const u7 = response.headers.get("anthropic-ratelimit-unified-7d-utilization");
  const r7 = response.headers.get("anthropic-ratelimit-unified-7d-reset");
  const weekly7d: QuotaWindow | null =
    u7 !== null && r7 !== null
      ? { utilization: Number.parseFloat(u7), resetTs: Number.parseInt(r7, 10) }
      : null;

  return { kind: "ok", session5h, weekly7d, status: s5 ?? "" };
}

function buildHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "anthropic-version": "2023-06-01",
    "anthropic-beta": "oauth-2025-04-20",
    "content-type": "application/json",
  };
}

function scrubSecrets(s: string): string {
  // Belt-and-braces: drop anything that looks like a bearer token.
  return s.replace(/Bearer\s+\S+/g, "Bearer <redacted>");
}
```

- [ ] **Step 3.4: Run — expect PASS**

```
npx vitest run tests/core/quota/probe.test.ts
```

Expected: 9 passing.

- [ ] **Step 3.5: Commit**

```
git add src/core/quota/probe.ts tests/core/quota/probe.test.ts
git commit -m "feat(quota): HTTP probe for anthropic-ratelimit-unified-* headers"
```

---

# Task 4 — JSONL activity gate

**Files:**
- Create: `src/core/quota/jsonl-gate.ts`
- Test: `tests/core/quota/jsonl-gate.test.ts`

- [ ] **Step 4.1: Write the failing test**

Create `tests/core/quota/jsonl-gate.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { shouldProbe } from "../../../src/core/quota/jsonl-gate.js";

describe("quota/jsonl-gate", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pf-jsonl-"));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it("returns false when projects dir is missing", async () => {
    const result = await shouldProbe({
      projectsDir: path.join(tmp, "absent"),
      now: Date.now(),
      gateMs: 60_000,
    });
    expect(result).toBe(false);
  });

  it("returns false when no .jsonl exists", async () => {
    const p = path.join(tmp, "projects");
    await fs.mkdir(path.join(p, "a"), { recursive: true });
    const result = await shouldProbe({ projectsDir: p, now: Date.now(), gateMs: 60_000 });
    expect(result).toBe(false);
  });

  it("returns true when a .jsonl was touched within the gate", async () => {
    const p = path.join(tmp, "projects");
    await fs.mkdir(path.join(p, "a"), { recursive: true });
    const f = path.join(p, "a", "conv-1.jsonl");
    await fs.writeFile(f, "", "utf8");
    const result = await shouldProbe({ projectsDir: p, now: Date.now(), gateMs: 60_000 });
    expect(result).toBe(true);
  });

  it("returns false when the only .jsonl is older than the gate", async () => {
    const p = path.join(tmp, "projects");
    await fs.mkdir(path.join(p, "a"), { recursive: true });
    const f = path.join(p, "a", "conv-1.jsonl");
    await fs.writeFile(f, "", "utf8");
    const oldTime = (Date.now() - 30 * 60_000) / 1000;
    await fs.utimes(f, oldTime, oldTime);
    const result = await shouldProbe({ projectsDir: p, now: Date.now(), gateMs: 10 * 60_000 });
    expect(result).toBe(false);
  });

  it("recursively descends into nested project dirs", async () => {
    const p = path.join(tmp, "projects");
    const nested = path.join(p, "team", "repo-abc");
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(path.join(nested, "conv.jsonl"), "", "utf8");
    const result = await shouldProbe({ projectsDir: p, now: Date.now(), gateMs: 60_000 });
    expect(result).toBe(true);
  });
});
```

- [ ] **Step 4.2: Run — expect FAIL**

```
npx vitest run tests/core/quota/jsonl-gate.test.ts
```

- [ ] **Step 4.3: Implement jsonl-gate.ts**

Create `src/core/quota/jsonl-gate.ts`:

```ts
/**
 * Decide whether to spend an API call. The gate returns true iff any
 * `*.jsonl` under `~/.claude/projects/` has been modified within `gateMs`.
 *
 * Bound by `MAX_FILES_VISITED` to avoid pathological walks. We early-exit
 * on the first fresh file — most installs find one immediately.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const MAX_FILES_VISITED = 2_000;

export interface ShouldProbeOptions {
  projectsDir?: string;
  /** epoch ms */
  now: number;
  gateMs: number;
}

export function defaultProjectsDir(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

export async function shouldProbe(opts: ShouldProbeOptions): Promise<boolean> {
  const root = opts.projectsDir ?? defaultProjectsDir();
  const cutoffMs = opts.now - opts.gateMs;
  let visited = 0;
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (++visited > MAX_FILES_VISITED) return false;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!e.isFile() || !full.endsWith(".jsonl")) continue;
      try {
        const stat = await fs.stat(full);
        if (stat.mtimeMs >= cutoffMs) return true;
      } catch {
        // unreadable — keep scanning
      }
    }
  }
  return false;
}
```

- [ ] **Step 4.4: Run — expect PASS**

```
npx vitest run tests/core/quota/jsonl-gate.test.ts
```

Expected: 5 passing.

- [ ] **Step 4.5: Commit**

```
git add src/core/quota/jsonl-gate.ts tests/core/quota/jsonl-gate.test.ts
git commit -m "feat(quota): JSONL mtime gate — skip API calls when user is idle"
```

---

# Task 5 — Mood derivation

**Files:**
- Create: `src/core/quota/mood.ts`
- Test: `tests/core/quota/mood.test.ts`

- [ ] **Step 5.1: Write failing test**

Create `tests/core/quota/mood.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveQuotaMood } from "../../../src/core/quota/mood.js";
import { createInitialQuota } from "../../../src/core/quota/schema.js";

function withWindow(util: number) {
  const q = createInitialQuota(0);
  q.optIn = true;
  q.lastProbeOk = true;
  q.session5h = { utilization: util, resetTs: 0 };
  q.status = "allowed";
  return q;
}

describe("quota/mood", () => {
  it("returns calm when opt-out", () => {
    const q = createInitialQuota(0);
    expect(deriveQuotaMood(q)).toBe("calm");
  });

  it("returns calm when probe failed (no signal)", () => {
    const q = withWindow(99);
    q.lastProbeOk = false;
    expect(deriveQuotaMood(q)).toBe("calm");
  });

  it("returns calm when session5h is null", () => {
    const q = withWindow(0);
    q.session5h = null;
    expect(deriveQuotaMood(q)).toBe("calm");
  });

  it("returns calm below stressed threshold", () => {
    expect(deriveQuotaMood(withWindow(79))).toBe("calm");
  });

  it("returns stressed at 80% utilization", () => {
    expect(deriveQuotaMood(withWindow(80))).toBe("stressed");
  });

  it("returns stressed when status is allowed_warning even at 0% util", () => {
    const q = withWindow(10);
    q.status = "allowed_warning";
    expect(deriveQuotaMood(q)).toBe("stressed");
  });

  it("returns panic at 95% utilization", () => {
    expect(deriveQuotaMood(withWindow(95))).toBe("panic");
  });

  it("returns panic when status is denied", () => {
    const q = withWindow(10);
    q.status = "denied";
    expect(deriveQuotaMood(q)).toBe("panic");
  });
});
```

- [ ] **Step 5.2: Run — expect FAIL**

- [ ] **Step 5.3: Implement mood.ts**

Create `src/core/quota/mood.ts`:

```ts
/**
 * Map quota state to a 3-level mood label. Pure, unit-testable. The web view
 * and Ink card both consume this and the existing activity-derived mood,
 * preferring the quota mood iff it returns "stressed" or "panic" (spec
 * §"Mood derivation").
 */

import type { QuotaState } from "./schema.js";

export type QuotaMood = "calm" | "stressed" | "panic";

const STRESSED_PCT = 80;
const PANIC_PCT = 95;

export function deriveQuotaMood(q: QuotaState): QuotaMood {
  if (!q.optIn || !q.lastProbeOk || !q.session5h) return "calm";
  if (q.session5h.utilization >= PANIC_PCT || q.status === "denied") return "panic";
  if (q.session5h.utilization >= STRESSED_PCT || q.status === "allowed_warning") return "stressed";
  return "calm";
}
```

- [ ] **Step 5.4: Run — expect PASS**

```
npx vitest run tests/core/quota/mood.test.ts
```

Expected: 8 passing.

- [ ] **Step 5.5: Commit**

```
git add src/core/quota/mood.ts tests/core/quota/mood.test.ts
git commit -m "feat(quota): mood derivation (calm/stressed/panic)"
```

---

# Task 6 — Achievement registry + evaluators

**Files:**
- Modify: `src/core/schema.ts:84-145` (ACHIEVEMENT_IDS append)
- Modify: `src/core/achievements.ts` (ACHIEVEMENTS registry append)
- Create: `src/core/quota/achievements.ts`
- Test: `tests/core/quota/achievements.test.ts`

- [ ] **Step 6.1: Append 6 IDs to ACHIEVEMENT_IDS**

Edit `src/core/schema.ts`. Locate `ACHIEVEMENT_IDS = [` (around line 84). After the final entry (`"picky_1k",` followed by `] as const;`), insert before the closing bracket:

```ts
  // Quota efficient (3 - V3.7, OTel-style optional)
  "quota_efficient_bronze",
  "quota_efficient_silver",
  "quota_efficient_gold",
  // Quota marathon (3 - V3.7, OTel-style optional)
  "quota_marathon_bronze",
  "quota_marathon_silver",
  "quota_marathon_gold",
```

- [ ] **Step 6.2: Append definitions to ACHIEVEMENTS in achievements.ts**

Edit `src/core/achievements.ts`. Find the final entry in the `ACHIEVEMENTS` registry (search `picky_1k`). Immediately after its closing brace, add:

```ts
  quota_efficient_bronze: {
    id: "quota_efficient_bronze",
    name: "Quota Efficient · Bronze",
    xp: 500,
    description: "Close 5 consecutive 5h windows with under 50% utilization.",
    medal: "bronze",
  },
  quota_efficient_silver: {
    id: "quota_efficient_silver",
    name: "Quota Efficient · Silver",
    xp: 2_000,
    description: "Close 20 consecutive 5h windows with under 50% utilization.",
    medal: "silver",
  },
  quota_efficient_gold: {
    id: "quota_efficient_gold",
    name: "Quota Efficient · Gold",
    xp: 10_000,
    description: "Close 100 consecutive 5h windows with under 50% utilization.",
    medal: "gold",
  },
  quota_marathon_bronze: {
    id: "quota_marathon_bronze",
    name: "Quota Marathon · Bronze",
    xp: 300,
    description: "Hit 95%+ session utilization once.",
    medal: "bronze",
  },
  quota_marathon_silver: {
    id: "quota_marathon_silver",
    name: "Quota Marathon · Silver",
    xp: 1_500,
    description: "Hit 95%+ session utilization 10 times.",
    medal: "silver",
  },
  quota_marathon_gold: {
    id: "quota_marathon_gold",
    name: "Quota Marathon · Gold",
    xp: 7_500,
    description: "Hit 95%+ session utilization 50 times.",
    medal: "gold",
  },
```

- [ ] **Step 6.3: Write failing achievement-eval test**

Create `tests/core/quota/achievements.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { checkQuotaAchievements } from "../../../src/core/quota/achievements.js";
import { createInitialState } from "../../../src/core/schema.js";
import { generatePet } from "../../../src/core/pet-engine.js";
import { ensureQuotaCounters } from "../../../src/core/state.js";

function freshState() {
  const pet = generatePet({ username: "ci", hostname: "ci" });
  const s = createInitialState(pet, 0);
  ensureQuotaCounters(s);
  // make non-inert
  const q = s.counters.quota;
  if (!q) throw new Error("quota not initialised");
  q.optIn = true;
  q.lastProbeTs = 1;
  return s;
}

describe("quota/achievements", () => {
  it("does nothing when opt-out", () => {
    const pet = generatePet({ username: "ci", hostname: "ci" });
    const s = createInitialState(pet, 0);
    ensureQuotaCounters(s);
    expect(checkQuotaAchievements(s)).toEqual([]);
    expect(s.achievements.unlocked).toEqual([]);
  });

  it("does nothing when lastProbeTs === 0 even if opt-in", () => {
    const pet = generatePet({ username: "ci", hostname: "ci" });
    const s = createInitialState(pet, 0);
    ensureQuotaCounters(s);
    const q = s.counters.quota;
    if (!q) throw new Error();
    q.optIn = true;
    expect(checkQuotaAchievements(s)).toEqual([]);
  });

  it("unlocks efficient bronze at 5 consecutive efficient closes", () => {
    const s = freshState();
    const q = s.counters.quota;
    if (!q) throw new Error();
    q.consecutiveEfficient = 5;
    const unlocked = checkQuotaAchievements(s);
    expect(unlocked).toContain("quota_efficient_bronze");
    expect(s.achievements.unlocked).toContain("quota_efficient_bronze");
  });

  it("unlocks efficient silver at 20, gold at 100", () => {
    const s = freshState();
    const q = s.counters.quota;
    if (!q) throw new Error();
    q.consecutiveEfficient = 100;
    const unlocked = checkQuotaAchievements(s);
    expect(unlocked).toEqual(
      expect.arrayContaining([
        "quota_efficient_bronze",
        "quota_efficient_silver",
        "quota_efficient_gold",
      ]),
    );
  });

  it("unlocks marathon tiers at 1, 10, 50", () => {
    const s = freshState();
    const q = s.counters.quota;
    if (!q) throw new Error();
    q.marathonCount = 50;
    const unlocked = checkQuotaAchievements(s);
    expect(unlocked).toEqual(
      expect.arrayContaining([
        "quota_marathon_bronze",
        "quota_marathon_silver",
        "quota_marathon_gold",
      ]),
    );
  });

  it("is idempotent — second call returns nothing newly unlocked", () => {
    const s = freshState();
    const q = s.counters.quota;
    if (!q) throw new Error();
    q.marathonCount = 1;
    checkQuotaAchievements(s);
    expect(checkQuotaAchievements(s)).toEqual([]);
  });
});
```

- [ ] **Step 6.4: Run — expect FAIL**

- [ ] **Step 6.5: Implement evaluator**

Create `src/core/quota/achievements.ts`:

```ts
/**
 * Quota-gated achievement checks. Spec §"Achievements".
 *
 * Gates on `quota.optIn === true && quota.lastProbeTs > 0` — matches the
 * OTel gate convention so unconfigured users never see a unlock from
 * default-zero counters.
 */

import { unlockAchievement } from "../achievements.js";
import type { AchievementId, State } from "../schema.js";

const EFFICIENT_BRONZE = 5;
const EFFICIENT_SILVER = 20;
const EFFICIENT_GOLD = 100;

const MARATHON_BRONZE = 1;
const MARATHON_SILVER = 10;
const MARATHON_GOLD = 50;

export function checkQuotaAchievements(state: State): AchievementId[] {
  const q = state.counters.quota;
  if (!q || !q.optIn || q.lastProbeTs === 0) return [];

  const newly: AchievementId[] = [];
  const tryUnlock = (id: AchievementId, condition: boolean): void => {
    if (condition && unlockAchievement(state, id)) newly.push(id);
  };

  tryUnlock("quota_efficient_bronze", q.consecutiveEfficient >= EFFICIENT_BRONZE);
  tryUnlock("quota_efficient_silver", q.consecutiveEfficient >= EFFICIENT_SILVER);
  tryUnlock("quota_efficient_gold", q.consecutiveEfficient >= EFFICIENT_GOLD);

  tryUnlock("quota_marathon_bronze", q.marathonCount >= MARATHON_BRONZE);
  tryUnlock("quota_marathon_silver", q.marathonCount >= MARATHON_SILVER);
  tryUnlock("quota_marathon_gold", q.marathonCount >= MARATHON_GOLD);

  return newly;
}
```

- [ ] **Step 6.6: Run — expect PASS**

```
npx vitest run tests/core/quota/achievements.test.ts
```

Expected: 6 passing.

- [ ] **Step 6.7: Commit**

```
git add src/core/schema.ts src/core/achievements.ts src/core/quota/achievements.ts tests/core/quota/achievements.test.ts
git commit -m "feat(quota): 6 medal-tiered achievements (efficient + marathon)"
```

---

# Task 7 — Sample-window update + counters from probe result

**Files:**
- Create: `src/core/quota/apply.ts`
- Test: `tests/core/quota/apply.test.ts`

This is the pure function that mutates QuotaState given a new ProbeResult and current time. Keeping it pure makes the daemon thin and unit-testable.

- [ ] **Step 7.1: Failing test**

Create `tests/core/quota/apply.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyProbeResult } from "../../../src/core/quota/apply.js";
import { createInitialQuota } from "../../../src/core/quota/schema.js";
import type { ProbeResult } from "../../../src/core/quota/probe.js";

describe("quota/apply", () => {
  it("sets session/weekly + status + ts on success", () => {
    const q = createInitialQuota(0);
    q.optIn = true;
    const ok: ProbeResult = {
      kind: "ok",
      session5h: { utilization: 40, resetTs: 1_700_000_500 },
      weekly7d: { utilization: 20, resetTs: 1_700_600_000 },
      status: "allowed",
    };
    applyProbeResult(q, ok, 1_000_000);
    expect(q.session5h).toEqual(ok.session5h);
    expect(q.weekly7d).toEqual(ok.weekly7d);
    expect(q.status).toBe("allowed");
    expect(q.lastProbeOk).toBe(true);
    expect(q.lastProbeTs).toBe(1_000_000);
    expect(q.lastError).toBeUndefined();
    expect(q.recentSamples).toEqual([{ ts: 1_000_000, utilization: 40 }]);
  });

  it("flags lastProbeOk = false and stores lastError on auth-error", () => {
    const q = createInitialQuota(0);
    q.optIn = true;
    applyProbeResult(q, { kind: "auth-error", httpStatus: 401 }, 5);
    expect(q.lastProbeOk).toBe(false);
    expect(q.lastError).toContain("401");
    expect(q.lastProbeTs).toBe(5);
  });

  it("keeps prior session/weekly snapshot on failure (do not zero out)", () => {
    const q = createInitialQuota(0);
    q.optIn = true;
    q.session5h = { utilization: 50, resetTs: 1 };
    applyProbeResult(q, { kind: "server-error", httpStatus: 500 }, 5);
    expect(q.session5h).toEqual({ utilization: 50, resetTs: 1 });
  });

  it("computes burnRatePctPerMin from 3 samples", () => {
    const q = createInitialQuota(0);
    q.optIn = true;
    const t0 = 1_000_000;
    const sec = 1_000;
    applyProbeResult(q, mkOk(10, 100), t0);
    applyProbeResult(q, mkOk(15, 100), t0 + 60 * sec); // +5 pct / 1 min
    applyProbeResult(q, mkOk(25, 100), t0 + 120 * sec); // +10 pct / 1 min
    // avg of (5, 10) per minute step = 7.5
    expect(q.burnRatePctPerMin).toBeCloseTo(7.5, 1);
    expect(q.recentSamples).toHaveLength(3);
  });

  it("drops oldest sample beyond 3", () => {
    const q = createInitialQuota(0);
    q.optIn = true;
    for (let i = 0; i < 5; i++) {
      applyProbeResult(q, mkOk(i * 5, 100), i * 60_000);
    }
    expect(q.recentSamples).toHaveLength(3);
    expect(q.recentSamples[0].utilization).toBe(10); // 0,1 dropped
  });

  it("increments consecutiveEfficient when 5h window closes with util < 50", () => {
    const q = createInitialQuota(0);
    q.optIn = true;
    applyProbeResult(q, mkOk(30, 100), 1_000);
    // window not yet rolled
    expect(q.consecutiveEfficient).toBe(0);
    // resetTs advances → window closed; previous util was 30 < 50 → +1
    applyProbeResult(q, mkOk(0, 200), 2_000);
    expect(q.consecutiveEfficient).toBe(1);
  });

  it("resets consecutiveEfficient when window closes with util >= 50", () => {
    const q = createInitialQuota(0);
    q.optIn = true;
    q.consecutiveEfficient = 4;
    applyProbeResult(q, mkOk(80, 100), 1_000);
    applyProbeResult(q, mkOk(0, 200), 2_000);
    expect(q.consecutiveEfficient).toBe(0);
  });

  it("increments marathonCount once per probe that crosses 95%", () => {
    const q = createInitialQuota(0);
    q.optIn = true;
    applyProbeResult(q, mkOk(80, 100), 1_000);
    expect(q.marathonCount).toBe(0);
    applyProbeResult(q, mkOk(95, 100), 1_001);
    expect(q.marathonCount).toBe(1);
    // Stays at 1 while still above 95 in same window
    applyProbeResult(q, mkOk(97, 100), 1_002);
    expect(q.marathonCount).toBe(1);
    // Drops below, then crosses again → +1
    applyProbeResult(q, mkOk(80, 100), 1_003);
    applyProbeResult(q, mkOk(96, 100), 1_004);
    expect(q.marathonCount).toBe(2);
  });
});

function mkOk(util: number, resetTs: number): ProbeResult {
  return {
    kind: "ok",
    session5h: { utilization: util, resetTs },
    weekly7d: null,
    status: "allowed",
  };
}
```

- [ ] **Step 7.2: Run — expect FAIL**

- [ ] **Step 7.3: Implement apply.ts**

Create `src/core/quota/apply.ts`:

```ts
/**
 * Pure function that folds a ProbeResult into a QuotaState.
 *
 * Handles: window snapshot, status, burn-rate derivation (rolling 3-sample
 * average of %/min increments between consecutive ok samples), counters
 * for `consecutiveEfficient` (incremented at session5h.resetTs rollover) and
 * `marathonCount` (incremented on 95%+ crossing edge).
 */

import type { ProbeResult } from "./probe.js";
import type { QuotaState, QuotaSample } from "./schema.js";

const SAMPLE_RING_SIZE = 3;
const EFFICIENT_THRESHOLD = 50;
const MARATHON_THRESHOLD = 95;

export function applyProbeResult(q: QuotaState, r: ProbeResult, now: number): void {
  q.lastProbeTs = now;
  if (r.kind !== "ok") {
    q.lastProbeOk = false;
    q.lastError = formatError(r);
    return;
  }
  delete q.lastError;
  q.lastProbeOk = true;

  // Window close detection (do this BEFORE overwriting session5h).
  const prevWindow = q.session5h;
  const prevReset = q.lastObservedResetTs;
  const newReset = r.session5h.resetTs;
  if (prevReset > 0 && newReset > prevReset && prevWindow !== null) {
    if (prevWindow.utilization < EFFICIENT_THRESHOLD) {
      q.consecutiveEfficient += 1;
    } else {
      q.consecutiveEfficient = 0;
    }
  }
  q.lastObservedResetTs = newReset;

  // Marathon edge detection: previous sample below threshold, new at/above.
  const prevUtil = prevWindow?.utilization ?? 0;
  if (prevUtil < MARATHON_THRESHOLD && r.session5h.utilization >= MARATHON_THRESHOLD) {
    q.marathonCount += 1;
  }

  // Commit window/status.
  q.session5h = r.session5h;
  q.weekly7d = r.weekly7d;
  q.status = r.status;

  // Push sample + recompute burn rate.
  q.recentSamples.push({ ts: now, utilization: r.session5h.utilization });
  while (q.recentSamples.length > SAMPLE_RING_SIZE) q.recentSamples.shift();
  q.burnRatePctPerMin = computeBurnRate(q.recentSamples);
}

function computeBurnRate(samples: QuotaSample[]): number {
  if (samples.length < 2) return 0;
  let totalPct = 0;
  let totalMin = 0;
  for (let i = 1; i < samples.length; i++) {
    const dPct = samples[i].utilization - samples[i - 1].utilization;
    const dMin = (samples[i].ts - samples[i - 1].ts) / 60_000;
    if (dMin <= 0) continue;
    totalPct += dPct;
    totalMin += dMin;
  }
  if (totalMin <= 0) return 0;
  return totalPct / totalMin;
}

function formatError(r: Exclude<ProbeResult, { kind: "ok" }>): string {
  switch (r.kind) {
    case "auth-error":
      return `auth-error (HTTP ${r.httpStatus}) — credentials may have expired`;
    case "rate-limited":
      return r.retryAfterSec !== undefined
        ? `rate-limited — retry after ${r.retryAfterSec}s`
        : "rate-limited";
    case "server-error":
      return `server-error (HTTP ${r.httpStatus})`;
    case "network-error":
      return `network-error: ${r.cause}`;
  }
}
```

- [ ] **Step 7.4: Run — expect PASS**

```
npx vitest run tests/core/quota/apply.test.ts
```

Expected: 8 passing.

- [ ] **Step 7.5: Commit**

```
git add src/core/quota/apply.ts tests/core/quota/apply.test.ts
git commit -m "feat(quota): applyProbeResult — windows, burn rate, marathon edge, efficient roll"
```

---

# Task 8 — `petforge quota` CLI (enable/disable/status one-shot)

**Files:**
- Create: `src/commands/quota.ts`
- Modify: `src/index.ts` (route the subcommand + help text)
- Test: `tests/commands/quota.test.ts`

- [ ] **Step 8.1: Failing test**

Create `tests/commands/quota.test.ts`:

```ts
import { describe, expect, it, beforeEach, vi } from "vitest";
import { quotaCli } from "../../src/commands/quota.js";
import { readState, withStateLock, ensurePetforgeDir } from "../../src/core/state.js";
import { createInitialState } from "../../src/core/schema.js";
import { generatePet } from "../../src/core/pet-engine.js";
import { promises as fs } from "node:fs";
import { STATE_FILE } from "../../src/core/paths.js";

async function seedState() {
  await ensurePetforgeDir();
  const pet = generatePet({ username: "ci", hostname: "ci" });
  await fs.writeFile(STATE_FILE, JSON.stringify(createInitialState(pet, 0)), "utf8");
}

describe("petforge quota CLI", () => {
  beforeEach(async () => {
    await seedState();
  });

  it("enable: writes optIn=true after a successful probe", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("{}", {
        status: 200,
        headers: {
          "anthropic-ratelimit-unified-5h-utilization": "10",
          "anthropic-ratelimit-unified-5h-reset": "1700000500",
          "anthropic-ratelimit-unified-5h-status": "allowed",
        },
      }),
    );
    const exit = await quotaCli(["enable"], {
      resolveToken: async () => ({ kind: "ok", token: "sk-x", source: "file" }),
      fetchImpl,
      now: () => 1_000,
    });
    expect(exit).toBe(0);
    const s = await readState();
    expect(s.counters.quota?.optIn).toBe(true);
    expect(s.counters.quota?.lastProbeOk).toBe(true);
    expect(s.counters.quota?.session5h?.utilization).toBe(10);
  });

  it("enable: does NOT flip optIn when probe fails", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 401 }));
    const exit = await quotaCli(["enable"], {
      resolveToken: async () => ({ kind: "ok", token: "sk-x", source: "file" }),
      fetchImpl,
      now: () => 1_000,
    });
    expect(exit).toBe(1);
    const s = await readState();
    expect(s.counters.quota?.optIn ?? false).toBe(false);
  });

  it("enable: errors with hint when credentials missing", async () => {
    const exit = await quotaCli(["enable"], {
      resolveToken: async () => ({ kind: "missing" }),
      fetchImpl: vi.fn(),
      now: () => 0,
    });
    expect(exit).toBe(1);
  });

  it("disable: flips optIn=false and zeroes samples/counters but keeps unlocks", async () => {
    await withStateLock(async (s) => {
      const q = s.counters.quota;
      if (!q) throw new Error();
      q.optIn = true;
      q.consecutiveEfficient = 3;
      q.marathonCount = 1;
      q.recentSamples = [{ ts: 1, utilization: 50 }];
      s.achievements.unlocked.push("quota_marathon_bronze");
    });
    const exit = await quotaCli(["disable"], { now: () => 0 });
    expect(exit).toBe(0);
    const s = await readState();
    expect(s.counters.quota?.optIn).toBe(false);
    expect(s.counters.quota?.consecutiveEfficient).toBe(0);
    expect(s.counters.quota?.marathonCount).toBe(0);
    expect(s.counters.quota?.recentSamples).toEqual([]);
    expect(s.achievements.unlocked).toContain("quota_marathon_bronze");
  });

  it("status (default): one-shot probe + print, requires opt-in", async () => {
    const out: string[] = [];
    const exit = await quotaCli([], {
      resolveToken: async () => ({ kind: "ok", token: "sk-x", source: "file" }),
      fetchImpl: vi.fn(),
      now: () => 0,
      writeOut: (s) => out.push(s),
    });
    expect(exit).toBe(1);
    expect(out.join("")).toMatch(/petforge quota enable/);
  });

  it("--json: emits machine-readable quota snapshot", async () => {
    await withStateLock(async (s) => {
      const q = s.counters.quota;
      if (!q) throw new Error();
      q.optIn = true;
      q.lastProbeTs = 1;
      q.session5h = { utilization: 33, resetTs: 1_700_000_500 };
      q.status = "allowed";
    });
    const out: string[] = [];
    const exit = await quotaCli(["--json"], {
      resolveToken: async () => ({ kind: "ok", token: "sk-x", source: "file" }),
      fetchImpl: vi.fn(),
      now: () => 0,
      writeOut: (s) => out.push(s),
    });
    expect(exit).toBe(0);
    const parsed = JSON.parse(out.join(""));
    expect(parsed.session5h.utilization).toBe(33);
  });
});
```

- [ ] **Step 8.2: Run — expect FAIL**

- [ ] **Step 8.3: Implement quota.ts (one-shot subcommand)**

Create `src/commands/quota.ts`:

```ts
/**
 * `petforge quota [enable | disable | --json]`
 *
 * Spec §"Surface — CLI". This file owns the one-shot CLI behaviors plus the
 * daemon entrypoint (Task 9). Long-running probe loop is exported as
 * `runQuotaDaemon` so `up.ts` can co-orchestrate it with collect + serve.
 */

import { applyProbeResult } from "../core/quota/apply.js";
import { checkQuotaAchievements } from "../core/quota/achievements.js";
import { resolveOAuthToken, type ResolveResult } from "../core/quota/credentials.js";
import { probe } from "../core/quota/probe.js";
import { createInitialQuota } from "../core/quota/schema.js";
import { ensureQuotaCounters, withStateLock } from "../core/state.js";

export interface QuotaCliDeps {
  resolveToken?: () => Promise<ResolveResult>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  writeOut?: (s: string) => void;
  writeErr?: (s: string) => void;
}

const out = (deps: QuotaCliDeps) => deps.writeOut ?? ((s: string) => process.stdout.write(s));
const err = (deps: QuotaCliDeps) => deps.writeErr ?? ((s: string) => process.stderr.write(s));
const now = (deps: QuotaCliDeps) => deps.now ?? (() => Date.now());

export async function quotaCli(argv: string[], deps: QuotaCliDeps = {}): Promise<number> {
  const sub = argv[0];
  if (sub === "enable") return enableCmd(deps);
  if (sub === "disable") return disableCmd(deps);
  if (sub === "--help" || sub === "-h") {
    out(deps)(helpText());
    return 0;
  }
  // default: one-shot status (with optional --json)
  const json = argv.includes("--json");
  return statusCmd(deps, json);
}

function helpText(): string {
  return `Usage: petforge quota [enable | disable | --json]\n`;
}

async function enableCmd(deps: QuotaCliDeps): Promise<number> {
  const resolve = deps.resolveToken ?? resolveOAuthToken;
  const tok = await resolve();
  if (tok.kind !== "ok") {
    err(deps)(formatTokenError(tok));
    return 1;
  }
  const r = await probe(tok.token, { fetchImpl: deps.fetchImpl });
  if (r.kind !== "ok") {
    err(deps)(`probe failed: ${probeErrShort(r)}\n`);
    return 1;
  }
  await withStateLock(async (s) => {
    ensureQuotaCounters(s);
    const q = s.counters.quota;
    if (!q) throw new Error("quota init failed");
    q.optIn = true;
    q.daemonStarted = now(deps)();
    applyProbeResult(q, r, now(deps)());
    checkQuotaAchievements(s);
  });
  out(deps)("Quota tracking enabled.\n");
  out(deps)(`Source: ${tok.source}\n`);
  out(deps)(`Session (5h): ${r.session5h.utilization.toFixed(0)}%\n`);
  if (r.weekly7d) out(deps)(`Weekly (7d): ${r.weekly7d.utilization.toFixed(0)}%\n`);
  return 0;
}

async function disableCmd(deps: QuotaCliDeps): Promise<number> {
  await withStateLock(async (s) => {
    ensureQuotaCounters(s);
    const fresh = createInitialQuota(now(deps)());
    // Preserve daemonStarted=0 → "never enabled" semantics
    fresh.daemonStarted = 0;
    s.counters.quota = fresh;
  });
  out(deps)("Quota tracking disabled.\n");
  return 0;
}

async function statusCmd(deps: QuotaCliDeps, json: boolean): Promise<number> {
  // Read current state without probe; if opt-out, instruct the user.
  let snapshot: unknown;
  let optIn = false;
  await withStateLock(async (s) => {
    ensureQuotaCounters(s);
    optIn = s.counters.quota?.optIn === true;
    snapshot = s.counters.quota;
  });
  if (!optIn) {
    err(deps)("Quota tracking is disabled. Enable with: petforge quota enable\n");
    return 1;
  }
  if (json) {
    out(deps)(`${JSON.stringify(snapshot, null, 2)}\n`);
    return 0;
  }
  out(deps)(formatStatus(snapshot as ReturnType<typeof createInitialQuota>));
  return 0;
}

function formatStatus(q: ReturnType<typeof createInitialQuota>): string {
  const lines: string[] = ["Quota status:"];
  if (q.session5h) {
    lines.push(`  Session (5h): ${q.session5h.utilization.toFixed(1)}%`);
  } else {
    lines.push("  Session (5h): no data yet");
  }
  if (q.weekly7d) {
    lines.push(`  Weekly  (7d): ${q.weekly7d.utilization.toFixed(1)}%`);
  }
  lines.push(`  Burn rate:    ${q.burnRatePctPerMin.toFixed(2)} %/min`);
  lines.push(`  Last probe:   ${q.lastProbeOk ? "ok" : `failed (${q.lastError ?? "?"})`}`);
  return `${lines.join("\n")}\n`;
}

function formatTokenError(r: Exclude<ResolveResult, { kind: "ok" }>): string {
  if (r.kind === "missing") {
    return "Claude Code credentials not found.\nLooked at: ~/.claude/.credentials.json (and macOS Keychain on darwin).\nLog into Claude Code first, then re-run.\n";
  }
  return `Credentials malformed: ${r.reason}\n`;
}

function probeErrShort(r: { kind: string; httpStatus?: number; cause?: string }): string {
  if (r.kind === "auth-error") return `HTTP ${r.httpStatus} — token rejected`;
  if (r.kind === "rate-limited") return "HTTP 429 — rate limited";
  if (r.kind === "server-error") return `HTTP ${r.httpStatus} — Anthropic server error`;
  if (r.kind === "network-error") return `network: ${r.cause}`;
  return r.kind;
}
```

- [ ] **Step 8.4: Wire into index.ts**

Edit `src/index.ts`. Add import:

```ts
import { quotaCli } from "./commands/quota.js";
```

Add a help line after the `collect` entry in the help block:

```ts
console.log("  quota       Show Claude Code rate-limit usage (5h + 7d)");
console.log("              (enable | disable | --json)");
```

Add a route after the `collect` route:

```ts
if (cmd === "quota") {
  return await quotaCli(args.slice(1));
}
```

- [ ] **Step 8.5: Run — expect PASS**

```
npx vitest run tests/commands/quota.test.ts
```

Expected: 6 passing.

- [ ] **Step 8.6: Commit**

```
git add src/commands/quota.ts src/index.ts tests/commands/quota.test.ts
git commit -m "feat(quota): petforge quota CLI — enable/disable/status (one-shot)"
```

---

# Task 9 — Quota daemon loop

**Files:**
- Modify: `src/commands/quota.ts` (append `runQuotaDaemon`)
- Test: `tests/commands/quota-daemon.test.ts`

- [ ] **Step 9.1: Failing test**

Create `tests/commands/quota-daemon.test.ts`:

```ts
import { describe, expect, it, beforeEach, vi } from "vitest";
import { runQuotaDaemon } from "../../src/commands/quota.js";
import { ensurePetforgeDir, readState, withStateLock } from "../../src/core/state.js";
import { createInitialState } from "../../src/core/schema.js";
import { generatePet } from "../../src/core/pet-engine.js";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { STATE_FILE } from "../../src/core/paths.js";

async function seedOptIn() {
  await ensurePetforgeDir();
  const pet = generatePet({ username: "ci", hostname: "ci" });
  await fs.writeFile(STATE_FILE, JSON.stringify(createInitialState(pet, 0)), "utf8");
  await withStateLock(async (s) => {
    const q = s.counters.quota;
    if (!q) throw new Error();
    q.optIn = true;
  });
}

describe("runQuotaDaemon", () => {
  beforeEach(async () => {
    await seedOptIn();
  });

  it("probes once when JSONL gate passes", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("{}", {
        status: 200,
        headers: {
          "anthropic-ratelimit-unified-5h-utilization": "42",
          "anthropic-ratelimit-unified-5h-reset": "1700000500",
          "anthropic-ratelimit-unified-5h-status": "allowed",
        },
      }),
    );
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pf-d-"));
    await fs.mkdir(path.join(tmp, "p"), { recursive: true });
    await fs.writeFile(path.join(tmp, "p", "conv.jsonl"), "", "utf8");

    const handle = await runQuotaDaemon({
      resolveToken: async () => ({ kind: "ok", token: "sk-x", source: "file" }),
      fetchImpl,
      projectsDir: tmp,
      probeIntervalMs: 10,
      probeGateMs: 60_000,
      now: () => Date.now(),
    });
    // wait for at least one tick
    await new Promise((r) => setTimeout(r, 50));
    await handle.close();
    expect(fetchImpl).toHaveBeenCalled();
    const s = await readState();
    expect(s.counters.quota?.session5h?.utilization).toBe(42);
  });

  it("does NOT probe when JSONL gate fails", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}"));
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pf-d-"));
    // no jsonl files
    const handle = await runQuotaDaemon({
      resolveToken: async () => ({ kind: "ok", token: "sk-x", source: "file" }),
      fetchImpl,
      projectsDir: tmp,
      probeIntervalMs: 10,
      probeGateMs: 60_000,
      now: () => Date.now(),
    });
    await new Promise((r) => setTimeout(r, 50));
    await handle.close();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stops probing when opt-out is flipped at runtime", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("{}", {
        status: 200,
        headers: {
          "anthropic-ratelimit-unified-5h-utilization": "1",
          "anthropic-ratelimit-unified-5h-reset": "1",
          "anthropic-ratelimit-unified-5h-status": "allowed",
        },
      }),
    );
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pf-d-"));
    await fs.mkdir(path.join(tmp, "p"), { recursive: true });
    await fs.writeFile(path.join(tmp, "p", "conv.jsonl"), "", "utf8");

    const handle = await runQuotaDaemon({
      resolveToken: async () => ({ kind: "ok", token: "sk-x", source: "file" }),
      fetchImpl,
      projectsDir: tmp,
      probeIntervalMs: 10,
      probeGateMs: 60_000,
      now: () => Date.now(),
    });
    await new Promise((r) => setTimeout(r, 30));
    const callsAfter = fetchImpl.mock.calls.length;
    await withStateLock(async (s) => {
      const q = s.counters.quota;
      if (!q) throw new Error();
      q.optIn = false;
    });
    await new Promise((r) => setTimeout(r, 30));
    const finalCalls = fetchImpl.mock.calls.length;
    await handle.close();
    expect(finalCalls).toBe(callsAfter);
  });
});
```

- [ ] **Step 9.2: Run — expect FAIL**

- [ ] **Step 9.3: Implement runQuotaDaemon**

Append to `src/commands/quota.ts`:

```ts
import { defaultProjectsDir, shouldProbe } from "../core/quota/jsonl-gate.js";

export interface QuotaDaemonOptions extends QuotaCliDeps {
  projectsDir?: string;
  probeIntervalMs?: number;
  probeGateMs?: number;
}

export interface QuotaDaemonHandle {
  close: () => Promise<void>;
}

const DEFAULT_PROBE_INTERVAL_MS = 5 * 60_000;
const DEFAULT_PROBE_GATE_MS = 10 * 60_000;

export async function runQuotaDaemon(opts: QuotaDaemonOptions = {}): Promise<QuotaDaemonHandle> {
  const resolve = opts.resolveToken ?? resolveOAuthToken;
  const projectsDir = opts.projectsDir ?? defaultProjectsDir();
  const interval = opts.probeIntervalMs ?? DEFAULT_PROBE_INTERVAL_MS;
  const gate = opts.probeGateMs ?? DEFAULT_PROBE_GATE_MS;
  const nowFn = opts.now ?? (() => Date.now());

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      // Re-read opt-in each tick — user may have disabled at runtime.
      let optIn = false;
      await withStateLock(async (s) => {
        ensureQuotaCounters(s);
        optIn = s.counters.quota?.optIn === true;
      });
      if (!optIn) return;

      const gateOk = await shouldProbe({
        projectsDir,
        now: nowFn(),
        gateMs: gate,
      });
      if (!gateOk) return;

      const tok = await resolve();
      if (tok.kind !== "ok") {
        await withStateLock(async (s) => {
          ensureQuotaCounters(s);
          const q = s.counters.quota;
          if (!q) return;
          q.lastProbeOk = false;
          q.lastError = tok.kind === "missing" ? "credentials missing" : "credentials malformed";
          q.lastProbeTs = nowFn();
        });
        return;
      }
      const r = await probe(tok.token, { fetchImpl: opts.fetchImpl });
      await withStateLock(async (s) => {
        ensureQuotaCounters(s);
        const q = s.counters.quota;
        if (!q) return;
        applyProbeResult(q, r, nowFn());
        checkQuotaAchievements(s);
      });
    } catch {
      // never throw out of the tick — the daemon must survive transient errors
    } finally {
      if (!stopped) timer = setTimeout(tick, interval);
    }
  };

  // First tick fires immediately so `up --quota` shows numbers fast.
  timer = setTimeout(tick, 0);

  return {
    close: async (): Promise<void> => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
```

- [ ] **Step 9.4: Run — expect PASS**

```
npx vitest run tests/commands/quota-daemon.test.ts
```

Expected: 3 passing.

- [ ] **Step 9.5: Commit**

```
git add src/commands/quota.ts tests/commands/quota-daemon.test.ts
git commit -m "feat(quota): daemon loop — JSONL-gated 5-min probe with runtime opt-out re-check"
```

---

# Task 10 — `petforge up --quota` integration

**Files:**
- Modify: `src/commands/up.ts`

- [ ] **Step 10.1: Add the flag + lifecycle**

Edit `src/commands/up.ts`. Add to the import block:

```ts
import { runQuotaDaemon } from "./quota.js";
```

In the `UpOptions` interface, add:

```ts
  quota?: boolean;
```

In `parseArgs` (search for it near the bottom of the file), add a case for `--quota` setting `opts.quota = true`.

In the help/usage string (in `upCli`), append `[--quota]` after `[--forward=URL]`.

After `server = await startServer(...)` succeeds (search for `[serve]   listening on`), add a third optional process:

```ts
  let quota: { close: () => Promise<void> } | null = null;
  if (opts.quota) {
    try {
      quota = await runQuotaDaemon();
      process.stdout.write("[quota]   probe loop active (every 5 min when JSONL is fresh)\n");
    } catch (err) {
      process.stderr.write(`[quota]   failed to start: ${(err as Error).message}\n`);
      await server.close();
      await collector.close();
      return 1;
    }
  }
```

In the SIGINT/SIGTERM handler (search for `signal-handler` or `process.on("SIGINT"`), add quota close before the collector close:

```ts
  if (quota) await quota.close();
```

- [ ] **Step 10.2: Manual smoke (not in CI)**

Document only — not a test step. Run locally:

```
npm run build && node dist/index.js up --quota
```

Verify the line `[quota]   probe loop active` appears, then Ctrl+C kills cleanly.

- [ ] **Step 10.3: Commit**

```
git add src/commands/up.ts
git commit -m "feat(up): --quota flag co-orchestrates quota daemon with collect+serve"
```

---

# Task 11 — `petforge doctor` quota check

**Files:**
- Modify: `src/commands/doctor.ts`

- [ ] **Step 11.1: Locate the existing check pattern**

Grep:

```
git grep -n "OTel\|otel" src/commands/doctor.ts
```

You'll see how the OTel check is added — same pattern for quota.

- [ ] **Step 11.2: Add the quota check**

In `src/commands/doctor.ts`, after the OTel section, add (adapt the helper names to match the file's existing pattern — `ok()`, `warn()`, `err()` or whatever it uses):

```ts
  // ----- Quota tracking -----
  const q = state.counters.quota;
  if (!q || !q.optIn) {
    info("Quota tracking", "disabled (run `petforge quota enable` to opt in)");
  } else {
    const tok = await resolveOAuthToken();
    if (tok.kind !== "ok") {
      err("Quota credentials", `${tok.kind} — re-login to Claude Code`);
    } else {
      ok("Quota credentials", `available (${tok.source})`);
    }
    if (q.lastProbeTs === 0) {
      warn("Quota last probe", "never");
    } else {
      const ageMin = (Date.now() - q.lastProbeTs) / 60_000;
      const ageLabel = `${ageMin.toFixed(1)} min ago`;
      if (!q.lastProbeOk) {
        err("Quota last probe", `failed (${ageLabel}): ${q.lastError ?? "?"}`);
      } else if (ageMin > 15) {
        warn("Quota last probe", `stale (${ageLabel})`);
      } else {
        ok("Quota last probe", ageLabel);
      }
    }
  }
```

Add `import { resolveOAuthToken } from "../core/quota/credentials.js";` at the top.

- [ ] **Step 11.3: Adjust to actual helpers in doctor.ts**

If doctor.ts emits text directly (no `ok()`/`warn()` helpers), inline the formatting using its existing pattern — keep the labels and conditions identical.

- [ ] **Step 11.4: Build + manual smoke**

```
npm run build
node dist/index.js doctor
```

Verify the new "Quota tracking" section appears.

- [ ] **Step 11.5: Commit**

```
git add src/commands/doctor.ts
git commit -m "feat(doctor): add quota tracking section (credentials + probe freshness)"
```

---

# Task 12 — CLI Ink rendering (QuotaBlock)

**Files:**
- Create: `src/render/components/QuotaBlock.tsx`
- Modify: `src/render/components/CardView.tsx`
- Test: `tests/render/QuotaBlock.test.tsx`

- [ ] **Step 12.1: Test the component**

Create `tests/render/QuotaBlock.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import React from "react";
import { QuotaBlock } from "../../src/render/components/QuotaBlock.js";
import { createInitialQuota } from "../../src/core/quota/schema.js";

describe("QuotaBlock", () => {
  it("renders nothing when quota is undefined", () => {
    const { lastFrame } = render(<QuotaBlock quota={undefined} />);
    expect(lastFrame()).toBe("");
  });

  it("renders nothing when opt-out", () => {
    const { lastFrame } = render(<QuotaBlock quota={createInitialQuota(0)} />);
    expect(lastFrame()).toBe("");
  });

  it("renders 5h bar when opt-in with session data", () => {
    const q = createInitialQuota(0);
    q.optIn = true;
    q.lastProbeOk = true;
    q.session5h = { utilization: 59, resetTs: Math.floor(Date.now() / 1000) + 3 * 3600 };
    const { lastFrame } = render(<QuotaBlock quota={q} />);
    const out = lastFrame() ?? "";
    expect(out).toContain("QUOTAS");
    expect(out).toContain("5h");
    expect(out).toMatch(/59\s*%/);
  });

  it("renders 7d bar only when weekly7d is present", () => {
    const q = createInitialQuota(0);
    q.optIn = true;
    q.lastProbeOk = true;
    q.session5h = { utilization: 10, resetTs: 0 };
    const { lastFrame } = render(<QuotaBlock quota={q} />);
    expect(lastFrame() ?? "").not.toContain("7d");

    q.weekly7d = { utilization: 20, resetTs: 0 };
    const { lastFrame: f2 } = render(<QuotaBlock quota={q} />);
    expect(f2() ?? "").toContain("7d");
  });
});
```

- [ ] **Step 12.2: Run — expect FAIL**

- [ ] **Step 12.3: Implement QuotaBlock**

Create `src/render/components/QuotaBlock.tsx`:

```tsx
/**
 * QuotaBlock — Ink rendering of `state.counters.quota` in `petforge card`.
 * Hidden when quota is undefined or opt-out. Spec §"Surface — CLI card".
 */

import { Box, Text } from "ink";
import type React from "react";
import type { QuotaState } from "../../core/quota/schema.js";

export interface QuotaBlockProps {
  quota: QuotaState | undefined;
}

export function QuotaBlock({ quota }: QuotaBlockProps): React.ReactElement | null {
  if (!quota || !quota.optIn) return null;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>QUOTAS</Text>
      {quota.session5h ? (
        <QuotaBar
          label="Session (5h)"
          util={quota.session5h.utilization}
          resetTs={quota.session5h.resetTs}
        />
      ) : (
        <Text dimColor>(no data yet)</Text>
      )}
      {quota.weekly7d ? (
        <QuotaBar
          label="Weekly  (7d)"
          util={quota.weekly7d.utilization}
          resetTs={quota.weekly7d.resetTs}
        />
      ) : null}
      {quota.lastProbeOk ? null : (
        <Text color="red">last probe: {quota.lastError ?? "failed"}</Text>
      )}
    </Box>
  );
}

function QuotaBar({
  label,
  util,
  resetTs,
}: {
  label: string;
  util: number;
  resetTs: number;
}): React.ReactElement {
  const pct = Math.max(0, Math.min(100, util));
  const filled = Math.round(pct / 5);
  const bar = "█".repeat(filled).padEnd(20, "░");
  const color = pct >= 95 ? "red" : pct >= 80 ? "yellow" : pct >= 60 ? "magenta" : "green";
  return (
    <Box>
      <Box width={14}>
        <Text>{label}</Text>
      </Box>
      <Text color={color}>
        [{bar}] {pct.toFixed(0)}% · resets {formatResetIn(resetTs)}
      </Text>
    </Box>
  );
}

function formatResetIn(resetTsSec: number): string {
  const deltaSec = resetTsSec - Math.floor(Date.now() / 1000);
  if (deltaSec <= 0) return "now";
  const h = Math.floor(deltaSec / 3600);
  const m = Math.floor((deltaSec % 3600) / 60);
  if (h >= 24) return `in ${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `in ${h}h ${m}m`;
  return `in ${m}m`;
}
```

- [ ] **Step 12.4: Integrate into CardView**

Edit `src/render/components/CardView.tsx`. Add import:

```ts
import { QuotaBlock } from "./QuotaBlock.js";
```

In the right column (the `<Box flexDirection="column">` that contains STATS + ACHIEVEMENTS, around lines 69-87), add `<QuotaBlock quota={state.counters.quota} />` immediately after the STATS block and before the `<Text> </Text>` spacer that precedes ACHIEVEMENTS.

- [ ] **Step 12.5: Run — expect PASS**

```
npx vitest run tests/render/QuotaBlock.test.tsx
```

Expected: 4 passing.

- [ ] **Step 12.6: Commit**

```
git add src/render/components/QuotaBlock.tsx src/render/components/CardView.tsx tests/render/QuotaBlock.test.tsx
git commit -m "feat(card): QuotaBlock — Ink rendering of 5h+7d gauges with color thresholds"
```

---

# Task 13 — Web view QUOTAS card

**Files:**
- Modify: `src/render/web/page.ts`

This file is template-string heavy. Modifications are surgical — three insertions into the HTML, CSS, and CLIENT_JS blocks.

- [ ] **Step 13.1: Add the HTML section**

In `src/render/web/page.ts`, find the existing `<section class="card stats-card">` block. Immediately AFTER its closing `</section>`, before the `goals-card`, add:

```html
  <section class="card quotas-card" id="quotas-card" hidden>
    <p class="card-label">Quotas</p>
    <div class="quota-row" id="quota-5h-row">
      <span class="quota-label">Session (5h)</span>
      <div class="quota-bar-track"><div class="quota-bar-fill" id="quota-5h-fill"></div></div>
      <span class="quota-pct" id="quota-5h-pct">--%</span>
    </div>
    <p class="quota-meta" id="quota-5h-meta"></p>
    <div class="quota-row" id="quota-7d-row" hidden>
      <span class="quota-label">Weekly (7d)</span>
      <div class="quota-bar-track"><div class="quota-bar-fill" id="quota-7d-fill"></div></div>
      <span class="quota-pct" id="quota-7d-pct">--%</span>
    </div>
    <p class="quota-meta" id="quota-7d-meta"></p>
  </section>
```

- [ ] **Step 13.2: Add the CSS rules**

In the same file, find the CSS template literal (search for `.stats-card`). Append after the stats-card rules:

```css
  /* Quotas card */
  .quotas-card .quota-row {
    display: grid;
    grid-template-columns: 7rem 1fr 3rem;
    gap: 0.5rem;
    align-items: center;
    margin-top: 0.25rem;
  }
  .quotas-card .quota-label { font-size: 0.85rem; opacity: 0.85; }
  .quotas-card .quota-bar-track {
    height: 0.6rem;
    background: rgba(255,255,255,0.08);
    border-radius: 0.3rem;
    overflow: hidden;
  }
  .quotas-card .quota-bar-fill {
    height: 100%;
    width: 0%;
    transition: width 200ms ease, background 200ms ease;
    background: #4ade80;
  }
  .quotas-card .quota-bar-fill.warn   { background: #facc15; }
  .quotas-card .quota-bar-fill.high   { background: #fb923c; }
  .quotas-card .quota-bar-fill.danger { background: #ef4444; }
  .quotas-card .quota-pct { font-variant-numeric: tabular-nums; text-align: right; }
  .quotas-card .quota-meta {
    font-size: 0.75rem;
    opacity: 0.7;
    margin: 0.2rem 0 0.4rem 7.5rem;
  }
```

- [ ] **Step 13.3: Add the client renderer**

In the CLIENT_JS template literal (search for `renderState`), inside that function, after the existing STATS rendering and before the achievements rendering, add:

```js
    // ----- Quotas (V3.7) -----
    var quota = s.counters && s.counters.quota;
    var qCard = document.getElementById('quotas-card');
    if (!quota || !quota.optIn) {
      qCard.hidden = true;
    } else {
      qCard.hidden = false;
      var s5 = quota.session5h;
      var w7 = quota.weekly7d;
      if (s5) {
        var pct5 = Math.max(0, Math.min(100, s5.utilization));
        var fill5 = document.getElementById('quota-5h-fill');
        fill5.style.width = pct5.toFixed(1) + '%';
        fill5.className = 'quota-bar-fill ' + bandClass(pct5);
        document.getElementById('quota-5h-pct').textContent = pct5.toFixed(0) + '%';
        document.getElementById('quota-5h-meta').textContent =
          'Resets ' + formatResetIn(s5.resetTs) +
          ' · burn ' + (quota.burnRatePctPerMin || 0).toFixed(2) + '%/min';
      }
      var row7 = document.getElementById('quota-7d-row');
      var meta7 = document.getElementById('quota-7d-meta');
      if (w7) {
        row7.hidden = false;
        meta7.hidden = false;
        var pct7 = Math.max(0, Math.min(100, w7.utilization));
        var fill7 = document.getElementById('quota-7d-fill');
        fill7.style.width = pct7.toFixed(1) + '%';
        fill7.className = 'quota-bar-fill ' + bandClass(pct7);
        document.getElementById('quota-7d-pct').textContent = pct7.toFixed(0) + '%';
        meta7.textContent = 'Resets ' + formatResetIn(w7.resetTs);
      } else {
        row7.hidden = true;
        meta7.hidden = true;
      }
    }
```

Above `renderState`, in the same CLIENT_JS literal, add the two helpers:

```js
  function bandClass(pct) {
    if (pct >= 95) return 'danger';
    if (pct >= 80) return 'high';
    if (pct >= 60) return 'warn';
    return '';
  }
  function formatResetIn(tsSec) {
    var delta = tsSec - Math.floor(Date.now()/1000);
    if (delta <= 0) return 'now';
    var h = Math.floor(delta/3600), m = Math.floor((delta%3600)/60);
    if (h >= 24) return 'in ' + Math.floor(h/24) + 'd ' + (h%24) + 'h';
    if (h > 0)  return 'in ' + h + 'h ' + m + 'm';
    return 'in ' + m + 'm';
  }
```

- [ ] **Step 13.4: Quota-aware Mood override**

In the same CLIENT_JS literal, find where the `mood` field is set in `renderState` (search for `getElementById('mood')`). Wrap the existing assignment so quota wins when `stressed`/`panic`:

```js
    var moodFromQuota = quotaMood(quota);
    var moodFromActivity = /* whatever the current code computes */;
    var displayMood = (moodFromQuota === 'stressed' || moodFromQuota === 'panic')
        ? moodFromQuota
        : moodFromActivity;
    document.getElementById('mood').textContent = displayMood;
```

Add `quotaMood` helper:

```js
  function quotaMood(q) {
    if (!q || !q.optIn || !q.lastProbeOk || !q.session5h) return 'calm';
    if (q.session5h.utilization >= 95 || q.status === 'denied') return 'panic';
    if (q.session5h.utilization >= 80 || q.status === 'allowed_warning') return 'stressed';
    return 'calm';
  }
```

- [ ] **Step 13.5: Smoke test**

Run:

```
npm run build && node dist/index.js up --quota
```

Open `http://127.0.0.1:7878`, verify the QUOTAS card appears (after one probe lands) and that mood flips to "stressed" when you mock a `>= 80%` value in `~/.petforge/state.json` and SSE pushes.

- [ ] **Step 13.6: Commit**

```
git add src/render/web/page.ts
git commit -m "feat(web): QUOTAS card + quota-aware mood override"
```

---

# Task 14 — README + CHANGELOG + version bump

**Files:**
- Modify: `package.json` (version bump)
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 14.1: Bump version**

In `package.json`, change `"version": "3.6.0"` (or whatever the current value is — read it first) to `"3.7.0"`.

In `README.md`, find the badge line `version-3.6.0-blue` and change to `version-3.7.0-blue`.

- [ ] **Step 14.2: Add CHANGELOG entry**

In `CHANGELOG.md`, prepend a new section at the top:

```markdown
## V3.7.0 — Claude Code quota tracking (opt-in)

- **New command** `petforge quota enable | disable | --json` — opt-in 5h/7d
  rate-limit gauge surfaced inside PetForge.
- **New flag** `petforge up --quota` — co-orchestrates a probe daemon alongside
  collect + serve. Single Ctrl+C kills all three.
- **New card** in the web view (`QUOTAS`) showing Session (5h), Weekly (7d) when
  on Max, burn rate, and reset countdown. Color-coded green/yellow/orange/red.
- **CLI card** gains a QUOTAS block in `petforge card` when opt-in.
- **Pet mood reactivity** — when session utilization ≥ 80%, the pet's mood
  flips to "stressed"; ≥ 95% or status `denied` → "panic". Falls back to the
  existing activity-derived mood when calm.
- **2 new achievement families** (6 entries total): `quota_efficient_*` (close
  5/20/100 consecutive 5h windows under 50% util) and `quota_marathon_*` (hit
  95%+ session util 1/10/50 times). 46 → 52 total achievements.
- **`petforge doctor`** now reports quota credentials + last-probe freshness.
- **No state schema bump.** `state.counters.quota?` is additive; V3.6 state
  files migrate transparently via `ensureQuotaCounters`.
- **JSONL-mtime gate** — when no `~/.claude/projects/**/conversation-*.jsonl`
  is touched for 10 min, the daemon skips its 5-min API call. Idle = zero cost.
- **Security:** opt-in only. OAuth token is read into a local variable, never
  logged, never persisted to state. The endpoint used
  (`POST /v1/messages` with `oauth-2025-04-20` beta header) is **undocumented**
  by Anthropic and may change without notice — opt-in is the contract.
```

- [ ] **Step 14.3: Add a Quota section to README**

In `README.md`, find the "Commands" table and add:

```markdown
| `petforge quota [enable\|disable\|--json]` | Show / configure Claude Code rate-limit tracking |
```

Find the existing "OpenTelemetry collector" section (or similar opt-in feature) and add a new sibling section:

````markdown
## Quota tracking (opt-in, V3.7)

PetForge can show your Claude Code 5h session and 7d weekly rate-limit usage
directly in the web view and CLI card — same data the "Claude Code Gauge"
extension family exposes, but without leaving PetForge.

```
petforge quota enable     # one-time opt-in (validates credentials)
petforge up --quota       # collect + serve + quota daemon
```

The probe runs every 5 minutes, **only** when a Claude Code JSONL has been
touched in the last 10 minutes. When you stop coding, PetForge stops calling
Anthropic. Each probe consumes ~9 input tokens of `claude-haiku-4-5`.

**Caveats:** the rate-limit response headers PetForge reads
(`anthropic-ratelimit-unified-*`) are not part of Anthropic's documented API.
This is an explicit opt-in for that reason. If Anthropic changes the shape,
PetForge will fail soft (the QUOTAS card shows "stale" + the reason) and
nothing else breaks.

To disable:

```
petforge quota disable
```

Existing quota achievements stay unlocked when disabled.
````

- [ ] **Step 14.4: Commit**

```
git add package.json README.md CHANGELOG.md
git commit -m "release: v3.7.0 — Claude Code quota tracking (opt-in)"
```

---

# Task 15 — Full test sweep + build

- [ ] **Step 15.1: Run full test suite**

```
npx vitest run
```

Expected: all tests pass. If anything fails, fix in place — do not bypass.

- [ ] **Step 15.2: Build**

```
npm run build
```

Expected: clean compile, no TypeScript errors.

- [ ] **Step 15.3: Biome lint**

```
npx biome check src tests
```

Fix any new violations.

- [ ] **Step 15.4: Manual end-to-end smoke**

```
node dist/index.js quota enable
node dist/index.js card
node dist/index.js up --quota
```

In a browser at `http://127.0.0.1:7878` verify the QUOTAS card appears.

```
node dist/index.js quota disable
```

Verify the QUOTAS card disappears from the web view (next SSE push).

- [ ] **Step 15.5: Final commit (if anything was fixed)**

If smoke testing revealed lint/build/test issues fixed in 15.1–15.3:

```
git add <whatever>
git commit -m "chore(quota): final V3.7 lint/test fixes from smoke pass"
```

Otherwise skip.

---

## Notes for the executing engineer

- The probe endpoint is **undocumented**. Do not normalise the response shape into something "prettier" than the headers provide. If Anthropic adds a new `anthropic-ratelimit-unified-*` header, add a field to `QuotaWindow` and bump `ProbeResult` — that's all.
- **Never** include the OAuth token in any error message, log line, or persisted state. The probe-error test guards this; do not delete it. If you add a new error path, add a parallel assertion.
- The 5-minute probe interval is set inside `runQuotaDaemon` and configurable via the `probeIntervalMs` option (used by tests with ~10ms). Do not lower the default — Anthropic's terms of service do not appreciate fast polling.
- Achievement evaluators are append-only. Do not renumber or change the IDs of `quota_efficient_*` / `quota_marathon_*` after release. If you want a 4th tier later, add `*_platinum`.
- The web view's QUOTAS card and the Ink QuotaBlock are intentionally simple — no sparkline, no history. That's V3.8.
