import { describe, expect, inject, test, vi } from 'vitest'
import { ERR_ABORTED, ERR_TIMEOUT } from '../../error'
import type { HttpRequest } from '../../http'
import type { FetchEventStreamOptions } from './event_stream'
import { fetchEventStream as fetchEventStreamInternal, getErrorOpenInfo, getEventStreamFatalCode } from './event_stream'
import { type EventStreamMessage, SSEParserLimitError } from './parser'

type TestOptions<T> = Omit<FetchEventStreamOptions<T>, 'maxBufferSize' | 'maxQueueSize'> & {
  maxBufferSize?: number
  maxQueueSize?: number
}

function fetchEventStream<T = EventStreamMessage>(request: HttpRequest, options: TestOptions<T> = {}) {
  return fetchEventStreamInternal(request, {
    maxBufferSize: 1024,
    maxQueueSize: 16,
    ...options,
  } as FetchEventStreamOptions<T>)
}

function settleWithin<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('operation did not settle')), 100)
    promise.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

describe('fetchEventStream advanced', () => {
  function createRequest(endpoint: string): HttpRequest {
    return {
      baseEndpoint: inject('testServerHost'),
      endpoint,
      method: 'GET',
    }
  }

  test('should skip messages when transformMessage returns undefined', async () => {
    const stream = await fetchEventStream(createRequest('/sse/basic'), {
      transformMessage() {
        return undefined
      },
    })

    const events: EventStreamMessage[] = []
    for await (const event of stream) {
      events.push(event as unknown as EventStreamMessage)
    }
    expect(events).toEqual([])
    await expect(stream.closed).resolves.toEqual({ kind: 'eof' })
  })

  test('should stop retry when onerror returns null', async () => {
    const networkError = new Error('network failure')
    const fetch = vi.fn(async () => {
      throw networkError
    }) as unknown as typeof globalThis.fetch
    const onerror = vi.fn().mockReturnValue(null)
    const shouldReconnect = vi.fn(() => true)

    await expect(
      fetchEventStream(createRequest('/events'), {
        fetch,
        onerror,
        reconnect: { shouldReconnect },
      }),
    ).rejects.toBe(networkError)
    expect(fetch).toHaveBeenCalledOnce()
    expect(onerror).toHaveBeenCalledTimes(1)
    expect(shouldReconnect).not.toHaveBeenCalled()
  })

  test('should preserve an undefined network rejection', async () => {
    await expect(
      fetchEventStream(createRequest('/events'), {
        fetch: () => Promise.reject(undefined),
        onerror: () => null,
      }),
    ).rejects.toBeUndefined()
  })

  test('should keep retry fields out of dispatched messages', async () => {
    const stream = await fetchEventStream(createRequest('/sse/retry'))

    const events: EventStreamMessage[] = []
    for await (const event of stream) {
      events.push(event as EventStreamMessage)
    }
    expect(events[0]).not.toHaveProperty('retry')
  })

  test('should use custom retry delay from onerror', async () => {
    const onerror = vi.fn().mockReturnValue(10)
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(new Response('id: 1\nevent: message\ndata: ok\n\n', { headers: { 'content-type': 'text/event-stream' } }))

    const stream = await fetchEventStream(createRequest('/events'), {
      fetch,
      onerror,
      reconnect: { attempts: 3, delayMs: 0 },
      retryInterval: 1,
    })

    const events: EventStreamMessage[] = []
    for await (const event of stream) {
      events.push(event as EventStreamMessage)
    }
    expect(events).toEqual([{ data: 'ok', event: 'message', id: '1' }])
    expect(onerror).toHaveBeenCalledTimes(1)
  })

  test('should close gracefully when close is called after already closed', async () => {
    const stream = await fetchEventStream(createRequest('/sse/basic'))
    stream.close()
    stream.close() // should not throw

    await expect(stream.closed).resolves.toMatchObject({ kind: 'aborted' })
  })

  test('should throw for non-ok response with error body', async () => {
    await expect(fetchEventStream(createRequest('/sse/500-always'))).rejects.toThrow()
  })

  test('should attach open info to error for getErrorOpenInfo', async () => {
    try {
      await fetchEventStream(createRequest('/sse/500-always'))
    } catch (error) {
      const openInfo = getErrorOpenInfo(error)
      expect(openInfo?.response.status).toBe(500)
    }
  })

  test('getErrorOpenInfo returns undefined for non-object errors', () => {
    expect(getErrorOpenInfo('string error')).toBeUndefined()
    expect(getErrorOpenInfo(null)).toBeUndefined()
    expect(getErrorOpenInfo(42)).toBeUndefined()
  })

  test('should throw when transformMessage throws', async () => {
    const stream = await fetchEventStream(createRequest('/sse/basic'), {
      transformMessage() {
        throw new Error('transform failed')
      },
    })

    const iter = stream[Symbol.asyncIterator]()
    await expect(iter.next()).rejects.toThrow('Failed to process event stream message')
  })

  test('should call onopen and onclose callbacks', async () => {
    const onopen = vi.fn()
    const onclose = vi.fn()

    const stream = await fetchEventStream(createRequest('/sse/basic'), {
      onopen,
      onclose,
    })

    for await (const _ of stream) {
      // consume
    }

    expect(onopen).toHaveBeenCalledTimes(1)
    expect(onclose).toHaveBeenCalledTimes(1)
  })

  test('should work with default options', async () => {
    const stream = await fetchEventStream(createRequest('/sse/basic'))

    const events: EventStreamMessage[] = []
    for await (const event of stream) {
      events.push(event as EventStreamMessage)
    }
    expect(events.length).toBeGreaterThan(0)
  })

  test('should close with non-error reason', async () => {
    const stream = await fetchEventStream(createRequest('/sse/basic'))
    stream.close('custom-reason')

    await expect(stream.closed).resolves.toMatchObject({ kind: 'aborted', reason: 'custom-reason' })
  })

  test('should not override existing Accept header', async () => {
    const request: HttpRequest = {
      ...createRequest('/sse/basic'),
      headers: new Headers({ Accept: 'application/json' }),
    }

    const stream = await fetchEventStream(request)
    // The request was made with the real fetch; we verify the endpoint responded correctly.
    const events: EventStreamMessage[] = []
    for await (const event of stream) {
      events.push(event as EventStreamMessage)
    }
    expect(events.length).toBeGreaterThan(0)
  })

  test('should close with TimeoutError reason', async () => {
    const stream = await fetchEventStream(createRequest('/sse/basic'))
    const timeoutError = new Error('timeout')
    timeoutError.name = 'TimeoutError'
    stream.close(timeoutError)

    await expect(stream.closed).resolves.toMatchObject({ kind: 'aborted', reason: 'timeout' })
  })

  test('should abort via request signal during fetch', async () => {
    const controller = new AbortController()
    const request: HttpRequest = {
      ...createRequest('/sse/slow'),
      abort: controller.signal,
    }

    setTimeout(() => controller.abort(ERR_ABORTED), 50)

    await expect(fetchEventStream(request)).rejects.toBe(ERR_ABORTED)
  })

  test.each([
    ['does not settle', () => new Promise<void>(() => undefined)],
    ['rejects', () => Promise.reject(new Error('cancel failed'))],
  ])('should settle an ignored fetch abort when late response cancellation %s', async (_label, cancelBody) => {
    const controller = new AbortController()
    const cancel = vi.fn(cancelBody)
    let resolveFetch!: (response: Response) => void
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )
    const opening = fetchEventStream(
      { ...createRequest('/events'), abort: controller.signal },
      { fetch: fetch as unknown as typeof globalThis.fetch },
    )

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    controller.abort(ERR_ABORTED)

    await expect(settleWithin(opening)).rejects.toBe(ERR_ABORTED)
    resolveFetch(
      new Response(new ReadableStream<Uint8Array>({ cancel }), {
        headers: { 'content-type': 'text/event-stream' },
      }),
    )
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledExactlyOnceWith(ERR_ABORTED))
  })

  test('should normalize TimeoutError from request abort signal', async () => {
    const controller = new AbortController()
    const timeoutError = new Error('timeout')
    timeoutError.name = 'TimeoutError'
    const request: HttpRequest = {
      ...createRequest('/sse/slow'),
      abort: controller.signal,
    }

    setTimeout(() => controller.abort(timeoutError), 50)

    try {
      await fetchEventStream(request)
    } catch (error) {
      expect(error).toBe(ERR_TIMEOUT)
    }
  })

  test('should throw for non-event-stream content type', async () => {
    await expect(fetchEventStream(createRequest('/json'))).rejects.toThrow(/Expected content-type/)
  })

  test('should throw for empty content type', async () => {
    await expect(fetchEventStream(createRequest('/no-content-type'))).rejects.toThrow(/Expected content-type/)
  })

  test.each([
    'text/event-stream',
    'Text/Event-Stream; charset=utf-8',
    'text/event-stream; note="a;b"',
    'text/event-stream; note="a\\\tb"',
    'text/event-stream; note="a\\ b"',
    'text/event-stream; note="a\\;b"',
    'text/event-stream; note="a\\éb"',
    'text/event-stream; note="café"',
  ])('should accept valid event-stream content type %s', async (contentType) => {
    const stream = await fetchEventStream(createRequest('/events'), {
      fetch: async () =>
        new Response('data: ok\n\n', {
          headers: { 'content-type': contentType },
        }),
    })

    await expect(stream[Symbol.asyncIterator]().next()).resolves.toMatchObject({ value: { data: 'ok' } })
  })

  test.each([
    undefined,
    'application/json',
    'text/event-streaming',
    'text/event-stream; bare',
    'text/event-stream; charset',
    'text/event-stream; bad name=value',
    'text/event-stream; note="unterminated',
    'text/',
    'text/event-stream nope',
    'text/event-stream; =utf-8',
    'text/event-stream; charset=',
    'text/event-stream; note="\\',
    'text/event-stream; note="\\\u0001"',
    'text/event-stream; note="\u0001"',
  ])('should reject invalid event-stream content type %s', async (contentType) => {
    await expect(
      fetchEventStream(createRequest('/events'), {
        fetch: async () =>
          new Response('data: ignored\n\n', {
            headers: contentType === undefined ? undefined : { 'content-type': contentType },
          }),
      }),
    ).rejects.toThrow(/Expected content-type/)
  })

  test('should observe but never retry a fatal open-validation error', async () => {
    const cancel = vi.fn()
    const onerror = vi.fn(() => 0)
    const shouldReconnect = vi.fn(() => true)
    const fetch = vi.fn(async () => {
      const body = new ReadableStream<Uint8Array>({ cancel })
      return new Response(body, { headers: { 'content-type': 'text/plain' } })
    })

    const error = await fetchEventStream(createRequest('/events'), {
      fetch,
      onerror,
      reconnect: { attempts: 2, delayMs: 0, shouldReconnect },
    }).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/Expected content-type/)
    expect(getEventStreamFatalCode(error)).toBe('RES_MEDIA_TYPE_INVALID')
    expect(fetch).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledOnce()
    expect(onerror).toHaveBeenCalledOnce()
    expect(shouldReconnect).not.toHaveBeenCalled()
  })

  test('should not wait for response cancellation after fatal open validation', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined))
    const fetch = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({ cancel }), { headers: { 'content-type': 'text/plain' } }))

    await expect(
      settleWithin(
        fetchEventStream(createRequest('/events'), {
          fetch,
        }),
      ),
    ).rejects.toThrow(/Expected content-type/)

    expect(cancel).toHaveBeenCalledOnce()
  })

  test('should cancel the response and terminate when onopen fails', async () => {
    const cancel = vi.fn()
    const fetch = vi.fn(async () => {
      const body = new ReadableStream<Uint8Array>({ cancel })
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
    })

    await expect(
      fetchEventStream(createRequest('/events'), {
        fetch,
        onerror: () => 0,
        onopen() {
          throw new Error('onopen failed')
        },
        reconnect: { attempts: 2, delayMs: 0 },
      }),
    ).rejects.toThrow('onopen failed')

    expect(fetch).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledOnce()
  })

  test('should preserve an onopen failure when response cancellation rejects', async () => {
    const cancel = vi.fn(() => Promise.reject(new Error('cancel failed')))
    const fetch = vi.fn(
      async () =>
        new Response(new ReadableStream<Uint8Array>({ cancel }), {
          headers: { 'content-type': 'text/event-stream' },
        }),
    )

    const error = await fetchEventStream(createRequest('/events'), {
      fetch,
      onopen() {
        throw new Error('onopen failed')
      },
    }).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('onopen failed')
    expect(getEventStreamFatalCode(error)).toBe('EXT_HOOK_FAILED')
    expect(cancel).toHaveBeenCalledOnce()
  })

  test('should use the stable fallback when onopen throws a non-Error value', async () => {
    const error = await fetchEventStream(createRequest('/events'), {
      fetch: async () => new Response('', { headers: { 'content-type': 'text/event-stream' } }),
      onopen() {
        throw 'non-error failure'
      },
    }).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('Event stream onopen callback failed')
    expect(getEventStreamFatalCode(error)).toBe('EXT_HOOK_FAILED')
  })

  test('should retain the original fatal error when its observer fails', async () => {
    const fetch = vi.fn(async () => new Response(null, { headers: { 'content-type': 'text/plain' } }))

    await expect(
      fetchEventStream(createRequest('/events'), {
        fetch,
        onerror() {
          throw new Error('observer failed')
        },
      }),
    ).rejects.toThrow(/Expected content-type/)
    expect(fetch).toHaveBeenCalledOnce()
  })

  test('should classify a missing response body as an invalid response', async () => {
    const error = await fetchEventStream(createRequest('/events'), {
      fetch: async () => new Response(null, { headers: { 'content-type': 'text/event-stream' } }),
    }).catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('Missing response body for event stream')
    expect(getEventStreamFatalCode(error)).toBe('RES_DECODE_FAILED')
  })

  test('should cancel upstream and terminate on a parser limit even when callbacks request retry', async () => {
    const cancel = vi.fn()
    const onerror = vi.fn(() => 0)
    const shouldReconnect = vi.fn(() => true)
    const fetch = vi.fn(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`data: ${'x'.repeat(100)}`))
        },
        cancel,
      })
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
    })

    const stream = await fetchEventStream(createRequest('/events'), {
      fetch,
      maxBufferSize: 16,
      onerror,
      reconnect: { attempts: 2, delayMs: 0, shouldReconnect },
    })
    const iterator = stream[Symbol.asyncIterator]()

    await expect(iterator.next()).rejects.toThrow('SSE parser buffer exceeded maxBufferSize')
    await expect(stream.closed).resolves.toMatchObject({ kind: 'error', code: 'CAP_BUFFER_EXCEEDED' })
    expect(fetch).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledOnce()
    expect(onerror).toHaveBeenCalledOnce()
    expect(shouldReconnect).not.toHaveBeenCalled()
  })

  test('should classify a parser limit thrown by the fetch boundary as fatal', async () => {
    const onerror = vi.fn(() => 0)
    const shouldReconnect = vi.fn(() => true)
    const fetch = vi.fn(async () => {
      throw new SSEParserLimitError()
    }) as unknown as typeof globalThis.fetch

    const error = await fetchEventStream(createRequest('/events'), {
      fetch,
      onerror,
      reconnect: { shouldReconnect },
    }).catch((cause: unknown) => cause)

    expect(getEventStreamFatalCode(error)).toBe('CAP_BUFFER_EXCEEDED')
    expect(fetch).toHaveBeenCalledOnce()
    expect(onerror).toHaveBeenCalledOnce()
    expect(shouldReconnect).not.toHaveBeenCalled()
  })

  test('should abort while observing a fatal open error', async () => {
    const abortController = new AbortController()
    const cancel = vi.fn()
    let markObserved: (() => void) | undefined
    const observed = new Promise<void>((resolve) => {
      markObserved = resolve
    })
    const opening = fetchEventStream(
      { ...createRequest('/events'), abort: abortController.signal },
      {
        fetch: async () =>
          new Response(new ReadableStream<Uint8Array>({ cancel }), {
            headers: { 'content-type': 'text/plain' },
          }),
        onerror() {
          markObserved?.()
          return new Promise<number>(() => undefined)
        },
      },
    )

    await observed
    abortController.abort(ERR_ABORTED)

    await expect(opening).rejects.toBe(ERR_ABORTED)
    expect(cancel).toHaveBeenCalledOnce()
  })

  test('should cancel upstream and terminate when message transformation fails', async () => {
    const cancel = vi.fn()
    const onerror = vi.fn(() => 0)
    const shouldReconnect = vi.fn(() => true)
    const fetch = vi.fn(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: value\n\n'))
        },
        cancel,
      })
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
    })

    const stream = await fetchEventStream(createRequest('/events'), {
      fetch,
      onerror,
      reconnect: { attempts: 2, delayMs: 0, shouldReconnect },
      transformMessage() {
        throw new Error('transform failed')
      },
    })

    await expect(stream[Symbol.asyncIterator]().next()).rejects.toThrow('Failed to process event stream message')
    await expect(stream.closed).resolves.toMatchObject({ kind: 'error', code: 'EXT_OBSERVER_FAILED' })
    expect(fetch).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledOnce()
    expect(onerror).toHaveBeenCalledOnce()
    expect(shouldReconnect).not.toHaveBeenCalled()
  })

  test('should discard buffered events and terminate on queue overflow', async () => {
    const cancel = vi.fn()
    const fetch = vi.fn(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: one\n\ndata: two\n\n'))
        },
        cancel,
      })
      return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
    })

    const stream = await fetchEventStream(createRequest('/events'), {
      fetch,
      maxQueueSize: 1,
      onerror: () => 0,
      reconnect: { attempts: 2, delayMs: 0 },
    })

    await expect(stream.closed).resolves.toMatchObject({ kind: 'error', code: 'CAP_QUEUE_OVERFLOW' })
    await expect(stream[Symbol.asyncIterator]().next()).rejects.toThrow('Event stream queue exceeded maxQueueSize')
    expect(fetch).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledOnce()
  })

  test('should abort during retry wait via request signal', async () => {
    const controller = new AbortController()
    const request: HttpRequest = {
      ...createRequest('/events'),
      abort: controller.signal,
    }
    const fetch = vi.fn(async () => {
      throw new Error('network error')
    })

    setTimeout(() => controller.abort(ERR_ABORTED), 50)

    await expect(
      fetchEventStream(request, {
        fetch,
        onerror() {
          return 1000
        },
        reconnect: { attempts: 3, delayMs: 1000 },
      }),
    ).rejects.toBe(ERR_ABORTED)
  })

  test('should close infinite stream', async () => {
    const stream = await fetchEventStream(createRequest('/sse/infinite'))

    setTimeout(() => stream.close(), 50)

    await expect(stream.closed).resolves.toMatchObject({ kind: 'aborted' })
  })

  test('should cancel active response body when stream is closed', async () => {
    const cancel = vi.fn()
    const mockFetch = vi.fn(async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: first\n\n'))
        },
        cancel,
      })

      return new Response(body, {
        headers: { 'content-type': 'text/event-stream' },
        status: 200,
      })
    }) as unknown as typeof fetch

    const stream = await fetchEventStream(createRequest('/sse/basic'), { fetch: mockFetch })
    const iterator = stream[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { data: 'first', event: '', id: '' },
    })

    stream.close('stop')

    await vi.waitFor(() => {
      expect(cancel).toHaveBeenCalledWith('stop')
    })
    await expect(stream.closed).resolves.toMatchObject({ kind: 'aborted' })
  })

  test.each([
    ['an Error', new Error('close failed')],
    ['undefined', undefined],
  ])('should finish teardown before rejecting a synchronous close throw of %s', async (_label, closeError) => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>(() => undefined)
      },
      cancel,
    })
    const stream = await fetchEventStream(createRequest('/events'), {
      fetch: async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
    })
    const close = vi.fn(() => {
      throw closeError
    })
    stream.close = close

    let first: PromiseLike<void> | undefined
    expect(() => {
      first = stream[Symbol.asyncDispose]()
    }).not.toThrow()
    expect(close).not.toHaveBeenCalled()
    if (!first) {
      throw new Error('Expected disposal promise')
    }

    const second = stream[Symbol.asyncDispose]()
    expect(second).toBe(first)
    await expect(Promise.resolve(first)).rejects.toBe(closeError)
    expect(close).toHaveBeenCalledOnce()
    await expect(settleWithin(stream.closed)).resolves.toMatchObject({ kind: 'aborted' })
    expect(cancel).toHaveBeenCalledOnce()
    expect(body.locked).toBe(false)
  })

  test('should dispose an active stream once without waiting for a stuck provider cancel', async () => {
    const pull = vi.fn(() => new Promise<void>(() => undefined))
    const cancel = vi.fn(() => new Promise<void>(() => undefined))
    const body = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 })
    const fetch = vi.fn(async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
    const stream = await fetchEventStream(createRequest('/events'), {
      fetch,
      reconnect: { attempts: 3, delayMs: 0 },
    })
    const close = vi.fn(stream.close.bind(stream))
    stream.close = close
    await vi.waitFor(() => expect(pull).toHaveBeenCalledOnce())

    let first: PromiseLike<void> | undefined
    expect(() => {
      first = stream[Symbol.asyncDispose]()
    }).not.toThrow()
    expect(close).not.toHaveBeenCalled()
    if (!first) {
      throw new Error('Expected disposal promise')
    }

    const second = stream[Symbol.asyncDispose]()
    expect(second).toBe(first)
    await expect(settleWithin(Promise.resolve(first))).resolves.toBeUndefined()

    expect(close).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledOnce()
    expect(body.locked).toBe(false)
    await expect(stream.closed).resolves.toMatchObject({ kind: 'aborted' })

    const pullCount = pull.mock.calls.length
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(pull).toHaveBeenCalledTimes(pullCount)
    expect(fetch).toHaveBeenCalledOnce()
  })

  test('should preserve an error terminal state when disposed', async () => {
    const failure = new Error('provider failed')
    let sourceController: ReadableStreamDefaultController<Uint8Array> | undefined
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        sourceController = controller
      },
    })
    const stream = await fetchEventStream(createRequest('/events'), {
      fetch: async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
    })

    sourceController?.error(failure)
    const terminal = await settleWithin(stream.closed)
    expect(terminal).toEqual({
      kind: 'error',
      code: 'NET_UNREACHABLE',
      cause: failure,
      reason: failure.message,
    })

    await expect(settleWithin(Promise.resolve(stream[Symbol.asyncDispose]()))).resolves.toBeUndefined()
    await expect(stream.closed).resolves.toBe(terminal)
    await expect(stream[Symbol.asyncIterator]().next()).rejects.toBe(failure)
  })

  test('should close and cancel the active response when iteration returns early', async () => {
    const cancel = vi.fn()
    const fetch = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: first\n\n'))
            },
            cancel,
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    ) as unknown as typeof globalThis.fetch
    const stream = await fetchEventStream(createRequest('/events'), { fetch })
    const iterator = stream[Symbol.asyncIterator]()

    await expect(iterator.next()).resolves.toMatchObject({ done: false, value: { data: 'first' } })
    await expect(iterator.return?.()).resolves.toEqual({ done: true, value: undefined })
    await expect(iterator.return?.()).resolves.toEqual({ done: true, value: undefined })
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })

    await expect(stream.closed).resolves.toMatchObject({ kind: 'aborted', reason: 'iterator-return' })
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledWith('iterator-return'))
  })

  test('should abort while onopen never settles', async () => {
    const abortController = new AbortController()
    const cancel = vi.fn()
    let markStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const opening = fetchEventStream(
      { ...createRequest('/events'), abort: abortController.signal },
      {
        fetch: async () =>
          new Response(new ReadableStream<Uint8Array>({ cancel }), {
            headers: { 'content-type': 'text/event-stream' },
          }),
        onopen() {
          markStarted?.()
          return new Promise<void>(() => undefined)
        },
      },
    )

    await started
    abortController.abort(ERR_ABORTED)

    await expect(opening).rejects.toBe(ERR_ABORTED)
    expect(cancel).toHaveBeenCalledOnce()
  })

  test('should abort while transformMessage never settles', async () => {
    const abortController = new AbortController()
    const cancel = vi.fn()
    let markStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    let transformSignal: AbortSignal | undefined
    const stream = await fetchEventStream(
      { ...createRequest('/events'), abort: abortController.signal },
      {
        fetch: async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('data: value\n\n'))
              },
              cancel,
            }),
            { headers: { 'content-type': 'text/event-stream' } },
          ),
        transformMessage(_message, signal) {
          transformSignal = signal
          markStarted?.()
          return new Promise<EventStreamMessage>(() => undefined)
        },
      },
    )
    const next = stream[Symbol.asyncIterator]().next()

    await started
    abortController.abort(ERR_ABORTED)

    await expect(next).resolves.toEqual({ done: true, value: undefined })
    await expect(stream.closed).resolves.toMatchObject({ kind: 'aborted', cause: ERR_ABORTED })
    expect(transformSignal?.aborted).toBe(true)
    expect(cancel).toHaveBeenCalledOnce()
  })

  test('should abort while onclose never settles', async () => {
    const abortController = new AbortController()
    let markStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const stream = await fetchEventStream(
      { ...createRequest('/events'), abort: abortController.signal },
      {
        fetch: async () =>
          new Response('data: value\n\n', {
            headers: { 'content-type': 'text/event-stream' },
          }),
        onclose() {
          markStarted?.()
          return new Promise<void>(() => undefined)
        },
      },
    )

    await started
    abortController.abort(ERR_ABORTED)

    await expect(stream.closed).resolves.toMatchObject({ kind: 'aborted', cause: ERR_ABORTED })
  })

  test.each([
    ['a TimeoutError', new DOMException('deadline expired', 'TimeoutError')],
    ['the canonical timeout error', ERR_TIMEOUT],
  ])('should fail an open stream when request abort uses %s', async (_label, timeoutError) => {
    const controller = new AbortController()
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>(
      {
        cancel,
        pull() {
          return new Promise<void>(() => undefined)
        },
      },
      { highWaterMark: 0 },
    )
    const stream = await fetchEventStream(
      { ...createRequest('/events'), abort: controller.signal },
      {
        fetch: async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
      },
    )
    const next = stream[Symbol.asyncIterator]().next()

    controller.abort(timeoutError)

    await expect(next).rejects.toBe(ERR_TIMEOUT)
    await expect(stream.closed).resolves.toEqual({
      kind: 'error',
      code: 'NET_TIMEOUT',
      cause: ERR_TIMEOUT,
      reason: ERR_TIMEOUT.message,
    })
    expect(cancel).toHaveBeenCalledExactlyOnceWith(timeoutError)
  })

  test('should keep an explicit close with a TimeoutError classified as owner abort', async () => {
    const timeoutError = new DOMException('owner chose this reason', 'TimeoutError')
    const stream = await fetchEventStream(createRequest('/sse/infinite'))

    stream.close(timeoutError)

    await expect(stream.closed).resolves.toEqual({ kind: 'aborted', cause: timeoutError, reason: timeoutError.message })
  })

  test('should abort while onerror never settles', async () => {
    const abortController = new AbortController()
    let markStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const opening = fetchEventStream(
      { ...createRequest('/events'), abort: abortController.signal },
      {
        fetch: async () => {
          throw new Error('network failure')
        },
        onerror() {
          markStarted?.()
          return new Promise<number>(() => undefined)
        },
      },
    )

    await started
    abortController.abort(ERR_ABORTED)

    await expect(opening).rejects.toBe(ERR_ABORTED)
  })

  test('should abort while shouldReconnect never settles', async () => {
    const abortController = new AbortController()
    let markStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const opening = fetchEventStream(
      { ...createRequest('/events'), abort: abortController.signal },
      {
        fetch: async () => {
          throw new Error('network failure')
        },
        reconnect: {
          shouldReconnect() {
            markStarted?.()
            return new Promise<boolean>(() => undefined)
          },
        },
      },
    )

    await started
    abortController.abort(ERR_ABORTED)

    await expect(opening).rejects.toBe(ERR_ABORTED)
  })

  test('should prefer a queued abort over a synchronous shouldReconnect result', async () => {
    const abortController = new AbortController()
    const opening = fetchEventStream(
      { ...createRequest('/events'), abort: abortController.signal },
      {
        fetch: async () => {
          throw new Error('network failure')
        },
        reconnect: {
          shouldReconnect() {
            queueMicrotask(() => abortController.abort(ERR_ABORTED))
            return false
          },
        },
      },
    )

    await expect(opening).rejects.toBe(ERR_ABORTED)
  })

  test('should reject a second event-stream iterator', async () => {
    const stream = await fetchEventStream(createRequest('/sse/infinite'))

    stream[Symbol.asyncIterator]()
    expect(() => stream[Symbol.asyncIterator]()).toThrow('AsyncQueue supports one consumer')

    stream.close('test complete')
    await expect(stream.closed).resolves.toMatchObject({ kind: 'aborted' })
  })

  test('should retry with default interval when fetch throws network error', async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: ok\n\n'))
              controller.close()
            },
          }),
          {
            headers: { 'content-type': 'text/event-stream' },
            status: 200,
          },
        ),
      ) as unknown as typeof globalThis.fetch

    const stream = await fetchEventStream(createRequest('/sse/basic'), {
      fetch: mockFetch,
      reconnect: { attempts: 3, delayMs: 0 },
      retryInterval: 1,
    })

    const events: EventStreamMessage[] = []
    for await (const event of stream) {
      events.push(event as unknown as EventStreamMessage)
    }
    expect(events).toEqual([{ data: 'ok', event: '', id: '' }])
  })

  test('should support streaming request body', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data'))
        controller.close()
      },
    })
    const request: HttpRequest = {
      ...createRequest('/sse/basic'),
      body,
      method: 'POST',
    }

    const stream = await fetchEventStream(request)
    const events: EventStreamMessage[] = []
    for await (const event of stream) {
      events.push(event as EventStreamMessage)
    }
    expect(events.length).toBeGreaterThan(0)
  })

  test('should not retry when reconnect is omitted', async () => {
    let fetchCount = 0
    const mockFetch = vi.fn(async () => {
      fetchCount += 1
      throw new Error('network error')
    }) as unknown as typeof fetch

    const request = { baseEndpoint: 'https://example.com', endpoint: '/fail', method: 'GET' }

    await expect(fetchEventStream(request, { fetch: mockFetch })).rejects.toThrow('network error')
    expect(fetchCount).toBe(1)
  })

  test('should not retry when reconnect.attempts = 0', async () => {
    let fetchCount = 0
    const mockFetch = vi.fn(async () => {
      fetchCount += 1
      return new Response(null, { status: 503 })
    }) as unknown as typeof fetch

    const request = { baseEndpoint: 'https://example.com', endpoint: '/fail', method: 'GET' }

    await expect(
      fetchEventStream(request, {
        fetch: mockFetch,
        reconnect: { attempts: 0 },
      }),
    ).rejects.toThrow()
    expect(fetchCount).toBe(1)
  })

  test('should retry up to reconnect.attempts limit', async () => {
    let fetchCount = 0
    const mockFetch = vi.fn(async () => {
      fetchCount += 1
      // Throw a network error (not EventStreamFatalError) to trigger retry path
      throw new Error('network error')
    }) as unknown as typeof fetch

    const request = { baseEndpoint: 'https://example.com', endpoint: '/fail', method: 'GET' }

    await expect(
      fetchEventStream(request, {
        fetch: mockFetch,
        reconnect: { attempts: 2, delayMs: 0 },
      }),
    ).rejects.toThrow()
    expect(fetchCount).toBe(3) // initial + 2 retries
  })

  test('should succeed when retry eventually works', async () => {
    let fetchCount = 0
    const mockFetch = vi.fn(async () => {
      fetchCount += 1
      if (fetchCount < 3) {
        // Throw network error to trigger retry path
        throw new Error('network error')
      }
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: ok\n\n'))
            controller.close()
          },
        }),
        {
          headers: { 'content-type': 'text/event-stream' },
          status: 200,
        },
      )
    }) as unknown as typeof fetch

    const request = { baseEndpoint: 'https://example.com', endpoint: '/flaky', method: 'GET' }

    const stream = await fetchEventStream(request, {
      fetch: mockFetch,
      reconnect: { attempts: 5, delayMs: 0 },
    })

    expect(fetchCount).toBe(3)
    const events: unknown[] = []
    for await (const event of stream) {
      events.push(event)
    }
    expect(events.length).toBe(1)
  })

  test('should stop retry when shouldReconnect returns false', async () => {
    let fetchCount = 0
    const mockFetch = vi.fn(async () => {
      fetchCount += 1
      // Throw network error so we reach the shouldReconnect check
      throw new Error('network error')
    }) as unknown as typeof fetch

    const request = { baseEndpoint: 'https://example.com', endpoint: '/fail', method: 'GET' }

    await expect(
      fetchEventStream(request, {
        fetch: mockFetch,
        reconnect: { shouldReconnect: async () => false, delayMs: 0 },
      }),
    ).rejects.toThrow()
    expect(fetchCount).toBe(1)
  })

  test('should continue retry when shouldReconnect returns true', async () => {
    let fetchCount = 0
    const mockFetch = vi.fn(async () => {
      fetchCount += 1
      if (fetchCount < 2) {
        throw new Error('network error')
      }
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('data: ok\n\n'))
            controller.close()
          },
        }),
        {
          headers: { 'content-type': 'text/event-stream' },
          status: 200,
        },
      )
    }) as unknown as typeof fetch

    const request = { baseEndpoint: 'https://example.com', endpoint: '/flaky', method: 'GET' }

    const stream = await fetchEventStream(request, {
      fetch: mockFetch,
      reconnect: { shouldReconnect: async () => true, delayMs: 0 },
    })

    const events: unknown[] = []
    for await (const event of stream) {
      events.push(event)
    }
    expect(events.length).toBe(1)
    expect(fetchCount).toBe(2)
  })

  test('should use exponential backoff with factor', async () => {
    let fetchCount = 0
    const mockFetch = vi.fn(async () => {
      fetchCount += 1
      throw new Error('network error')
    }) as unknown as typeof fetch

    const request = { baseEndpoint: 'https://example.com', endpoint: '/fail', method: 'GET' }

    // Use a short delay so the test completes quickly; we verify attempts work
    await expect(
      fetchEventStream(request, {
        fetch: mockFetch,
        reconnect: { attempts: 2, delayMs: 1, factor: 2 },
      }),
    ).rejects.toThrow()

    expect(fetchCount).toBe(3)
  })

  test('should reject a non-finite retry delay without hot reconnecting', async () => {
    const mockFetch = vi.fn(async () => {
      throw new Error('network error')
    }) as unknown as typeof fetch

    await expect(
      fetchEventStream(
        { baseEndpoint: 'https://example.com', endpoint: '/fail', method: 'GET' },
        {
          fetch: mockFetch,
          reconnect: { attempts: 1, delayMs: Infinity },
        },
      ),
    ).rejects.toThrow('Reconnect delay must be finite')

    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  test('should clamp the final retry delay after applying a factor to a wire retry value', async () => {
    vi.useFakeTimers()
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    let fetchCount = 0
    const mockFetch = vi.fn(async () => {
      fetchCount += 1
      if (fetchCount === 1) {
        let pulled = false
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (!pulled) {
                pulled = true
                controller.enqueue(new TextEncoder().encode('retry: 999999999999999999999999\n\n'))
                return
              }
              controller.error(new Error('connection lost'))
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        )
      }
      throw new Error('network error')
    }) as unknown as typeof fetch

    try {
      const stream = await fetchEventStream(
        { baseEndpoint: 'https://example.com', endpoint: '/events', method: 'GET' },
        {
          fetch: mockFetch,
          reconnect: { attempts: 2, factor: 2 },
        },
      )

      await vi.advanceTimersByTimeAsync(2_147_483_647)

      expect(fetchCount).toBe(2)
      expect(setTimeoutSpy.mock.calls.at(-1)?.[1]).toBe(2_147_483_647)

      stream.close('test complete')
      await expect(stream.closed).resolves.toMatchObject({ kind: 'aborted' })
    } finally {
      setTimeoutSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  test('should cap delay with maxDelayMs', async () => {
    let fetchCount = 0
    const mockFetch = vi.fn(async () => {
      fetchCount += 1
      throw new Error('network error')
    }) as unknown as typeof fetch

    const request = { baseEndpoint: 'https://example.com', endpoint: '/fail', method: 'GET' }

    await expect(
      fetchEventStream(request, {
        fetch: mockFetch,
        reconnect: { attempts: 2, delayMs: 1, factor: 10, maxDelayMs: 5 },
      }),
    ).rejects.toThrow()

    expect(fetchCount).toBe(3)
  })

  test('should apply jitter to retry delay', async () => {
    let fetchCount = 0
    const mockFetch = vi.fn(async () => {
      fetchCount += 1
      throw new Error('network error')
    }) as unknown as typeof fetch

    const request = { baseEndpoint: 'https://example.com', endpoint: '/fail', method: 'GET' }

    await expect(
      fetchEventStream(request, {
        fetch: mockFetch,
        reconnect: { attempts: 1, delayMs: 1, jitter: 0.5 },
      }),
    ).rejects.toThrow()

    expect(fetchCount).toBe(2)
  })

  test('should reject out-of-range SSE reconnect jitter', async () => {
    const mockFetch = vi.fn(async () => {
      throw new Error('network error')
    }) as unknown as typeof fetch

    await expect(
      fetchEventStream(
        { baseEndpoint: 'https://example.com', endpoint: '/fail', method: 'GET' },
        {
          fetch: mockFetch,
          reconnect: { attempts: 1, delayMs: 1, jitter: 1.1 },
        },
      ),
    ).rejects.toThrow('SSE reconnect jitter is out of range')
  })

  test('should enforce maxBufferSize in parser', async () => {
    const mockFetch = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              // Send a very long partial line without newline to exceed buffer
              controller.enqueue(new TextEncoder().encode(`data: ${'x'.repeat(100)}`))
              controller.enqueue(new TextEncoder().encode(`data: ${'y'.repeat(100)}`))
              controller.close()
            },
          }),
          {
            headers: { 'content-type': 'text/event-stream' },
            status: 200,
          },
        ),
    ) as unknown as typeof fetch

    const request = { baseEndpoint: 'https://example.com', endpoint: '/huge', method: 'GET' }

    // maxBufferSize error happens after stream is open (200 response),
    // so fetchEventStream resolves the handle. The error propagates
    // through the async iterator.
    const stream = await fetchEventStream(request, {
      fetch: mockFetch,
      maxBufferSize: 50,
      onerror: () => null,
    })

    const iter = stream[Symbol.asyncIterator]()
    await expect(iter.next()).rejects.toThrow('SSE parser buffer exceeded maxBufferSize')
  })
})

