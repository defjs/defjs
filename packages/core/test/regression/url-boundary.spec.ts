import { describe, expect, test, vi } from 'vitest'
import {
  createClient,
  createHttpInterceptor,
  createSSEInterceptor,
  createWebSocketInterceptor,
  defineEventStream,
  defineRequest,
  defineWebSocket,
  struct,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
  withSSEHandle,
  withSSEReconnect,
  withWebSocketHandle,
} from '../../src'

function socketHandle(constructed: (url: string) => void) {
  return class Socket extends EventTarget {
    static readonly OPEN = 1
    readyState = 0
    bufferedAmount = 0
    protocol = ''
    extensions = ''
    readonly url: string
    constructor(url: string | URL) {
      super()
      this.url = String(url)
      constructed(this.url)
      queueMicrotask(() => {
        if (this.readyState !== 0) return
        this.readyState = 1
        this.dispatchEvent(new Event('open'))
      })
    }
    send(_data: string) {}
    close() {
      this.readyState = 3
      this.dispatchEvent(new Event('close'))
    }
  }
}

const invalidPaths = [
  '\\\\other.example/x',
  '/\\\\other.example/x',
  '\\/other.example/x',
  ' https://other.example/x',
  '\thttps://other.example/x',
  'h\tttps://other.example/x',
  '\t//other.example/x',
  '\n//other.example/x',
  'x\ny',
  'x\ty',
  'x\u0000y',
  'x\u001fy',
  'x\ry',
  ' //trusted.example/api/x',
  'https://trusted.example/api/x',
  '//trusted.example/api/x',
  '../outside',
  '%2e%2e/outside',
  'nested/../../outside',
  '/events?secret=1',
  '/events#fragment',
]

function commands(path: string) {
  return {
    http: defineRequest({ method: 'GET', path })(),
    sse: defineEventStream({ path, events: { message: struct.string() }, maxBufferSize: 1024, maxQueueSize: 4 })(),
    ws: defineWebSocket({ path, incoming: struct.string(), maxIncomingQueueSize: 4 })(),
  }
}

