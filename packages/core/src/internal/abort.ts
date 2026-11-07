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

type ForwardingSignalState = {
  active: boolean;
  release: () => void;
  sources: readonly AbortSignal[];
};

const forwardingSignals = new WeakMap<AbortSignal, ForwardingSignalState>();

/** Release listeners owned by a signal returned from `mergeAbortSignals`. */
export function releaseAbortSignal(signal: AbortSignal): void {
  forwardingSignals.get(signal)?.release();
}

export function mergeAbortSignals(
  controller: AbortSignal,
  signals: (AbortSignal | undefined)[],
): AbortSignal {
  if (
    signals.length > 0 &&
    signals.every((signal) => signal === undefined || signal === controller)
  ) {
    return controller;
  }

  const merged: AbortSignal[] = [];
  const seen = new Set<AbortSignal>();
  const append = (signal: AbortSignal) => {
    const state = forwardingSignals.get(signal);
    if (state?.active) {
      for (const source of state.sources) {
        append(source);
      }
      return;
    }
    if (!seen.has(signal)) {
      seen.add(signal);
      merged.push(signal);
    }
  };
  append(controller);
  for (const signal of signals) {
    if (signal) {
      append(signal);
    }
  }

  const sole = merged[0];
  if (merged.length === 1 && sole !== undefined) {
    return sole;
  }

  const combinedController = new AbortController();
  const listeners: Array<[AbortSignal, () => void]> = [];
  const state: ForwardingSignalState = {
    active: true,
    release() {
      if (!state.active) {
        return;
      }
      state.active = false;
      for (const [source, listener] of listeners) {
        source.removeEventListener("abort", listener);
      }
    },
    sources: merged,
  };
  forwardingSignals.set(combinedController.signal, state);

  const abortWithReason = (reason: unknown) => {
    if (combinedController.signal.aborted) {
      return;
    }
    combinedController.abort(reason);
    state.release();
  };

  const alreadyAborted = merged.find((signal) => signal.aborted);
  if (alreadyAborted) {
    abortWithReason(alreadyAborted.reason);
    return combinedController.signal;
  }

  for (const source of merged) {
    const listener = () => abortWithReason(source.reason);
    listeners.push([source, listener]);
    source.addEventListener("abort", listener, { once: true });
  }

  return combinedController.signal;
}
