import { afterEach, describe, expect, test, vi } from 'vitest'
import { createClient, withEndpoint, withInterceptors, withSSEHandle, withSSEReconnect } from '../client'
import { ERR_STREAMING_REQUEST_UNSUPPORTED, __resetStreamingRequestBodySupportForTests } from '../http/transport/fetch_init'
import { simulateUnsupportedStreaming } from '../../test/streaming-support'
import type { Client } from '../client'
import { createSSEInterceptor } from '../interceptor'
import { struct } from '../struct'
import { defineEventStream } from './index'

/**
 * Locks SSE onto the one fault-code namespace shared with HTTP.
 *
 * The two `EXT_*` splits live in `transport/event_stream.advanced.spec.ts`: `onopen`/`onclose`
 * and `transformMessage` are `fetchEventStream` options, not client-level surface.
 *
 * SSE used to carry a parallel `EventStreamErrorCode` set with no `kind` and no mapping to the
 * request error model, and it reported two different kinds of caller code — the lifecycle hooks
 * and the message transform — under a single `EXT_OBSERVER_FAILED`.
 */

const SSE_HEADERS = { 'content-type': 'text/event-stream' }

function streamOf(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
}

function clientReturning(response: () => Response | Promise<Response>, ...options: Parameters<typeof createClient>): Client {
  return createClient(withEndpoint('https://api.example.test'), withSSEHandle(response as unknown as typeof fetch), ...options)
}

const useStream = defineEventStream({
  events: { message: struct.string() },
  maxBufferSize: 1024,
  maxQueueSize: 8,
  path: '/events',
})

describe('sse startup faults', () => {
  test('should report a non-2xx handshake as HTTP_STATUS with the declared error body', async () => {
    const useDeclared = defineEventStream({
      error: struct.object({ reason: struct.string() }),
      events: { message: struct.string() },
      maxBufferSize: 1024,
      maxQueueSize: 8,
      path: '/events',
    })
    const client = clientReturning(
      async () => new Response('{"reason":"forbidden"}', { headers: { 'content-type': 'application/json' }, status: 403 }),
    )

    const [fault] = await client.execute(useDeclared())

    expect(fault?.code).toBe('HTTP_STATUS')
    if (fault?.code !== 'HTTP_STATUS') throw new Error('Expected an http status fault')
    expect(fault.status).toBe(403)
    expect(fault.data).toEqual({ reason: 'forbidden' })
  })

  test('should report a wrong handshake media type as RES_MEDIA_TYPE_INVALID', async () => {
    const client = clientReturning(async () => new Response('not a stream', { headers: { 'content-type': 'text/plain' } }))

    const [fault] = await client.execute(useStream())

    expect(fault?.code).toBe('RES_MEDIA_TYPE_INVALID')
  })

  test('should report a missing handshake body as RES_DECODE_FAILED', async () => {
    const client = clientReturning(async () => new Response(null, { headers: SSE_HEADERS }))

    const [fault] = await client.execute(useStream())

    expect(fault?.code).toBe('RES_DECODE_FAILED')
  })

  test('should report an unreachable transport as NET_UNREACHABLE', async () => {
    const cause = new TypeError('fetch failed')
    const client = clientReturning(async () => {
      throw cause
    })

    const [fault] = await client.execute(useStream())

    expect(fault?.code).toBe('NET_UNREACHABLE')
    expect(fault?.cause).toBe(cause)
  })

  test('should report an interceptor throw as EXT_INTERCEPTOR_FAILED', async () => {
    const cause = new Error('interceptor exploded')
    const client = clientReturning(
      async () => new Response(streamOf('data: hi\n\n'), { headers: SSE_HEADERS }),
      withInterceptors(
        createSSEInterceptor(async () => {
          throw cause
        }),
      ),
    )

    const [fault] = await client.execute(useStream())

    expect(fault?.code).toBe('EXT_INTERCEPTOR_FAILED')
    expect(fault?.cause).toBe(cause)
  })
})

