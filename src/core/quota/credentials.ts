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

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
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
