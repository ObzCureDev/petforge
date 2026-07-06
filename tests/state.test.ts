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
// Same default-import style state.ts uses, so this binds to the exact same
// cached CJS module.exports object that `withStateLock` calls `.lock` on —
// spying here observes (and can inspect the args of) the real production call.
import lockfile from "proper-lockfile";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as PathsMod from "../src/core/paths.js";
import type * as PetEngineMod from "../src/core/pet-engine.js";
import type * as SchemaMod from "../src/core/schema.js";
import type * as StateMod from "../src/core/state.js";

interface TestModules {
  paths: typeof PathsMod;
  petEngine: typeof PetEngineMod;
  schema: typeof SchemaMod;
  state: typeof StateMod;
}

function testPet(petEngine: typeof PetEngineMod): SchemaMod.Pet {
  return petEngine.generatePet({ username: "test-user", hostname: "test-host" });
}

let testHome: string;
let prevHome: string | undefined;

async function loadModules(): Promise<TestModules> {
  vi.resetModules();
  const paths = await import("../src/core/paths.js");
  const petEngine = await import("../src/core/pet-engine.js");
  const schema = await import("../src/core/schema.js");
  const state = await import("../src/core/state.js");
  return { paths, petEngine, schema, state };
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
    const { petEngine, schema } = await loadModules();
    const pet = testPet(petEngine);
    const s = schema.createInitialState(pet, 1700000000000);

    expect(s.schemaVersion).toBe(2);
    expect(s.pet).toEqual(pet);
    expect(s.progress).toEqual({
      xp: 0,
      level: 1,
      phase: "egg",
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
    const { petEngine, schema } = await loadModules();
    const s = schema.createInitialState(testPet(petEngine));
    const broken = { ...s, pet: { ...s.pet, species: "pixel" } };
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
    const { paths, petEngine, schema, state } = await loadModules();
    await state.ensurePetforgeDir();
    const pet = testPet(petEngine);
    const fresh = schema.createInitialState(pet, 1700000000000);
    await fs.writeFile(paths.STATE_FILE, JSON.stringify(fresh, null, 2), "utf8");

    const loaded = await state.readState();
    expect(loaded.schemaVersion).toBe(2);
    expect(loaded.pet.species).toBe(pet.species);
    expect(loaded.pet.seed).toBe(pet.seed);
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

  it("V3.7.1: recoverCorruptState backs up corrupt file then THROWS (no silent regenerate)", async () => {
    const { paths, petEngine, state } = await loadModules();
    await state.ensurePetforgeDir();
    await fs.writeFile(paths.STATE_FILE, "garbage", "utf8");

    // Previously this returned a fresh state, silently wiping any prior
    // progress. Now it throws so the operator must restore from a backup.
    await expect(state.recoverCorruptState(() => testPet(petEngine))).rejects.toBeInstanceOf(
      state.StateCorruptError,
    );

    // The backup is still copied (best-effort) for forensic recovery.
    const entries = await fs.readdir(paths.PETFORGE_DIR);
    const backups = entries.filter((n) => n.startsWith("state.corrupt.") && n.endsWith(".json"));
    expect(backups.length).toBe(1);

    const backupName = backups[0];
    expect(backupName).toBeDefined();
    if (backupName !== undefined) {
      const backupContent = await fs.readFile(path.join(paths.PETFORGE_DIR, backupName), "utf8");
      expect(backupContent).toBe("garbage");
    }

    // The original corrupt state.json is untouched (no overwrite).
    const onDisk = await fs.readFile(paths.STATE_FILE, "utf8");
    expect(onDisk).toBe("garbage");
  });

  it("V3.7.1: recoverCorruptState produces fresh state ONLY on true first install (no marker, no state.json)", async () => {
    const { paths, petEngine, state } = await loadModules();
    await state.ensurePetforgeDir();
    // Neither state.json nor the .initialized marker exists - virgin install.

    const fresh = await state.recoverCorruptState(() => testPet(petEngine));
    expect(fresh.schemaVersion).toBe(2);
    expect(fresh.progress.xp).toBe(0);
    expect(fresh.progress.level).toBe(1);
    expect(fresh.progress.phase).toBe("egg");

    // No .corrupt backups were created (nothing to back up).
    const entries = await fs.readdir(paths.PETFORGE_DIR);
    const backups = entries.filter((n) => n.startsWith("state.corrupt.") && n.endsWith(".json"));
    expect(backups.length).toBe(0);

    // The marker file is now present, so future "missing state" events
    // will refuse to regenerate (Windows NTFS rename-race protection).
    const markerExists = await fs
      .access(path.join(paths.PETFORGE_DIR, ".initialized"))
      .then(() => true)
      .catch(() => false);
    expect(markerExists).toBe(true);
  });

  it("V3.7.1: recoverCorruptState THROWS when marker exists but state.json is missing (rename race protection)", async () => {
    const { paths, petEngine, state } = await loadModules();
    await state.ensurePetforgeDir();
    // Simulate a previously-initialized install where state.json was
    // momentarily absent (e.g. Windows atomic-rename mid-operation).
    await fs.writeFile(path.join(paths.PETFORGE_DIR, ".initialized"), "1", "utf8");

    await expect(state.recoverCorruptState(() => testPet(petEngine))).rejects.toBeInstanceOf(
      state.StateCorruptError,
    );
  });

  it("writeStateAtomic creates state.json with content and updates meta.updatedAt", async () => {
    const { paths, petEngine, schema, state } = await loadModules();
    await state.ensurePetforgeDir();
    const s = schema.createInitialState(testPet(petEngine), 1700000000000);
    expect(s.meta.updatedAt).toBe(1700000000000);

    const before = Date.now();
    await state.writeStateAtomic(s);
    const after = Date.now();

    expect(s.meta.updatedAt).toBeGreaterThanOrEqual(before);
    expect(s.meta.updatedAt).toBeLessThanOrEqual(after);

    const onDisk = JSON.parse(await fs.readFile(paths.STATE_FILE, "utf8"));
    expect(onDisk.schemaVersion).toBe(2);
    expect(onDisk.meta.updatedAt).toBe(s.meta.updatedAt);

    // tmp file should be cleaned up via rename
    await expect(fs.access(`${paths.STATE_FILE}.tmp`)).rejects.toBeTruthy();
  });

  it("writeStateAtomic replaces existing content atomically", async () => {
    const { paths, petEngine, schema, state } = await loadModules();
    await state.ensurePetforgeDir();

    const first = schema.createInitialState(testPet(petEngine));
    first.counters.promptsTotal = 1;
    await state.writeStateAtomic(first);

    const second = schema.createInitialState(testPet(petEngine));
    second.counters.promptsTotal = 99;
    await state.writeStateAtomic(second);

    const onDisk = JSON.parse(await fs.readFile(paths.STATE_FILE, "utf8"));
    expect(onDisk.counters.promptsTotal).toBe(99);
  });

  it("withStateLock initialises state via onMissingOrCorrupt when file absent", async () => {
    const { petEngine, schema, state } = await loadModules();
    const result = await state.withStateLock(
      (s) => {
        s.counters.promptsTotal = 7;
        return s.counters.promptsTotal;
      },
      { onMissingOrCorrupt: () => schema.createInitialState(testPet(petEngine)) },
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
    const { petEngine, schema, state } = await loadModules();

    // seed an initial state so the file exists for all five workers
    await state.ensurePetforgeDir();
    await state.writeStateAtomic(schema.createInitialState(testPet(petEngine)));

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

  it("withStateLock serializes concurrent first-run mutations on empty home", async () => {
    const { paths, petEngine, state } = await loadModules();

    // No pre-seeding — state.json doesn't exist yet, so every parallel
    // mutator must go through onMissingOrCorrupt. This exercises the
    // first-run race window in lock-target selection: with the buggy
    // ternary `STATE_FILE-if-exists else PETFORGE_DIR`, the workers
    // would split across two distinct `.lock` files (one keyed off
    // `state.json`, one keyed off `.petforge`) and both enter the
    // critical section, producing a final count < N.
    const N = 10;
    const tasks = Array.from({ length: N }, () =>
      state.withStateLock(
        (s) => {
          s.counters.promptsTotal += 1;
        },
        { onMissingOrCorrupt: () => state.recoverCorruptState(() => testPet(petEngine)) },
      ),
    );
    await Promise.all(tasks);

    const final = await state.readState();
    expect(final.counters.promptsTotal).toBe(N);

    // Belt-and-braces: the dedicated lock file must have been created
    // (proving the fix routed through LOCK_FILE rather than the
    // existence-conditional ternary).
    await expect(fs.access(paths.LOCK_FILE)).resolves.toBeUndefined();
  });

  // V3.7.11 regression coverage: proper-lockfile's default onCompromised is
  // `(err) => { throw err; }`, thrown from ITS OWN internal setInterval — an
  // uncaught exception that kills the whole `petforge up` daemon (collector +
  // web server + quota probe) whenever the lock refresh misses the stale
  // window (laptop sleep, or the lock getting stolen by a short-lived hook
  // invocation). The fix is to give proper-lockfile a non-throwing handler.
  it("onStateLockCompromised never throws, and best-effort logs the compromise", async () => {
    const { paths, state } = await loadModules();
    await state.ensurePetforgeDir();

    // This IS the contract: calling the real handler with a real Error must
    // return normally, not throw. If this ever throws again, proper-lockfile
    // would propagate it straight out of its internal timer and crash the
    // daemon exactly as seen in production err.log.
    expect(() => state.onStateLockCompromised(new Error("ECOMPROMISED: simulated"))).not.toThrow();

    // Verify the real (non-mocked) side effect too: logHookError is
    // fire-and-forget, so poll briefly for the async append to land instead
    // of asserting against a mock.
    const deadline = Date.now() + 1000;
    let content = "";
    while (Date.now() < deadline) {
      try {
        content = await fs.readFile(paths.HOOK_ERROR_LOG, "utf8");
        if (content.includes("state lock compromised")) break;
      } catch {
        // log file not written yet - keep polling
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(content).toContain("state lock compromised");
    expect(content).toContain("ECOMPROMISED: simulated");
  });

  it("withStateLock passes onCompromised to lockfile.lock and it never throws when invoked", async () => {
    const { petEngine, schema, state } = await loadModules();
    const lockSpy = vi.spyOn(lockfile, "lock");

    try {
      await state.withStateLock(
        (s) => {
          s.counters.promptsTotal = 1;
        },
        { onMissingOrCorrupt: () => schema.createInitialState(testPet(petEngine)) },
      );

      expect(lockSpy).toHaveBeenCalledTimes(1);
      const opts = lockSpy.mock.calls[0]?.[1];
      expect(opts?.onCompromised).toBeTypeOf("function");
      expect(opts?.onCompromised).toBe(state.onStateLockCompromised);

      // The real contract under test: whatever function withStateLock hands
      // to proper-lockfile, invoking it directly must not throw/reject —
      // that is precisely what stands between a stale lock and a crashed
      // long-running `petforge up` daemon.
      expect(() => opts?.onCompromised?.(new Error("ECOMPROMISED: simulated"))).not.toThrow();

      // Other lock semantics must be untouched by this change.
      expect(opts?.stale).toBe(5000);
      expect(opts?.realpath).toBe(false);
      // Pin the tuned retry budget too, so accidental drift is caught (it is
      // sized to stay under the 5 s hook timeout — see the rationale comment
      // in withStateLock).
      expect(opts?.retries).toEqual({
        retries: 20,
        factor: 1.2,
        minTimeout: 20,
        maxTimeout: 200,
      });
    } finally {
      lockSpy.mockRestore();
    }
  });
});

describe("renameWithRetry (via writeStateAtomic)", () => {
  it("succeeds on first try when fs.rename works", async () => {
    const { paths, petEngine, schema, state } = await loadModules();
    await state.ensurePetforgeDir();
    const s = schema.createInitialState(testPet(petEngine), 1700000000000);

    const fsMod = await import("node:fs");
    const renameSpy = vi.spyOn(fsMod.promises, "rename");

    try {
      await state.writeStateAtomic(s);
      expect(renameSpy).toHaveBeenCalledTimes(1);
      const onDisk = JSON.parse(await fs.readFile(paths.STATE_FILE, "utf8"));
      expect(onDisk.schemaVersion).toBe(2);
    } finally {
      renameSpy.mockRestore();
    }
  });

  it("retries on EPERM and eventually succeeds", async () => {
    const { petEngine, schema, state } = await loadModules();
    await state.ensurePetforgeDir();
    const s = schema.createInitialState(testPet(petEngine), 1700000000000);

    const fsMod = await import("node:fs");
    const realRename = fsMod.promises.rename.bind(fsMod.promises);
    let calls = 0;
    const renameSpy = vi.spyOn(fsMod.promises, "rename").mockImplementation(async (from, to) => {
      calls++;
      if (calls <= 2) {
        const err = new Error("EPERM: operation not permitted") as NodeJS.ErrnoException;
        err.code = "EPERM";
        throw err;
      }
      return realRename(from, to);
    });

    try {
      await state.writeStateAtomic(s);
      expect(renameSpy).toHaveBeenCalledTimes(3);
    } finally {
      renameSpy.mockRestore();
    }
  });

  it("gives up after 3 retries on persistent EPERM", async () => {
    const { petEngine, schema, state } = await loadModules();
    await state.ensurePetforgeDir();
    const s = schema.createInitialState(testPet(petEngine), 1700000000000);

    const fsMod = await import("node:fs");
    const renameSpy = vi.spyOn(fsMod.promises, "rename").mockImplementation(async () => {
      const err = new Error("EPERM: operation not permitted") as NodeJS.ErrnoException;
      err.code = "EPERM";
      throw err;
    });

    try {
      await expect(state.writeStateAtomic(s)).rejects.toThrow(/EPERM/);
      expect(renameSpy).toHaveBeenCalledTimes(4);
    } finally {
      renameSpy.mockRestore();
    }
  });

  it("does not retry on non-retryable errors (e.g., ENOSPC)", async () => {
    const { petEngine, schema, state } = await loadModules();
    await state.ensurePetforgeDir();
    const s = schema.createInitialState(testPet(petEngine), 1700000000000);

    const fsMod = await import("node:fs");
    const renameSpy = vi.spyOn(fsMod.promises, "rename").mockImplementation(async () => {
      const err = new Error("ENOSPC: no space left on device") as NodeJS.ErrnoException;
      err.code = "ENOSPC";
      throw err;
    });

    try {
      await expect(state.writeStateAtomic(s)).rejects.toThrow(/ENOSPC/);
      expect(renameSpy).toHaveBeenCalledTimes(1);
    } finally {
      renameSpy.mockRestore();
    }
  });
});

describe("V3.1 -> V3.2 achievement ID rename through readState", () => {
  it("renames V3.1 IDs in unlocked + pendingUnlocks on read", async () => {
    const { paths, petEngine, schema, state } = await loadModules();
    await state.ensurePetforgeDir();
    const fresh = schema.createInitialState(testPet(petEngine), 1700000000000);
    fresh.achievements.unlocked = ["hatch", "tool_whisperer", "centurion"];
    fresh.achievements.pendingUnlocks = ["first_tool", "marathon"];
    await fs.writeFile(paths.STATE_FILE, JSON.stringify(fresh, null, 2), "utf8");

    const out = await state.readState();
    expect(out.achievements.unlocked).toEqual(["hatch_hatchling", "tool_5k", "hatch_mythic"]);
    // first_tool dropped; marathon renamed to marathon_4h
    expect(out.achievements.pendingUnlocks).toEqual(["marathon_4h"]);
  });
});
