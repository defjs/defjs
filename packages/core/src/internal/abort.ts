import type { PreflightFault } from '../error'
import { createNetworkFault, createPreflightFault, ERR_ABORTED, ERR_TIMEOUT } from '../error'
import { isTimeoutCause } from '../error/cause'

export const ABORT_TIMEOUT_CONFLICT_MESSAGE = 'abort and timeout cannot be used together'
const MAX_TIMER_DELAY_MS = 2_147_483_647

export type UseCancellationConfig =
  | {
      abort?: AbortSignal
      timeout?: never
    }
  | {
      abort?: never
      timeout?: number
    }

export interface CancellationConfigLike {
  abort?: unknown
  signal?: unknown
  timeout?: unknown
}

export interface CancellationConfigSnapshot {
  abort?: AbortSignal
  signal?: AbortSignal
  timeout?: number
}

export function snapshotCancellationConfig(config: CancellationConfigSnapshot): CancellationConfigSnapshot {
  return {
    abort: config.abort,
    signal: config.signal,
    timeout: config.timeout,
  }
}

export function hasAbortTimeoutConflict(config: CancellationConfigLike | undefined): boolean {
  return config !== undefined && config.abort !== undefined && config.timeout !== undefined
}

/** The cancellation cause for an already-aborted signal, or `undefined` while it is still live. */
export function resolveAbortCause(signal: AbortSignal): Error | undefined {
  if (!signal.aborted) {
    return undefined
  }

  return resolveAbortedCause(signal)
}

/** `ERR_TIMEOUT` or `ERR_ABORTED`, chosen from the signal's abort reason, including another copy's timeout sentinel. */
export function resolveAbortedCause(signal: AbortSignal): Error {
  return isTimeoutCause(signal.reason) ? ERR_TIMEOUT : ERR_ABORTED
}

/** `REQ_OPTIONS_INVALID` for execute options that pass both `abort` and `timeout`. */
export function createAbortTimeoutConflictFault(): PreflightFault {
  return createPreflightFault('REQ_OPTIONS_INVALID', new Error(ABORT_TIMEOUT_CONFLICT_MESSAGE))
}

/** The cancellation fault for an already-aborted signal, or `undefined` while it is still live. */
export function resolveAbortFault(signal: AbortSignal): PreflightFault | undefined {
  if (!signal.aborted) {
    return undefined
  }

  return resolveAbortedFault(signal)
}

/** `NET_ABORTED` or `NET_TIMEOUT`, chosen from the signal's abort reason. */
export function resolveAbortedFault(signal: AbortSignal): PreflightFault {
  return createNetworkFault(resolveAbortedCause(signal))
}

export function validateTransportTimeout(timeout: number | undefined): void {
  if (typeof timeout !== 'undefined' && (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > MAX_TIMER_DELAY_MS)) {
    throw new RangeError(`Request timeout must be a positive safe integer no greater than ${MAX_TIMER_DELAY_MS}`)
  }
}

