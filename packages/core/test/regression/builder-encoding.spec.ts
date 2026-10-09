import { describe, expect, inject, test, vi } from 'vitest'
import {
  createClient,
  createHttpInterceptor,
  createSSEInterceptor,
  createWebSocketInterceptor,
  defineEventStream,
  defineRequest,
  defineWebSocket,
  makeResponse,
  struct,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
  withQuerySerializer,
  withSSEHandle,
  withWebSocketHandle,
  type HttpRequest,
} from '../../src'
import { createHttpRequest } from '../../src/http/request'
import { parseEndpointInput } from '../../src/internal/endpoint_input'
import { materializeOutboundRequest } from '../../src/internal/outbound_request'
import { fillUrl } from '../../src/internal/url'
import { decodeJson } from '../../src/struct/codec/json'
import { STRUCT } from '../../src/struct/symbols'
import { serializeOutgoingWebSocketMessage, transformWebSocketMessage } from '../../src/web_socket/codec'
import { createControllableSocketClass, openControllableSocket } from './controllable_socket'

const iso = new Date('1815-12-10T00:00:00.000Z')

function tagOf(value: object): unknown {
  return (value as { [STRUCT]?: unknown })[STRUCT]
}

function responseStream(text: string): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text))
        controller.close()
      },
    }),
    { headers: { 'content-type': 'text/event-stream' }, status: 200 },
  )
}

