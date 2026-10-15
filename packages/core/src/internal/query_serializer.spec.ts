import { describe, expect, test } from 'vitest'
import {
  createClient,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
  withQuerySerializer,
  withSSEHandle,
  withWebSocketHandle,
} from '../client'
import { createHttpInterceptor } from '../interceptor'
import { makeResponse } from './http_response'
import type { HttpRequest } from './http_request'
import { defineRequest } from '../http/http'
import { defineEventStream } from '../sse/sse'
import { struct } from '../struct'
import { STRUCT } from '../struct/symbols'
import { defineWebSocket } from '../web_socket/web_socket'

const birthday = new Date('1815-12-10T00:00:00.000Z')

const Query = struct.object({
  filter: struct.object({
    min: struct.bigint().alias('min_id'),
    since: struct.date().alias('since_at'),
    state: struct.string(),
  }),
  pageSize: struct.number().alias('page_size'),
  tags: struct.array(struct.string()),
})

function stoppingSocket(urls: string[]): typeof WebSocket {
  return class {
    static OPEN = 1
    constructor(url: string) {
      urls.push(url)
      throw new Error('stop')
    }
  } as unknown as typeof WebSocket
}

describe('query serializer contract', () => {
  test('serializer receives the alias-applied encoded query object', async () => {
    let received: unknown
    let captured: HttpRequest | undefined
    const client = createClient(
      withEndpoint('https://example.com'),
      withQuerySerializer((query) => {
        received = query
        return 'ok=1'
      }),
      withInterceptors(
        createHttpInterceptor(async (request) => {
          captured = request
          return makeResponse({ status: 204 })
        }),
      ),
    )
    const search = defineRequest({
      builder: (input) => ({ query: input }),
      input: Query,
      method: 'GET',
      path: '/search',
    })

    const [error] = await client.execute(
      search({
        filter: { min: 1n, since: birthday, state: 'open' },
        pageSize: 10,
        tags: ['a', 'b'],
      }),
    )

    expect(error).toBeNull()
    expect(received).toEqual({
      filter: { min_id: '1', since_at: '1815-12-10T00:00:00.000Z', state: 'open' },
      page_size: 10,
      tags: ['a', 'b'],
    })
    expect(received).not.toBeInstanceOf(URLSearchParams)
    expect(Object.getOwnPropertySymbols(received as object)).not.toContain(STRUCT)
    expect(captured?.queryString).toBe('ok=1')
    expect(captured?.queryParams?.get('ok')).toBe('1')
  })

  test('default query repeats array keys', async () => {
    let captured: HttpRequest | undefined
    const client = createClient(
      withEndpoint('https://example.com'),
      withInterceptors(
        createHttpInterceptor(async (request) => {
          captured = request
          return makeResponse({ status: 204 })
        }),
      ),
    )
    const list = defineRequest({
      builder: () => ({ query: { include: true, tags: ['a', 'b'] } }),
      method: 'GET',
      path: '/items',
    })

    const [error] = await client.execute(list())

    expect(error).toBeNull()
    expect(captured?.queryString).toBe('include=true&tags=a&tags=b')
    expect(captured?.queryParams?.getAll('tags')).toEqual(['a', 'b'])
    expect(captured?.queryParams?.toString()).toBe(captured?.queryString)
  })

  test('default nested query fails with REQ_BUILD_FAILED asking for a query serializer', async () => {
    const client = createClient(withEndpoint('https://example.com'))
    const search = defineRequest({
      builder: () => ({ query: { filter: { state: 'open' } } }),
      method: 'GET',
      path: '/items',
    })

    expect(() => search()).not.toThrow()
    const [error] = await client.execute(search())

    expect(error?.code).toBe('REQ_BUILD_FAILED')
    expect(error?.cause).toBeInstanceOf(TypeError)
    if (!(error?.cause instanceof Error)) {
      throw new Error('expected nested query cause')
    }
    expect(error.cause.message).toContain('a query serializer is required')
  })

  test('null query fails with REQ_BUILD_FAILED', async () => {
    const client = createClient(withEndpoint('https://example.com'))
    const search = defineRequest({
      builder: (() => ({ query: { id: null } })) as never,
      method: 'GET',
      path: '/items',
    })

    const [error] = await client.execute(search())

    expect(error?.code).toBe('REQ_BUILD_FAILED')
    expect(error?.cause).toBeInstanceOf(TypeError)
    if (!(error?.cause instanceof Error)) {
      throw new Error('expected null query cause')
    }
    expect(error.cause.message).toContain('null')
  })

  test('URLSearchParams query bypasses the serializer', async () => {
    const query = new URLSearchParams()
    query.append('tag', 'a')
    query.append('tag', 'b')
    let captured: HttpRequest | undefined
    const client = createClient(
      withEndpoint('https://example.com'),
      withQuerySerializer(() => {
        throw new Error('serializer should be skipped')
      }),
      withInterceptors(
        createHttpInterceptor(async (request) => {
          captured = request
          return makeResponse({ status: 204 })
        }),
      ),
    )
    const list = defineRequest({
      builder: () => ({ query }),
      method: 'GET',
      path: '/items',
    })

    const [error] = await client.execute(list())

    expect(error).toBeNull()
    expect(captured?.queryString).toBe('tag=a&tag=b')
    expect(captured?.queryParams).toBe(query)
  })

  test('interceptor sees queryParams parsed from the serializer string', async () => {
    let captured: HttpRequest | undefined
    const client = createClient(
      withEndpoint('https://example.com'),
      withQuerySerializer(() => 'filter[state]=open&tag=a&tag=b'),
      withInterceptors(
        createHttpInterceptor(async (request) => {
          captured = request
          return makeResponse({ status: 204 })
        }),
      ),
    )
    const search = defineRequest({
      builder: () => ({ query: { filter: { state: 'open' }, tag: ['a', 'b'] } }),
      method: 'GET',
      path: '/items',
    })

    const [error] = await client.execute(search())

    expect(error).toBeNull()
    expect(captured?.queryString).toBe('filter[state]=open&tag=a&tag=b')
    expect(captured?.queryParams?.get('filter[state]')).toBe('open')
    expect(captured?.queryParams?.getAll('tag')).toEqual(['a', 'b'])
  })

  test('a configured serializer is not called when the request has no query', async () => {
    let calls = 0
    let captured: HttpRequest | undefined
    const client = createClient(
      withEndpoint('https://example.com'),
      withQuerySerializer(() => {
        calls += 1
        return 'x=1'
      }),
      withInterceptors(
        createHttpInterceptor(async (request) => {
          captured = request
          return makeResponse({ status: 204 })
        }),
      ),
    )
    const health = defineRequest({ method: 'GET', path: '/health' })

    const [error] = await client.execute(health())

    expect(error).toBeNull()
    expect(calls).toBe(0)
    expect(captured?.queryString).toBe('')
    expect(captured?.queryParams?.toString()).toBe('')
  })

  test('SSE query uses the serializer and skips URLSearchParams', async () => {
    const seen: unknown[] = []
    let url = ''
    const client = createClient(
      withEndpoint('https://example.com'),
      withQuerySerializer((query) => {
        seen.push(query)
        return 'from=sse'
      }),
      withSSEHandle(async (input) => {
        url = input instanceof Request ? input.url : String(input)
        throw new Error('stop')
      }),
    )
    const events = defineEventStream({
      builder: (input) => ({ query: input }),
      events: { message: struct.string() },
      input: struct.object({ roomId: struct.string().alias('room_id'), since: struct.date() }),
      maxBufferSize: 128,
      maxQueueSize: 4,
      path: '/events',
    })
    const native = defineEventStream({
      builder: () => ({ query: new URLSearchParams({ room_id: 'blue' }) }),
      events: { message: struct.string() },
      maxBufferSize: 128,
      maxQueueSize: 4,
      path: '/events',
    })

    const [encodedError] = await client.execute(events({ roomId: 'blue', since: birthday }))
    const [nativeError] = await client.execute(native())

    expect(encodedError?.code.startsWith('NET_')).toBe(true)
    expect(nativeError?.code.startsWith('NET_')).toBe(true)
    expect(seen).toEqual([{ room_id: 'blue', since: '1815-12-10T00:00:00.000Z' }])
    expect(url).toContain('room_id=blue')
    expect(url).not.toContain('from=sse')
  })

  test('WebSocket query uses the serializer and skips URLSearchParams', async () => {
    const seen: unknown[] = []
    const urls: string[] = []
    const client = createClient(
      withEndpoint('https://example.com'),
      withQuerySerializer((query) => {
        seen.push(query)
        return 'from=ws'
      }),
      withWebSocketHandle(stoppingSocket(urls)),
    )
    const encoded = defineWebSocket({
      builder: (input) => ({ query: input }),
      incoming: struct.unknown(),
      input: struct.object({ roomId: struct.string().alias('room_id'), since: struct.date() }),
      maxIncomingQueueSize: 1,
      path: '/ws',
    })
    const native = defineWebSocket({
      builder: () => ({ query: new URLSearchParams({ room_id: 'blue' }) }),
      incoming: struct.unknown(),
      maxIncomingQueueSize: 1,
      path: '/ws',
    })

    await client.execute(encoded({ roomId: 'blue', since: birthday }))
    await client.execute(native())

    expect(seen).toEqual([{ room_id: 'blue', since: '1815-12-10T00:00:00.000Z' }])
    expect(urls[0]).toContain('from=ws')
    expect(urls[1]).toContain('room_id=blue')
    expect(urls[1]).not.toContain('from=ws')
  })

  test('WebSocket nested query fails without a serializer', async () => {
    const urls: string[] = []
    const client = createClient(withEndpoint('https://example.com'), withWebSocketHandle(stoppingSocket(urls)))
    const socket = defineWebSocket({
      builder: () => ({ query: { filter: { state: 'open' } } }),
      incoming: struct.unknown(),
      maxIncomingQueueSize: 1,
      path: '/ws',
    })

    const [error] = await client.execute(socket())

    expect(urls).toEqual([])
    expect(error?.code).toBe('REQ_BUILD_FAILED')
    expect(error?.cause).toBeInstanceOf(TypeError)
    if (!(error?.cause instanceof Error)) {
      throw new Error('expected nested websocket query cause')
    }
    expect(error.cause.message).toContain('a query serializer is required')
  })

  test('fetch sends the serializer string verbatim', async () => {
    let search = ''
    const client = createClient(
      withEndpoint('https://example.com'),
      withQuerySerializer(() => 'filter[state]=open'),
      withHTTPHandle(async (input) => {
        const request = input instanceof Request ? input : new Request(input)
        search = new URL(request.url).search
        return new Response(null, { status: 204 })
      }),
    )
    const searchRequest = defineRequest({
      builder: () => ({ query: { filter: { state: 'open' } } }),
      method: 'GET',
      path: '/items',
    })

    const [error] = await client.execute(searchRequest())

    expect(error).toBeNull()
    expect(search === '?filter[state]=open' || search === '?filter%5Bstate%5D=open').toBe(true)
  })
})
