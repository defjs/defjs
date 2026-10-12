import type { HttpRequest } from '@defjs/core'
import { createNetworkFault, ERR_ABORTED, ERR_TIMEOUT } from '@defjs/core'
import { context, diag, ROOT_CONTEXT, SpanStatusCode, trace } from '@opentelemetry/api'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  activeSpans,
  createMockLogger,
  createMockMetrics,
  createMockPropagator,
  createMockTracer,
  makeHttpRequest,
  makeHttpResponse,
} from '../test-utils'
import { createOpenTelemetryHttpInterceptor } from './http'

let mockPropagator: ReturnType<typeof createMockPropagator>

describe('HTTP client diagnostic logs', () => {
  afterEach(() => vi.restoreAllMocks())

  test.each([false, true])('records the saved context and original cause with tracer=%s', async (tracing) => {
    const { logger, records } = createMockLogger()
    const { tracer, spans } = createMockTracer()
    const parent = trace.setSpanContext(ROOT_CONTEXT, {
      traceId: '11111111111111111111111111111111',
      spanId: '2222222222222222',
      traceFlags: 0,
    })
    const active = vi.spyOn(context, 'active').mockReturnValue(parent)
    const interceptor = createOpenTelemetryHttpInterceptor({
      logger,
      tracer: tracing ? tracer : undefined,
      propagator: createMockPropagator(),
    })
    const cause = new TypeError('private network detail')
    await expect(
      interceptor.fn(makeHttpRequest(), async () => {
        active.mockReturnValue(ROOT_CONTEXT)
        throw cause
      }),
    ).rejects.toBe(cause)
    expect(records).toHaveLength(1)
    const record = records[0]
    if (!record?.context) throw new Error('Expected a log record with explicit context')
    expect(record).toMatchObject({
      eventName: 'http.client.request.exception',
      severityNumber: 13,
      severityText: 'WARN',
      attributes: { 'defjs.phase': 'request', 'exception.type': 'TypeError' },
    })
    if (tracing) expect(trace.getSpan(record.context)).toBe(spans[0])
    else expect(record.context).toBe(parent)
  })

  test.each([ERR_ABORTED, new DOMException('cancelled', 'AbortError'), createNetworkFault(ERR_ABORTED)])(
    'does not log cancellation: %s',
    async (cause) => {
      const { logger, records } = createMockLogger()
      const interceptor = createOpenTelemetryHttpInterceptor({ logger, propagator: createMockPropagator() })
      await expect(
        interceptor.fn(makeHttpRequest(), async () => {
          throw cause
        }),
      ).rejects.toBe(cause)
      expect(records).toEqual([])
    },
  )

  test('still logs a timeout when the request signal is aborted', async () => {
    const { logger, records } = createMockLogger()
    const interceptor = createOpenTelemetryHttpInterceptor({ logger, propagator: createMockPropagator() })
    await expect(
      interceptor.fn({ ...makeHttpRequest(), abort: AbortSignal.abort(ERR_TIMEOUT) }, async () => {
        throw ERR_TIMEOUT
      }),
    ).rejects.toBe(ERR_TIMEOUT)
    expect(records).toHaveLength(1)
    expect(records[0]?.severityNumber).toBe(13)
  })

  test.each([200, 404, 500, 0])('does not manufacture an exception log for status %s', async (status) => {
    const { logger, records } = createMockLogger()
    const interceptor = createOpenTelemetryHttpInterceptor({ logger, propagator: createMockPropagator() })
    const response = { ...makeHttpResponse(), status }
    await expect(interceptor.fn(makeHttpRequest(), async () => response)).resolves.toBe(response)
    expect(records).toEqual([])
  })

  test('logger failure preserves the original rejection and other telemetry', async () => {
    const { logger } = createMockLogger()
    logger.emit.mockImplementation(() => {
      throw new Error('logger failed')
    })
    vi.spyOn(diag, 'error').mockImplementation(() => undefined)
    const { tracer, spans } = createMockTracer()
    const metrics = createMockMetrics()
    const cause = new Error('network failed')
    const interceptor = createOpenTelemetryHttpInterceptor({ logger, tracer, metrics, propagator: createMockPropagator() })
    await expect(
      interceptor.fn(makeHttpRequest(), async () => {
        throw cause
      }),
    ).rejects.toBe(cause)
    expect(logger.emit).toHaveBeenCalledTimes(1)
    expect(spans[0]?.ended).toBe(true)
    expect(metrics.requestDuration.record).toHaveBeenCalledTimes(1)
  })
})

