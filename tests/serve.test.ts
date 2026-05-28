/**
 * Tests for `petforge serve`.
 *
 * Each test runs against a fresh temp PETFORGE_HOME and an ephemeral port
 * (`port: 0`). We re-import modules with `vi.resetModules()` so `paths.ts`
 * recomputes against the test home (mirrors the rest of the test suite).
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let testHome: string;
let prevHome: string | undefined;

beforeEach(async () => {
  prevHome = process.env.PETFORGE_HOME;
  testHome = await fs.mkdtemp(path.join(os.tmpdir(), "petforge-serve-"));
  process.env.PETFORGE_HOME = testHome;
  vi.resetModules();
});

afterEach(async () => {
  if (prevHome === undefined) {
    delete process.env.PETFORGE_HOME;
  } else {
    process.env.PETFORGE_HOME = prevHome;
  }
  try {
    await fs.rm(testHome, { recursive: true, force: true });
  } catch {
    /* noop */
  }
});

async function loadServe() {
  const serve = await import("../src/commands/serve.js");
  return serve;
}

async function seedState() {
  const { runHook } = await import("../src/commands/hook.js");
  await runHook("session_start", { session_id: "s1" }, Date.now());
}

describe("petforge serve", () => {
  it("GET / returns HTML even when no state exists", async () => {
    const { startServer } = await loadServe();
    const handle = await startServer({ spendRefreshMs: 0, port: 0 });
    try {
      const res = await fetch(`${handle.url}/`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/text\/html/);
      const body = await res.text();
      expect(body).toContain("<!doctype html>");
      expect(body).toContain("PetForge");
      expect(body).toContain("EventSource");
    } finally {
      await handle.close();
    }
  });

  it("GET / embeds the current state when present", async () => {
    await seedState();
    const { startServer } = await loadServe();
    const handle = await startServer({ spendRefreshMs: 0, port: 0 });
    try {
      const res = await fetch(`${handle.url}/`);
      expect(res.status).toBe(200);
      const body = await res.text();
      // initial-state script tag should contain a JSON object, not "null".
      const match = body.match(/<script id="initial-state"[^>]*>([^<]+)<\/script>/);
      expect(match).not.toBeNull();
      expect(match?.[1]).not.toBe("null");
      // The schemaVersion field should be embedded.
      expect(match?.[1]).toContain('"schemaVersion"');
    } finally {
      await handle.close();
    }
  });

  it("GET /state.json returns the state when present", async () => {
    await seedState();
    const { startServer } = await loadServe();
    const handle = await startServer({ spendRefreshMs: 0, port: 0 });
    try {
      const res = await fetch(`${handle.url}/state.json`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { schemaVersion: number; pet: { species: string } };
      expect(body.schemaVersion).toBe(2);
      expect(body.pet.species).toBeTypeOf("string");
    } finally {
      await handle.close();
    }
  });

  it("GET /state.json returns 404 when state missing", async () => {
    const { startServer } = await loadServe();
    const handle = await startServer({ spendRefreshMs: 0, port: 0 });
    try {
      const res = await fetch(`${handle.url}/state.json`);
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("no state yet");
    } finally {
      await handle.close();
    }
  });

  it("returns 404 for unknown paths", async () => {
    const { startServer } = await loadServe();
    const handle = await startServer({ spendRefreshMs: 0, port: 0 });
    try {
      const res = await fetch(`${handle.url}/nope`);
      expect(res.status).toBe(404);
    } finally {
      await handle.close();
    }
  });

  it("sets defense-in-depth headers", async () => {
    await seedState();
    const { startServer } = await loadServe();
    const handle = await startServer({ spendRefreshMs: 0, port: 0 });
    try {
      const res = await fetch(`${handle.url}/`);
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    } finally {
      await handle.close();
    }
  });

  it("token guard rejects requests without the token", async () => {
    await seedState();
    const { startServer } = await loadServe();
    const handle = await startServer({ spendRefreshMs: 0, port: 0, token: "secret" });
    try {
      const noAuth = await fetch(`${handle.url}/state.json`);
      expect(noAuth.status).toBe(401);
      const wrongAuth = await fetch(`${handle.url}/state.json?token=wrong`);
      expect(wrongAuth.status).toBe(401);
    } finally {
      await handle.close();
    }
  });

  it("token guard accepts ?token= query param", async () => {
    await seedState();
    const { startServer } = await loadServe();
    const handle = await startServer({ spendRefreshMs: 0, port: 0, token: "secret" });
    try {
      const ok = await fetch(`${handle.url}/state.json?token=secret`);
      expect(ok.status).toBe(200);
    } finally {
      await handle.close();
    }
  });

  it("token guard accepts Bearer Authorization header", async () => {
    await seedState();
    const { startServer } = await loadServe();
    const handle = await startServer({ spendRefreshMs: 0, port: 0, token: "secret" });
    try {
      const ok = await fetch(`${handle.url}/state.json`, {
        headers: { Authorization: "Bearer secret" },
      });
      expect(ok.status).toBe(200);
    } finally {
      await handle.close();
    }
  });

  it("/stream emits an SSE event-stream response with initial data", async () => {
    await seedState();
    const { startServer } = await loadServe();
    const handle = await startServer({ spendRefreshMs: 0, port: 0 });
    try {
      const res = await fetch(`${handle.url}/stream`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
      const reader = res.body?.getReader();
      if (!reader) throw new Error("no body");
      // Read enough bytes to capture the initial-state push.
      const decoder = new TextDecoder();
      let text = "";
      for (let i = 0; i < 5 && !text.includes("data:"); i++) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
      expect(text).toContain("data:");
      await reader.cancel();
    } finally {
      await handle.close();
    }
  });

  it("/stream pushes a new event when state.json changes", async () => {
    await seedState();
    const { startServer } = await loadServe();
    const handle = await startServer({ spendRefreshMs: 0, port: 0 });
    try {
      const res = await fetch(`${handle.url}/stream`);
      const reader = res.body?.getReader();
      if (!reader) throw new Error("no body");
      const decoder = new TextDecoder();

      // Drain the initial push first.
      let buf = "";
      while (!buf.includes("data:")) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
      }
      const initialChunk = buf;

      // Trigger a state mutation that changes the JSON: another hook event.
      const { runHook } = await import("../src/commands/hook.js");
      await runHook("prompt", { session_id: "s1" }, Date.now());

      // Wait for the push to arrive.
      let pushBuf = "";
      const start = Date.now();
      while (Date.now() - start < 3000) {
        const { value, done } = await reader.read();
        if (done) break;
        pushBuf += decoder.decode(value, { stream: true });
        if (pushBuf.includes("data:")) break;
      }
      expect(pushBuf.length).toBeGreaterThan(0);
      // The push payload should reflect the prompt increment.
      expect(initialChunk + pushBuf).toContain('"promptsTotal":1');

      await reader.cancel();
    } finally {
      await handle.close();
    }
  }, 10_000);

  it("close() shuts down cleanly without hanging", async () => {
    const { startServer } = await loadServe();
    const handle = await startServer({ spendRefreshMs: 0, port: 0 });
    await handle.close();
    // If close did not hang, this assertion is reached.
    expect(true).toBe(true);
  });

  it("startServer returns a usable port and url", async () => {
    const { startServer } = await loadServe();
    const handle = await startServer({ spendRefreshMs: 0, port: 0 });
    try {
      expect(handle.port).toBeGreaterThan(0);
      expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    } finally {
      await handle.close();
    }
  });

  it("--host override shapes the displayed URL when --lan is set", async () => {
    const { startServer } = await loadServe();
    const handle = await startServer({
      spendRefreshMs: 0,
      port: 0,
      lan: true,
      host: "10.20.30.40",
    });
    try {
      // Bind is still 0.0.0.0, but the printed URL should reflect the override.
      expect(handle.url).toBe(`http://10.20.30.40:${handle.port}`);
      // And the server is still reachable locally on the actual port.
      const res = await fetch(`http://127.0.0.1:${handle.port}/`);
      expect(res.status).toBe(200);
    } finally {
      await handle.close();
    }
  });

  it("--host is ignored when --lan is not set (loopback-only mode)", async () => {
    const { startServer } = await loadServe();
    // Caller passes host without lan: bind stays loopback, displayed URL stays
    // 127.0.0.1 because there's no LAN exposure to advertise.
    const handle = await startServer({ spendRefreshMs: 0, port: 0, host: "10.20.30.40" });
    try {
      expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    } finally {
      await handle.close();
    }
  });
});

describe("petforge serve - spend injection", () => {
  const stubSnapshot = {
    lifetimeCents: 2_451_687,
    lifetimeApiCents: 15_240_251,
    todayCents: 38_838,
    todayApiCents: 120_000,
    todayKey: "2026-05-29",
    lifetimeMessages: 61_151,
    todayMessages: 42,
    oldestTs: 1,
    newestTs: 2,
    lastScanTs: 1_700_000_000_000,
    scanMs: 5,
  };

  it("/spend returns 503 until the first scan completes", async () => {
    const { startServer } = await loadServe();
    // A scan that never resolves keeps the cache empty.
    const handle = await startServer({
      port: 0,
      computeSpendImpl: () => new Promise(() => {}),
    });
    try {
      const res = await fetch(`${handle.url}/spend`);
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("spend not computed yet");
    } finally {
      await handle.close();
    }
  });

  it("/spend serves the cached snapshot once computed", async () => {
    const { startServer } = await loadServe();
    const handle = await startServer({
      port: 0,
      computeSpendImpl: async () => stubSnapshot,
    });
    try {
      // Poll briefly for the background scan to populate the cache.
      let body: typeof stubSnapshot | null = null;
      for (let i = 0; i < 20 && !body; i++) {
        const res = await fetch(`${handle.url}/spend`);
        if (res.status === 200) {
          body = (await res.json()) as typeof stubSnapshot;
          break;
        }
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(body).not.toBeNull();
      expect(body?.lifetimeCents).toBe(2_451_687);
      expect(body?.todayCents).toBe(38_838);
      expect(body?.todayKey).toBe("2026-05-29");
    } finally {
      await handle.close();
    }
  });

  it("injects spend into the embedded state on GET /", async () => {
    await seedState();
    const { startServer } = await loadServe();
    const handle = await startServer({
      port: 0,
      computeSpendImpl: async () => stubSnapshot,
    });
    try {
      let body = "";
      for (let i = 0; i < 20; i++) {
        const res = await fetch(`${handle.url}/`);
        body = await res.text();
        const m = body.match(/<script id="initial-state"[^>]*>([^<]+)<\/script>/);
        if (m?.[1]?.includes('"spend"')) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      const match = body.match(/<script id="initial-state"[^>]*>([^<]+)<\/script>/);
      expect(match?.[1]).toContain('"spend"');
      expect(match?.[1]).toContain('"lifetimeCents"');
    } finally {
      await handle.close();
    }
  });
});