describe('sse runtime faults', () => {
  test('should report a buffer limit as CAP_BUFFER_EXCEEDED', async () => {
    const useTiny = defineEventStream({
      events: { message: struct.string() },
      maxBufferSize: 4,
      maxQueueSize: 8,
      path: '/events',
    })
    const client = clientReturning(async () => new Response(streamOf(`data: ${'x'.repeat(64)}\n\n`), { headers: SSE_HEADERS }))

    const [fault, stream] = await client.execute(useTiny())

    expect(fault).toBeNull()
    if (fault) throw new Error('Expected the stream to open')
    await expect(stream[Symbol.asyncIterator]().next()).rejects.toThrow()
    await expect(stream.closed).resolves.toMatchObject({ code: 'CAP_BUFFER_EXCEEDED', kind: 'error' })
  })

  test('should report a queue overflow as CAP_QUEUE_OVERFLOW', async () => {
    const useTinyQueue = defineEventStream({
      events: { message: struct.string() },
      maxBufferSize: 1024,
      maxQueueSize: 1,
      path: '/events',
    })
    const client = clientReturning(async () => new Response(streamOf('data: a\n\ndata: b\n\ndata: c\n\n'), { headers: SSE_HEADERS }))

    const [fault, stream] = await client.execute(useTinyQueue())

    expect(fault).toBeNull()
    if (fault) throw new Error('Expected the stream to open')
    await expect(stream.closed).resolves.toMatchObject({ code: 'CAP_QUEUE_OVERFLOW', kind: 'error' })
  })

  test('should report a clean end of stream with kind eof and no code', async () => {
    const client = clientReturning(async () => new Response(streamOf('data: hi\n\n'), { headers: SSE_HEADERS }))

    const [fault, stream] = await client.execute(useStream())

    expect(fault).toBeNull()
    if (fault) throw new Error('Expected the stream to open')
    for await (const event of stream) {
      expect(event.data).toBe('hi')
    }
    const closed = await stream.closed
    expect(closed.kind).toBe('eof')
    expect(closed).not.toHaveProperty('code')
  })
})

describe('unsupported streaming request body', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    __resetStreamingRequestBodySupportForTests()
  })

  test('should report ENV_UNSUPPORTED for a ReadableStream body before calling the handle', async () => {
    simulateUnsupportedStreaming()
    const body = byteStream()
    const handle = vi.fn(async () => new Response(null, { status: 204 }))
    const client = createClient(withEndpoint('https://example.com'), withSSEHandle(handle))
    const useStream = defineEventStream({
      builder: () => ({ body }),
      events: { message: struct.string() },
      maxBufferSize: 1024,
      maxQueueSize: 8,
      method: 'POST',
      path: '/events',
    })

    const [error, events, open] = await client.execute(useStream())

    expect(error?.code).toBe('ENV_UNSUPPORTED')
    expect(error?.cause).toBe(ERR_STREAMING_REQUEST_UNSUPPORTED)
    expect(error?.cause instanceof Error ? error.cause.message : '').toBe('ERR_STREAMING_REQUEST_UNSUPPORTED')
    expect(events).toBeUndefined()
    expect(open).toBeUndefined()
    expect(handle).toHaveBeenCalledTimes(0)
    expect(body.locked).toBe(false)
  })

  test('should report ENV_UNSUPPORTED without consulting reconnect', async () => {
    simulateUnsupportedStreaming()
    const body = byteStream()
    const handle = vi.fn(async () => new Response(null, { status: 204 }))
    const shouldReconnect = vi.fn(() => false)
    const client = createClient(
      withEndpoint('https://example.com'),
      withSSEHandle(handle),
      withSSEReconnect({ delayMs: 60_000, shouldReconnect }),
    )
    const useStream = defineEventStream({
      builder: () => ({ body }),
      events: { message: struct.string() },
      maxBufferSize: 1024,
      maxQueueSize: 8,
      method: 'POST',
      path: '/events',
    })

    const [error, events, open] = await client.execute(useStream())

    expect(error?.code).toBe('ENV_UNSUPPORTED')
    expect(error?.cause).toBe(ERR_STREAMING_REQUEST_UNSUPPORTED)
    expect(events).toBeUndefined()
    expect(open).toBeUndefined()
    expect(handle).toHaveBeenCalledTimes(0)
    expect(shouldReconnect).toHaveBeenCalledTimes(0)
    expect(body.locked).toBe(false)
  })
})

test('should return REQ_BUILD_FAILED when the JSON body is a Map', async () => {
  const handle = vi.fn(async () => new Response(streamOf('data: a\n\n'), { headers: SSE_HEADERS }))
  const client = createClient(withEndpoint('https://example.com'), withSSEHandle(handle))
  const useStream = defineEventStream({
    builder: () => ({ body: new Map() as never }),
    events: { message: struct.string() },
    maxBufferSize: 1024,
    maxQueueSize: 8,
    method: 'POST',
    path: '/events',
  })

  const [fault, events, open] = await client.execute(useStream())

  expect(fault?.code).toBe('REQ_BUILD_FAILED')
  expect(events).toBeUndefined()
  expect(open).toBeUndefined()
  expect(fault?.cause).toBeInstanceOf(TypeError)
  expect(fault?.cause instanceof TypeError ? fault.cause.message : '').toMatch(/Map/)
  expect(handle).toHaveBeenCalledTimes(0)
})