describe('builder refactor adversarial audit', () => {
  test('propagates struct tags through unions, intersections, nullable values, arrays, and deep spreads', async () => {
    const Alpha = struct.object({ kind: struct.literal('alpha'), displayName: struct.string().alias('display_name') })
    const Beta = struct.object({ kind: struct.literal('beta'), count: struct.number().alias('count_value') })
    const Left = struct.object({ leftId: struct.number().alias('left_id') })
    const Right = struct.object({ rightName: struct.string().alias('right_name') })
    const Child = struct.object({ name: struct.string().alias('child_name'), when: struct.date() })
    const Root = struct.object({
      choice: struct.or(Alpha, Beta),
      both: struct.intersection(Left, Right),
      maybe: Child.nullable(),
      items: struct.array(Child),
      optional: Child.optional(),
    })

    const parsed = await parseEndpointInput(Root, {
      choice: { displayName: 'Ada', kind: 'alpha' },
      both: { leftId: 7, rightName: 'Lovelace' },
      items: [{ name: 'A', when: iso }],
      maybe: null,
    })
    const value = parsed as unknown as {
      choice: Record<string, unknown>
      both: Record<string, unknown>
      items: Record<string, unknown>[]
      maybe: null
    }

    expect(tagOf(parsed as object)).toBe(Root)
    expect(tagOf(value.choice)).toBe(Alpha)
    expect(tagOf(value.both)).toBeDefined()
    expect(tagOf(value.items[0] as object)).toBe(Child)
    expect(value.maybe).toBeNull()

    const request = createHttpRequest(
      'POST',
      '/audit',
      parsed,
      (input) => {
        const child = { ...(input as typeof value).items[0] }
        return { body: { choice: { ...(input as typeof value).choice }, both: (input as typeof value).both, child } }
      },
      {
        abort: new AbortController().signal,
        baseEndpoint: 'https://example.test',
      },
    )

    expect(request.body).toBe(
      '{"choice":{"kind":"alpha","display_name":"Ada"},"both":{"left_id":7,"right_name":"Lovelace"},"child":{"child_name":"A","when":"1815-12-10T00:00:00.000Z"}}',
    )
  })

  test('keeps endpoint tags visible only to symbol-aware code', async () => {
    const User = struct.object({ displayName: struct.string().alias('display_name') })
    const parsed = await parseEndpointInput(User, { displayName: 'Ada' })

    expect(Object.keys(parsed as object)).toEqual(['displayName'])
    expect(JSON.stringify(parsed)).toBe('{"displayName":"Ada"}')
    expect(Object.getOwnPropertySymbols(parsed as object)).toContain(STRUCT)

    const [, publicValue] = struct.parse(User, { displayName: 'Ada' })
    expect(Object.getOwnPropertySymbols(publicValue as object)).not.toContain(STRUCT)
  })

  test('rejects alias collisions after a deep spread', async () => {
    const Child = struct.object({ displayName: struct.string().alias('display_name') })
    const Root = struct.object({ child: Child })
    const parsed = await parseEndpointInput(Root, { child: { displayName: 'Ada' } })

    expect(() =>
      createHttpRequest(
        'POST',
        '/audit',
        parsed,
        (input: { child: Record<string, unknown> }) => ({ body: { child: { ...input.child, display_name: 'shadow' } } }),
        { abort: new AbortController().signal, baseEndpoint: 'https://example.test' },
      ),
    ).toThrow(/display_name/)
  })

  test('preserves an own __proto__ body field instead of silently dropping it', () => {
    const body = Object.create(null) as Record<string, unknown>
    Object.defineProperty(body, '__proto__', { configurable: true, enumerable: true, value: 'safe', writable: true })
    const request = materializeOutboundRequest({ body }, 'http')
    const decoded = JSON.parse(request.body as string) as Record<string, unknown>

    expect(Object.hasOwn(decoded, '__proto__')).toBe(true)
    expect(decoded['__proto__']).toBe('safe')
    expect((Object.prototype as Record<string, unknown>)['polluted']).toBeUndefined()
  })

  test('preserves an own __proto__ query field for serializers', () => {
    const query = Object.create(null) as Record<string, unknown>
    Object.defineProperty(query, '__proto__', { configurable: true, enumerable: true, value: 'safe', writable: true })
    const request = materializeOutboundRequest({ query }, 'http')

    expect(Object.hasOwn(request.query as object, '__proto__')).toBe(true)
    expect((request.query as Record<string, unknown>)['__proto__']).toBe('safe')
    expect((Object.prototype as Record<string, unknown>)['polluted']).toBeUndefined()
  })

  test('preserves an own __proto__ header field instead of silently dropping it', () => {
    const headers = Object.create(null) as Record<string, unknown>
    Object.defineProperty(headers, '__proto__', { configurable: true, enumerable: true, value: 'safe', writable: true })
    const request = materializeOutboundRequest({ headers }, 'http')

    expect(Object.hasOwn(request.headers as object, '__proto__')).toBe(true)
    expect((request.headers as Record<string, unknown>)['__proto__']).toBe('safe')
    expect((Object.prototype as Record<string, unknown>)['polluted']).toBeUndefined()
  })

  test('keeps an own constructor key in body, query, and headers', () => {
    const value = Object.create(null) as Record<string, unknown>
    Object.defineProperty(value, 'constructor', { configurable: true, enumerable: true, value: 'safe', writable: true })

    const request = materializeOutboundRequest({ body: value, query: value, headers: value }, 'http')
    expect(JSON.parse(request.body as string)).toMatchObject({ constructor: 'safe' })
    expect((request.query as Record<string, unknown>).constructor).toBe('safe')
    expect((request.headers as Record<string, unknown>).constructor).toBe('safe')
  })

  test('rejects path injection and header CR/LF before transport', () => {
    expect(() => fillUrl('/users/:id', { id: '' })).toThrow(/non-empty/)
    expect(() => fillUrl('/users/:id', { id: '.' })).toThrow(/dot segment/)
    expect(() => fillUrl('/users/:id', { id: '..' })).toThrow(/dot segment/)
    expect(fillUrl('/users/:id', { id: '../x' })).toBe('/users/..%2Fx')
    expect(fillUrl('/users/:id', { id: '%2F' })).toBe('/users/%252F')
    expect(() =>
      createHttpRequest('GET', '/users', undefined, () => ({ headers: { 'x-name': 'ok\r\nInjected: yes' } }), {
        abort: new AbortController().signal,
        baseEndpoint: 'https://example.test',
      }),
    ).toThrow()
  })

  test('rejects non-plain query objects while JSON-encoding class body objects', () => {
    expect(() => materializeOutboundRequest({ query: new Map([['q', 'x']]) }, 'http')).toThrow(/query value/)
    class Payload {
      value = 7
    }
    const request = materializeOutboundRequest({ body: new Payload() }, 'http')
    expect(request.body).toBe('{"value":7}')
  })

  test('passes deeply nested and large queries to the serializer after alias encoding', async () => {
    let serialized: unknown
    let captured: HttpRequest | undefined
    const client = createClient(
      withEndpoint('https://example.test'),
      withQuerySerializer((query) => {
        serialized = query
        return `payload=${encodeURIComponent(JSON.stringify(query))}`
      }),
      withInterceptors(
        createHttpInterceptor(async (request) => {
          captured = request
          return makeResponse({ status: 204 })
        }),
      ),
    )
    const Query = struct.object({
      filters: struct.object({ tagName: struct.string().alias('tag_name'), values: struct.array(struct.number()) }),
    })
    const endpoint = defineRequest({
      builder: (input) => ({ query: input.query }),
      input: struct.object({ query: Query }),
      method: 'GET',
      path: '/search',
    })
    const values = Array.from({ length: 256 }, (_, index) => index)

    const [error] = await client.execute(endpoint({ query: { filters: { tagName: 'large', values } } }))
    expect(error).toBeNull()
    expect(serialized).toEqual({ filters: { tag_name: 'large', values } })
    expect(captured?.queryString).toContain('payload=')
  })

  test('keeps BufferSource view offsets when fetch creates the Request', async () => {
    const bytes = new Uint8Array([0, 1, 2, 3])
    const view = bytes.subarray(1, 3)
    let received: number[] = []
    const client = createClient(
      withEndpoint('https://example.test'),
      withHTTPHandle(async (input) => {
        const request = input instanceof Request ? input : new Request(input)
        received = [...new Uint8Array(await request.arrayBuffer())]
        return new Response(null, { status: 204 })
      }),
    )
    const upload = defineRequest({ builder: () => ({ body: view }), method: 'POST', path: '/bytes' })

    const [error] = await client.execute(upload())
    expect(error).toBeNull()
    expect(received).toEqual([1, 2])
  })

  test('surfaces stream reuse as a second-call transport failure', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]))
        controller.close()
      },
    })
    const client = createClient(
      withEndpoint('https://example.test'),
      withHTTPHandle(async (input) => {
        const request = input instanceof Request ? input : new Request(input)
        await request.arrayBuffer()
        return new Response(null, { status: 204 })
      }),
    )
    const upload = defineRequest({ builder: () => ({ body: stream }), method: 'POST', path: '/stream' })

    const [firstError] = await client.execute(upload())
    const [secondError] = await client.execute(upload())
    expect(firstError).toBeNull()
    expect(secondError?.code).toBe('NET_UNREACHABLE')
  })

  test('maps non-Error, non-object, and async builder results to REQ_BUILD_FAILED', async () => {
    const client = createClient(
      withEndpoint('https://example.test'),
      withInterceptors(createHttpInterceptor(async () => makeResponse({ status: 204 }))),
    )
    const throwsValue = defineRequest({
      builder: () => {
        throw 'boom'
      },
      method: 'POST',
      path: '/throws',
    })
    const returnsValue = defineRequest({ builder: (() => 1) as never, method: 'POST', path: '/value' })
    const returnsPromise = defineRequest({ builder: (() => Promise.resolve({})) as never, method: 'POST', path: '/promise' })
    const returnsUndefined = defineRequest({ builder: (() => undefined) as never, method: 'POST', path: '/undefined' })

    const [thrown] = await client.execute(throwsValue())
    const [value] = await client.execute(returnsValue())
    const [promise] = await client.execute(returnsPromise())
    const [undefinedResult] = await client.execute(returnsUndefined())

    expect(thrown?.code).toBe('REQ_BUILD_FAILED')
    expect(thrown?.cause).toBe('boom')
    expect(value?.code).toBe('REQ_BUILD_FAILED')
    expect(promise?.code).toBe('REQ_BUILD_FAILED')
    expect(undefinedResult).toBeNull()
  })

  test.each(['GET', 'HEAD'] as const)('rejects a runtime %s body even when method widened to string', async (method) => {
    const dynamicMethod: string = method
    let handleCalls = 0
    let interceptorCalls = 0
    const client = createClient(
      withEndpoint('https://example.test'),
      withInterceptors(
        createHttpInterceptor(async () => {
          interceptorCalls += 1
          return makeResponse({ status: 204 })
        }),
      ),
      withHTTPHandle(async () => {
        handleCalls += 1
        return new Response(null, { status: 204 })
      }),
    )
    const endpoint = defineRequest({ builder: () => ({ body: 'forbidden' }) as never, method: dynamicMethod, path: '/body' })

    const [error] = await client.execute(endpoint())
    expect(error?.code).toBe('REQ_BUILD_FAILED')
    expect(error?.message).toBe('GET/HEAD requests cannot have a body')
    expect(handleCalls).toBe(0)
    expect(interceptorCalls).toBe(0)
  })

  test.each(['GET', 'HEAD'] as const)('rejects a runtime SSE %s body even when method widened to string', async (method) => {
    const dynamicMethod: string = method
    let handleCalls = 0
    let interceptorCalls = 0
    const client = createClient(
      withEndpoint('https://example.test'),
      withInterceptors(
        createSSEInterceptor(async (request, next) => {
          interceptorCalls += 1
          return next(request)
        }),
      ),
      withSSEHandle(async () => {
        handleCalls += 1
        return responseStream('event: message\ndata: ok\n\n')
      }),
    )
    const endpoint = defineEventStream({
      builder: () => ({ body: 'forbidden' }) as never,
      events: { message: struct.string() },
      maxBufferSize: 1024,
      maxQueueSize: 4,
      method: dynamicMethod,
      path: '/events',
    })

    const [error, stream] = await client.execute(endpoint())
    expect(error?.code).toBe('REQ_BUILD_FAILED')
    expect(error?.message).toBe('GET/HEAD requests cannot have a body')
    expect(stream).toBeUndefined()
    expect(handleCalls).toBe(0)
    expect(interceptorCalls).toBe(0)
  })

  test('keeps HTTP interceptor request fields coherent after builder encoding', async () => {
    let captured: HttpRequest | undefined
    const client = createClient(
      withEndpoint('https://example.test'),
      withInterceptors(
        createHttpInterceptor(async (request) => {
          captured = request
          return makeResponse({ status: 204 })
        }),
      ),
    )
    const Payload = struct.object({ displayName: struct.string().alias('display_name') })
    const endpoint = defineRequest({
      builder: (input) => ({
        body: input,
        headers: { 'x-request': 'yes' },
        query: { page: 2 },
      }),
      input: Payload,
      method: 'POST',
      path: '/coherent',
    })

    const [error] = await client.execute(endpoint({ displayName: 'Ada' }))
    expect(error).toBeNull()
    expect(captured?.queryString).toBe('page=2')
    expect(captured?.queryParams?.get('page')).toBe('2')
    expect(captured?.headers?.get('x-request')).toBe('yes')
    expect(captured?.body).toBe('{"display_name":"Ada"}')
  })

  test('runs SSE builder path and query through the same request pipeline', async () => {
    let captured: HttpRequest | undefined
    const client = createClient(
      withEndpoint('https://example.test'),
      withInterceptors(
        createSSEInterceptor(async (request, next) => {
          captured = request
          return next(request)
        }),
      ),
      withSSEHandle(async () => responseStream('event: message\ndata: ok\n\n')),
    )
    const feed = defineEventStream({
      builder: (input) => ({ path: { room: input.room }, query: { since: input.since } }),
      events: { message: struct.string() },
      input: struct.object({ room: struct.string(), since: struct.string() }),
      maxBufferSize: 1024,
      maxQueueSize: 4,
      path: '/rooms/:room/events',
    })

    const [error, stream] = await client.execute(feed({ room: 'blue', since: '2' }))
    expect(error).toBeNull()
    expect(captured?.endpoint).toBe('/rooms/blue/events')
    expect(captured?.queryString).toBe('since=2')
    await stream?.closed
  })

  test('runs WebSocket builder path/query through interceptors and rejects invalid outgoing data', async () => {
    let captured: HttpRequest | undefined
    const host = inject('testServerHost')
    const client = createClient(
      withEndpoint(host),
      withInterceptors(
        createWebSocketInterceptor(async (request, next) => {
          captured = request
          return next(request)
        }),
      ),
    )
    const Room = struct.object({ room: struct.string().alias('room') })
    const Chat = defineWebSocket({
      builder: (input) => ({ path: input, query: { since: '2' } }),
      incoming: struct.discriminatedUnion('type', [
        struct.object({ roomId: struct.string().alias('room_id'), type: struct.literal('joined'), query: struct.string() }),
        struct.object({ raw: struct.string(), type: struct.literal('observed') }),
      ]),
      input: Room,
      maxIncomingQueueSize: 4,
      outgoing: struct.object({ text: struct.string(), type: struct.literal('say') }),
      path: '/e2e/ws/:room',
    })

    const [error, socket] = await client.execute(Chat({ room: 'blue' }))
    expect(error).toBeNull()
    expect(captured?.endpoint).toBe('/e2e/ws/blue')
    expect(captured?.queryString).toBe('since=2')
    if (!socket) throw new Error('Expected socket')
    expect(() => socket.send({ type: 'wrong' } as never)).toThrow()
    socket.close()
    await socket.closed
  })
})

