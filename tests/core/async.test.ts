/**
 * `withTimeout` — the shared wedge-proofing helper used by every long-lived
 * `petforge up` loop (quota probe, spend refresh, ...).
 *
 * The critical guarantee under test is #3: a promise that loses the race
 * (because the timeout fired first) but later rejects anyway must NOT
 * produce an `unhandledRejection`. In a long-lived daemon that crashes the
 * whole process by default, so this is the guarantee the rest of the
 * resilience work depends on.
 */

import { describe, expect, it } from "vitest";
import { TimeoutError, withTimeout } from "../../src/core/async.js";

describe("withTimeout", () => {
  it("resolves with the value when the promise wins", async () => {
    const result = await withTimeout(Promise.resolve("ok"), 1_000);
    expect(result).toBe("ok");
  });

  it("rejects with a distinguishable timeout error when the timer wins", async () => {
    const neverSettles = new Promise<never>(() => {
      // intentionally never resolves/rejects
    });
    await expect(withTimeout(neverSettles, 10)).rejects.toBeInstanceOf(TimeoutError);
    await expect(withTimeout(neverSettles, 10)).rejects.toThrow(/timed out after 10ms/);
  });

  it("does not produce an unhandledRejection when the loser rejects after losing the race", async () => {
    let sawUnhandledRejection: unknown;
    const onUnhandledRejection = (reason: unknown): void => {
      sawUnhandledRejection = reason;
    };
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      let rejectLoser!: (err: Error) => void;
      const loser = new Promise<never>((_resolve, reject) => {
        rejectLoser = reject;
      });

      // The timeout wins first (loser never settles before ms elapses).
      await expect(withTimeout(loser, 10)).rejects.toBeInstanceOf(TimeoutError);

      // Now the abandoned promise rejects AFTER the timeout already won.
      rejectLoser(new Error("late failure from the abandoned promise"));

      // Give Node's microtask/macrotask queues a chance to surface an
      // unhandledRejection if `withTimeout` had failed to attach a handler.
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(sawUnhandledRejection).toBeUndefined();
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
  });
});
