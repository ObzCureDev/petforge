/**
 * Tests for src/core/{schema,paths,state}.ts.
 *
 * Isolation strategy: every test sets `process.env.PETFORGE_HOME` to a unique
 * temp dir, then `vi.resetModules()` and dynamic-imports the modules so the
 * path constants recompute against the test home.
 */

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as PathsMod from "../src/core/paths.js";
import type * as SchemaMod from "../src/core/schema.js";
import type * as StateMod from "../src/core/state.js";

interface TestModules {
  paths: typeof PathsMod;
  schema: typeof SchemaMod;
  state: typeof StateMod;
}

let testHome: string;
let prevHome: string | undefined;

async function loadModules(): Promise<TestModules> {
  vi.resetModules();
  const paths = await import("../src/core/paths.js");
  const schema = await import("../src/core/schema.js");
  const state = await import("../src/core/state.js");
  return { paths, schema, state };
}

beforeEach(async () => {
  prevHome = process.env.PETFORGE_HOME;
  testHome = await fs.mkdtemp(path.join(os.tmpdir(), "petforge-test-"));
  process.env.PETFORGE_HOME = testHome;
});

afterEach(async () => {
  if (prevHome === undefined) {
    delete process.env.PETFORGE_HOME;
  } else {
    process.env.PETFORGE_HOME = prevHome;
  }
  // best-effort cleanup
  try {
    await fs.rm(testHome, { recursive: true, force: true });
  } catch {
    /* noop */
  }
});

describe("schema", () => {
  it("createInitialState produces a State that validates", async () => {
    const { schema } = await loadModules();
    const pet = schema.placeholderPet();
    const s = schema.createInitialState(pet, 1700000000000);

    expect(s.schemaVersion).toBe(1);
    expect(s.pet).toEqual(pet);
    expect(s.progress).toEqual({
      xp: 0,
      level: 1,
      phase: "hatchling",
      pendingLevelUp: false,
    });
    expect(s.counters.activeSessions).toEqual({});
    expect(s.counters.promptsTotal).toBe(0);
    expect(s.achievements.unlocked).toEqual([]);
    expect(s.achievements.pendingUnlocks).toEqual([]);
    expect(s.buddy.userToggle).toBe("auto");
    expect(s.meta.createdAt).toBe(1700000000000);
    expect(s.meta.updatedAt).toBe(1700000000000);

    const parsed = schema.StateSchema.safeParse(s);
    expect(parsed.success).toBe(true);
  });

  it("StateSchema rejects unknown species", async () => {
    const { schema } = await loadModules();
    const s = schema.createInitialState(schema.placeholderPet());
    const broken = { ...s, pet: { ...s.pet, species: "dragon" } };
    expect(schema.StateSchema.safeParse(broken).success).toBe(false);
  });
});

describe("paths", () => {
  it("resolves under PETFORGE_HOME when set", async () => {
    const { paths } = await loadModules();
    expect(paths.PETFORGE_DIR).toBe(path.join(testHome, ".petforge"));
    expect(paths.STATE_FILE).toBe(path.join(testHome, ".petforge", "state.json"));
    expect(paths.HOOK_ERROR_LOG).toBe(path.join(testHome, ".petforge", "hook-errors.log"));
    expect(paths.CLAUDE_SETTINGS_FILE).toBe(path.join(testHome, ".claude", "settings.json"));
  });
});