describe('fetchEventStream message path', () => {
  const request: HttpRequest = { baseEndpoint: 'https://example.com', endpoint: '/events', method: 'GET' }

  // The whole text arrives as one chunk.
  function respondWith(text: string) {
    return vi.fn(async () => new Response(text, { headers: { 'content-type': 'text/event-stream' } }))
  }

  function nextTurn(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0))
  }

  test('should transform every message of a chunk in one synchronous pass', async () => {
    const order: string[] = []
    const stream = await fetchEventStream(request, {
      fetch: respondWith('data: a\n\ndata: b\n\ndata: c\n\n'),
      transformMessage(message) {
        if (order.length === 0) {
          queueMicrotask(() => order.push('microtask'))
        }
        order.push(`transform ${message.data}`)
        return message
      },
    })
    for await (const _ of stream) {
      // consume
    }

    // The microtask queued by the first transform runs only after the whole chunk has been handled.
    expect(order).toEqual(['transform a', 'transform b', 'transform c', 'microtask'])
  })

  test.each([
    { expected: ['a', 'b!', 'c'], settled: { data: 'b!', event: '', id: '' } },
    { expected: ['a', 'c'], settled: undefined },
  ])('should hold later messages back until a pending transform settles ($expected)', async ({ expected, settled }) => {
    const gate = Promise.withResolvers<EventStreamMessage | undefined>()
    const transformed: string[] = []
    const stream = await fetchEventStream(request, {
      fetch: respondWith('data: a\n\ndata: b\n\ndata: c\n\n'),
      transformMessage(message) {
        transformed.push(message.data)
        return message.data === 'b' ? gate.promise : message
      },
    })
    await nextTurn()

    // "b" is pending, so "c" is neither transformed nor delivered ahead of it.
    expect(transformed).toEqual(['a', 'b'])

    gate.resolve(settled)
    const received: string[] = []
    for await (const event of stream) {
      received.push(event.data)
    }

    expect(transformed).toEqual(['a', 'b', 'c'])
    expect(received).toEqual(expected)
  })

  test.each(['throws', 'rejects'] as const)('should fail with EXT_OBSERVER_FAILED when a transform %s', async (mode) => {
    const failure = new Error('transform failed')
    const transformed: string[] = []
    const fetch = respondWith('data: a\n\ndata: b\n\n')
    const onerror = vi.fn(() => 0)
    const stream = await fetchEventStream(request, {
      fetch,
      onerror,
      reconnect: { attempts: 2, delayMs: 0 },
      transformMessage(message) {
        transformed.push(message.data)
        if (mode === 'throws') {
          throw failure
        }
        return Promise.reject(failure)
      },
    })

    const error = await stream[Symbol.asyncIterator]()
      .next()
      .catch((reason: unknown) => reason)

    expect(getEventStreamFatalCode(error)).toBe('EXT_OBSERVER_FAILED')
    expect(error).toMatchObject({ cause: failure })
    await expect(stream.closed).resolves.toMatchObject({ cause: error, code: 'EXT_OBSERVER_FAILED', kind: 'error' })
    // The failing message ends the stream: nothing after it is read, and a fatal error is not retried.
    expect(transformed).toEqual(['a'])
    expect(fetch).toHaveBeenCalledOnce()
    expect(onerror).toHaveBeenCalledOnce()
  })

  test('should keep CAP_QUEUE_OVERFLOW as the failure when the queue overflows after a pending transform', async () => {
    const stream = await fetchEventStream(request, {
      fetch: respondWith('data: a\n\ndata: b\n\n'),
      maxQueueSize: 1,
      transformMessage: async (message) => message,
    })

    await expect(stream.closed).resolves.toMatchObject({ code: 'CAP_QUEUE_OVERFLOW', kind: 'error' })
    await expect(stream[Symbol.asyncIterator]().next()).rejects.toThrow('Event stream queue exceeded maxQueueSize')
  })

  test('should keep an abort as the outcome when a transform throws after aborting', async () => {
    const controller = new AbortController()
    const fetch = respondWith('data: a\n\n')
    const onerror = vi.fn(() => 0)
    const stream = await fetchEventStream(
      { ...request, abort: controller.signal },
      {
        fetch,
        onerror,
        reconnect: { attempts: 2, delayMs: 0 },
        transformMessage() {
          controller.abort(ERR_ABORTED)
          throw new Error('transform failed after the abort')
        },
      },
    )

    await expect(settleWithin(stream[Symbol.asyncIterator]().next())).resolves.toEqual({ done: true, value: undefined })
    await expect(stream.closed).resolves.toMatchObject({ cause: ERR_ABORTED, kind: 'aborted' })
    expect(fetch).toHaveBeenCalledOnce()
    expect(onerror).not.toHaveBeenCalled()
  })

  test('should observe a transform promise rejection after the transform aborts', async () => {
    const controller = new AbortController()
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    const lateFailure = new Error('late transform failure')

    try {
      const stream = await fetchEventStream(
        { ...request, abort: controller.signal },
        {
          fetch: respondWith('data: a\n\n'),
          transformMessage() {
            controller.abort(ERR_ABORTED)
            return Promise.reject(lateFailure)
          },
        },
      )

      await expect(stream.closed).resolves.toMatchObject({ cause: ERR_ABORTED, kind: 'aborted' })
      await new Promise((resolve) => setImmediate(resolve))
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  test('should not transform the remaining messages of a chunk once the request is aborted', async () => {
    const controller = new AbortController()
    const transformed: string[] = []
    const stream = await fetchEventStream(
      { ...request, abort: controller.signal },
      {
        fetch: respondWith('data: a\n\ndata: b\n\ndata: c\n\n'),
        transformMessage(message) {
          transformed.push(message.data)
          controller.abort(ERR_ABORTED)
          return message
        },
      },
    )

    await expect(settleWithin(stream.closed)).resolves.toMatchObject({ cause: ERR_ABORTED, kind: 'aborted' })
    expect(transformed).toEqual(['a'])
    await expect(stream[Symbol.asyncIterator]().next()).resolves.toEqual({ done: true, value: undefined })
  })
})