const Proto = struct.object({ value: struct.string().alias('__proto__') })
const PHASE_TIMEOUT_MS = 15
const SLOW_PHASE_MS = 40

function occupyEventLoop(ms: number): void {
  // Synchronous parse/build holds the thread, so a queued timeout cannot run until the turn ends.
  let elapsed = 0
  const startedAt = Date.now()
  while (elapsed < ms) {
    elapsed = Date.now() - startedAt
  }
}

function slowInput(): { id: string } {
  const input = {} as { id: string }
  Object.defineProperty(input, 'id', {
    enumerable: true,
    get() {
      occupyEventLoop(SLOW_PHASE_MS)
      return 'ok'
    },
  })
  return input
}

function abortingInput(controller: AbortController): { id: string } {
  const input = {} as { id: string }
  Object.defineProperty(input, 'id', {
    enumerable: true,
    get() {
      controller.abort('caller stopped')
      return 'ok'
    },
  })
  return input
}

function sseResponse(): Response {
  return new Response('event: message\ndata: "ok"\n\n', {
    headers: { 'content-type': 'text/event-stream' },
  })
}

async function closeIfOpened(resource: { close: () => void; closed: Promise<unknown> } | undefined): Promise<void> {
  if (!resource) {
    return
  }
  resource.close()
  await resource.closed
}