describe("state", () => {
  it("readState throws StateNotFoundError when file missing", async () => {
    const { state } = await loadModules();
    await expect(state.readState()).rejects.toBeInstanceOf(state.StateNotFoundError);
  });

  it("readState succeeds with a valid state file", async () => {
    const { paths, schema, state } = await loadModules();
    await state.ensurePetforgeDir();
    const fresh = schema.createInitialState(schema.placeholderPet(), 1700000000000);
    await fs.writeFile(paths.STATE_FILE, JSON.stringify(fresh, null, 2), "utf8");

    const loaded = await state.readState();
    expect(loaded.schemaVersion).toBe(1);
    expect(loaded.pet.species).toBe("blob");
    expect(loaded.progress.level).toBe(1);
  });

  it("readState throws StateCorruptError on garbage JSON", async () => {
    const { paths, state } = await loadModules();
    await state.ensurePetforgeDir();
    await fs.writeFile(paths.STATE_FILE, "{ this is not valid json", "utf8");
    await expect(state.readState()).rejects.toBeInstanceOf(state.StateCorruptError);
  });

  it("readState throws StateCorruptError on schema mismatch", async () => {
    const { paths, state } = await loadModules();
    await state.ensurePetforgeDir();
    await fs.writeFile(paths.STATE_FILE, JSON.stringify({ schemaVersion: 1 }), "utf8");
    await expect(state.readState()).rejects.toBeInstanceOf(state.StateCorruptError);
  });

  it("recoverCorruptState backs up corrupt file and returns fresh state", async () => {
    const { paths, schema, state } = await loadModules();
    await state.ensurePetforgeDir();
    await fs.writeFile(paths.STATE_FILE, "garbage", "utf8");

    const fresh = await state.recoverCorruptState(() => schema.placeholderPet());
    expect(fresh.schemaVersion).toBe(1);
    expect(fresh.progress.xp).toBe(0);

    const entries = await fs.readdir(paths.PETFORGE_DIR);
    const backups = entries.filter((n) => n.startsWith("state.corrupt.") && n.endsWith(".json"));
    expect(backups.length).toBe(1);

    const backupName = backups[0];
    expect(backupName).toBeDefined();
    if (backupName !== undefined) {
      const backupContent = await fs.readFile(path.join(paths.PETFORGE_DIR, backupName), "utf8");
      expect(backupContent).toBe("garbage");
    }
  });

  it("writeStateAtomic creates state.json with content and updates meta.updatedAt", async () => {
    const { paths, schema, state } = await loadModules();
    await state.ensurePetforgeDir();
    const s = schema.createInitialState(schema.placeholderPet(), 1700000000000);
    expect(s.meta.updatedAt).toBe(1700000000000);

    const before = Date.now();
    await state.writeStateAtomic(s);
    const after = Date.now();

    expect(s.meta.updatedAt).toBeGreaterThanOrEqual(before);
    expect(s.meta.updatedAt).toBeLessThanOrEqual(after);

    const onDisk = JSON.parse(await fs.readFile(paths.STATE_FILE, "utf8"));
    expect(onDisk.schemaVersion).toBe(1);
    expect(onDisk.meta.updatedAt).toBe(s.meta.updatedAt);

    // tmp file should be cleaned up via rename
    await expect(fs.access(`${paths.STATE_FILE}.tmp`)).rejects.toBeTruthy();
  });

  it("writeStateAtomic replaces existing content atomically", async () => {
    const { paths, schema, state } = await loadModules();
    await state.ensurePetforgeDir();

    const first = schema.createInitialState(schema.placeholderPet());
    first.counters.promptsTotal = 1;
    await state.writeStateAtomic(first);

    const second = schema.createInitialState(schema.placeholderPet());
    second.counters.promptsTotal = 99;
    await state.writeStateAtomic(second);

    const onDisk = JSON.parse(await fs.readFile(paths.STATE_FILE, "utf8"));
    expect(onDisk.counters.promptsTotal).toBe(99);
  });

  it("withStateLock initialises state via onMissingOrCorrupt when file absent", async () => {
    const { schema, state } = await loadModules();
    const result = await state.withStateLock(
      (s) => {
        s.counters.promptsTotal = 7;
        return s.counters.promptsTotal;
      },
      { onMissingOrCorrupt: () => schema.createInitialState(schema.placeholderPet()) },
    );
    expect(result).toBe(7);

    const reloaded = await state.readState();
    expect(reloaded.counters.promptsTotal).toBe(7);
  });

  it("withStateLock rethrows when state missing and no initialiser provided", async () => {
    const { state } = await loadModules();
    await expect(state.withStateLock((s) => s.counters.promptsTotal)).rejects.toBeInstanceOf(
      state.StateNotFoundError,
    );
  });

  it("withStateLock serialises 5 concurrent increments (smoke test)", async () => {
    const { schema, state } = await loadModules();

    // seed an initial state so the file exists for all five workers
    await state.ensurePetforgeDir();
    await state.writeStateAtomic(schema.createInitialState(schema.placeholderPet()));

    const N = 5;
    const tasks = Array.from({ length: N }, () =>
      state.withStateLock((s) => {
        s.counters.promptsTotal += 1;
        return s.counters.promptsTotal;
      }),
    );

    const results = await Promise.all(tasks);
    expect(results.length).toBe(N);

    const final = await state.readState();
    expect(final.counters.promptsTotal).toBe(N);
  });
});