describe('createOpenTelemetryHttpInterceptor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPropagator = createMockPropagator()
  })

  test('should inject traceparent header via propagator', async () => {
    const { tracer } = createMockTracer()
    const interceptor = createOpenTelemetryHttpInterceptor({ tracer, propagator: mockPropagator })

    const req = makeHttpRequest()
    const next = vi.fn(async (_req: HttpRequest) => makeHttpResponse())

    await interceptor.fn(req, next)

    expect(mockPropagator.inject).toHaveBeenCalled()
    const calls = vi.mocked(next).mock.calls
    expect(calls[0]?.[0].headers?.get('traceparent')).toBe('mock-trace-id')
  })

  test.each([200, 404, 500, 0])('records HTTP status %s without a tracer and preserves the response', async (status) => {
    const metrics = createMockMetrics()
    const response = { ...makeHttpResponse(), status }
    const interceptor = createOpenTelemetryHttpInterceptor({ propagator: mockPropagator, metrics })

    await expect(interceptor.fn(makeHttpRequest(), async () => response)).resolves.toBe(response)

    expect(metrics.requestDuration.record).toHaveBeenCalledTimes(1)
    expect(metrics.requestDuration.record).toHaveBeenCalledWith(expect.any(Number), {
      'http.request.method': 'GET',
      'server.address': 'api.example.com',
      ...(status === 0 ? {} : { 'http.response.status_code': status }),
      ...(status >= 400 ? { 'error.type': String(status) } : {}),
    })
  })

  test('records a transport rejection without a tracer and rethrows the original cause', async () => {
    const metrics = createMockMetrics()
    const error = new TypeError('connection failed')
    const interceptor = createOpenTelemetryHttpInterceptor({ propagator: mockPropagator, metrics })

    await expect(
      interceptor.fn(makeHttpRequest(), async () => {
        throw error
      }),
    ).rejects.toBe(error)

    expect(metrics.requestDuration.record).toHaveBeenCalledTimes(1)
    expect(metrics.requestDuration.record).toHaveBeenCalledWith(expect.any(Number), {
      'http.request.method': 'GET',
      'server.address': 'api.example.com',
      'error.type': 'TypeError',
    })
  })

  test('should create span with correct name', async () => {
    const { tracer } = createMockTracer()
    const interceptor = createOpenTelemetryHttpInterceptor({ tracer, propagator: mockPropagator })

    await interceptor.fn(makeHttpRequest(), async () => makeHttpResponse())

    expect(activeSpans).toHaveLength(1)
    expect(activeSpans[0]?.name).toBe('GET')
  })

  test('should set span attributes', async () => {
    const { tracer } = createMockTracer()
    const interceptor = createOpenTelemetryHttpInterceptor({ tracer, propagator: mockPropagator })

    await interceptor.fn(makeHttpRequest(), async () => makeHttpResponse())

    expect(activeSpans[0]?.attributes['http.request.method']).toBe('GET')
    expect(activeSpans[0]?.attributes['url.full']).toBe('https://api.example.com/test')
  })

  test('should merge startSpanHook attributes last into initial HTTP span options', async () => {
    const { tracer } = createMockTracer()
    const req = { ...makeHttpRequest(), baseEndpoint: 'https://api.example.com:8443' }
    const startSpanHook = vi.fn(() => ({
      'app.tenant': 'acme',
      'server.address': 'tenant.example.com',
      'server.port': 9443,
      'url.full': 'https://tenant.example.com/custom',
    }))
    const interceptor = createOpenTelemetryHttpInterceptor({ tracer, propagator: mockPropagator, startSpanHook })

    await interceptor.fn(req, async () => makeHttpResponse())

    expect(startSpanHook).toHaveBeenCalledWith(req)
    expect(vi.mocked(tracer.startSpan).mock.calls[0]?.[1]?.attributes).toEqual({
      'app.tenant': 'acme',
      'http.request.method': 'GET',
      'server.address': 'tenant.example.com',
      'server.port': 9443,
      'url.full': 'https://tenant.example.com/custom',
    })
  })

  test('should keep the resolved HTTP URL initial and omit req.queryString when startSpanHook is absent', async () => {
    const { tracer } = createMockTracer()
    const interceptor = createOpenTelemetryHttpInterceptor({ tracer, propagator: mockPropagator })
    const req = { ...makeHttpRequest(), queryString: 'tenant=acme' }

    await interceptor.fn(req, async () => makeHttpResponse())

    expect(vi.mocked(tracer.startSpan).mock.calls[0]?.[1]?.attributes).toEqual({
      'http.request.method': 'GET',
      'server.address': 'api.example.com',
      'url.full': 'https://api.example.com/test',
    })
  })

  test('should preserve a literal query already present in the endpoint URL', async () => {
    const { tracer } = createMockTracer()
    const interceptor = createOpenTelemetryHttpInterceptor({ tracer, propagator: mockPropagator })

    await interceptor.fn({ ...makeHttpRequest(), endpoint: '/test?literal=kept' }, async () => makeHttpResponse())

    expect(vi.mocked(tracer.startSpan).mock.calls[0]?.[1]?.attributes?.['url.full']).toBe('/test?literal=kept')
  })

  test('should let startSpanHook explicitly include req.queryString in url.full', async () => {
    const { tracer } = createMockTracer()
    const req = { ...makeHttpRequest(), queryString: 'tenant=acme' }
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
      startSpanHook: (request) => ({ 'url.full': `${request.baseEndpoint}${request.endpoint}?${request.queryString}` }),
    })

    await interceptor.fn(req, async () => makeHttpResponse())

    expect(vi.mocked(tracer.startSpan).mock.calls[0]?.[1]?.attributes?.['url.full']).toBe('https://api.example.com/test?tenant=acme')
  })

  test('should continue HTTP and record a hook error when startSpanHook throws', async () => {
    const { tracer } = createMockTracer()
    const next = vi.fn(async () => makeHttpResponse())
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
      startSpanHook: () => {
        throw new Error('start hook failed')
      },
    })

    await interceptor.fn(makeHttpRequest(), next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(vi.mocked(tracer.startSpan).mock.calls[0]?.[1]?.attributes).toEqual({
      'http.request.method': 'GET',
      'server.address': 'api.example.com',
      'url.full': 'https://api.example.com/test',
    })
    expect(activeSpans[0]?.addEvent).toHaveBeenCalledWith('defjs.otel.hook.error', {
      'error.type': 'Error',
      'hook.name': 'startSpanHook',
    })
  })

  test('should continue HTTP when startSpanHook throws undefined', async () => {
    const { tracer } = createMockTracer()
    const next = vi.fn(async () => makeHttpResponse())
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
      startSpanHook: () => {
        throw undefined
      },
    })

    await interceptor.fn(makeHttpRequest(), next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(activeSpans[0]?.addEvent).toHaveBeenCalledWith('defjs.otel.hook.error', {
      'error.type': '_OTHER',
      'hook.name': 'startSpanHook',
    })
  })

  test('should leave span status unset on success', async () => {
    const { tracer } = createMockTracer()
    const interceptor = createOpenTelemetryHttpInterceptor({ tracer, propagator: mockPropagator })

    await interceptor.fn(makeHttpRequest(), async () => makeHttpResponse())

    expect(activeSpans[0]?.ended).toBe(true)
    expect(activeSpans[0]?.status).toBeUndefined()
  })

  test('should end span on 5xx status with ERROR', async () => {
    const { tracer } = createMockTracer()
    const interceptor = createOpenTelemetryHttpInterceptor({ tracer, propagator: mockPropagator })

    await interceptor.fn(makeHttpRequest(), async () => ({ ...makeHttpResponse(), status: 500 }))

    expect(activeSpans[0]?.ended).toBe(true)
    expect(activeSpans[0]?.attributes['error.type']).toBe('500')
    expect(activeSpans[0]?.status?.code).toBe(SpanStatusCode.ERROR)
  })

  test('should end client span on 4xx status with ERROR', async () => {
    const { tracer } = createMockTracer()
    const interceptor = createOpenTelemetryHttpInterceptor({ tracer, propagator: mockPropagator })

    await interceptor.fn(makeHttpRequest(), async () => ({ ...makeHttpResponse(), status: 404 }))

    expect(activeSpans[0]?.ended).toBe(true)
    expect(activeSpans[0]?.attributes['error.type']).toBe('404')
    expect(activeSpans[0]?.status?.code).toBe(SpanStatusCode.ERROR)
  })

  test('should leave a status-0 response unattributed for spans and metrics', async () => {
    // Transport failures reject now, so a status-0 response can only be a synthetic one an
    // interceptor built, and it carries nothing to attribute.
    const { tracer } = createMockTracer()
    const metrics = createMockMetrics()
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
    })
    const response = { ...makeHttpResponse(), status: 0 }

    await expect(interceptor.fn(makeHttpRequest(), async () => response)).resolves.toBe(response)

    expect(activeSpans[0]?.attributes['http.response.status_code']).toBeUndefined()
    expect(activeSpans[0]?.attributes['error.type']).toBeUndefined()
    expect(activeSpans[0]?.status).toBeUndefined()
    expect(activeSpans[0]?.ended).toBe(true)
    expect(metrics.requestDuration.record).toHaveBeenCalledWith(expect.any(Number), {
      'http.request.method': 'GET',
      'server.address': 'api.example.com',
    })
  })

  test('should record error on exception', async () => {
    const { tracer } = createMockTracer()
    const interceptor = createOpenTelemetryHttpInterceptor({ tracer, propagator: mockPropagator })

    await expect(
      interceptor.fn(makeHttpRequest(), async () => {
        throw new Error('network error')
      }),
    ).rejects.toThrow('network error')

    expect(activeSpans[0]?.ended).toBe(true)
    expect(activeSpans[0]?.attributes['error.type']).toBe('Error')
    expect(activeSpans[0]?.status?.code).toBe(SpanStatusCode.ERROR)
    expect(activeSpans[0]?.recordException).toHaveBeenCalled()
  })

  test('should pass request with headers to next', async () => {
    const { tracer } = createMockTracer()
    const interceptor = createOpenTelemetryHttpInterceptor({ tracer, propagator: mockPropagator })

    const req = makeHttpRequest()
    const next = vi.fn(async (_req: HttpRequest) => makeHttpResponse())

    await interceptor.fn(req, next)

    expect(next).toHaveBeenCalledTimes(1)
    const calls = vi.mocked(next).mock.calls
    expect(calls[0]?.[0].method).toBe('GET')
    expect(calls[0]?.[0].endpoint).toBe('/test')
    expect(calls[0]?.[0].headers).toBeInstanceOf(Headers)
  })

  test('should skip span creation when requireParentSpan and no active span', async () => {
    const { tracer } = createMockTracer()
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
      requireParentSpan: true,
    })

    const next = vi.fn(async (_req: HttpRequest) => makeHttpResponse())
    await interceptor.fn(makeHttpRequest(), next)

    expect(activeSpans).toHaveLength(0)
    expect(next).toHaveBeenCalledTimes(1)
  })

  test('should call requestHook before request', async () => {
    const { tracer } = createMockTracer()
    const requestHook = vi.fn()
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
      requestHook,
    })

    const req = makeHttpRequest()
    await interceptor.fn(req, async () => makeHttpResponse())

    expect(requestHook).toHaveBeenCalledTimes(1)
    expect(requestHook).toHaveBeenCalledWith(activeSpans[0], req)
  })

  test('should call responseHook before span ends', async () => {
    const { tracer } = createMockTracer()
    const responseHook = vi.fn()
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
      responseHook,
    })

    const res = makeHttpResponse()
    const req = makeHttpRequest()
    await interceptor.fn(req, async () => res)

    expect(responseHook).toHaveBeenCalledTimes(1)
    expect(responseHook).toHaveBeenCalledWith(activeSpans[0], res, req)
    expect(activeSpans[0]?.ended).toBe(true) // span ends after hook
  })

  test('should keep request running when requestHook throws', async () => {
    const { tracer } = createMockTracer()
    const requestHook = vi.fn(() => {
      throw new Error('hook failed')
    })
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
      requestHook,
    })

    const response = makeHttpResponse()
    const result = await interceptor.fn(makeHttpRequest(), async () => response)

    expect(result).toBe(response)
    expect(activeSpans[0]?.addEvent).toHaveBeenCalledWith('defjs.otel.hook.error', expect.objectContaining({ 'hook.name': 'requestHook' }))
    expect(activeSpans[0]?.recordException).toHaveBeenCalled()
    expect(activeSpans[0]?.status).toBeUndefined()
    expect(activeSpans[0]?.ended).toBe(true)
  })

  test('should keep response running when responseHook throws', async () => {
    const { tracer } = createMockTracer()
    const metrics = createMockMetrics()
    const responseHook = vi.fn(() => {
      throw new Error('hook failed')
    })
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
      responseHook,
    })

    const response = makeHttpResponse()
    const result = await interceptor.fn(makeHttpRequest(), async () => response)

    expect(result).toBe(response)
    expect(activeSpans[0]?.addEvent).toHaveBeenCalledWith('defjs.otel.hook.error', expect.objectContaining({ 'hook.name': 'responseHook' }))
    expect(metrics.requestDuration.record).toHaveBeenCalled()
    expect(activeSpans[0]?.status).toBeUndefined()
    expect(activeSpans[0]?.ended).toBe(true)
  })

  test('should record duration metrics on success', async () => {
    const { tracer } = createMockTracer()
    const metrics = createMockMetrics()
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
    })

    await interceptor.fn(makeHttpRequest(), async () => makeHttpResponse())

    expect(metrics.requestDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        'http.request.method': 'GET',
        'http.response.status_code': 200,
        'server.address': 'api.example.com',
      }),
    )
  })

  test('should record status code on non-2xx metrics', async () => {
    const { tracer } = createMockTracer()
    const metrics = createMockMetrics()
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
    })

    await interceptor.fn(makeHttpRequest(), async () => ({ ...makeHttpResponse(), status: 500 }))

    expect(metrics.requestDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        'error.type': '500',
        'http.response.status_code': 500,
      }),
    )
  })

  test('should record error attributes on exception metrics', async () => {
    const { tracer } = createMockTracer()
    const metrics = createMockMetrics()
    const interceptor = createOpenTelemetryHttpInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
    })

    await expect(
      interceptor.fn(makeHttpRequest(), async () => {
        throw new TypeError('fail')
      }),
    ).rejects.toThrow('fail')

    expect(metrics.requestDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        'http.request.method': 'GET',
        'error.type': 'TypeError',
      }),
    )
  })

  test('should set server.address and server.port from URL', async () => {
    const { tracer } = createMockTracer()
    const interceptor = createOpenTelemetryHttpInterceptor({ tracer, propagator: mockPropagator })

    await interceptor.fn(makeHttpRequest(), async () => makeHttpResponse())

    expect(activeSpans[0]?.attributes['server.address']).toBe('api.example.com')
  })

  test('should set server.port when URL has explicit port', async () => {
    const { tracer } = createMockTracer()
    const interceptor = createOpenTelemetryHttpInterceptor({ tracer, propagator: mockPropagator })

    const req = { ...makeHttpRequest(), baseEndpoint: 'https://api.example.com:8443' }
    await interceptor.fn(req, async () => makeHttpResponse())

    expect(activeSpans[0]?.attributes['server.address']).toBe('api.example.com')
    expect(activeSpans[0]?.attributes['server.port']).toBe(8443)
  })

  test('should fall back to endpoint on invalid baseEndpoint', async () => {
    const { tracer } = createMockTracer()
    const interceptor = createOpenTelemetryHttpInterceptor({ tracer, propagator: mockPropagator })

    const req = { ...makeHttpRequest(), baseEndpoint: 'not-a-url' }
    await interceptor.fn(req, async () => makeHttpResponse())

    expect(activeSpans[0]?.attributes['url.full']).toBe('/test')
  })

  test('should reuse existing Headers when req.headers is already Headers', async () => {
    const { tracer } = createMockTracer()
    const interceptor = createOpenTelemetryHttpInterceptor({ tracer, propagator: mockPropagator })

    const existingHeaders = new Headers({ 'x-custom': 'value' })
    const req = { ...makeHttpRequest(), headers: existingHeaders }
    const next = vi.fn(async (_req: HttpRequest) => makeHttpResponse())

    await interceptor.fn(req, next)

    const calls = vi.mocked(next).mock.calls
    expect(calls[0]?.[0]?.headers).toBe(existingHeaders)
    expect(calls[0]?.[0]?.headers?.get('x-custom')).toBe('value')
    expect(calls[0]?.[0]?.headers?.get('traceparent')).toBe('mock-trace-id')
  })

  test('should create new Headers when req.headers is undefined', async () => {
    const { tracer } = createMockTracer()
    const interceptor = createOpenTelemetryHttpInterceptor({ tracer, propagator: mockPropagator })

    const req = { ...makeHttpRequest(), headers: undefined }
    const next = vi.fn(async (_req: HttpRequest) => makeHttpResponse())

    await interceptor.fn(req, next)

    const calls = vi.mocked(next).mock.calls
    expect(calls[0]?.[0]?.headers).toBeInstanceOf(Headers)
    expect(calls[0]?.[0]?.headers?.get('traceparent')).toBe('mock-trace-id')
  })
})
