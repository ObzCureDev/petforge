/**
 * Tests for src/commands/init.ts (the `petforge init` command).
 *
 * All tests use a temp settingsPath; the user's real ~/.claude/settings.json
 * is never touched. Tests pass `yes: true` so no interactive prompt fires.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runInit } from "../src/commands/init.js";

let tmpDir: string;
let settingsPath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "petforge-init-"));
  settingsPath = path.join(tmpDir, "settings.json");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("runInit", () => {
  it("installs hooks when settings file is missing (--yes)", async () => {
    const result = await runInit({ yes: true, settingsPath });
    expect(result.status).toBe("ok-installed");
    expect(result.backupPath).toBeNull();
    const written = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    expect(written.hooks?.UserPromptSubmit).toBeDefined();
    expect(written.hooks?.UserPromptSubmit?.[0]?.hooks?.[0]?.command).toBe(
      "petforge hook --event prompt",
    );
  });

  it("creates parent directory when missing", async () => {
    const nested = path.join(tmpDir, "deep", "nested", "settings.json");
    const result = await runInit({ yes: true, settingsPath: nested });
    expect(result.status).toBe("ok-installed");
    const written = JSON.parse(await fs.readFile(nested, "utf8"));
    expect(written.hooks).toBeDefined();
  });

  it("is idempotent — second run reports already-configured", async () => {
    await runInit({ yes: true, settingsPath });
    const result = await runInit({ yes: true, settingsPath });
    expect(result.status).toBe("ok-already-configured");
  });

  it("updates outdated hooks (--yes auto-confirms)", async () => {
    const stale = {
      hooks: {
        UserPromptSubmit: [
          {
            matcher: "*",
            hooks: [{ type: "command", command: "petforge hook --event prompt", timeout: 999 }],
          },
        ],
      },
    };
    await fs.writeFile(settingsPath, JSON.stringify(stale, null, 2));
    const result = await runInit({ yes: true, settingsPath });
    expect(result.status).toBe("ok-updated");
    const written = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    const entries = (written.hooks?.UserPromptSubmit ?? []).flatMap(
      (g: { hooks: { command: string; timeout?: number }[] }) => g.hooks,
    );
    const petforgeEntries = entries.filter((e: { command: string }) =>
      e.command.startsWith("petforge hook"),
    );
    expect(petforgeEntries).toHaveLength(1);
    expect(petforgeEntries[0].timeout).toBe(1);
  });

  it("refuses to overwrite invalid JSON", async () => {
    await fs.writeFile(settingsPath, "{ this is broken");
    const result = await runInit({ yes: true, settingsPath });
    expect(result.status).toBe("error-invalid-json");
    expect(result.message).toContain("Invalid JSON");
    // File untouched
    const after = await fs.readFile(settingsPath, "utf8");
    expect(after).toBe("{ this is broken");
    // No backup created
    const backupExists = await fs
      .access(`${settingsPath}.bak`)
      .then(() => true)
      .catch(() => false);
    expect(backupExists).toBe(false);
  });

  it("creates a backup when overwriting", async () => {
    const existing = {
      hooks: {
        SomeOther: [{ matcher: "*", hooks: [{ type: "command", command: "echo x" }] }],
      },
    };
    await fs.writeFile(settingsPath, JSON.stringify(existing, null, 2));
    const result = await runInit({ yes: true, settingsPath });
    expect(result.status).toBe("ok-installed");
    expect(result.backupPath).toBe(`${settingsPath}.bak`);
    const backup = JSON.parse(await fs.readFile(`${settingsPath}.bak`, "utf8"));
    expect(backup.hooks.SomeOther).toBeDefined();
  });

  it("preserves existing unrelated hooks in the same group", async () => {
    const existing = {
      hooks: {
        UserPromptSubmit: [
          { matcher: "*", hooks: [{ type: "command", command: "echo before-prompt" }] },
        ],
      },
    };
    await fs.writeFile(settingsPath, JSON.stringify(existing, null, 2));
    await runInit({ yes: true, settingsPath });
    const written = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    const commands = written.hooks.UserPromptSubmit.flatMap((g: { hooks: { command: string }[] }) =>
      g.hooks.map((h) => h.command),
    );
    expect(commands).toContain("echo before-prompt");
    expect(commands).toContain("petforge hook --event prompt");
  });

  it("preserves unknown top-level fields", async () => {
    const existing = {
      theme: "dark",
      preferences: { fontSize: 14 },
    };
    await fs.writeFile(settingsPath, JSON.stringify(existing, null, 2));
    await runInit({ yes: true, settingsPath });
    const written = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    expect(written.theme).toBe("dark");
    expect(written.preferences).toEqual({ fontSize: 14 });
    expect(written.hooks?.UserPromptSubmit).toBeDefined();
  });
});
