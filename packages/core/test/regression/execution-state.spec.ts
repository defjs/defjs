import { expect, test, vi } from 'vitest'
import {
  createClient,
  createHttpInterceptor,
  createSSEInterceptor,
  defineEventStream,
  defineRequest,
  ERR_ABORTED,
  ERR_TIMEOUT,
  struct,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
  withSSEHandle,
} from '../../src'

const request = defineRequest({ method: 'GET', path: '/request' })
const events = defineEventStream({ path: '/events', events: { message: struct.string() }, maxBufferSize: 1024, maxQueueSize: 4 })

test.each(['abort', 'timeout'] as const)('HTTP %s cannot mark a sentinel for another client', async (mode) => {
  vi.useFakeTimers()
  const entered = Promise.withResolvers<void>()
  const controller = new AbortController()
  const first = createClient(
    withEndpoint('https://first.example'),
    withHTTPHandle(async () => {
      entered.resolve()
      return new Promise<Response>(() => {})
    }),
  )
  const cause = mode === 'abort' ? ERR_ABORTED : ERR_TIMEOUT
  const second = createClient(
    withEndpoint('https://second.example'),
    withInterceptors(
      createSSEInterceptor(async () => {
        throw cause
      }),
    ),
  )
  try {
    const pending = first.execute(request(), { signal: controller.signal, ...(mode === 'timeout' ? { timeout: 10 } : {}) })
    await entered.promise
    if (mode === 'abort') controller.abort()
    else await vi.advanceTimersByTimeAsync(11)
    expect((await pending)[0]?.code).toBe(mode === 'abort' ? 'NET_ABORTED' : 'NET_TIMEOUT')
    const [fault, stream, open] = await second.execute(events())
    expect(fault?.code).toBe('EXT_INTERCEPTOR_FAILED')
    expect(fault?.cause).toBe(cause)
    expect(stream).toBeUndefined()
    expect(open).toBeUndefined()
  } finally {
    controller.abort()
    vi.useRealTimers()
  }
})

test.each(['http', 'sse'] as const)('a reused cause retains its %s execution origin only', async (transport) => {
  const cause = new Error('shared handle and interceptor cause')
  let transportFailure = true
  const seen: unknown[] = []
  const client = createClient(
    withEndpoint('https://example.test'),
    withHTTPHandle(async () => {
      throw cause
    }),
    withSSEHandle(async () => {
      throw cause
    }),
    withInterceptors(
      createHttpInterceptor(async (req, next) => {
        if (!transportFailure) throw cause
        try {
          return await next(req)
        } catch (error) {
          seen.push(error)
          throw error
        }
      }),
      createSSEInterceptor(async (req, next) => {
        if (!transportFailure) throw cause
        try {
          return await next(req)
        } catch (error) {
          seen.push(error)
          throw error
        }
      }),
    ),
  )
  const first = transport === 'http' ? await client.execute(request()) : await client.execute(events())
  expect(first[0]?.code).toBe('NET_UNREACHABLE')
  expect(seen).toEqual([cause])
  transportFailure = false
  const second = transport === 'http' ? await client.execute(request()) : await client.execute(events())
  expect(second[0]?.code).toBe('EXT_INTERCEPTOR_FAILED')
  expect(second[0]?.cause).toBe(cause)
})

test.each(['abort', 'timeout'] as const)('SSE %s cannot leak open info into another client startup', async (mode) => {
  vi.useFakeTimers()
  const controller = new AbortController()
  const cause = mode === 'abort' ? ERR_ABORTED : ERR_TIMEOUT
  const first = createClient(
    withEndpoint('https://first.example'),
    withSSEHandle(
      async () => new Response(new ReadableStream<Uint8Array>(), { headers: { 'content-type': 'text/event-stream', 'x-tenant': 'first' } }),
    ),
  )
  try {
    const [fault, stream, open] = await first.execute(events(), { signal: controller.signal })
    expect(fault).toBeNull()
    expect(open?.response.headers.get('x-tenant')).toBe('first')
    controller.abort(mode === 'timeout' ? new DOMException('deadline', 'TimeoutError') : undefined)
    await stream?.closed
    await stream?.[Symbol.asyncDispose]()
    const second = createClient(
      withEndpoint('https://second.example'),
      withSSEHandle(async () => {
        throw cause
      }),
    )
    const [nextFault, nextStream, nextOpen] = await second.execute(events())
    expect(nextFault?.code).toBe(mode === 'abort' ? 'NET_ABORTED' : 'NET_TIMEOUT')
    expect(nextFault?.cause).toBe(cause)
    expect(nextStream).toBeUndefined()
    expect(nextOpen).toBeUndefined()
    const stalled = createClient(
      withEndpoint('https://third.example'),
      withSSEHandle(async () => new Promise<Response>(() => {})),
    )
    const pending = stalled.execute(events(), { timeout: 10 })
    await vi.advanceTimersByTimeAsync(11)
    const [timeoutFault, , timeoutOpen] = await pending
    expect(timeoutFault?.code).toBe('NET_TIMEOUT')
    expect(timeoutOpen).toBeUndefined()
  } finally {
    controller.abort()
    vi.useRealTimers()
  }
})

test('a cancelled 401 handshake cannot classify a later sentinel as HTTP_STATUS', async () => {
  const controller = new AbortController()
  const entered = Promise.withResolvers<void>()
  const rejected = Promise.withResolvers<unknown>()
  const first = createClient(
    withEndpoint('https://first.example'),
    withSSEHandle(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>(
            {
              pull() {
                entered.resolve()
              },
            },
            { highWaterMark: 0 },
          ),
          { status: 401, headers: { 'content-type': 'application/json', 'x-tenant': 'first' } },
        ),
    ),
    withInterceptors(
      createSSEInterceptor(async (req, next) => {
        try {
          return await next(req)
        } catch (cause) {
          rejected.resolve(cause)
          throw cause
        }
      }),
    ),
  )
  const declared = defineEventStream({
    path: '/events',
    error: struct.object({ message: struct.string() }),
    events: { message: struct.string() },
    maxBufferSize: 1024,
    maxQueueSize: 4,
  })
  const pending = first.execute(declared(), { signal: controller.signal })
  await entered.promise
  await Promise.resolve()
  controller.abort()
  await pending
  expect(await rejected.promise).toBe(ERR_ABORTED)
  const second = createClient(
    withEndpoint('https://second.example'),
    withSSEHandle(async () => {
      throw ERR_ABORTED
    }),
  )
  const [fault, , open] = await second.execute(events())
  expect(fault?.code).toBe('NET_ABORTED')
  expect(open).toBeUndefined()
})