describe.each(['http', 'sse', 'ws'] as const)('%s URL boundary', (transport) => {
  test.each(invalidPaths)('rejects definition path %j before interceptors or transport', async (path) => {
    const handle = vi.fn(async () => new Response(null, { status: 204 }))
    const constructed = vi.fn()
    const Socket = socketHandle(constructed)
    const interceptor = vi.fn(() => {
      throw new Error('Must not run')
    })
    const shouldReconnect = vi.fn(() => true)
    const client = createClient(
      withEndpoint('https://trusted.example/api'),
      withHTTPHandle(handle),
      withSSEHandle(handle),
      withWebSocketHandle(Socket),
      withSSEReconnect({ attempts: 2, delayMs: 0, shouldReconnect }),
      withInterceptors(createHttpInterceptor(interceptor), createSSEInterceptor(interceptor), createWebSocketInterceptor(interceptor)),
    )
    const command = commands(path)
    const [fault, delivered] = await (transport === 'http'
      ? client.execute(command.http)
      : transport === 'sse'
        ? client.execute(command.sse)
        : client.execute(command.ws))
    delivered?.close()
    expect(fault?.code).toBe('REQ_BUILD_FAILED')
    expect(handle).not.toHaveBeenCalled()
    expect(constructed).not.toHaveBeenCalled()
    expect(interceptor).not.toHaveBeenCalled()
    expect(shouldReconnect).not.toHaveBeenCalled()
  })

  test.each(['', '/api', 'not a url'])('rejects client endpoint %j as a build failure', async (endpoint) => {
    const handle = vi.fn(async () => new Response(null, { status: 204 }))
    const constructed = vi.fn()
    const Socket = socketHandle(constructed)
    const shouldReconnect = vi.fn(() => true)
    const client = createClient(
      withEndpoint(endpoint),
      withHTTPHandle(handle),
      withSSEHandle(handle),
      withWebSocketHandle(Socket),
      withSSEReconnect({ attempts: 2, delayMs: 0, shouldReconnect }),
    )
    const command = commands('/events')
    const [fault, delivered] = await (transport === 'http'
      ? client.execute(command.http)
      : transport === 'sse'
        ? client.execute(command.sse)
        : client.execute(command.ws))
    delivered?.close()
    expect(fault?.code).toBe('REQ_BUILD_FAILED')
    expect(handle).not.toHaveBeenCalled()
    expect(constructed).not.toHaveBeenCalled()
    expect(shouldReconnect).not.toHaveBeenCalled()
  })

  test.each(invalidPaths)('rejects interceptor path %j before transport or reconnect', async (path) => {
    const handle = vi.fn(async () => new Response(null, { status: 204 }))
    const constructed = vi.fn()
    const Socket = socketHandle(constructed)
    const shouldReconnect = vi.fn(() => true)
    const client = createClient(
      withEndpoint('https://trusted.example/api'),
      withHTTPHandle(handle),
      withSSEHandle(handle),
      withWebSocketHandle(Socket),
      withSSEReconnect({ attempts: 2, delayMs: 0, shouldReconnect }),
      withInterceptors(
        createHttpInterceptor((request, next) => next({ ...request, endpoint: path })),
        createSSEInterceptor((request, next) => next({ ...request, endpoint: path })),
        createWebSocketInterceptor((request, next) => next({ ...request, endpoint: path })),
      ),
    )
    const command = commands('/events')
    const [fault, delivered] = await (transport === 'http'
      ? client.execute(command.http)
      : transport === 'sse'
        ? client.execute(command.sse)
        : client.execute(command.ws))
    delivered?.close()
    expect(fault?.code).toBe('REQ_BUILD_FAILED')
    expect(handle).not.toHaveBeenCalled()
    expect(constructed).not.toHaveBeenCalled()
    expect(shouldReconnect).not.toHaveBeenCalled()
  })

  test.each(['', '/api', 'not a url'])('rejects interceptor base %j as a build failure', async (baseEndpoint) => {
    const handle = vi.fn(async () => new Response(null, { status: 204 }))
    const constructed = vi.fn()
    const Socket = socketHandle(constructed)
    const shouldReconnect = vi.fn(() => true)
    const client = createClient(
      withEndpoint('https://trusted.example/api'),
      withHTTPHandle(handle),
      withSSEHandle(handle),
      withWebSocketHandle(Socket),
      withSSEReconnect({ attempts: 2, delayMs: 0, shouldReconnect }),
      withInterceptors(
        createHttpInterceptor((request, next) => next({ ...request, baseEndpoint })),
        createSSEInterceptor((request, next) => next({ ...request, baseEndpoint })),
        createWebSocketInterceptor((request, next) => next({ ...request, baseEndpoint })),
      ),
    )
    const command = commands('/events')
    const [fault] = await (transport === 'http'
      ? client.execute(command.http)
      : transport === 'sse'
        ? client.execute(command.sse)
        : client.execute(command.ws))
    expect(fault?.code).toBe('REQ_BUILD_FAILED')
    expect(handle).not.toHaveBeenCalled()
    expect(constructed).not.toHaveBeenCalled()
    expect(shouldReconnect).not.toHaveBeenCalled()
  })
})

describe.each(['http', 'sse'] as const)('%s interceptor URL rejection', (transport) => {
  test('allows an invalid next promise to be discarded without an unhandled rejection', async () => {
    const client = createClient(
      withEndpoint('https://trusted.example/api'),
      withHTTPHandle(async () => new Response(null, { status: 204 })),
      withSSEHandle(async () => new Response('data: hi\n\n', { headers: { 'content-type': 'text/event-stream' } })),
      withInterceptors(
        createHttpInterceptor((request, next) => {
          void next({ ...request, baseEndpoint: '' })
          return next(request)
        }),
        createSSEInterceptor((request, next) => {
          void next({ ...request, baseEndpoint: '' })
          return next(request)
        }),
      ),
    )
    const command = commands('/events')
    const [fault, stream] = await (transport === 'http' ? client.execute(command.http) : client.execute(command.sse))
    stream?.close()
    expect(fault).toBeNull()
  })

  test.each(['catch', 'then'] as const)('allows promise %s recovery from an invalid next request', async (mode) => {
    let recovered = false
    const client = createClient(
      withEndpoint('https://trusted.example/api'),
      withHTTPHandle(async () => new Response(null, { status: 204 })),
      withSSEHandle(async () => new Response('data: hi\n\n', { headers: { 'content-type': 'text/event-stream' } })),
      withInterceptors(
        createHttpInterceptor((request, next) => {
          const recover = (error: unknown) => {
            expect(error).toBeInstanceOf(TypeError)
            recovered = true
            return next(request)
          }
          const pending = next(mode === 'catch' ? { ...request, baseEndpoint: '' } : { ...request, endpoint: '//other.example/x' })
          return mode === 'catch' ? pending.catch(recover) : pending.then(undefined, recover)
        }),
        createSSEInterceptor((request, next) => {
          const recover = (error: unknown) => {
            expect(error).toBeInstanceOf(TypeError)
            recovered = true
            return next(request)
          }
          const pending = next(mode === 'catch' ? { ...request, baseEndpoint: '' } : { ...request, endpoint: '//other.example/x' })
          return mode === 'catch' ? pending.catch(recover) : pending.then(undefined, recover)
        }),
      ),
    )
    const command = commands('/events')
    const [fault, stream] = await (transport === 'http' ? client.execute(command.http) : client.execute(command.sse))
    stream?.close()
    expect(recovered).toBe(true)
    expect(fault).toBeNull()
  })
})

