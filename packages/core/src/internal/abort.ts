import type { PreflightFault } from "../error";
import { createNetworkFault, ERR_ABORTED, ERR_TIMEOUT } from "../error";
import { isTimeoutCause } from "../error/cause";

/** The cancellation cause for an already-aborted signal, or `undefined` while it is still live. */
export function resolveAbortCause(signal: AbortSignal): Error | undefined {
  if (!signal.aborted) {
    return undefined;
  }

  return resolveAbortedCause(signal);
}

/** `ERR_TIMEOUT` or `ERR_ABORTED`, chosen from the signal's abort reason, including another copy's timeout sentinel. */
export function resolveAbortedCause(signal: AbortSignal): Error {
  return isTimeoutCause(signal.reason) ? ERR_TIMEOUT : ERR_ABORTED;
}

/** The cancellation fault for an already-aborted signal, or `undefined` while it is still live. */
export function resolveAbortFault(
  signal: AbortSignal,
): PreflightFault | undefined {
  if (!signal.aborted) {
    return undefined;
  }

  return resolveAbortedFault(signal);
}

/** `NET_ABORTED` or `NET_TIMEOUT`, chosen from the signal's abort reason. */
export function resolveAbortedFault(signal: AbortSignal): PreflightFault {
  return createNetworkFault(resolveAbortedCause(signal));
}

export async function awaitWithSignal<T>(
  run: () => T | PromiseLike<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();

  let rejectAbort!: (reason?: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => rejectAbort(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });

  const task = Promise.resolve().then(() => {
    signal.throwIfAborted();
    return run();
  });
  void task.catch(() => undefined);

  try {
    const value = await Promise.race([task, aborted]);
    signal.throwIfAborted();
    return value;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function stopFollowingNothing(): void {}

/**
 * Makes `controller` abort with `source`'s reason when `source` aborts. Returns the function that stops following.
 *
 * - No `source`: nothing to follow, and nothing is allocated.
 * - A `source` that is already aborted aborts `controller` now.
 * - Otherwise one listener is added to `source`, and the returned function removes it. It may be called more than once.
 *
 * The caller releases on every exit, so that nothing stays attached to a signal the caller keeps. There is no
 * registry and no unwrapping: to follow two sources, call it twice and release both once. After the release an
 * abort of `source` is no longer seen through `controller.signal`; read `source.aborted` where that still matters.
 * Do not pass `controller.signal` as its own source.
 */
export function followAbort(
  controller: AbortController,
  source: AbortSignal | undefined,
): () => void {
  if (source === undefined) {
    return stopFollowingNothing;
  }
  if (source.aborted) {
    controller.abort(source.reason);
    return stopFollowingNothing;
  }
  const onAbort = () => controller.abort(source.reason);
  source.addEventListener("abort", onAbort, { once: true });
  return () => source.removeEventListener("abort", onAbort);
}

/** Whether the caller's `signal` has aborted. A session reads it after it has released its own listener on it. */
export function hasAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

/**
 * Whether the caller's signal has stopped a session, so that its unread items are gone. A deadline is a failure, not a
 * stop: it delivers what was queued, unless the session had already ended when it expired. A session reads the signal
 * at each read instead of listening to it, so nothing stays attached to the signal once the session has ended.
 */
export function stopsUnreadItems(
  signal: AbortSignal | undefined,
  endedBeforeAbort: boolean,
): boolean {
  return (
    signal?.aborted === true &&
    (endedBeforeAbort || !isTimeoutCause(signal.reason))
  );
}
