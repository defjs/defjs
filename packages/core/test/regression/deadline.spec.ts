import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  createClient,
  createHttpInterceptor,
  createSSEInterceptor,
  createWebSocketInterceptor,
  defineRequest,
  defineEventStream,
  defineWebSocket,
  makeResponse,
  struct,
  withEndpoint,
  withInterceptors,
  withHTTPHandle,
  withQuerySerializer,
  withSSEHandle,
  withWebSocketHandle,
} from '../../src'
import type { WebSocketSessionLike } from '../../src/interceptor'
import type { EventStreamHandle } from '../../src/sse'

afterEach(() => {
  vi.useRealTimers()
})

function replacementStream(): EventStreamHandle<unknown> {
  const closed = Promise.resolve({ kind: 'eof' as const })
  return {
    closed,
    close() {},
    open: {
      response: makeResponse({ status: 200, url: 'https://example.test/events' }),
      url: 'https://example.test/events',
    },
    [Symbol.asyncDispose]() {
      return closed.then(() => undefined)
    },
    async *[Symbol.asyncIterator]() {},
  }
}

function replacementSession(): WebSocketSessionLike {
  return {
    bufferedAmount: 0,
    close() {},
    closed: Promise.resolve({ kind: 'closed' }),
    connection: { generation: 1 },
    onRuntimeError: () => () => {},
    onStateChange: () => () => {},
    receive: {
      async *[Symbol.asyncIterator]() {},
    },
    send() {},
    state: 'closed',
    [Symbol.asyncDispose]() {
      return this.closed.then(() => undefined)
    },
  }
}

function occupyEventLoop(ms: number): void {
  const startedAt = Date.now()
  while (Date.now() - startedAt < ms) {
    // Deliberately block the event loop to exercise the wall-clock deadline check.
  }
}

function reconnectingSocketClass(onConstruct: () => number): typeof WebSocket {
  return class ReconnectingSocket {
    static OPEN = 1
    static CONNECTING = 0
    static CLOSING = 2
    static CLOSED = 3

    readonly url: string
    readyState = ReconnectingSocket.CONNECTING
    bufferedAmount = 0
    binaryType = 'arraybuffer'
    extensions = ''
    protocol = ''
    private readonly listeners: Record<string, Array<(event: unknown) => void>> = Object.create(null)

    constructor(url: string) {
      this.url = url
      const constructed = onConstruct()
      queueMicrotask(() => {
        if (this.readyState !== ReconnectingSocket.CONNECTING) {
          return
        }
        this.readyState = ReconnectingSocket.OPEN
        this.emit('open', {})
        if (constructed !== 1) {
          return
        }
        setTimeout(() => {
          if (this.readyState === ReconnectingSocket.CLOSED) {
            return
          }
          this.readyState = ReconnectingSocket.CLOSED
          this.emit('close', { code: 1006, reason: 'drop', wasClean: false })
        }, 20)
      })
    }

    addEventListener(type: string, listener: (event: unknown) => void): void {
      ;(this.listeners[type] ??= []).push(listener)
    }

    removeEventListener(type: string, listener: (event: unknown) => void): void {
      this.listeners[type] = (this.listeners[type] ?? []).filter((item) => item !== listener)
    }

    send(): void {}

    close(): void {
      this.readyState = ReconnectingSocket.CLOSED
      this.emit('close', { code: 1000, reason: '', wasClean: true })
    }

    private emit(type: string, event: unknown): void {
      for (const listener of this.listeners[type] ?? []) listener(event)
    }
  } as unknown as typeof WebSocket
}

function openingSocketClass(): typeof WebSocket {
  return class OpeningSocket {
    static OPEN = 1
    static CONNECTING = 0
    static CLOSING = 2
    static CLOSED = 3

    readonly url: string
    readyState = OpeningSocket.CONNECTING
    bufferedAmount = 0
    binaryType = 'arraybuffer'
    extensions = ''
    protocol = ''
    private readonly listeners: Record<string, Array<(event: unknown) => void>> = Object.create(null)

    constructor(url: string) {
      this.url = url
      queueMicrotask(() => {
        this.readyState = OpeningSocket.OPEN
        this.emit('open', {})
      })
    }

    addEventListener(type: string, listener: (event: unknown) => void): void {
      ;(this.listeners[type] ??= []).push(listener)
    }

    removeEventListener(type: string, listener: (event: unknown) => void): void {
      this.listeners[type] = (this.listeners[type] ?? []).filter((item) => item !== listener)
    }

    send(): void {}

    close(): void {
      this.readyState = OpeningSocket.CLOSED
      this.emit('close', { code: 1000, reason: '', wasClean: true })
    }

    private emit(type: string, event: unknown): void {
      for (const listener of this.listeners[type] ?? []) listener(event)
    }
  } as unknown as typeof WebSocket
}

