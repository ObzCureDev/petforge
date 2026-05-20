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
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      execImpl: exec as any,
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
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      execImpl: exec as any,
    });
    expect(tok.kind).toBe("missing");
  });
});
