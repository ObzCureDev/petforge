/**
 * Path resolution: lazy getters + the test-isolation guard.
 *
 * These cover V3.7.9 hardening: production code resolves paths through
 * call-time getters (so PETFORGE_HOME is honoured without vi.resetModules),
 * and a guard makes it IMPOSSIBLE for a test run to resolve the real
 * ~/.petforge — the root cause of the recurring state-wipe incidents.
 */

import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const SNAPSHOT = process.env.PETFORGE_HOME;
afterEach(() => {
  if (SNAPSHOT === undefined) delete process.env.PETFORGE_HOME;
  else process.env.PETFORGE_HOME = SNAPSHOT;
});

describe("lazy path getters", () => {
  test("getStateFile reflects PETFORGE_HOME at call time (no resetModules)", async () => {
    const paths = await import("../../src/core/paths.js");
    const a = path.join(os.tmpdir(), "pf-lazy-a");
    const b = path.join(os.tmpdir(), "pf-lazy-b");

    process.env.PETFORGE_HOME = a;
    expect(paths.getStateFile()).toBe(path.join(a, ".petforge", "state.json"));

    // No re-import, no resetModules — a second call sees the new value.
    process.env.PETFORGE_HOME = b;
    expect(paths.getStateFile()).toBe(path.join(b, ".petforge", "state.json"));
  });

  test("every getter composes from the current home", async () => {
    const paths = await import("../../src/core/paths.js");
    const h = path.join(os.tmpdir(), "pf-compose");
    process.env.PETFORGE_HOME = h;

    expect(paths.getHomeDir()).toBe(h);
    expect(paths.getPetforgeDir()).toBe(path.join(h, ".petforge"));
    expect(paths.getLockFile()).toBe(path.join(h, ".petforge", ".lock"));
    expect(paths.getHookErrorLog()).toBe(path.join(h, ".petforge", "hook-errors.log"));
    expect(paths.getClaudeDir()).toBe(path.join(h, ".claude"));
    expect(paths.getClaudeSettingsFile()).toBe(path.join(h, ".claude", "settings.json"));
  });
});

describe("assertIsolatedHome guard", () => {
  test("throws under test when PETFORGE_HOME is unset", async () => {
    const { assertIsolatedHome } = await import("../../src/core/paths.js");
    expect(() => assertIsolatedHome(undefined, "/home/dan", true)).toThrow(/PETFORGE_HOME/);
  });

  test("throws under test when PETFORGE_HOME equals the real home", async () => {
    const { assertIsolatedHome } = await import("../../src/core/paths.js");
    expect(() => assertIsolatedHome("/home/dan", "/home/dan", true)).toThrow(/PETFORGE_HOME/);
  });

  test("returns the override under test when isolated to a temp dir", async () => {
    const { assertIsolatedHome } = await import("../../src/core/paths.js");
    const tmp = path.join(os.tmpdir(), "pf-isolated");
    expect(assertIsolatedHome(tmp, "/home/dan", true)).toBe(tmp);
  });

  test("falls back to the real home in production (guard inert)", async () => {
    const { assertIsolatedHome } = await import("../../src/core/paths.js");
    expect(assertIsolatedHome(undefined, "/home/dan", false)).toBe("/home/dan");
    expect(assertIsolatedHome("/custom", "/home/dan", false)).toBe("/custom");
  });
});
