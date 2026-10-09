import { createClient, defineEventStream, defineRequest, defineWebSocket, struct, withEndpoint, withHTTPHandle } from '@defjs/core'
import { SpanStatusCode } from '@opentelemetry/api'
import { CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator } from '@opentelemetry/core'
import { describe, expect, inject, test } from 'vitest'
import { withOpenTelemetryServer } from './src/option'
import type { MockSpan } from './src/test-utils'
import { createMockTracer } from './src/test-utils'

interface EchoHeadersResponse {
  headers: { [key: string]: string }
}

function createPropagator() {
  return new CompositePropagator({
    propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
  })
}

function isEchoHeadersResponse(value: unknown): value is EchoHeadersResponse {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const headers: unknown = Reflect.get(value, 'headers')
  if (typeof headers !== 'object' || headers === null) {
    return false
  }

  return Object.values(headers).every((item) => typeof item === 'string')
}

function onlySpan(spans: readonly MockSpan[]): MockSpan {
  expect(spans).toHaveLength(1)

  const span = spans[0]
  if (!span) {
    throw new Error('Expected one span')
  }

  return span
}

const TRACE_PARENT_REGEX = /^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/

describe('e2e: opentelemetry-server with real test server', () => {
  test('HTTP request carries traceparent header', async () => {
    const { tracer, spans } = createMockTracer()
    const propagator = createPropagator()
    const host = inject('testServerHost')

    const client = createClient(withEndpoint(host), withOpenTelemetryServer({ tracer, propagator }))

    const useEchoHeaders = defineRequest({
      builder: () => ({}),
      method: 'POST',
      path: '/echo-headers',
      input: struct.object({}),
      output: struct.object({ headers: struct.record(struct.string()) }),
    })

    const [error, result] = await client.execute(useEchoHeaders({}))

    expect(error).toBeNull()
    expect(result).toBeDefined()
    if (!isEchoHeadersResponse(result)) {
      throw new Error('Expected echo headers response')
    }
    expect(result.headers['traceparent']).toMatch(TRACE_PARENT_REGEX)

    const span = onlySpan(spans)
    expect(span.name).toBe('POST')
    expect(span.attributes['http.request.method']).toBe('POST')
    expect(span.attributes['url.full']).toMatch(/\/echo-headers$/)
    expect(span.ended).toBe(true)
    expect(span.status).toBeUndefined()
  })

  test('HTTP error records span with ERROR status', async () => {
    const { tracer, spans } = createMockTracer()
    const propagator = createPropagator()
    const host = inject('testServerHost')

    const client = createClient(withEndpoint(host), withOpenTelemetryServer({ tracer, propagator }))

    const useFail = defineRequest({
      method: 'GET',
      path: '/500',
    })

    const [error] = await client.execute(useFail())

    expect(error).not.toBeNull()
    const span = onlySpan(spans)
    expect(span.name).toBe('GET')
    expect(span.attributes['error.type']).toBe('500')
    expect(span.status?.code).toBe(SpanStatusCode.ERROR)
    expect(span.ended).toBe(true)
  })

  test('HTTP transport rejection returns NET_UNREACHABLE and records the exception class on the span', async () => {
    const { tracer, spans } = createMockTracer()
    const client = createClient(
      withEndpoint('https://example.invalid'),
      withHTTPHandle(() => Promise.reject(new TypeError('fetch failed'))),
      withOpenTelemetryServer({ tracer, propagator: createPropagator() }),
    )
    const useUnavailable = defineRequest({ method: 'GET', path: '/unavailable' })

    const [error, result, response] = await client.execute(useUnavailable())

    expect(error).toMatchObject({ code: 'NET_UNREACHABLE' })
    expect(result).toBeUndefined()
    expect(response).toBeUndefined()

    const span = onlySpan(spans)
    expect(span.name).toBe('GET')
    expect(span.attributes['http.response.status_code']).toBeUndefined()
    // An in-chain observer sees the raw rejection; fault classification happens outside the
    // chain, so the span carries the exception class per OTel convention.
    expect(span.attributes['error.type']).toBe('TypeError')
    expect(span.status?.code).toBe(SpanStatusCode.ERROR)
    expect(span.ended).toBe(true)
  })

  test('SSE request carries traceparent header', async () => {
    const { tracer, spans } = createMockTracer()
    const propagator = createPropagator()
    const host = inject('testServerHost')

    const client = createClient(withEndpoint(host), withOpenTelemetryServer({ tracer, propagator }))

    const useStream = defineEventStream({
      events: {
        traceparent: struct.string(),
      },
      maxBufferSize: 64 * 1024,
      maxQueueSize: 16,
      path: '/sse',
    })

    const [error, stream, open] = await client.execute(useStream())

    expect(error).toBeNull()
    expect(open?.response?.ok).toBe(true)

    if (!stream) {
      throw new Error('Expected stream')
    }

    const messages: Array<{ data: string; event: string; id?: string }> = []
    for await (const event of stream) {
      messages.push(event)
    }

    expect(messages).toHaveLength(1)
    expect(messages[0]?.data).toMatch(TRACE_PARENT_REGEX)
    await stream.closed

    const span = onlySpan(spans)
    expect(span.name).toBe('SSE')
    expect(span.ended).toBe(true)
  })

  test('SSE error records span with ERROR status', async () => {
    const { tracer, spans } = createMockTracer()
    const propagator = createPropagator()
    const host = inject('testServerHost')

    const client = createClient(withEndpoint(host), withOpenTelemetryServer({ tracer, propagator }))

    const useStream = defineEventStream({
      events: {
        traceparent: struct.string(),
      },
      maxBufferSize: 64 * 1024,
      maxQueueSize: 16,
      path: '/sse/500',
    })

    const [error] = await client.execute(useStream())

    expect(error).not.toBeNull()
    const span = onlySpan(spans)
    expect(span.name).toBe('SSE')
    expect(span.status?.code).toBe(2) // ERROR
    expect(span.ended).toBe(true)
  })

  test('WebSocket explicit query propagation carries traceparent in query params', async () => {
    const { tracer, spans } = createMockTracer()
    const propagator = createPropagator()
    const host = inject('testServerHost')

    // Replace http:// with ws:// for WebSocket endpoint
    const wsHost = host.replace(/^http:/, 'ws:')

    const client = createClient(
      withEndpoint(wsHost),
      withOpenTelemetryServer({ tracer, propagator, webSocket: { queryPropagation: true } }),
    )

    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.object({ type: struct.literal('traceparent'), value: struct.string() }),
      path: '/ws',
    })

    const [error, socket, connection] = await client.execute(useSocket())

    expect(error).toBeNull()
    expect(socket).toBeDefined()

    if (!socket) {
      throw new Error('Expected socket')
    }

    const messages: Array<{ type: string; value: string }> = []
    for await (const msg of socket.receive) {
      messages.push(msg)
    }

    await socket.closed

    expect(messages).toHaveLength(1)
    expect(messages[0]?.type).toBe('traceparent')
    expect(messages[0]?.value).toMatch(TRACE_PARENT_REGEX)

    const span = onlySpan(spans)
    expect(span.name).toBe('WebSocket')
    expect(span.ended).toBe(true)

    // Verify URL contains traceparent
    const url = new URL(connection?.url ?? '')
    expect(url.searchParams.get('traceparent')).toMatch(TRACE_PARENT_REGEX)
  })

  test('WebSocket omitted query propagation leaves the URL unchanged', async () => {
    const { tracer, spans } = createMockTracer()
    const propagator = createPropagator()
    const host = inject('testServerHost')
    const wsHost = host.replace(/^http:/, 'ws:')

    const client = createClient(
      withEndpoint(wsHost),
      withOpenTelemetryServer({
        tracer,
        propagator,
      }),
    )

    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.object({ type: struct.literal('traceparent'), value: struct.string() }),
      path: '/ws',
    })

    const [error, socket, connection] = await client.execute(useSocket())

    expect(error).toBeNull()
    if (!socket) {
      throw new Error('Expected socket')
    }

    const messages: Array<{ type: string; value: string }> = []
    for await (const msg of socket.receive) {
      messages.push(msg)
    }

    await socket.closed

    expect(messages).toHaveLength(1)
    expect(messages[0]?.type).toBe('traceparent')
    expect(messages[0]?.value).toBe('missing')

    const span = onlySpan(spans)
    expect(span.name).toBe('WebSocket')
    expect(span.ended).toBe(true)

    const url = new URL(connection?.url ?? '')
    expect(url.searchParams.get('traceparent')).toBeNull()
    expect(connection?.url).toBe(`${wsHost}/ws`)
  })
})
