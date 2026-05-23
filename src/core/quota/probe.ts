/**
 * Single-shot probe of api.anthropic.com to provoke rate-limit response
 * headers. The response body is intentionally discarded - only headers
 * carry the data we want.
 *
 * Spec §"Probe contract". Token is passed in, never read from disk here.
 */

import type { QuotaWindow } from "./schema.js";

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const PROBE_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_TIMEOUT_MS = 10_000;

export type ProbeResult =
  | {
      kind: "ok";
      session5h: QuotaWindow;
      weekly7d: QuotaWindow | null;
      /** V3.7.2 - Max plan + Opus usage only. Null otherwise. */
      opus7d: QuotaWindow | null;
      status: string;
    }
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
    // from fetch/abort - by construction it does not contain the token, but we
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

  // 200 / 4xx-non-auth / other 2xx - try to extract headers. If a required
  // header is missing, treat as server-error (Anthropic shipped a shape we
  // don't understand).
  const u5 = response.headers.get("anthropic-ratelimit-unified-5h-utilization");
  const r5 = response.headers.get("anthropic-ratelimit-unified-5h-reset");
  const s5 = response.headers.get("anthropic-ratelimit-unified-5h-status");
  if (u5 === null || r5 === null) {
    return { kind: "server-error", httpStatus: response.status };
  }

  // Anthropic returns utilization as a ratio in [0, 1] (e.g. "0.07" for 7%).
  // We normalize to a percentage 0-100 here so the rest of the codebase
  // (mood thresholds, rendering, achievements) consumes a single, intuitive
  // unit. Multiplied at the boundary, never re-normalized downstream.
  const session5h: QuotaWindow = {
    utilization: Math.round(Number.parseFloat(u5) * 10000) / 100,
    resetTs: Number.parseInt(r5, 10),
  };

  const u7 = response.headers.get("anthropic-ratelimit-unified-7d-utilization");
  const r7 = response.headers.get("anthropic-ratelimit-unified-7d-reset");
  const weekly7d: QuotaWindow | null =
    u7 !== null && r7 !== null
      ? { utilization: Math.round(Number.parseFloat(u7) * 10000) / 100, resetTs: Number.parseInt(r7, 10) }
      : null;

  // V3.7.2 - Opus-specific weekly window. Anthropic exposes this on Max
  // plans when Opus has been used in the rolling window. Headers may
  // disappear if no Opus usage yet - we keep the field null in that case.
  const u7o = response.headers.get("anthropic-ratelimit-unified-7d-opus-utilization");
  const r7o = response.headers.get("anthropic-ratelimit-unified-7d-opus-reset");
  const opus7d: QuotaWindow | null =
    u7o !== null && r7o !== null
      ? { utilization: Math.round(Number.parseFloat(u7o) * 10000) / 100, resetTs: Number.parseInt(r7o, 10) }
      : null;

  return { kind: "ok", session5h, weekly7d, opus7d, status: s5 ?? "" };
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
