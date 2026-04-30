/**
 * `petforge collect` — long-running OTLP/HTTP/JSON collector.
 *
 * Listens on 127.0.0.1:<port> (default 7879). Strict loopback bind —
 * NO `--lan` flag (see spec §11). Payloads contain prompts/paths/cost.
 *
 * Routes:
 *   POST /v1/metrics  -> ingest claude_code.* metrics
 *   POST /v1/logs     -> 200 OK (discard, V2.1 will consume)
 *   POST /v1/traces   -> 404 (out of scope)
 *   GET  /healthz     -> { ok: true, lastUpdate }
 */

import http from "node:http";
import { checkOtelAchievements } from "../core/otel/achievements.js";
import { Aggregator } from "../core/otel/aggregate.js";
import { extractClaudeMetrics } from "../core/otel/parse.js";
import { createInitialOtelCounters } from "../core/otel/schema.js";
import type { OtlpExportMetricsRequest } from "../core/otel/types.js";
import { generatePet } from "../core/pet-engine.js";
import { recoverCorruptState, withStateLock } from "../core/state.js";

export interface CollectOptions {
  port?: number;
  forward?: string;
}

export interface CollectorHandle {
  url: string;
  close: () => Promise<void>;
}

const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024;

export async function startCollector(opts: CollectOptions = {}): Promise<CollectorHandle> {
  const port = opts.port ?? Number.parseInt(process.env.PETFORGE_OTEL_PORT ?? "7879", 10);
  const forward = opts.forward ?? process.env.PETFORGE_OTEL_FORWARD;
  const debug = process.env.PETFORGE_OTEL_DEBUG === "1";

  const aggregator = new Aggregator();

  const server = http.createServer((req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");

    if (req.method === "GET" && req.url === "/healthz") {
      handleHealth(res).catch(() => {
        if (!res.headersSent) {
          res.writeHead(500);
          res.end();
        }
      });
      return;
    }

    if (req.method === "POST" && req.url === "/v1/traces") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "traces not supported" }));
      return;
    }

    if (req.method === "POST" && req.url === "/v1/logs") {
      // Read and discard body to drain the socket cleanly.
      readBody(req, MAX_PAYLOAD_BYTES)
        .then(() => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end("{}");
        })
        .catch((err: Error & { code?: string }) => {
          if (err.code === "PAYLOAD_TOO_LARGE") {
            res.writeHead(413);
            res.end();
          } else {
            res.writeHead(400);
            res.end();
          }
        });
      return;
    }

    if (req.method === "POST" && req.url === "/v1/metrics") {
      handleMetrics(req, res, aggregator, forward, debug).catch((err) => {
        if (debug)
          process.stderr.write(
            `[petforge collect] metrics handler error: ${(err as Error).message}\n`,
          );
        if (!res.headersSent) {
          res.writeHead(500);
          res.end();
        }
      });
      return;
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    // Strict loopback bind — never accept LAN.
    server.listen(port, "127.0.0.1", () => resolve());
  });

  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : port;
  const url = `http://127.0.0.1:${actualPort}`;

  return {
    url,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function handleHealth(res: http.ServerResponse): Promise<void> {
  let lastUpdate = 0;
  try {
    const { readState } = await import("../core/state.js");
    const state = await readState();
    lastUpdate = state.counters.otel?.lastUpdate ?? 0;
  } catch {
    // no state yet
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, lastUpdate }));
}