test.each([
  { path: 'x y', encoded: 'x%20y' },
  { path: '/a b/ü', encoded: 'a%20b/%C3%BC' },
  { path: '/a%20b/ü', encoded: 'a%20b/%C3%BC' },
  { path: '/a\u00a0b', encoded: 'a%C2%A0b' },
  { path: '\u00a0//local', encoded: '%C2%A0//local' },
])('allows same-directory path $path across HTTP, SSE and WebSocket', async ({ path, encoded }) => {
  const urls: string[] = []
  const client = createClient(
    withEndpoint('https://trusted.example/api'),
    withHTTPHandle(async (request) => {
      urls.push(new Request(request).url)
      return new Response(null, { status: 204 })
    }),
    withSSEHandle(async (request) => {
      urls.push(new Request(request).url)
      return new Response('data: hi\n\n', { headers: { 'content-type': 'text/event-stream' } })
    }),
    withWebSocketHandle(socketHandle((url) => urls.push(url))),
  )
  const command = commands(path)
  expect((await client.execute(command.http))[0]).toBeNull()
  const [streamFault, stream] = await client.execute(command.sse)
  expect(streamFault).toBeNull()
  await stream?.[Symbol.asyncDispose]()
  const [socketFault, socket] = await client.execute(command.ws)
  try {
    expect(socketFault).toBeNull()
    expect(urls).toEqual([
      `https://trusted.example/api/${encoded}`,
      `https://trusted.example/api/${encoded}`,
      `wss://trusted.example/api/${encoded}`,
    ])
  } finally {
    socket?.close()
  }
})

test('relative interceptor rewrites share HTTP, SSE and WebSocket URL rules', async () => {
  const urls: string[] = []
  const Socket = socketHandle((url) => urls.push(url))
  const client = createClient(
    withEndpoint('https://trusted.example/api?discard=1#discard'),
    withHTTPHandle(async (request) => {
      urls.push(new Request(request).url)
      return new Response(null, { status: 204 })
    }),
    withSSEHandle(async (request) => {
      urls.push(new Request(request).url)
      return new Response('data: hi\n\n', { headers: { 'content-type': 'text/event-stream' } })
    }),
    withWebSocketHandle(Socket),
    withInterceptors(
      createHttpInterceptor((request, next) => next({ ...request, endpoint: '/changed' })),
      createSSEInterceptor((request, next) => next({ ...request, endpoint: '/changed' })),
      createWebSocketInterceptor((request, next) => next({ ...request, endpoint: '/changed' })),
    ),
  )
  const command = commands('/events')
  expect((await client.execute(command.http))[0]).toBeNull()
  const [streamFault, stream] = await client.execute(command.sse)
  expect(streamFault).toBeNull()
  await stream?.[Symbol.asyncDispose]()
  const [socketFault, socket] = await client.execute(command.ws)
  try {
    expect(socketFault).toBeNull()
    expect(urls).toEqual([
      'https://trusted.example/api/changed',
      'https://trusted.example/api/changed',
      'wss://trusted.example/api/changed',
    ])
  } finally {
    socket?.close()
  }
})