function createOpeningSocket(): { Socket: new (url: string) => unknown; counters: { sockets: number } } {
  const counters = { sockets: 0 }

  class OpeningSocket {
    static OPEN = 1
    static CONNECTING = 0
    static CLOSING = 2
    static CLOSED = 3

    bufferedAmount = 0
    binaryType = 'blob'
    extensions = ''
    protocol = ''
    readyState = OpeningSocket.CONNECTING
    url: string
    private readonly listeners: { [type: string]: Array<(event: unknown) => void> } = Object.create(null)

    constructor(url: string) {
      counters.sockets += 1
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

    emit(type: string, event: unknown): void {
      for (const listener of this.listeners[type] ?? []) {
        listener(event)
      }
    }
  }

  return { Socket: OpeningSocket, counters }
}

describe('builder fixes re-audit', () => {
  test('preserves __proto__ aliases through outgoing WebSocket records and incoming JSON', () => {
    const Message = struct.object({ nested: struct.array(Proto), records: struct.record(Proto) })
    const records = JSON.parse('{"__proto__":{"value":"record"}}') as Record<string, { value: string }>
    const wire = serializeOutgoingWebSocketMessage(Message, { nested: [{ value: 'nested' }], records })
    expect(wire).toBe('{"nested":[{"__proto__":"nested"}],"records":{"__proto__":{"__proto__":"record"}}}')
    const decoded = decodeJson(Message, JSON.parse(wire)) as { records: Record<string, { value: string }> }
    expect(Object.getPrototypeOf(decoded.records)).toBeNull()
    expect(Object.hasOwn(decoded.records, '__proto__')).toBe(true)
    expect(decoded.records['__proto__']).toEqual({ value: 'record' })
  })

  test('sends __proto__ alias on a real WebSocket frame with query serialization', async () => {
    let serialized: unknown
    const client = createClient(
      withEndpoint(inject('testServerHost')),
      withQuerySerializer((query) => {
        serialized = query
        return new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)])).toString()
      }),
    )
    const endpoint = defineWebSocket({
      builder: (input) => ({ path: { room: 'audit' }, query: input }),
      incoming: struct.discriminatedUnion('type', [
        struct.object({ type: struct.literal('joined'), query: struct.string() }),
        struct.object({ type: struct.literal('observed'), raw: struct.string() }),
      ]),
      input: Proto,
      maxIncomingQueueSize: 4,
      outgoing: Proto,
      path: '/e2e/ws/:room',
    })
    const [error, socket] = await client.execute(endpoint({ value: 'query' }))
    expect(error).toBeNull()
    if (!socket) throw new Error('Expected socket')
    try {
      const iterator = socket.receive[Symbol.asyncIterator]()
      expect((await iterator.next()).value).toEqual({ type: 'joined', query: '__proto__=query' })
      expect(Object.getPrototypeOf(serialized)).toBeNull()
      expect(Object.hasOwn(serialized as object, '__proto__')).toBe(true)
      socket.send({ value: 'frame' })
      expect((await iterator.next()).value).toEqual({ type: 'observed', raw: '{"__proto__":"frame"}' })
    } finally {
      socket.close()
      await socket.closed
    }
  })

  test.each(['formData', 'urlencoded'] as const)('preserves __proto__ form arrays through HTTP %s transport', async (codec) => {
    let fields: FormData | undefined
    const Form = struct[codec]({ values: struct.array(struct.string()).alias('__proto__') })
    const client = createClient(
      withEndpoint('https://example.test'),
      withHTTPHandle(async (input) => {
        fields = await (input as Request).formData()
        return new Response(null, { status: 204 })
      }),
    )
    const endpoint = defineRequest({ builder: (input) => ({ body: input }), input: Form, method: 'POST', path: '/form' })
    const [error] = await client.execute(endpoint({ values: ['first', 'second'] }))
    expect(error).toBeNull()
    expect(fields?.getAll('__proto__')).toEqual(['first', 'second'])
  })

  test.each([false, true])('preserves SSE query, headers, path, body and inbound alias (custom serializer: %s)', async (custom) => {
    let captured: HttpRequest | undefined
    let received: Request | undefined
    let serialized: unknown
    const options = custom
      ? [
          withQuerySerializer((query) => {
            serialized = query
            return new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)])).toString()
          }),
        ]
      : []
    const client = createClient(
      withEndpoint('https://example.test'),
      ...options,
      withInterceptors(
        createSSEInterceptor(async (request, next) => {
          captured = request
          return next(request)
        }),
      ),
      withSSEHandle(async (input) => {
        received = input as Request
        return new Response('event: message\ndata: {"__proto__":"inbound"}\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        })
      }),
    )
    const endpoint = defineEventStream({
      builder: (input) => ({ path: input, query: input, headers: input, body: input }),
      events: { message: Proto },
      input: Proto,
      maxBufferSize: 1024,
      maxQueueSize: 4,
      method: 'POST',
      path: '/events/:__proto__',
    })
    const [error, stream] = await client.execute(endpoint({ value: 'safe' }))
    expect(error).toBeNull()
    expect(captured?.endpoint).toBe('/events/safe')
    expect(captured?.headers?.get('__proto__')).toBe('safe')
    expect(captured?.queryParams?.get('__proto__')).toBe('safe')
    expect(captured?.queryString).toBe('__proto__=safe')
    expect(captured?.body).toBe('{"__proto__":"safe"}')
    expect(received?.url).toBe('https://example.test/events/safe?__proto__=safe')
    expect(await received?.text()).toBe('{"__proto__":"safe"}')
    if (custom) {
      expect(Object.getPrototypeOf(serialized)).toBeNull()
      expect(Object.hasOwn(serialized as object, '__proto__')).toBe(true)
    }
    if (!stream) throw new Error('Expected stream')
    const events = []
    for await (const event of stream) events.push(event)
    expect(events).toEqual([{ event: 'message', data: { value: 'inbound' }, id: undefined }])
    await stream.closed
  })

  test.each([200, 400])('decodes __proto__ aliases on HTTP status %s', async (status) => {
    const client = createClient(
      withEndpoint('https://example.test'),
      withHTTPHandle(async () => new Response('{"__proto__":"safe"}', { status, headers: { 'content-type': 'application/json' } })),
    )
    const endpoint = defineRequest({ error: Proto, output: Proto, method: 'GET', path: '/response' })
    const [error, result] = await client.execute(endpoint())
    if (status === 200) {
      expect(error).toBeNull()
      expect(result).toEqual({ value: 'safe' })
    } else {
      expect(error).toMatchObject({ code: 'HTTP_STATUS', data: { value: 'safe' }, status: 400 })
    }
  })

  test('exposes derived response representations to interceptors', async () => {
    const requests: HttpRequest[] = []
    const client = createClient(
      withInterceptors(
        createHttpInterceptor(async (request) => {
          requests.push(request)
          return makeResponse({ body: 'ok', status: 200 })
        }),
      ),
    )
    await client.execute(defineRequest({ method: 'GET', path: '/', output: struct.string(), error: struct.object({}) })())
    await client.execute(defineRequest({ method: 'GET', path: '/', error: struct.arrayBuffer() })())
    await client.execute(defineRequest({ method: 'GET', path: '/' })())
    expect(requests.map((request) => [request.responseType, request.errorResponseType])).toEqual([
      ['text', 'json'],
      [undefined, 'arraybuffer'],
      [undefined, undefined],
    ])
  })

  test('skips a WebSocket builder when cancellation is already active', async () => {
    const controller = new AbortController()
    controller.abort('caller stopped')
    let builderCalls = 0
    const client = createClient(withEndpoint('https://example.test'))
    const endpoint = defineWebSocket({
      builder: () => {
        builderCalls += 1
        throw new Error('builder must not run after cancellation')
      },
      incoming: struct.unknown(),
      maxIncomingQueueSize: 1,
      path: '/socket',
    })

    const [error] = await client.execute(endpoint(), { signal: controller.signal })

    expect(builderCalls).toBe(0)
    expect(error).toMatchObject({ code: 'NET_ABORTED' })
  })

  test('returns NET_TIMEOUT when a WebSocket builder outlasts the execute timeout', async () => {
    const opened = createOpeningSocket()
    const client = createClient(withEndpoint('https://example.test'), withWebSocketHandle(opened.Socket as unknown as typeof WebSocket))
    const endpoint = defineWebSocket({
      builder: () => {
        occupyEventLoop(SLOW_PHASE_MS)
        return {}
      },
      incoming: struct.unknown(),
      maxIncomingQueueSize: 1,
      path: '/socket',
    })

    const [error, session] = await client.execute(endpoint(), { timeout: PHASE_TIMEOUT_MS })
    await closeIfOpened(session)

    expect(opened.counters.sockets).toBe(0)
    expect(session).toBeUndefined()
    expect(error).toMatchObject({ code: 'NET_TIMEOUT' })
  })

  test('returns NET_TIMEOUT when WebSocket input parsing outlasts the execute timeout', async () => {
    const opened = createOpeningSocket()
    const client = createClient(withEndpoint('https://example.test'), withWebSocketHandle(opened.Socket as unknown as typeof WebSocket))
    const endpoint = defineWebSocket({
      builder: () => ({}),
      incoming: struct.unknown(),
      input: struct.object({ id: struct.string() }),
      maxIncomingQueueSize: 1,
      path: '/socket',
    })

    const [error, session] = await client.execute(endpoint(slowInput()), { timeout: PHASE_TIMEOUT_MS })
    await closeIfOpened(session)

    expect(opened.counters.sockets).toBe(0)
    expect(session).toBeUndefined()
    expect(error).toMatchObject({ code: 'NET_TIMEOUT' })
  })

  test('does not run a WebSocket builder when input parsing aborts the signal', async () => {
    const controller = new AbortController()
    const opened = createOpeningSocket()
    let builderCalls = 0
    const client = createClient(withEndpoint('https://example.test'), withWebSocketHandle(opened.Socket as unknown as typeof WebSocket))
    const endpoint = defineWebSocket({
      builder: () => {
        builderCalls += 1
        return {}
      },
      incoming: struct.unknown(),
      input: struct.object({ id: struct.string() }),
      maxIncomingQueueSize: 1,
      path: '/socket',
    })

    const [error, session] = await client.execute(endpoint(abortingInput(controller)), { signal: controller.signal })
    await closeIfOpened(session)

    expect(builderCalls).toBe(0)
    expect(opened.counters.sockets).toBe(0)
    expect(session).toBeUndefined()
    expect(error).toMatchObject({ code: 'NET_ABORTED' })
  })

  test('returns NET_TIMEOUT when a WebSocket builder throws after the execute timeout', async () => {
    const opened = createOpeningSocket()
    const client = createClient(withEndpoint('https://example.test'), withWebSocketHandle(opened.Socket as unknown as typeof WebSocket))
    const endpoint = defineWebSocket({
      builder: () => {
        occupyEventLoop(SLOW_PHASE_MS)
        throw new Error('build failed after the deadline')
      },
      incoming: struct.unknown(),
      maxIncomingQueueSize: 1,
      path: '/socket',
    })

    const [error, session] = await client.execute(endpoint(), { timeout: PHASE_TIMEOUT_MS })

    expect(opened.counters.sockets).toBe(0)
    expect(session).toBeUndefined()
    expect(error).toMatchObject({ code: 'NET_TIMEOUT' })
  })

  test('returns NET_ABORTED when a WebSocket builder aborts and then throws', async () => {
    const controller = new AbortController()
    const opened = createOpeningSocket()
    const client = createClient(withEndpoint('https://example.test'), withWebSocketHandle(opened.Socket as unknown as typeof WebSocket))
    const endpoint = defineWebSocket({
      builder: () => {
        controller.abort('caller stopped')
        throw new Error('build failed after abort')
      },
      incoming: struct.unknown(),
      maxIncomingQueueSize: 1,
      path: '/socket',
    })

    const [error, session] = await client.execute(endpoint(), { signal: controller.signal })

    expect(opened.counters.sockets).toBe(0)
    expect(session).toBeUndefined()
    expect(error).toMatchObject({ code: 'NET_ABORTED' })
  })

  test('returns NET_ABORTED before WebSocket queue validation when cancellation is already active', async () => {
    const controller = new AbortController()
    controller.abort('caller stopped')
    const endpoint = defineWebSocket({
      incoming: struct.unknown(),
      maxIncomingQueueSize: 0,
      path: '/socket',
    })

    const [error, session] = await createClient(withEndpoint('https://example.test')).execute(endpoint(), { signal: controller.signal })

    expect(session).toBeUndefined()
    expect(error).toMatchObject({ code: 'NET_ABORTED' })
  })

  test('skips an HTTP builder when cancellation is already active', async () => {
    const controller = new AbortController()
    controller.abort('caller stopped')
    let builderCalls = 0
    let fetches = 0
    const client = createClient(
      withEndpoint('https://example.test'),
      withHTTPHandle(async () => {
        fetches += 1
        return new Response('ok', { status: 200 })
      }),
    )
    const endpoint = defineRequest({
      builder: () => {
        builderCalls += 1
        throw new Error('builder must not run after cancellation')
      },
      method: 'GET',
      path: '/item',
    })

    const [error, result] = await client.execute(endpoint(), { signal: controller.signal })

    expect(builderCalls).toBe(0)
    expect(fetches).toBe(0)
    expect(result).toBeUndefined()
    expect(error).toMatchObject({ code: 'NET_ABORTED' })
  })

  test('returns NET_TIMEOUT when an HTTP builder outlasts the execute timeout', async () => {
    let fetches = 0
    const client = createClient(
      withEndpoint('https://example.test'),
      withHTTPHandle(async () => {
        fetches += 1
        return new Response('ok', { status: 200 })
      }),
    )
    const endpoint = defineRequest({
      builder: () => {
        occupyEventLoop(SLOW_PHASE_MS)
        return {}
      },
      method: 'GET',
      path: '/item',
    })

    const [error, result] = await client.execute(endpoint(), { timeout: PHASE_TIMEOUT_MS })

    expect(fetches).toBe(0)
    expect(result).toBeUndefined()
    expect(error).toMatchObject({ code: 'NET_TIMEOUT' })
  })

  test('returns NET_TIMEOUT when HTTP input parsing outlasts the execute timeout', async () => {
    let fetches = 0
    const client = createClient(
      withEndpoint('https://example.test'),
      withHTTPHandle(async () => {
        fetches += 1
        return new Response('ok', { status: 200 })
      }),
    )
    const endpoint = defineRequest({
      builder: () => ({}),
      input: struct.object({ id: struct.string() }),
      method: 'GET',
      path: '/item',
    })

    const [error, result] = await client.execute(endpoint(slowInput()), { timeout: PHASE_TIMEOUT_MS })

    expect(fetches).toBe(0)
    expect(result).toBeUndefined()
    expect(error).toMatchObject({ code: 'NET_TIMEOUT' })
  })

  test('does not run an HTTP builder when input parsing aborts the signal', async () => {
    const controller = new AbortController()
    let builderCalls = 0
    let fetches = 0
    const client = createClient(
      withEndpoint('https://example.test'),
      withHTTPHandle(async () => {
        fetches += 1
        return new Response('ok', { status: 200 })
      }),
    )
    const endpoint = defineRequest({
      builder: () => {
        builderCalls += 1
        return {}
      },
      input: struct.object({ id: struct.string() }),
      method: 'GET',
      path: '/item',
    })

    const [error, result] = await client.execute(endpoint(abortingInput(controller)), { signal: controller.signal })

    expect(builderCalls).toBe(0)
    expect(fetches).toBe(0)
    expect(result).toBeUndefined()
    expect(error).toMatchObject({ code: 'NET_ABORTED' })
  })

  test('returns NET_TIMEOUT when an HTTP builder throws after the execute timeout', async () => {
    let fetches = 0
    const client = createClient(
      withEndpoint('https://example.test'),
      withHTTPHandle(async () => {
        fetches += 1
        return new Response('ok', { status: 200 })
      }),
    )
    const endpoint = defineRequest({
      builder: () => {
        occupyEventLoop(SLOW_PHASE_MS)
        throw new Error('build failed after the deadline')
      },
      method: 'GET',
      path: '/item',
    })

    const [error, result] = await client.execute(endpoint(), { timeout: PHASE_TIMEOUT_MS })

    expect(fetches).toBe(0)
    expect(result).toBeUndefined()
    expect(error).toMatchObject({ code: 'NET_TIMEOUT' })
  })

  test('returns NET_ABORTED when an HTTP builder aborts and then throws', async () => {
    const controller = new AbortController()
    let fetches = 0
    const client = createClient(
      withEndpoint('https://example.test'),
      withHTTPHandle(async () => {
        fetches += 1
        return new Response('ok', { status: 200 })
      }),
    )
    const endpoint = defineRequest({
      builder: () => {
        controller.abort('caller stopped')
        throw new Error('build failed after abort')
      },
      method: 'GET',
      path: '/item',
    })

    const [error, result] = await client.execute(endpoint(), { signal: controller.signal })

    expect(fetches).toBe(0)
    expect(result).toBeUndefined()
    expect(error).toMatchObject({ code: 'NET_ABORTED' })
  })

  test('aborts the HTTP transport when interceptor resolution aborts the signal', async () => {
    const controller = new AbortController()
    let fetches = 0
    const client = createClient(
      withEndpoint('https://example.test'),
      withHTTPHandle(async () => {
        fetches += 1
        return new Response('ok', { status: 200 })
      }),
      (config) => {
        // Resolution sits after the builder cancellation check and before the chain starts.
        config.interceptors = new Proxy(config.interceptors, {
          get(target, property, receiver) {
            if (property === 'filter') {
              controller.abort('caller stopped')
            }
            return Reflect.get(target, property, receiver)
          },
        })
      },
    )
    const endpoint = defineRequest({ method: 'GET', path: '/item' })

    const [error, result] = await client.execute(endpoint(), { signal: controller.signal })

    expect(fetches).toBe(0)
    expect(result).toBeUndefined()
    expect(error).toMatchObject({ code: 'NET_ABORTED' })
  })

  test('skips an SSE builder when cancellation is already active', async () => {
    const controller = new AbortController()
    controller.abort('caller stopped')
    let builderCalls = 0
    let fetches = 0
    const client = createClient(
      withEndpoint('https://example.test'),
      withSSEHandle(async () => {
        fetches += 1
        return sseResponse()
      }),
    )
    const endpoint = defineEventStream({
      builder: () => {
        builderCalls += 1
        throw new Error('builder must not run after cancellation')
      },
      events: { message: struct.string() },
      maxBufferSize: 1024,
      maxQueueSize: 4,
      path: '/events',
    })

    const [error, stream] = await client.execute(endpoint(), { signal: controller.signal })
    await closeIfOpened(stream)

    expect(builderCalls).toBe(0)
    expect(fetches).toBe(0)
    expect(stream).toBeUndefined()
    expect(error).toMatchObject({ code: 'NET_ABORTED' })
  })

  test('returns NET_TIMEOUT when an SSE builder outlasts the execute timeout', async () => {
    let fetches = 0
    const client = createClient(
      withEndpoint('https://example.test'),
      withSSEHandle(async () => {
        fetches += 1
        return sseResponse()
      }),
    )
    const endpoint = defineEventStream({
      builder: () => {
        occupyEventLoop(SLOW_PHASE_MS)
        return {}
      },
      events: { message: struct.string() },
      maxBufferSize: 1024,
      maxQueueSize: 4,
      path: '/events',
    })

    const [error, stream] = await client.execute(endpoint(), { timeout: PHASE_TIMEOUT_MS })
    await closeIfOpened(stream)

    expect(fetches).toBe(0)
    expect(stream).toBeUndefined()
    expect(error).toMatchObject({ code: 'NET_TIMEOUT' })
  })

  test('returns NET_TIMEOUT when SSE input parsing outlasts the execute timeout', async () => {
    let fetches = 0
    const client = createClient(
      withEndpoint('https://example.test'),
      withSSEHandle(async () => {
        fetches += 1
        return sseResponse()
      }),
    )
    const endpoint = defineEventStream({
      builder: () => ({}),
      events: { message: struct.string() },
      input: struct.object({ id: struct.string() }),
      maxBufferSize: 1024,
      maxQueueSize: 4,
      path: '/events',
    })

    const [error, stream] = await client.execute(endpoint(slowInput()), { timeout: PHASE_TIMEOUT_MS })
    await closeIfOpened(stream)

    expect(fetches).toBe(0)
    expect(stream).toBeUndefined()
    expect(error).toMatchObject({ code: 'NET_TIMEOUT' })
  })

  test('does not run an SSE builder when input parsing aborts the signal', async () => {
    const controller = new AbortController()
    let builderCalls = 0
    let fetches = 0
    const client = createClient(
      withEndpoint('https://example.test'),
      withSSEHandle(async () => {
        fetches += 1
        return sseResponse()
      }),
    )
    const endpoint = defineEventStream({
      builder: () => {
        builderCalls += 1
        return {}
      },
      events: { message: struct.string() },
      input: struct.object({ id: struct.string() }),
      maxBufferSize: 1024,
      maxQueueSize: 4,
      path: '/events',
    })

    const [error, stream] = await client.execute(endpoint(abortingInput(controller)), { signal: controller.signal })
    await closeIfOpened(stream)

    expect(builderCalls).toBe(0)
    expect(fetches).toBe(0)
    expect(stream).toBeUndefined()
    expect(error).toMatchObject({ code: 'NET_ABORTED' })
  })

  test('returns NET_TIMEOUT when an SSE builder throws after the execute timeout', async () => {
    let fetches = 0
    const client = createClient(
      withEndpoint('https://example.test'),
      withSSEHandle(async () => {
        fetches += 1
        return sseResponse()
      }),
    )
    const endpoint = defineEventStream({
      builder: () => {
        occupyEventLoop(SLOW_PHASE_MS)
        throw new Error('build failed after the deadline')
      },
      events: { message: struct.string() },
      maxBufferSize: 1024,
      maxQueueSize: 4,
      path: '/events',
    })

    const [error, stream] = await client.execute(endpoint(), { timeout: PHASE_TIMEOUT_MS })
    await closeIfOpened(stream)

    expect(fetches).toBe(0)
    expect(stream).toBeUndefined()
    expect(error).toMatchObject({ code: 'NET_TIMEOUT' })
  })

  test('returns NET_ABORTED when an SSE builder aborts and then throws', async () => {
    const controller = new AbortController()
    let fetches = 0
    const client = createClient(
      withEndpoint('https://example.test'),
      withSSEHandle(async () => {
        fetches += 1
        return sseResponse()
      }),
    )
    const endpoint = defineEventStream({
      builder: () => {
        controller.abort('caller stopped')
        throw new Error('build failed after abort')
      },
      events: { message: struct.string() },
      maxBufferSize: 1024,
      maxQueueSize: 4,
      path: '/events',
    })

    const [error, stream] = await client.execute(endpoint(), { signal: controller.signal })

    expect(fetches).toBe(0)
    expect(stream).toBeUndefined()
    expect(error).toMatchObject({ code: 'NET_ABORTED' })
  })

  test('returns NET_ABORTED before SSE limit validation when cancellation is already active', async () => {
    const controller = new AbortController()
    controller.abort('caller stopped')
    const endpoint = defineEventStream({
      events: { message: struct.string() },
      maxBufferSize: 1024,
      maxQueueSize: 0,
      path: '/events',
    })

    const [error, stream] = await createClient(withEndpoint('https://example.test')).execute(endpoint(), { signal: controller.signal })

    expect(stream).toBeUndefined()
    expect(error).toMatchObject({ code: 'NET_ABORTED' })
  })

  test('BUILDER-PROTOTYPE-002: accepts an intersection with a logical __proto__ field', async () => {
    const Left = struct.object({ ['__proto__']: struct.string().alias('proto_value') })
    const Input = struct.intersection(Left, struct.object({ label: struct.string() }))
    const parsed = await parseEndpointInput(Input, { ['__proto__']: 'safe', label: 'left' })
    const request = materializeOutboundRequest({ body: parsed }, 'http')
    expect(request.body).toBe('{"proto_value":"safe","label":"left"}')
  })

  test('decodes aliased fields in SSE JSON event data', async () => {
    const client = createClient(
      withEndpoint('https://example.test'),
      withSSEHandle(
        async () =>
          new Response('event: message\ndata: {"error_code":"DENIED"}\n\n', {
            headers: { 'content-type': 'text/event-stream' },
          }),
      ),
    )
    const endpoint = defineEventStream({
      events: { message: struct.object({ code: struct.string().alias('error_code') }) },
      maxBufferSize: 1024,
      maxQueueSize: 4,
      path: '/events',
    })
    const [error, stream] = await client.execute(endpoint())
    expect(error).toBeNull()
    if (!stream) {
      throw new Error('Expected stream')
    }
    const events = []
    for await (const event of stream) {
      events.push(event)
    }
    expect(events).toEqual([{ data: { code: 'DENIED' }, event: 'message', id: undefined }])
  })

  test('decodes aliased fields on an incoming WebSocket frame', async () => {
    const decoded = await transformWebSocketMessage(struct.object({ code: struct.string().alias('error_code') }), '{"error_code":"DENIED"}')
    expect(decoded).toEqual({ code: 'DENIED' })

    let opened: FakeSocket | undefined
    class FakeSocket {
      static OPEN = 1
      static CONNECTING = 0
      static CLOSING = 2
      static CLOSED = 3

      bufferedAmount = 0
      binaryType = 'blob'
      extensions = ''
      protocol = ''
      readyState = FakeSocket.CONNECTING
      url: string
      private readonly listeners: { [type: string]: Array<(event: unknown) => void> } = Object.create(null)

      constructor(url: string) {
        this.url = url
        // oxlint-disable-next-line typescript/no-this-alias -- the test has to emit a frame on the constructed socket
        opened = this
        queueMicrotask(() => {
          this.readyState = FakeSocket.OPEN
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

      close(code = 1000, reason = ''): void {
        this.readyState = FakeSocket.CLOSED
        this.emit('close', { code, reason, wasClean: true })
      }

      emit(type: string, event: unknown): void {
        for (const listener of this.listeners[type] ?? []) {
          listener(event)
        }
      }
    }

    const client = createClient(withEndpoint('https://example.test'), withWebSocketHandle(FakeSocket as unknown as typeof WebSocket))
    const endpoint = defineWebSocket({
      incoming: struct.object({ code: struct.string().alias('error_code') }),
      maxIncomingQueueSize: 4,
      path: '/socket',
    })
    const [openError, session] = await client.execute(endpoint())
    expect(openError).toBeNull()
    if (!session || !opened) {
      throw new Error('Expected socket')
    }
    const pending = session.receive[Symbol.asyncIterator]().next()
    opened.emit('message', { data: '{"error_code":"DENIED"}' })
    await expect(pending).resolves.toEqual({ done: false, value: { code: 'DENIED' } })
    session.close()
    await session.closed
  })

  test('decodes aliased fields before heartbeat acknowledgement classification', async () => {
    vi.useFakeTimers()
    const { Socket, latest } = createControllableSocketClass()
    try {
      const seen: unknown[] = []
      const client = createClient(withEndpoint('https://example.test'), withWebSocketHandle(Socket as unknown as typeof WebSocket))
      const endpoint = defineWebSocket({
        incoming: struct.object({ kind: struct.string().alias('type'), ok: struct.boolean() }),
        maxIncomingQueueSize: 4,
        outgoing: struct.object({ at: struct.number(), type: struct.literal('ping') }),
        path: '/ws/heartbeat',
      })
      const pending = client.execute(endpoint(), {
        heartbeat: {
          intervalMs: 10,
          isAck: (message: { kind: string; ok: boolean }) => {
            seen.push(message)
            return message.kind === 'pong'
          },
          message: () => ({ at: 1, type: 'ping' as const }),
          timeoutMs: 100,
        },
      })
      const [error, session] = await openControllableSocket(pending, latest)
      expect(error).toBeNull()
      const socket = latest()
      if (!session || !socket) {
        throw new Error('Expected socket session')
      }
      const runtimeErrors: unknown[] = []
      session.onRuntimeError((cause) => {
        runtimeErrors.push(cause)
      })

      await vi.advanceTimersByTimeAsync(10)
      expect(JSON.parse(socket.sent[0] ?? '')).toEqual({ at: 1, type: 'ping' })
      // The wire key is `type`. Classification must see the decoded logical key `kind`.
      socket.triggerMessage('{"ok":true,"type":"pong"}')
      // Flush the message pump without moving the clock. vi.waitFor advances fake timers and
      // would let the next interval arm a fresh deadline inside this timeout window.
      await vi.advanceTimersByTimeAsync(0)
      expect(seen).toEqual([{ kind: 'pong', ok: true }])
      await vi.advanceTimersByTimeAsync(100)

      expect(runtimeErrors).toEqual([])
      expect(session.state).toBe('open')
      session.close(1000, 'heartbeat-ok')
      socket.triggerClose({ code: 1000, reason: 'heartbeat-ok', wasClean: true })
      await expect(session.closed).resolves.toMatchObject({ code: 1000, reason: 'heartbeat-ok' })
    } finally {
      vi.useRealTimers()
    }
  })

  test('SSE-ERROR-ALIAS-001: decodes aliased fields in a failed SSE handshake', async () => {
    const client = createClient(
      withEndpoint('https://example.test'),
      withSSEHandle(async () => new Response('{"error_code":"DENIED"}', { status: 403, headers: { 'content-type': 'application/json' } })),
    )
    const endpoint = defineEventStream({
      error: struct.object({ code: struct.string().alias('error_code') }),
      events: { message: struct.string() },
      maxBufferSize: 1024,
      maxQueueSize: 4,
      path: '/events',
    })
    const [error] = await client.execute(endpoint())
    expect(error).toMatchObject({ code: 'HTTP_STATUS', data: { code: 'DENIED' }, status: 403 })
  })
})

const Profile = struct.object({ displayName: struct.string().alias('display_name') })
const Input = struct.object({ profile: Profile })

test('runtime tags survive records, tuples, and chained modifiers used by the type probes', async () => {
  const User = struct.object({ id: struct.string().alias('user_id') })
  const record = await parseEndpointInput(struct.record(User), { selected: { id: '42' } })
  const tuple = await parseEndpointInput(struct.tuple([User]), [{ id: '42' }])
  const modified = await parseEndpointInput(User.optional().nullable(), { id: '42' })
  for (const value of [record['selected'], tuple[0], modified]) {
    if (!value) throw new Error('Expected a parsed object')
    expect(Object.getOwnPropertySymbols(value)).toContain(STRUCT)
    expect(materializeOutboundRequest({ path: value }, 'http').params).toEqual({ user_id: '42' })
  }
})

test('preserves a nested spread extra when its parent remains typed', async () => {
  let sentBody: unknown
  const client = createClient(
    withEndpoint('https://example.test'),
    withHTTPHandle(async (request) => {
      sentBody = await new Request(request).json()
      return new Response(null, { status: 204 })
    }),
  )
  const endpoint = defineRequest({
    input: Input,
    method: 'POST',
    path: '/profile',
    builder: (input) => ({ body: { ...input, profile: { ...input.profile, role: 'admin' } } }),
  })

  const [fault] = await client.execute(endpoint({ profile: { displayName: 'Ada' } }))
  expect(fault).toBeNull()
  expect(sentBody).toEqual({ profile: { display_name: 'Ada', role: 'admin' } })
})

test('rejects a nested spread wire-key collision before sending a typed parent', async () => {
  let calls = 0
  const client = createClient(
    withEndpoint('https://example.test'),
    withHTTPHandle(async () => {
      calls += 1
      return new Response(null, { status: 204 })
    }),
  )
  const endpoint = defineRequest({
    input: Input,
    method: 'POST',
    path: '/profile',
    builder: (input) => ({ body: { ...input, profile: { ...input.profile, display_name: 'shadow' } } }),
  })

  const [fault] = await client.execute(endpoint({ profile: { displayName: 'Ada' } }))
  expect(fault?.code).toBe('REQ_BUILD_FAILED')
  expect(calls).toBe(0)
})
