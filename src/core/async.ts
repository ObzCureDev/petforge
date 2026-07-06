/**
 * Small async utilities shared by the long-lived `petforge up` daemon loops
 * (quota probe, spend refresh, ...). Extracted so every loop gets the same,
 * carefully-reviewed wedge-proofing instead of a copy-pasted local helper.
 */

/**
 * Distinguishes a `withTimeout` timeout rejection from an ordinary error
 * rejected by the raced promise itself. Callers that want to react
 * specifically to "the body was abandoned because it took too long" (as
 * opposed to a normal transient failure) can `instanceof` this class instead
 * of pattern-matching on a message string.
 */
export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

/**
 * Race `promise` against a timer that rejects after `ms`. Whichever settles
 * first wins; the loser is abandoned (its side effects, if any, still run
 * eventually, but the caller stops waiting on it).
 *
 * Three correctness requirements this depends on:
 *  - The timeout timer is cleared as soon as `promise` settles first, so we
 *    never leak a pending setTimeout.
 *  - The timeout timer is `unref()`'d so it can never, by itself, keep the
 *    Node.js event loop (and therefore the process) alive.
 *  - **Rejection-handler retention**: this function attaches BOTH a fulfill
 *    and a reject handler to `promise` itself, unconditionally — even when
 *    the timeout wins the race first. If we only attached handlers to the
 *    winner, an abandoned `promise` that later rejects would have zero
 *    handlers registered on it and Node would raise an `unhandledRejection`.
 *    In a long-lived daemon process, an unhandled rejection is fatal by
 *    default (Node terminates the process) — so a single wedged-then-failed
 *    await could kill the entire `petforge up` process well after the
 *    timeout already "handled" it. Attaching `.then(onFulfilled, onRejected)`
 *    to `promise` here consumes that later rejection unconditionally, so it
 *    can never surface as unhandled, regardless of which side of the race
 *    wins.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(ms));
    }, ms);
    timer.unref?.();
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
