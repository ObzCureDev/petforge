/**
 * `petforge up [--lan] [--port=N] [--collect-port=N] [--token=XXX] [--forward=URL]`
 *
 * One-shot launcher: starts both the OTel collector and the web view in the
 * same process, with prefixed output and a single Ctrl+C shutdown.
 *
 *   --port=N           web view port (default 7878)
 *   --collect-port=N   OTel collector port (default 7879)
 *   --lan              expose web view on 0.0.0.0 (collector stays loopback)
 *   --token=XXX        bearer token for web view
 *   --forward=URL      fan-out OTel to a downstream endpoint
 *
 * Security: collector is ALWAYS bound to 127.0.0.1. Only the web view
 * honours `--lan` since the OTel payload contains prompts/file paths.
 */

import os from "node:os";
import { startCollector } from "./collect.js";
import { startServer } from "./serve.js";

interface UpOptions {
  port?: number;
  collectPort?: number;
  lan?: boolean;
  token?: string;
  forward?: string;
}

export async function upCli(argv: string[]): Promise<number> {
  const opts = parseArgs(argv);
  if (!opts) {
    process.stderr.write(
      "Usage: petforge up [--port=N] [--collect-port=N] [--lan] [--token=XXX] [--forward=URL]\n",
    );
    return 1;
  }

  process.stdout.write("[up]      starting collector + web view...\n");

  // 1. Collector first — if Claude Code is already pushing, we want to be ready.
  let collector: { url: string; close: () => Promise<void> };
  try {
    collector = await startCollector({
      port: opts.collectPort,
      forward: opts.forward,
    });
    process.stdout.write(`[collect] listening on ${collector.url}\n`);
    if (opts.forward) {
      process.stdout.write(`[collect] forwarding to ${opts.forward}\n`);
    }
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "EADDRINUSE") {
      process.stderr.write(
        `[collect] port ${opts.collectPort ?? 7879} already in use. Try --collect-port=N.\n`,
      );
    } else {
      process.stderr.write(`[collect] failed to start: ${(err as Error).message}\n`);
    }
    return 1;
  }

  // 2. Web view — close collector if this fails.
  let server: { url: string; port: number; close: () => Promise<void> };
  try {
    server = await startServer({
      port: opts.port,
      lan: opts.lan,
      token: opts.token,
    });
    process.stdout.write(`[serve]   listening on ${server.url}\n`);
    if (opts.lan) {
      const lan = lanIp();
      if (lan) {
        process.stdout.write(`[serve]   phone access (same Wi-Fi): http://${lan}:${server.port}\n`);
      }
    }
    if (opts.token) {
      process.stdout.write(
        `[serve]   token required (append ?token=${opts.token} or send Bearer header)\n`,
      );
    }
  } catch (err) {
    await collector.close();
    const e = err as NodeJS.ErrnoException;
    if (e.code === "EADDRINUSE") {
      process.stderr.write(`[serve] port ${opts.port ?? 7878} already in use. Try --port=N.\n`);
    } else {
      process.stderr.write(`[serve] failed to start: ${(err as Error).message}\n`);
    }
    return 1;
  }

  process.stdout.write("[up]      Ctrl+C to stop both.\n");

  await new Promise<void>((resolve) => {
    let stopping = false;
    const shutdown = (): void => {
      if (stopping) return;
      stopping = true;
      process.stdout.write("\n[up]      shutting down...\n");
      Promise.allSettled([server.close(), collector.close()]).finally(() => resolve());
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });

  process.stdout.write("[up]      stopped.\n");
  return 0;
}

function parseArgs(argv: string[]): UpOptions | null {
  const opts: UpOptions = {};
  for (const a of argv) {
    if (a === "--lan") {
      opts.lan = true;
    } else if (a.startsWith("--port=")) {
      const n = Number.parseInt(a.slice("--port=".length), 10);
      if (Number.isNaN(n) || n < 0 || n > 65535) return null;
      opts.port = n;
    } else if (a.startsWith("--collect-port=")) {
      const n = Number.parseInt(a.slice("--collect-port=".length), 10);
      if (Number.isNaN(n) || n < 0 || n > 65535) return null;
      opts.collectPort = n;
    } else if (a.startsWith("--token=")) {
      const t = a.slice("--token=".length);
      if (t.length === 0) return null;
      opts.token = t;
    } else if (a.startsWith("--forward=")) {
      const f = a.slice("--forward=".length);
      if (f.length === 0) return null;
      opts.forward = f;
    } else if (a === "--help" || a === "-h") {
      return null;
    } else {
      return null;
    }
  }
  return opts;
}

function lanIp(): string | null {
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
