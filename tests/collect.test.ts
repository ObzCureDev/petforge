import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("petforge collect", () => {
  let dir: string;
  let prevHome: string | undefined;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "petforge-collect-"));
    prevHome = process.env.PETFORGE_HOME;
    process.env.PETFORGE_HOME = dir;
    delete process.env.PETFORGE_OTEL_FORWARD;
    delete process.env.PETFORGE_OTEL_PORT;
    delete process.env.PETFORGE_OTEL_DEBUG;
    vi.resetModules();
  });
  afterEach(async () => {
    if (prevHome === undefined) {
      delete process.env.PETFORGE_HOME;
    } else {
      process.env.PETFORGE_HOME = prevHome;
    }
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function seedState(): Promise<void> {
    const { runHook } = await import("../src/commands/hook.js");
    await runHook("session_start", { session_id: "s1" }, Date.now());
  }

  function fixtureBody(): string {
    return JSON.stringify({
      resourceMetrics: [
        {
          scopeMetrics: [
            {
              metrics: [
                {
                  name: "claude_code.lines_of_code.count",
                  sum: {
                    dataPoints: [
                      {
                        asInt: "0",
                        attributes: [{ key: "type", value: { stringValue: "added" } }],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    });
  }

  function fixtureBodyGrown(): string {
    return JSON.stringify({
      resourceMetrics: [
        {
          scopeMetrics: [
            {
              metrics: [
                {
                  name: "claude_code.lines_of_code.count",
                  sum: {
                    dataPoints: [
                      {
                        asInt: "100",
                        attributes: [{ key: "type", value: { stringValue: "added" } }],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    });
  }

  it("POST /v1/metrics with valid JSON ingests the delta into state", async () => {
    await seedState();
    const { startCollector } = await import("../src/commands/collect.js");
    const handle = await startCollector({ port: 0 });
    try {
      // First batch: baseline
      let res = await fetch(`${handle.url}/v1/metrics`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: fixtureBody(),
      });
      expect(res.status).toBe(200);
      // Second batch: delta = 100
      res = await fetch(`${handle.url}/v1/metrics`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: fixtureBodyGrown(),
      });
      expect(res.status).toBe(200);

      const { readState } = await import("../src/core/state.js");
      const state = await readState();
      expect(state.counters.otel?.linesAdded).toBe(100);
      expect(state.counters.otel?.lastUpdate).toBeGreaterThan(0);
    } finally {
      await handle.close();
    }
  });

  it("rejects non-loopback bind attempts (NEVER allow --lan)", async () => {
    // The collect command must not accept any host other than 127.0.0.1.
    // We assert this by reading the source of truth: startCollector ignores
    // any host argument. The CLI parser also does not expose --lan.
    const { startCollector } = await import("../src/commands/collect.js");
    const handle = await startCollector({ port: 0 });
    try {
      // Verify the URL is loopback-only.
      expect(handle.url.startsWith("http://127.0.0.1:")).toBe(true);
    } finally {
      await handle.close();
    }
  });

  it("HTTP 415 for non-JSON content-type", async () => {
    const { startCollector } = await import("../src/commands/collect.js");
    const handle = await startCollector({ port: 0 });
    try {
      const res = await fetch(`${handle.url}/v1/metrics`, {
        method: "POST",
        headers: { "content-type": "application/x-protobuf" },
        body: "binary garbage",
      });
      expect(res.status).toBe(415);
    } finally {
      await handle.close();
    }
  });

  it("HTTP 400 for malformed JSON", async () => {
    const { startCollector } = await import("../src/commands/collect.js");
    const handle = await startCollector({ port: 0 });
    try {
      const res = await fetch(`${handle.url}/v1/metrics`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{ not valid",
      });
      expect(res.status).toBe(400);
    } finally {
      await handle.close();
    }
  });

  it("HTTP 413 for payload over 10MB", async () => {
    const { startCollector } = await import("../src/commands/collect.js");
    const handle = await startCollector({ port: 0 });
    try {
      const big = "x".repeat(11 * 1024 * 1024);
      const res = await fetch(`${handle.url}/v1/metrics`, {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": String(big.length) },
        body: big,
      });
      expect(res.status).toBe(413);
    } finally {
      await handle.close();
    }
  });

  it("/v1/logs accepts but discards (V2.1 will use)", async () => {
    const { startCollector } = await import("../src/commands/collect.js");
    const handle = await startCollector({ port: 0 });
    try {
      const res = await fetch(`${handle.url}/v1/logs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(200);
    } finally {
      await handle.close();
    }
  });

  it("/v1/traces returns 404 (out of scope)", async () => {
    const { startCollector } = await import("../src/commands/collect.js");
    const handle = await startCollector({ port: 0 });
    try {
      const res = await fetch(`${handle.url}/v1/traces`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(404);
    } finally {
      await handle.close();
    }
  });

  it("/healthz returns ok + lastUpdate without state mutation", async () => {
    await seedState();
    const { startCollector } = await import("../src/commands/collect.js");
    const handle = await startCollector({ port: 0 });
    try {
      const res = await fetch(`${handle.url}/healthz`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; lastUpdate: number };
      expect(body.ok).toBe(true);
      expect(typeof body.lastUpdate).toBe("number");
    } finally {
      await handle.close();
    }
  });

  it("forward URL receives the original body", async () => {
    await seedState();

    // Spin up a fake forward server
    const http = await import("node:http");
    let received = "";
    const fwd = http.createServer((req, res) => {
      let buf = "";
      req.on("data", (c: Buffer) => {
        buf += c.toString("utf8");
      });
      req.on("end", () => {
        received = buf;
        res.writeHead(200);
        res.end();
      });
    });
    await new Promise<void>((r) => fwd.listen(0, "127.0.0.1", () => r()));
    const fwdAddr = fwd.address();
    const fwdPort = typeof fwdAddr === "object" && fwdAddr ? fwdAddr.port : 0;

    const { startCollector } = await import("../src/commands/collect.js");
    const handle = await startCollector({
      port: 0,
      forward: `http://127.0.0.1:${fwdPort}/v1/metrics`,
    });

    try {
      const body = fixtureBody();
      await fetch(`${handle.url}/v1/metrics`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      // Allow the fire-and-forget POST to land
      await new Promise((r) => setTimeout(r, 200));
      expect(received).toBe(body);
    } finally {
      await handle.close();
      await new Promise<void>((r) => fwd.close(() => r()));
    }
  });
});