describe('transport deadline lifecycle re-audit', () => {
  test('rejects an HTTP transport that starts after a synchronous interceptor exceeds timeout', async () => {
    const client = createClient(
      withEndpoint('https://example.test'),
      withHTTPHandle(async () => new Response(null, { status: 204 })),
      withInterceptors(
        createHttpInterceptor((request, next) => {
          occupyEventLoop(30)
          return next(request)
        }),
      ),
    )
    const endpoint = defineRequest({ method: 'GET', path: '/slow-interceptor' })

    const [error] = await client.execute(endpoint(), { timeout: 5 })
    expect(error?.code).toBe('NET_TIMEOUT')
  })

  test('preserves an earlier caller abort when synchronous parsing later crosses the timeout', async () => {
    const controller = new AbortController()
    const input = {} as { id: string }
    Object.defineProperty(input, 'id', {
      enumerable: true,
      get() {
        controller.abort('caller stopped')
        occupyEventLoop(30)
        return 'ok'
      },
    })
    const client = createClient(withEndpoint('https://example.test'))
    const endpoint = defineRequest({
      builder: () => ({}),
      input: struct.object({ id: struct.string() }),
      method: 'GET',
      path: '/cancelled-parse',
    })

    const [error] = await client.execute(endpoint(input), { signal: controller.signal, timeout: 5 })
    expect(error?.code).toBe('NET_ABORTED')
  })

  test('rejects a WebSocket query serializer that starts transport after timeout', async () => {
    const client = createClient(
      withEndpoint('https://example.test'),
      withQuerySerializer((query) => {
        occupyEventLoop(30)
        return new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)])).toString()
      }),
      withWebSocketHandle(openingSocketClass()),
    )
    const endpoint = defineWebSocket({
      builder: () => ({ query: { id: 'slow' } }),
      incoming: struct.unknown(),
      maxIncomingQueueSize: 4,
      path: '/socket',
    })

    const [error, session] = await client.execute(endpoint(), { timeout: 5 })
    session?.close()
    await session?.closed
    expect(error?.code).toBe('NET_TIMEOUT')
  })

  test('does not construct a WebSocket after a synchronous beforeConnect exceeds timeout', async () => {
    let constructed = 0
    const client = createClient(
      withEndpoint('https://example.test'),
      withWebSocketHandle(
        class {
          static OPEN = 1
          constructor() {
            constructed += 1
          }
        } as unknown as typeof WebSocket,
      ),
    )
    const endpoint = defineWebSocket({ incoming: struct.unknown(), maxIncomingQueueSize: 4, path: '/socket' })

    const [error, session] = await client.execute(endpoint(), {
      beforeConnect() {
        occupyEventLoop(30)
      },
      timeout: 5,
    })

    expect(constructed).toBe(0)
    expect(session).toBeUndefined()
    expect(error?.code).toBe('NET_TIMEOUT')
  })

  test('releases an SSE deadline after normal EOF', async () => {
    vi.useFakeTimers()
    let requestSignal: AbortSignal | undefined
    const client = createClient(
      withEndpoint('https://example.test'),
      withInterceptors(
        createSSEInterceptor((request, next) => {
          requestSignal = request.abort
          return next(request)
        }),
      ),
      withSSEHandle(
        async () =>
          new Response('event: message\ndata: "ok"\n\n', {
            headers: { 'content-type': 'text/event-stream' },
          }),
      ),
    )
    const endpoint = defineEventStream({ events: { message: struct.string() }, maxBufferSize: 1024, maxQueueSize: 4, path: '/events' })

    const [error, stream] = await client.execute(endpoint(), { timeout: 100 })
    expect(error).toBeNull()
    await stream?.closed
    expect(requestSignal?.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(101)
    expect(requestSignal?.aborted).toBe(false)
  })

  test('releases an SSE deadline after a startup fault', async () => {
    vi.useFakeTimers()
    let requestSignal: AbortSignal | undefined
    const client = createClient(
      withEndpoint('https://example.test'),
      withInterceptors(
        createSSEInterceptor((request, next) => {
          requestSignal = request.abort
          return next(request)
        }),
      ),
      withSSEHandle(async () => new Response('not an event stream', { headers: { 'content-type': 'text/plain' } })),
    )
    const endpoint = defineEventStream({ events: { message: struct.string() }, maxBufferSize: 1024, maxQueueSize: 4, path: '/events' })

    const [error, stream] = await client.execute(endpoint(), { timeout: 100 })
    expect(error).toBeTruthy()
    expect(stream).toBeUndefined()
    expect(requestSignal?.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(101)
    expect(requestSignal?.aborted).toBe(false)
  })

  test('releases a WebSocket deadline after an interceptor short-circuits', async () => {
    vi.useFakeTimers()
    let requestSignal: AbortSignal | undefined
    const client = createClient(
      withEndpoint('https://example.test'),
      withInterceptors(
        createWebSocketInterceptor(async (request) => {
          requestSignal = request.abort
          return replacementSession()
        }),
      ),
    )
    const endpoint = defineWebSocket({ incoming: struct.unknown(), maxIncomingQueueSize: 4, path: '/socket' })

    const [error, session] = await client.execute(endpoint(), { timeout: 100 })
    expect(error).toBeNull()
    expect(session).toBeDefined()
    expect(requestSignal?.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(101)
    expect(requestSignal?.aborted).toBe(false)
  })

  test('does not start an HTTP fetch after a synchronous interceptor exceeds timeout', async () => {
    let fetches = 0
    const client = createClient(
      withEndpoint('https://example.test'),
      withHTTPHandle(async () => {
        fetches += 1
        return new Response(null, { status: 204 })
      }),
      withInterceptors(
        createHttpInterceptor((request, next) => {
          occupyEventLoop(30)
          return next(request)
        }),
      ),
    )
    const endpoint = defineRequest({ method: 'GET', path: '/slow-interceptor' })

    const [error] = await client.execute(endpoint(), { timeout: 5 })
    expect(fetches).toBe(0)
    expect(error?.code).toBe('NET_TIMEOUT')
  })

  test('does not start an SSE fetch after a synchronous interceptor exceeds timeout', async () => {
    let fetches = 0
    const client = createClient(
      withEndpoint('https://example.test'),
      withInterceptors(
        createSSEInterceptor((request, next) => {
          occupyEventLoop(30)
          return next(request)
        }),
      ),
      withSSEHandle(async () => {
        fetches += 1
        return new Response('event: message\ndata: "ok"\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        })
      }),
    )
    const endpoint = defineEventStream({ events: { message: struct.string() }, maxBufferSize: 1024, maxQueueSize: 4, path: '/events' })

    const [error, stream] = await client.execute(endpoint(), { timeout: 5 })
    stream?.close()
    expect(fetches).toBe(0)
    expect(error?.code).toBe('NET_TIMEOUT')
  })

  test('releases an SSE deadline after an interceptor short-circuits', async () => {
    vi.useFakeTimers()
    let requestSignal: AbortSignal | undefined
    const client = createClient(
      withEndpoint('https://example.test'),
      withInterceptors(
        createSSEInterceptor((request) => {
          requestSignal = request.abort
          return Promise.resolve(replacementStream())
        }),
      ),
    )
    const endpoint = defineEventStream({ events: { message: struct.string() }, maxBufferSize: 1024, maxQueueSize: 4, path: '/events' })

    const [error, stream] = await client.execute(endpoint(), { timeout: 100 })
    expect(error).toBeNull()
    expect(stream).toBeDefined()
    expect(requestSignal?.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(101)
    expect(requestSignal?.aborted).toBe(false)
  })

  test('releases a WebSocket deadline after the socket opens', async () => {
    vi.useFakeTimers()
    let requestSignal: AbortSignal | undefined
    const client = createClient(
      withEndpoint('https://example.test'),
      withInterceptors(
        createWebSocketInterceptor((request, next) => {
          requestSignal = request.abort
          return next(request)
        }),
      ),
      withWebSocketHandle(openingSocketClass()),
    )
    const endpoint = defineWebSocket({ incoming: struct.unknown(), maxIncomingQueueSize: 4, path: '/socket' })

    const [error, session] = await client.execute(endpoint(), { timeout: 30 })
    expect(error).toBeNull()
    expect(session).toBeDefined()
    expect(requestSignal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(31)
    expect(requestSignal?.aborted).toBe(false)
    session?.close()
    await session?.closed
  })

  test('does not let the original startup deadline abort a WebSocket reconnect', async () => {
    let constructed = 0
    const client = createClient(
      withEndpoint('https://example.test'),
      withInterceptors(
        createWebSocketInterceptor(async (request, next) => {
          const session = await next(request)
          await vi.waitFor(() => expect(session.connection.generation).toBe(2))
          return session
        }),
      ),
      withWebSocketHandle(
        reconnectingSocketClass(() => {
          constructed += 1
          return constructed
        }),
      ),
    )
    const endpoint = defineWebSocket({ incoming: struct.unknown(), maxIncomingQueueSize: 4, path: '/socket' })

    const [error, session] = await client.execute(endpoint(), {
      reconnect: { attempts: 1, delayMs: 40 },
      timeout: 30,
    })
    expect(error).toBeNull()
    expect(constructed).toBe(2)
    expect(session?.connection.generation).toBe(2)
    session?.close()
    await session?.closed
  })
})
