import { afterEach, describe, expect, test, vi } from 'vitest'
import { ERR_TIMEOUT } from '../error'
import {
  armTransportDeadline,
  awaitWithSignal,
  createAbortTimeoutConflictFault,
  hasAbortTimeoutConflict,
  mergeAbortSignals,
  releaseAbortSignal,
  validateTransportTimeout,
} from './abort'

describe('abort helpers', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('should merge abort signals and preserve single controller signal', () => {
    const controller = new AbortController()
    expect(mergeAbortSignals(controller.signal, [])).toBe(controller.signal)
    expect(mergeAbortSignals(controller.signal, [controller.signal, controller.signal])).toBe(controller.signal)

    const another = new AbortController()
    const merged = mergeAbortSignals(controller.signal, [another.signal])
    another.abort('stop')

    expect(merged.aborted).toBe(true)
    expect(merged.reason).toBe('stop')
  })

  test('should release forwarding listeners and deduplicate identical sources', () => {
    const controller = new AbortController()
    const another = new AbortController()
    const add = vi.spyOn(controller.signal, 'addEventListener')
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const merged = mergeAbortSignals(controller.signal, [another.signal, another.signal])

    expect(add).toHaveBeenCalledOnce()
    releaseAbortSignal(merged)

    expect(remove).toHaveBeenCalledExactlyOnceWith('abort', add.mock.calls[0]?.[1])
  })

  test('should merge timeout into abort signals', () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const merged = mergeAbortSignals(controller.signal, [], 20)

    vi.advanceTimersByTime(20)

    expect(merged.aborted).toBe(true)
    expect(merged.reason).toBe(ERR_TIMEOUT)
  })

  test('should use a platform timer instead of AbortSignal.timeout', () => {
    vi.useFakeTimers()
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
    const controller = new AbortController()
    mergeAbortSignals(controller.signal, [], 50)

    expect(timeoutSpy).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(1)
    timeoutSpy.mockRestore()
    controller.abort('stop')
  })

  test('should clear the timeout timer when another signal aborts first', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    const controller = new AbortController()
    const merged = mergeAbortSignals(controller.signal, [], 60_000)
    controller.abort('stop')

    expect(merged.aborted).toBe(true)
    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })

  test('should clear the timeout timer when a merged signal is already aborted', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    const controller = new AbortController()
    controller.abort('already stopped')
    const merged = mergeAbortSignals(controller.signal, [], 60_000)

    expect(merged.aborted).toBe(true)
    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })

  test.each([-1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])('should reject invalid transport timeout %s', (timeout) => {
    expect(() => validateTransportTimeout(timeout)).toThrow('Request timeout must be a positive safe integer no greater than 2147483647')
  })

  test('should accept the largest safe transport timer delay', () => {
    expect(() => validateTransportTimeout(2_147_483_647)).not.toThrow()
  })

  test('should not listen on a signal when no deadline is armed', () => {
    const signal = new AbortController().signal
    const add = vi.spyOn(signal, 'addEventListener')

    armTransportDeadline(undefined).releaseOnAbort(signal)

    expect(add).not.toHaveBeenCalled()
  })

  test('should remove its release listener when the deadline is released', () => {
    const signal = new AbortController().signal
    const add = vi.spyOn(signal, 'addEventListener')
    const remove = vi.spyOn(signal, 'removeEventListener')
    const deadline = armTransportDeadline(1_000)

    deadline.releaseOnAbort(signal)
    deadline.release()

    expect(remove).toHaveBeenCalledExactlyOnceWith('abort', add.mock.calls[0]?.[1])
  })

  test('should release the deadline when the watched signal aborts', () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const deadline = armTransportDeadline(1_000)

    deadline.releaseOnAbort(controller.signal)
    controller.abort()
    vi.advanceTimersByTime(1_000)

    expect(deadline.signal?.aborted).toBe(false)
  })

  test('should detect abort and timeout field conflict', () => {
    const signal = new AbortController().signal

    expect(hasAbortTimeoutConflict(undefined)).toBe(false)
    expect(hasAbortTimeoutConflict({})).toBe(false)
    expect(hasAbortTimeoutConflict({ abort: signal })).toBe(false)
    expect(hasAbortTimeoutConflict({ timeout: 100 })).toBe(false)
    expect(hasAbortTimeoutConflict({ abort: signal, timeout: 100 })).toBe(true)
    expect(hasAbortTimeoutConflict({ abort: signal, timeout: 0 })).toBe(true)
    expect(hasAbortTimeoutConflict({ abort: signal, timeout: undefined })).toBe(false)
  })

  test('should create an options fault for an abort/timeout conflict', () => {
    const error = createAbortTimeoutConflictFault()

    expect(error.code).toBe('REQ_OPTIONS_INVALID')
    expect(error.message).toBe('abort and timeout cannot be used together')
    expect(error.cause).toBeInstanceOf(Error)
  })

  test('should resolve an asynchronous callback result', async () => {
    const signal = new AbortController().signal
    const add = vi.spyOn(signal, 'addEventListener')
    const remove = vi.spyOn(signal, 'removeEventListener')

    await expect(awaitWithSignal(() => Promise.resolve(1), signal)).resolves.toBe(1)

    expect(remove).toHaveBeenCalledExactlyOnceWith('abort', add.mock.calls[0]?.[1])
  })

  test('should stop waiting for a callback when aborted', async () => {
    const controller = new AbortController()
    const add = vi.spyOn(controller.signal, 'addEventListener')
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const result = awaitWithSignal(() => new Promise<never>(() => undefined), controller.signal)

    controller.abort(new Error('stop'))

    await expect(result).rejects.toThrow('stop')
    expect(remove).toHaveBeenCalledExactlyOnceWith('abort', add.mock.calls[0]?.[1])
  })

  test('should not invoke a callback when already aborted', async () => {
    const controller = new AbortController()
    const run = vi.fn()
    controller.abort(new Error('already stopped'))

    await expect(awaitWithSignal(run, controller.signal)).rejects.toThrow('already stopped')
    expect(run).not.toHaveBeenCalled()
  })

  test('should not start a queued callback after same-tick abort', async () => {
    const controller = new AbortController()
    const run = vi.fn()
    const result = awaitWithSignal(run, controller.signal)

    controller.abort(new Error('stop before start'))

    await expect(result).rejects.toThrow('stop before start')
    expect(run).not.toHaveBeenCalled()
  })

  test('should reject when a callback schedules abort before its result settles', async () => {
    const controller = new AbortController()
    const reason = new Error('stop before result')

    const result = awaitWithSignal(() => {
      queueMicrotask(() => controller.abort(reason))
      return 'value'
    }, controller.signal)

    await expect(result).rejects.toBe(reason)
  })

  test('should consume a callback rejection that arrives after abort', async () => {
    const controller = new AbortController()
    const unhandled = vi.fn()
    let rejectTask: ((reason: unknown) => void) | undefined
    process.on('unhandledRejection', unhandled)

    try {
      const result = awaitWithSignal(
        () =>
          new Promise<never>((_resolve, reject) => {
            rejectTask = reject
          }),
        controller.signal,
      )
      controller.abort(new Error('stop'))
      await expect(result).rejects.toThrow('stop')

      rejectTask?.(new Error('late failure'))
      await new Promise((resolve) => setImmediate(resolve))

      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})