export async function awaitWithSignal<T>(run: () => T | PromiseLike<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()

  let rejectAbort!: (reason?: unknown) => void
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject
  })
  const onAbort = () => rejectAbort(signal.reason)
  signal.addEventListener('abort', onAbort, { once: true })

  const task = Promise.resolve().then(() => {
    signal.throwIfAborted()
    return run()
  })
  void task.catch(() => undefined)

  try {
    const value = await Promise.race([task, aborted])
    signal.throwIfAborted()
    return value
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

export interface TransportDeadline {
  /** `NET_TIMEOUT` once synchronous work has already used up `timeout`. */
  expiredFault: () => PreflightFault | undefined
  release: () => void
  /**
   * Release early when `signal` aborts. The listener exists only while a timer is armed and is
   * removed by `release`: a listener left on a composite signal pins it to every source it follows,
   * so a caller's long-lived signal would otherwise hold every request that ever used it.
   */
  releaseOnAbort: (signal: AbortSignal) => void
  signal: AbortSignal | undefined
}

/**
 * Arm `timeout` before synchronous parse and builder work.
 *
 * A timer task cannot run until that work yields. `expiredFault` also watches
 * the wall clock so a microtask transport cannot succeed after the deadline.
 * `release` clears the timer and makes a later wall-clock check a no-op, so a
 * settled startup can no longer abort the request signal.
 */
export function armTransportDeadline(timeout: number | undefined): TransportDeadline {
  if (typeof timeout !== 'number') {
    return {
      expiredFault: () => undefined,
      release: () => undefined,
      releaseOnAbort: () => undefined,
      signal: undefined,
    }
  }

  const startedAt = Date.now()
  const controller = new AbortController()
  let released = false
  let watched: AbortSignal | undefined
  const timer = setTimeout(() => {
    controller.abort(ERR_TIMEOUT)
  }, timeout)
  const release = () => {
    if (released) {
      return
    }
    released = true
    clearTimeout(timer)
    watched?.removeEventListener('abort', release)
  }

  return {
    release,
    releaseOnAbort(signal) {
      watched = signal
      signal.addEventListener('abort', release, { once: true })
    },
    signal: controller.signal,
    expiredFault() {
      if (released || Date.now() - startedAt < timeout) {
        return undefined
      }
      controller.abort(ERR_TIMEOUT)
      return resolveAbortedFault(controller.signal)
    },
  }
}

/**
 * Caller abort wins over a wall-clock deadline. A timer that already fired aborts
 * with `ERR_TIMEOUT`, so that signal still reports `NET_TIMEOUT`. Cancellation wins
 * over a parse or builder failure. Without `fallback`, a live signal returns undefined.
 */
export function resolveTransportCancellation(deadline: TransportDeadline, signal: AbortSignal): PreflightFault | undefined
export function resolveTransportCancellation(deadline: TransportDeadline, signal: AbortSignal, fallback: PreflightFault): PreflightFault
export function resolveTransportCancellation(
  deadline: TransportDeadline,
  signal: AbortSignal,
  fallback?: PreflightFault,
): PreflightFault | undefined {
  return resolveAbortFault(signal) ?? deadline.expiredFault() ?? fallback
}

type ForwardingSignalState = {
  active: boolean
  release: () => void
  sources: readonly AbortSignal[]
}

const forwardingSignals = new WeakMap<AbortSignal, ForwardingSignalState>()

/** Release listeners owned by a signal returned from `mergeAbortSignals`. */
export function releaseAbortSignal(signal: AbortSignal): void {
  forwardingSignals.get(signal)?.release()
}

export function mergeAbortSignals(controller: AbortSignal, signals: (AbortSignal | undefined)[], timeout?: number): AbortSignal {
  validateTransportTimeout(timeout)
  const hasTimeout = typeof timeout === 'number'

  if (!hasTimeout && signals.length > 0 && signals.every((signal) => signal === undefined || signal === controller)) {
    return controller
  }

  const merged: AbortSignal[] = []
  const seen = new Set<AbortSignal>()
  const append = (signal: AbortSignal) => {
    const state = forwardingSignals.get(signal)
    if (state?.active) {
      for (const source of state.sources) {
        append(source)
      }
      return
    }
    if (!seen.has(signal)) {
      seen.add(signal)
      merged.push(signal)
    }
  }
  append(controller)
  for (const signal of signals) {
    if (signal) {
      append(signal)
    }
  }

  if (!hasTimeout && merged.length === 1) {
    return merged[0] as AbortSignal
  }

  let timeoutTimer: ReturnType<typeof setTimeout> | undefined
  const combinedController = new AbortController()
  const listeners: Array<[AbortSignal, () => void]> = []
  let abortWithReason: (reason: unknown) => void
  const state: ForwardingSignalState = {
    active: true,
    release() {
      if (!state.active) {
        return
      }
      state.active = false
      for (const [source, listener] of listeners) {
        source.removeEventListener('abort', listener)
      }
      if (timeoutTimer !== undefined) {
        clearTimeout(timeoutTimer)
      }
    },
    sources: merged,
  }
  forwardingSignals.set(combinedController.signal, state)

  abortWithReason = (reason) => {
    if (combinedController.signal.aborted) {
      return
    }
    combinedController.abort(reason)
    state.release()
  }

  if (hasTimeout) {
    timeoutTimer = setTimeout(() => {
      abortWithReason(ERR_TIMEOUT)
    }, timeout)
  }

  const alreadyAborted = merged.find((signal) => signal.aborted)
  if (alreadyAborted) {
    abortWithReason(alreadyAborted.reason)
    return combinedController.signal
  }

  for (const source of merged) {
    const listener = () => abortWithReason(source.reason)
    listeners.push([source, listener])
    source.addEventListener('abort', listener, { once: true })
  }

  return combinedController.signal
}
