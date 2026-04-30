/**
 * Tests for src/settings/claude-config.ts.
 *
 * All tests use a temp directory; ~/.claude/ is never touched.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildPetforgeHookConfig,
  type ClaudeSettings,
  ClaudeSettingsInvalidJsonError,
  detectExistingPetforgeHooks,
  detectOutdatedPetforgeHooks,
  mergeHookConfig,
  readClaudeSettings,
  writeClaudeSettingsWithBackup,
} from "../src/settings/claude-config.js";

let tmpDir: string;
let settingsPath: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "petforge-claude-config-"));
  settingsPath = path.join(tmpDir, "settings.json");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("claude-config", () => {
  describe("readClaudeSettings", () => {
    it("returns null for missing file", async () => {
      expect(await readClaudeSettings(settingsPath)).toBeNull();
    });

    it("returns {} for empty file", async () => {
      await fs.writeFile(settingsPath, "");
      expect(await readClaudeSettings(settingsPath)).toEqual({});
    });

    it("returns {} for whitespace-only file", async () => {
      await fs.writeFile(settingsPath, "   \n  \t\n");
      expect(await readClaudeSettings(settingsPath)).toEqual({});
    });

    it("parses valid JSON", async () => {
      await fs.writeFile(settingsPath, JSON.stringify({ hello: "world" }));
      expect(await readClaudeSettings(settingsPath)).toEqual({ hello: "world" });
    });

    it("throws ClaudeSettingsInvalidJsonError on garbage", async () => {
      await fs.writeFile(settingsPath, "not json {{{");
      await expect(readClaudeSettings(settingsPath)).rejects.toThrow(
        ClaudeSettingsInvalidJsonError,
      );
    });
  });

  describe("buildPetforgeHookConfig", () => {
    it("emits 5 groups with single command entries", () => {
      const cfg = buildPetforgeHookConfig();
      expect(Object.keys(cfg)).toEqual([
        "UserPromptSubmit",
        "PostToolUse",
        "Stop",
        "SessionStart",
        "SessionEnd",
      ]);
      expect(cfg.UserPromptSubmit[0]?.hooks[0]?.command).toBe("petforge hook --event prompt");
      expect(cfg.PostToolUse[0]?.hooks[0]?.command).toBe("petforge hook --event post_tool_use");
      expect(cfg.Stop[0]?.hooks[0]?.command).toBe("petforge hook --event stop");
      expect(cfg.SessionStart[0]?.hooks[0]?.command).toBe("petforge hook --event session_start");
      expect(cfg.SessionEnd[0]?.hooks[0]?.command).toBe("petforge hook --event session_end");
    });

    it("each entry has type=command, matcher=*, timeout=1", () => {
      const cfg = buildPetforgeHookConfig();
      for (const groupKey of Object.keys(cfg) as (keyof typeof cfg)[]) {
        const groups = cfg[groupKey];
        expect(groups).toHaveLength(1);
        const group = groups[0];
        expect(group?.matcher).toBe("*");
        expect(group?.hooks).toHaveLength(1);
        const entry = group?.hooks[0];
        expect(entry?.type).toBe("command");
        expect(entry?.timeout).toBe(1);
      }
    });
  });

  describe("mergeHookConfig", () => {
    it("preserves existing unrelated hooks and unknown top-level fields", () => {
      const existing: ClaudeSettings = {
        hooks: {
          UserPromptSubmit: [{ matcher: "*", hooks: [{ type: "command", command: "echo hi" }] }],
          OtherEvent: [{ matcher: "*", hooks: [{ type: "command", command: "ls" }] }],
        },
        otherTopLevel: { foo: "bar" },
      };
      const merged = mergeHookConfig(existing);
      // Other top-level field preserved
      expect(merged.otherTopLevel).toEqual({ foo: "bar" });
      // OtherEvent group preserved verbatim
      expect(merged.hooks?.OtherEvent).toEqual([
        { matcher: "*", hooks: [{ type: "command", command: "ls" }] },
      ]);
      // UserPromptSubmit kept the unrelated `echo hi` AND added PetForge
      const ups = merged.hooks?.UserPromptSubmit ?? [];
      expect(ups.length).toBeGreaterThanOrEqual(2);
      const commands = ups.flatMap((g) => g.hooks.map((h) => h.command));
      expect(commands).toContain("echo hi");
      expect(commands).toContain("petforge hook --event prompt");
    });

    it("does not duplicate PetForge hooks on second merge", () => {
      const merged1 = mergeHookConfig(null);
      const merged2 = mergeHookConfig(merged1);
      const ups = merged2.hooks?.UserPromptSubmit ?? [];
      const commands = ups.flatMap((g) => g.hooks.map((h) => h.command));
      const promptHooks = commands.filter((c) => c === "petforge hook --event prompt");
      expect(promptHooks).toHaveLength(1);
    });

    it("replaces outdated PetForge hooks (different timeout)", () => {
      const outdated: ClaudeSettings = {
        hooks: {
          UserPromptSubmit: [
            {
              matcher: "*",
              hooks: [{ type: "command", command: "petforge hook --event prompt", timeout: 999 }],
            },
          ],
        },
      };
      const merged = mergeHookConfig(outdated);
      const entries = merged.hooks?.UserPromptSubmit?.flatMap((g) => g.hooks) ?? [];
      const petforgeEntries = entries.filter((e) => (e.command ?? "").startsWith("petforge hook"));
      expect(petforgeEntries).toHaveLength(1);
      expect(petforgeEntries[0]?.timeout).toBe(1);
    });

    it("strips an outdated PetForge entry that lived alongside a user entry in the same group", () => {
      const mixed: ClaudeSettings = {
        hooks: {
          UserPromptSubmit: [
            {
              matcher: "*",
              hooks: [
                { type: "command", command: "echo before" },
                { type: "command", command: "petforge hook --event prompt", timeout: 999 },
              ],
            },
          ],
        },
      };
      const merged = mergeHookConfig(mixed);
      const entries = merged.hooks?.UserPromptSubmit?.flatMap((g) => g.hooks) ?? [];
      const commands = entries.map((e) => e.command);
      // The user `echo before` entry survives.
      expect(commands).toContain("echo before");
      // Only ONE PetForge entry remains, with the new timeout.
      const petforgeEntries = entries.filter((e) => (e.command ?? "").startsWith("petforge hook"));
      expect(petforgeEntries).toHaveLength(1);
      expect(petforgeEntries[0]?.timeout).toBe(1);
    });

    it("works on a null/empty starting state", () => {
      const merged = mergeHookConfig(null);
      expect(merged.hooks?.UserPromptSubmit?.[0]?.hooks[0]?.command).toBe(
        "petforge hook --event prompt",
      );
      expect(merged.hooks?.SessionEnd?.[0]?.hooks[0]?.command).toBe(
        "petforge hook --event session_end",
      );
    });
  });

  describe("detectExistingPetforgeHooks", () => {
    it("returns found=false on null/empty settings", () => {
      expect(detectExistingPetforgeHooks(null)).toEqual({
        found: false,
        groupsFound: [],
        outdated: [],
      });
      expect(detectExistingPetforgeHooks({})).toEqual({
        found: false,
        groupsFound: [],
        outdated: [],
      });
      expect(detectExistingPetforgeHooks({ hooks: {} })).toEqual({
        found: false,
        groupsFound: [],
        outdated: [],
      });
    });

    it("ignores unrelated hooks", () => {
      const settings: ClaudeSettings = {
        hooks: {
          UserPromptSubmit: [{ matcher: "*", hooks: [{ type: "command", command: "echo hi" }] }],
        },
      };
      expect(detectExistingPetforgeHooks(settings).found).toBe(false);
    });

    it("detects fully-installed hooks as found+not-outdated", () => {
      const merged = mergeHookConfig(null);
      const det = detectExistingPetforgeHooks(merged);
      expect(det.found).toBe(true);
      expect(det.groupsFound).toHaveLength(5);
      expect(det.outdated).toHaveLength(0);
    });

    it("detects outdated PetForge hooks (timeout differs)", () => {
      const stale: ClaudeSettings = {
        hooks: {
          UserPromptSubmit: [
            {
              matcher: "*",
              hooks: [{ type: "command", command: "petforge hook --event prompt", timeout: 999 }],
            },
          ],
        },
      };
      const det = detectExistingPetforgeHooks(stale);
      expect(det.found).toBe(true);
      expect(det.groupsFound).toContain("UserPromptSubmit");
      expect(det.outdated).toContain("UserPromptSubmit");
    });

    it("detects outdated PetForge hooks (command differs)", () => {
      const stale: ClaudeSettings = {
        hooks: {
          PostToolUse: [
            {
              matcher: "*",
              hooks: [{ type: "command", command: "petforge hook --event old_event", timeout: 1 }],
            },
          ],
        },
      };
      const det = detectExistingPetforgeHooks(stale);
      expect(det.found).toBe(true);
      expect(det.outdated).toContain("PostToolUse");
    });
  });

  describe("detectOutdatedPetforgeHooks", () => {
    it("returns empty array when nothing is installed", () => {
      expect(detectOutdatedPetforgeHooks(null)).toEqual([]);
      expect(detectOutdatedPetforgeHooks({})).toEqual([]);
    });

    it("returns the outdated group keys", () => {
      const stale: ClaudeSettings = {
        hooks: {
          UserPromptSubmit: [
            {
              matcher: "*",
              hooks: [{ type: "command", command: "petforge hook --event prompt", timeout: 999 }],
            },
          ],
        },
      };
      expect(detectOutdatedPetforgeHooks(stale)).toEqual(["UserPromptSubmit"]);
    });
  });

  describe("writeClaudeSettingsWithBackup", () => {
    it("creates the file when it doesn't exist (no backup needed)", async () => {
      const merged = mergeHookConfig(null);
      const backup = await writeClaudeSettingsWithBackup(merged, settingsPath);
      expect(backup).toBeNull();
      const written = JSON.parse(await fs.readFile(settingsPath, "utf8"));
      expect(written.hooks?.UserPromptSubmit).toBeDefined();
    });

    it("writes pretty-printed 2-space JSON with trailing newline", async () => {
      const merged = mergeHookConfig(null);
      await writeClaudeSettingsWithBackup(merged, settingsPath);
      const raw = await fs.readFile(settingsPath, "utf8");
      expect(raw.endsWith("\n")).toBe(true);
      // Pretty-printed: contains a newline followed by two spaces before "hooks".
      expect(raw).toContain('\n  "hooks":');
    });

    it("creates a .bak when overwriting existing file", async () => {
      await fs.writeFile(settingsPath, JSON.stringify({ existing: true }));
      const merged = mergeHookConfig({ existing: true });
      const backup = await writeClaudeSettingsWithBackup(merged, settingsPath);
      expect(backup).toBe(`${settingsPath}.bak`);
      const backupContent = JSON.parse(await fs.readFile(backup as string, "utf8"));
      expect(backupContent).toEqual({ existing: true });
    });

    it("uses timestamped backup if .bak already exists", async () => {
      await fs.writeFile(settingsPath, JSON.stringify({ a: 1 }));
      await fs.writeFile(`${settingsPath}.bak`, JSON.stringify({ b: 2 }));
      const backup = await writeClaudeSettingsWithBackup({ c: 3 } as ClaudeSettings, settingsPath);
      expect(backup).not.toBe(`${settingsPath}.bak`);
      expect(backup).toMatch(/\.bak$/);
      // Original .bak preserved
      const old = JSON.parse(await fs.readFile(`${settingsPath}.bak`, "utf8"));
      expect(old).toEqual({ b: 2 });
      // The new backup contains the pre-write file (a:1)
      const fresh = JSON.parse(await fs.readFile(backup as string, "utf8"));
      expect(fresh).toEqual({ a: 1 });
    });

    it("creates parent directory if missing", async () => {
      const nested = path.join(tmpDir, "nested", "deeper", "settings.json");
      const merged = mergeHookConfig(null);
      await writeClaudeSettingsWithBackup(merged, nested);
      const written = JSON.parse(await fs.readFile(nested, "utf8"));
      expect(written.hooks).toBeDefined();
    });
  });
});