async function handleMetrics(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  aggregator: Aggregator,
  forward: string | undefined,
  debug: boolean,
): Promise<void> {
  const contentType = (req.headers["content-type"] ?? "").toLowerCase();
  if (!contentType.includes("application/json")) {
    res.writeHead(415, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: "Only application/json supported. Set OTEL_EXPORTER_OTLP_PROTOCOL=http/json.",
      }),
    );
    return;
  }

  // Fast-reject when content-length advertises an oversized payload.
  const contentLength = Number.parseInt(req.headers["content-length"] ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_PAYLOAD_BYTES) {
    res.writeHead(413);
    res.end();
    return;
  }

  let body: string;
  try {
    body = await readBody(req, MAX_PAYLOAD_BYTES);
  } catch (err) {
    if ((err as { code?: string }).code === "PAYLOAD_TOO_LARGE") {
      if (!res.headersSent) {
        res.writeHead(413);
        res.end();
      }
      return;
    }
    if (!res.headersSent) {
      res.writeHead(400);
      res.end();
    }
    return;
  }

  let parsed: OtlpExportMetricsRequest;
  try {
    parsed = JSON.parse(body) as OtlpExportMetricsRequest;
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }

  const items = extractClaudeMetrics(parsed);

  if (debug) {
    process.stderr.write(
      `[petforge collect] received ${items.length} claude_code data points (body=${body.length}B)\n`,
    );
  }

  // Persist via withStateLock — same locking infrastructure as hooks.
  await withStateLock(
    (state) => {
      if (!state.counters.otel) state.counters.otel = createInitialOtelCounters();
      aggregator.applyMetrics(state.counters.otel, items);
      const newly = checkOtelAchievements(state);
      if (debug && newly.length > 0) {
        process.stderr.write(`[petforge collect] unlocked: ${newly.join(", ")}\n`);
      }
    },
    { onMissingOrCorrupt: () => recoverCorruptState(generatePet) },
  );

  // Fan-out — fire and forget, 1s timeout.
  if (forward) {
    void forwardBody(forward, body, debug);
  }

  res.writeHead(200, { "content-type": "application/json" });
  res.end("{}");
}

function readBody(req: http.IncomingMessage, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > max) {
        const err = new Error("payload too large") as Error & { code: string };
        err.code = "PAYLOAD_TOO_LARGE";
        req.destroy();
        reject(err);
        return;
      }
      buf += chunk.toString("utf8");
    });
    req.on("end", () => resolve(buf));
    req.on("error", reject);
  });
}

async function forwardBody(url: string, body: string, debug: boolean): Promise<void> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1000);
    try {
      await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    if (debug) {
      process.stderr.write(
        `[petforge collect] forward to ${url} failed: ${(err as Error).message}\n`,
      );
    }
  }
}

export async function collectCli(argv: string[]): Promise<number> {
  const opts = parseArgs(argv);
  if (!opts) {
    process.stderr.write(
      "Usage: petforge collect [--port=7879] [--forward=URL]\n" +
        "  Strict loopback bind. Run in foreground; Ctrl+C to stop.\n",
    );
    return 1;
  }
  try {
    const handle = await startCollector(opts);
    process.stderr.write(`petforge collector listening on ${handle.url}\n`);
    if (opts.forward) {
      process.stderr.write(
        `forwarding raw bodies to ${opts.forward} (1s timeout, fire-and-forget)\n`,
      );
    }
    process.stderr.write("Press Ctrl+C to stop.\n");

    await new Promise<void>((resolve) => {
      const shutdown = (): void => {
        handle.close().finally(() => resolve());
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    });
    return 0;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "EADDRINUSE") {
      process.stderr.write(`Port ${opts.port ?? 7879} already in use. Try --port=N.\n`);
      return 1;
    }
    process.stderr.write(`petforge collect failed: ${(err as Error).message}\n`);
    return 1;
  }
}

function parseArgs(argv: string[]): CollectOptions | null {
  const opts: CollectOptions = {};
  for (const a of argv) {
    if (a === "--help" || a === "-h") return null;
    if (a.startsWith("--port=")) {
      const n = Number.parseInt(a.slice(7), 10);
      if (!Number.isFinite(n) || n < 0 || n > 65535) return null;
      opts.port = n;
    } else if (a.startsWith("--forward=")) {
      opts.forward = a.slice(10);
    } else {
      return null;
    }
  }
  return opts;
}
