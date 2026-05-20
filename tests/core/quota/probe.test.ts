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
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      captured.url = typeof url === "string" ? url : url.toString();
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
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const result = await probe("sk-test", { fetchImpl, timeoutMs: 10 });
    expect(result.kind).toBe("network-error");
  });
});
