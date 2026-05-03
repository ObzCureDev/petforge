/**
 * `petforge serve [--port=N] [--lan] [--host=IP] [--token=XXX]`
 *
 * Starts a local HTTP server that:
 *  - serves a self-contained mobile-friendly HTML page at `/`
 *  - streams state updates via SSE at `/stream`
 *  - exposes the raw state JSON at `/state.json`
 *
 * The server watches `~/.petforge/state.json` and pushes on every change so
 * a phone or browser stays in sync within ~50ms of any hook event.
 *
 * Security:
 *  - Default binds to 127.0.0.1 (loopback only).
 *  - `--lan` exposes on 0.0.0.0 for same-Wi-Fi phone access.
 *  - `--host=IP` (with `--lan`) overrides the IP printed in the "Phone access"
 *    line. Useful when auto-detect picks the wrong interface (Hyper-V, Docker,
 *    Tailscale, VPN). Bind stays on 0.0.0.0; only the displayed URL changes.
 *  - Optional `--token=XXX` shared secret guards every endpoint.
 *  - Defense-in-depth headers (`X-Content-Type-Options: nosniff`,
 *    `Referrer-Policy: no-referrer`).
 *
 * Read-only by design — this server never mutates state.
 */

import { promises as fs, watch as fsWatch } from "node:fs";
import http from "node:http";
import os from "node:os";
import { STATE_FILE } from "../core/paths.js";
import type { State } from "../core/schema.js";
import { readState, StateCorruptError, StateNotFoundError } from "../core/state.js";
import {
  ICON_JPEG_BUFFER,
  ICON_JPEG_TYPE,
  ICON_PNG_BUFFER,
  ICON_PNG_TYPE,
  MANIFEST_JSON,
  renderPage,
} from "../render/web/page.js";

export interface ServeOptions {
  port?: number;
  lan?: boolean;
  token?: string;
  /**
   * Override the IP/hostname printed in the "Phone access" line and in the
   * returned `url`. Only meaningful with `lan: true`. Bind address is unchanged
   * (still 0.0.0.0). Use when `localIp()` picks a virtual interface that the
   * phone cannot reach, or when you want to advertise a specific path
   * (Tailscale, mDNS, custom DNS).
   */
  host?: string;
}

export interface ServeHandle {
  url: string;
  port: number;
  close: () => Promise<void>;
}

const DEFAULT_PORT = 7878;

export async function startServer(opts: ServeOptions = {}): Promise<ServeHandle> {
  const requestedPort = opts.port ?? DEFAULT_PORT;
  const host = opts.lan ? "0.0.0.0" : "127.0.0.1";
  const token = opts.token;

  const sseClients = new Set<http.ServerResponse>();

  // ---- timestamp-based debounce / broadcast ----
  let debounceTimer: NodeJS.Timeout | null = null;
  const broadcast = async (): Promise<void> => {
    try {
      const state = await readState();
      const data = `data: ${JSON.stringify(state)}\n\n`;
      for (const client of sseClients) {
        try {
          client.write(data);
        } catch {
          // dead client — close listener will remove it
        }
      }
    } catch {
      // state momentarily missing/corrupt during a hook write
    }
  };
  const scheduleBroadcast = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void broadcast();
    }, 50);
  };

  // ---- request handler ----
  const server = http.createServer((req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    // Optional bearer token — required for every endpoint when set.
    if (token) {
      const auth = req.headers.authorization;
      const queryToken = url.searchParams.get("token");
      const provided = auth?.startsWith("Bearer ") ? auth.slice(7) : queryToken;
      if (provided !== token) {
        res.writeHead(401, { "Content-Type": "text/plain" });
        res.end("Unauthorized");
        return;
      }
    }

    if (url.pathname === "/") {
      handleRoot(res).catch(() => {
        res.writeHead(500);
        res.end("server error");
      });
      return;
    }
    if (url.pathname === "/stream") {
      handleStream(res, sseClients).catch(() => {
        // SSE failures are silent — the client auto-reconnects.
      });
      return;
    }
    if (url.pathname === "/state.json") {
      handleStateJson(res).catch(() => {
        res.writeHead(500);
        res.end("server error");
      });
      return;
    }
    if (url.pathname === "/manifest.webmanifest" || url.pathname === "/manifest.json") {
      res.writeHead(200, {
        "Content-Type": "application/manifest+json; charset=utf-8",
        "Cache-Control": "no-cache",
      });
      res.end(MANIFEST_JSON);
      return;
    }
    if (
      url.pathname === "/icon-512.png" ||
      url.pathname === "/icon.png" ||
      url.pathname === "/apple-touch-icon.png"
    ) {
      res.writeHead(200, {
        "Content-Type": ICON_PNG_TYPE,
        "Cache-Control": "public, max-age=86400",
        "Content-Length": String(ICON_PNG_BUFFER.length),
      });
      res.end(ICON_PNG_BUFFER);
      return;
    }
    if (url.pathname === "/icon.jpg" || url.pathname === "/icon.jpeg") {
      res.writeHead(200, {
        "Content-Type": ICON_JPEG_TYPE,
        "Cache-Control": "public, max-age=86400",
        "Content-Length": String(ICON_JPEG_BUFFER.length),
      });
      res.end(ICON_JPEG_BUFFER);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  // ---- file watcher ----
  // fs.watch may not exist before state.json is created. We tolerate that
  // by polling for the file to appear, then attaching the watcher.
  let watcher: ReturnType<typeof fsWatch> | null = null;
  let pollInterval: NodeJS.Timeout | null = null;

  const attachWatcher = (): void => {
    try {
      watcher = fsWatch(STATE_FILE, { persistent: false }, () => {
        scheduleBroadcast();
      });
    } catch {
      // ignore — we'll keep polling
    }
  };

  try {
    await fs.access(STATE_FILE);
    attachWatcher();
  } catch {
    pollInterval = setInterval(async () => {
      try {
        await fs.access(STATE_FILE);
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
        attachWatcher();
        await broadcast();
      } catch {
        // still missing — keep polling
      }
    }, 1000);
    pollInterval.unref?.();
  }

  // ---- bind ----
  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => {
      server.removeListener("error", onError);
      reject(err);
    };
    server.once("error", onError);
    server.listen(requestedPort, host, () => {
      server.removeListener("error", onError);
      resolve();
    });
  });

  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : requestedPort;
  let displayHost: string;
  if (opts.host && host === "0.0.0.0") {
    displayHost = opts.host;
  } else if (host === "0.0.0.0") {
    displayHost = localIp() ?? "127.0.0.1";
  } else {
    displayHost = "127.0.0.1";
  }
  const url = `http://${displayHost}:${actualPort}`;

  return {
    url,
    port: actualPort,
    close: async () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      if (watcher) {
        try {
          watcher.close();
        } catch {
          // ignore
        }
      }
      for (const client of sseClients) {
        try {
          client.end();
        } catch {
          // ignore
        }
      }
      sseClients.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };

  // ---- handlers ----
  async function handleRoot(res: http.ServerResponse): Promise<void> {
    let state: State | null = null;
    try {
      state = await readState();
    } catch {
      state = null;
    }
    const html = renderPage(state);
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(html);
  }

  async function handleStateJson(res: http.ServerResponse): Promise<void> {
    try {
      const state = await readState();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(state));
    } catch (err) {
      if (err instanceof StateNotFoundError) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "no state yet" }));
        return;
      }
      if (err instanceof StateCorruptError) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "state corrupt" }));
        return;
      }
      res.writeHead(500);
      res.end();
    }
  }

  async function handleStream(
    res: http.ServerResponse,
    clients: Set<http.ServerResponse>,
  ): Promise<void> {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(":\n\n"); // initial comment to flush headers
    clients.add(res);

    // Send the current state immediately if available.
    try {
      const state = await readState();
      res.write(`data: ${JSON.stringify(state)}\n\n`);
    } catch {
      // none yet — client renders skeleton
    }

    // Heartbeat every 25s to keep proxies happy.
    const heartbeat = setInterval(() => {
      try {
        res.write(": heartbeat\n\n");
      } catch {
        // ignore
      }
    }, 25_000);
    heartbeat.unref?.();

    res.on("close", () => {
      clearInterval(heartbeat);
      clients.delete(res);
    });
  }
}