test('should return REQ_BUILD_FAILED when the JSON body is an async iterable object', async () => {
  const handle = vi.fn(async () => new Response(streamOf('data: a\n\n'), { headers: SSE_HEADERS }))
  const client = createClient(withEndpoint('https://example.com'), withSSEHandle(handle))
  const useStream = defineEventStream({
    builder: () => ({
      body: {
        async *[Symbol.asyncIterator]() {
          yield new TextEncoder().encode('chunk')
        },
      },
    }),
    events: { message: struct.string() },
    maxBufferSize: 1024,
    maxQueueSize: 8,
    method: 'POST',
    path: '/events',
  })

  const [fault, events, open] = await client.execute(useStream())

  expect(fault?.code).toBe('REQ_BUILD_FAILED')
  expect(events).toBeUndefined()
  expect(open).toBeUndefined()
  expect(fault?.cause).toBeInstanceOf(TypeError)
  expect(fault?.cause instanceof TypeError ? fault.cause.message : '').toMatch(/iterable object/)
  expect(handle).toHaveBeenCalledTimes(0)
})

describe('ReadableStream body and reconnect', () => {
  test('should not reconnect when the handle reads a stream body and fails', async () => {
    const failure = new TypeError('network down')
    const body = byteStream()
    const shouldReconnect = vi.fn(() => true)
    const handle = vi.fn(async (request: Request) => {
      await request.arrayBuffer()
      throw failure
    }) as unknown as typeof globalThis.fetch
    const client = createClient(
      withEndpoint('https://example.com'),
      withSSEHandle(handle),
      withSSEReconnect({ attempts: 2, delayMs: 0, shouldReconnect }),
    )
    const useStream = defineEventStream({
      builder: () => ({ body }),
      events: { message: struct.string() },
      maxBufferSize: 1024,
      maxQueueSize: 8,
      method: 'POST',
      path: '/events',
    })

    const [fault, events, open] = await client.execute(useStream())

    expect(events).toBeUndefined()
    expect(open).toBeUndefined()
    expect(fault?.code).toBe('NET_UNREACHABLE')
    expect(fault?.cause).toBe(failure)
    expect(handle).toHaveBeenCalledTimes(1)
    expect(shouldReconnect).toHaveBeenCalledTimes(0)
  })

  test('should not reconnect when an interceptor replaces the body with a stream', async () => {
    const failure = new TypeError('network down')
    const shouldReconnect = vi.fn(() => true)
    const handle = vi.fn(async (request: Request) => {
      await request.arrayBuffer()
      throw failure
    }) as unknown as typeof globalThis.fetch
    const client = createClient(
      withEndpoint('https://example.com'),
      withSSEHandle(handle),
      withSSEReconnect({ attempts: 2, delayMs: 0, shouldReconnect }),
      withInterceptors(
        createSSEInterceptor(async (request, next) => {
          return await next({ ...request, body: byteStream() })
        }),
      ),
    )
    const useStream = defineEventStream({
      builder: () => ({ body: 'prompt' }),
      events: { message: struct.string() },
      maxBufferSize: 1024,
      maxQueueSize: 8,
      method: 'POST',
      path: '/events',
    })

    const [fault, events, open] = await client.execute(useStream())

    expect(events).toBeUndefined()
    expect(open).toBeUndefined()
    expect(fault?.code).toBe('NET_UNREACHABLE')
    expect(fault?.cause).toBe(failure)
    expect(handle).toHaveBeenCalledTimes(1)
    expect(shouldReconnect).toHaveBeenCalledTimes(0)
  })

  test('should reconnect when an interceptor replaces a stream body with a blob', async () => {
    const failure = new TypeError('network down')
    const shouldReconnect = vi.fn(() => true)
    let attempt = 0
    const handle = vi.fn(async () => {
      attempt += 1
      if (attempt === 1) {
        throw failure
      }
      return new Response(streamOf('data: hi\n\n'), { headers: SSE_HEADERS })
    })
    const client = createClient(
      withEndpoint('https://example.com'),
      withSSEHandle(handle),
      withSSEReconnect({ attempts: 2, delayMs: 0, shouldReconnect }),
      withInterceptors(
        createSSEInterceptor(async (request, next) => {
          return await next({ ...request, body: new Blob(['x']) })
        }),
      ),
    )
    const useStream = defineEventStream({
      builder: () => ({ body: byteStream() }),
      events: { message: struct.string() },
      maxBufferSize: 1024,
      maxQueueSize: 8,
      method: 'POST',
      path: '/events',
    })

    const [fault, stream] = await client.execute(useStream())

    expect(fault).toBeNull()
    if (!stream) {
      throw new Error('Expected the stream to open')
    }
    const events: string[] = []
    for await (const event of stream) {
      events.push(event.data)
    }
    expect(events).toEqual(['hi'])
    expect(handle).toHaveBeenCalledTimes(2)
  })
})

function byteStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Uint8Array.from([1, 2, 3, 4]))
      controller.close()
    },
  })
}