export async function serveCli(argv: string[]): Promise<number> {
  const opts = parseArgs(argv);
  if (!opts) {
    process.stderr.write("Usage: petforge serve [--port=N] [--lan] [--host=IP] [--token=XXX]\n");
    return 1;
  }
  try {
    const handle = await startServer(opts);
    process.stdout.write(`PetForge server listening on ${handle.url}\n`);
    if (opts.lan) {
      const lanIp = opts.host ?? localIp();
      if (lanIp) {
        process.stdout.write(`Phone access (same Wi-Fi): http://${lanIp}:${handle.port}\n`);
      }
    }
    if (opts.token) {
      process.stdout.write(`Token required (append ?token=${opts.token} or send Bearer header)\n`);
    }
    process.stdout.write("Press Ctrl+C to stop.\n");

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
      process.stderr.write(`Port ${opts.port ?? DEFAULT_PORT} already in use. Try --port=N.\n`);
      return 1;
    }
    process.stderr.write(`petforge serve failed: ${(err as Error).message}\n`);
    return 1;
  }
}

function parseArgs(argv: string[]): ServeOptions | null {
  const opts: ServeOptions = {};
  for (const a of argv) {
    if (a === "--lan") {
      opts.lan = true;
    } else if (a.startsWith("--port=")) {
      const n = Number.parseInt(a.slice("--port=".length), 10);
      if (Number.isNaN(n) || n < 0 || n > 65535) return null;
      opts.port = n;
    } else if (a.startsWith("--token=")) {
      const t = a.slice("--token=".length);
      if (t.length === 0) return null;
      opts.token = t;
    } else if (a.startsWith("--host=")) {
      const h = a.slice("--host=".length);
      if (!isValidHost(h)) return null;
      opts.host = h;
    } else if (a === "--help" || a === "-h") {
      return null;
    } else {
      return null;
    }
  }
  // --host only makes sense with --lan: it overrides the displayed LAN IP.
  if (opts.host && !opts.lan) return null;
  return opts;
}

// Allow IPv4, hostnames, and bracketed IPv6 ([::1]). Reject empty, whitespace,
// protocol prefixes, and anything that would break URL composition.
function isValidHost(h: string): boolean {
  if (h.length === 0 || h.length > 255) return false;
  if (/\s/.test(h)) return false;
  if (h.includes("/")) return false;
  return /^[a-zA-Z0-9.\-:[\]]+$/.test(h);
}

function localIp(): string | null {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}
