import type { HttpRequest } from '@defjs/core'
import { createNetworkFault, ERR_ABORTED, ERR_TIMEOUT } from '@defjs/core'
import { context, diag, ROOT_CONTEXT, trace } from '@opentelemetry/api'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  activeSpans,
  createMockMetrics,
  createMockLogger,
  createMockPropagator,
  createMockTracer,
  makeDeferredSSEStream,
  makeSSERequest,
  makeSSEStream,
  waitForSettledPromises,
} from '../test-utils'
import { createOpenTelemetrySSEInterceptor } from './sse'

let mockPropagator: ReturnType<typeof createMockPropagator>

describe('SSE client diagnostic logs', () => {
  afterEach(() => vi.restoreAllMocks())

  test.each([
    { cause: new Error('offline'), count: 1 },
    { cause: ERR_TIMEOUT, count: 1 },
    { cause: ERR_ABORTED, count: 0 },
    { cause: createNetworkFault(ERR_ABORTED), count: 0 },
  ])('classifies startup failure $cause with $count diagnostics', async ({ cause, count }) => {
    const { logger, records } = createMockLogger()
    const interceptor = createOpenTelemetrySSEInterceptor({ logger, propagator: createMockPropagator() })
    await expect(
      interceptor.fn(makeSSERequest(), async () => {
        throw cause
      }),
    ).rejects.toBe(cause)
    expect(records).toHaveLength(count)
    if (count)
      expect(records[0]).toMatchObject({
        eventName: 'defjs.client.sse.exception',
        severityNumber: 13,
        attributes: { 'defjs.phase': 'connect' },
      })
  })

  test.each([
    { tracing: false, rejected: false },
    { tracing: true, rejected: false },
    { tracing: false, rejected: true },
    { tracing: true, rejected: true },
  ])('retains the opening context after close, tracer=$tracing rejected=$rejected', async ({ tracing, rejected }) => {
    const { logger, records } = createMockLogger()
    const { tracer, spans } = createMockTracer()
    const metrics = createMockMetrics()
    const parent = trace.setSpanContext(ROOT_CONTEXT, {
      traceId: '11111111111111111111111111111111',
      spanId: '2222222222222222',
      traceFlags: 0,
    })
    const active = vi.spyOn(context, 'active').mockReturnValue(parent)
    const stream = makeDeferredSSEStream()
    const interceptor = createOpenTelemetrySSEInterceptor({
      logger,
      tracer: tracing ? tracer : undefined,
      metrics,
      propagator: createMockPropagator(),
    })
    await expect(interceptor.fn(makeSSERequest(), async () => stream.stream)).resolves.toBe(stream.stream)
    expect(records).toEqual([])
    active.mockReturnValue(ROOT_CONTEXT)
    const cause = new TypeError('private failure')
    if (rejected) stream.reject(cause)
    else stream.close('error', cause, 'CAP_BUFFER_EXCEEDED')
    await waitForSettledPromises()
    stream.close('error', cause)
    await waitForSettledPromises()
    expect(records).toHaveLength(1)
    const record = records[0]
    if (!record?.context) throw new Error('Expected a log record with explicit context')
    expect(record).toMatchObject({ severityNumber: 13, attributes: { 'defjs.phase': 'connection', 'exception.type': 'TypeError' } })
    expect(record.attributes?.['defjs.sse.fault.code']).toBe(rejected ? undefined : 'CAP_BUFFER_EXCEEDED')
    if (tracing) expect(trace.getSpan(record.context)).toBe(spans[0])
    else expect(record.context).toBe(parent)
    expect(metrics.activeStreams.add.mock.calls.map(([value]) => value)).toEqual([1, -1])
    expect(metrics.connectionDuration.record).toHaveBeenCalledTimes(1)
  })

  test.each(['eof', 'aborted'] as const)('does not log %s even if it carries an error cause', async (kind) => {
    const { logger, records } = createMockLogger()
    const stream = makeDeferredSSEStream()
    const interceptor = createOpenTelemetrySSEInterceptor({ logger, propagator: createMockPropagator() })
    await interceptor.fn(makeSSERequest(), async () => stream.stream)
    stream.close(kind, new Error('user decided to stop'))
    await waitForSettledPromises()
    expect(records).toEqual([])
  })

  test.each([false, true])('logger failure preserves closed outcome, rejected=%s', async (rejected) => {
    const { logger } = createMockLogger()
    logger.emit.mockImplementation(() => {
      throw new Error('logger failed')
    })
    vi.spyOn(diag, 'error').mockImplementation(() => undefined)
    const { tracer, spans } = createMockTracer()
    const metrics = createMockMetrics()
    const stream = makeDeferredSSEStream()
    const interceptor = createOpenTelemetrySSEInterceptor({ logger, tracer, metrics, propagator: createMockPropagator() })
    await expect(interceptor.fn(makeSSERequest(), async () => stream.stream)).resolves.toBe(stream.stream)
    const cause = new Error('original')
    if (rejected) {
      stream.reject(cause)
      await expect(stream.stream.closed).rejects.toBe(cause)
    } else {
      stream.close('error', cause)
      await expect(stream.stream.closed).resolves.toMatchObject({ kind: 'error', cause })
    }
    await waitForSettledPromises()
    expect(logger.emit).toHaveBeenCalledTimes(1)
    expect(spans[0]?.ended).toBe(true)
    expect(metrics.activeStreams.add.mock.calls.map(([value]) => value)).toEqual([1, -1])
  })
})

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

describe('createOpenTelemetrySSEInterceptor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPropagator = createMockPropagator()
  })

  test.each([
    { close: 'eof', result: 'success', extras: { 'sse.close.kind': 'eof' } },
    { close: 'aborted', result: 'success', extras: { 'sse.close.kind': 'aborted' } },
    {
      close: 'error',
      result: 'error',
      extras: { 'sse.close.kind': 'error', 'defjs.sse.fault.code': 'CAP_QUEUE_OVERFLOW', 'error.type': 'TypeError' },
    },
    { close: 'rejected', result: 'error', extras: { 'error.type': 'TypeError' } },
  ] as const)('records SSE $close lifecycle without a tracer', async ({ close, result, extras }) => {
    const metrics = createMockMetrics()
    const stream = makeDeferredSSEStream()
    const interceptor = createOpenTelemetrySSEInterceptor({ propagator: mockPropagator, metrics, requireParentSpan: true })
    await expect(interceptor.fn(makeSSERequest(), async () => stream.stream)).resolves.toBe(stream.stream)
    expect(metrics.connectDuration.record).toHaveBeenCalledWith(expect.any(Number), {
      'server.address': 'api.example.com',
      'defjs.result': 'success',
    })
    expect(metrics.activeStreams.add.mock.calls).toEqual([[1, { 'server.address': 'api.example.com' }]])
    expect(metrics.connectionDuration.record).not.toHaveBeenCalled()

    if (close === 'rejected') stream.reject(new TypeError('stream lost'))
    else stream.close(close, close === 'error' ? new TypeError('stream lost') : undefined, 'CAP_QUEUE_OVERFLOW')
    await waitForSettledPromises()

    expect(metrics.activeStreams.add.mock.calls).toEqual([
      [1, { 'server.address': 'api.example.com' }],
      [-1, { 'server.address': 'api.example.com' }],
    ])
    expect(metrics.connectionDuration.record).toHaveBeenCalledTimes(1)
    expect(metrics.connectionDuration.record).toHaveBeenCalledWith(expect.any(Number), {
      'server.address': 'api.example.com',
      'defjs.result': result,
      ...extras,
    })
  })

  test('records SSE startup failure without a tracer without incrementing active streams', async () => {
    const metrics = createMockMetrics()
    const error = new TypeError('connect failed')
    const interceptor = createOpenTelemetrySSEInterceptor({ propagator: mockPropagator, metrics })
    await expect(
      interceptor.fn(makeSSERequest(), async () => {
        throw error
      }),
    ).rejects.toBe(error)
    expect(metrics.connectDuration.record).toHaveBeenCalledTimes(1)
    expect(metrics.connectDuration.record).toHaveBeenCalledWith(expect.any(Number), {
      'server.address': 'api.example.com',
      'defjs.result': 'error',
      'error.type': 'TypeError',
    })
    expect(metrics.activeStreams.add).not.toHaveBeenCalled()
    expect(metrics.connectionDuration.record).not.toHaveBeenCalled()
  })

  test('should inject traceparent header via propagator', async () => {
    const { tracer } = createMockTracer()
    const interceptor = createOpenTelemetrySSEInterceptor({ tracer, propagator: mockPropagator })

    const req = makeSSERequest()
    const next = vi.fn(async (_req: HttpRequest) => makeSSEStream())

    await interceptor.fn(req, next)

    expect(mockPropagator.inject).toHaveBeenCalled()
    const calls = vi.mocked(next).mock.calls
    expect(calls[0]?.[0].headers?.get('traceparent')).toBe('mock-trace-id')
  })

  test('should create span with correct name', async () => {
    const { tracer } = createMockTracer()
    const interceptor = createOpenTelemetrySSEInterceptor({ tracer, propagator: mockPropagator })

    await interceptor.fn(makeSSERequest(), async () => makeSSEStream())

    expect(activeSpans).toHaveLength(1)
    expect(activeSpans[0]?.name).toBe('SSE')
  })

  test('should set url.full attribute', async () => {
    const { tracer } = createMockTracer()
    const interceptor = createOpenTelemetrySSEInterceptor({ tracer, propagator: mockPropagator })

    await interceptor.fn(makeSSERequest(), async () => makeSSEStream())

    expect(activeSpans[0]?.attributes['url.full']).toBe('https://api.example.com/events')
  })

  test('should merge startSpanHook attributes last into initial SSE span options', async () => {
    const { tracer } = createMockTracer()
    const req = makeSSERequest()
    const startSpanHook = vi.fn(() => ({ 'app.tenant': 'acme', 'url.full': 'https://tenant.example.com/events' }))
    const interceptor = createOpenTelemetrySSEInterceptor({ tracer, propagator: mockPropagator, startSpanHook })

    await interceptor.fn(req, async () => makeSSEStream())

    expect(startSpanHook).toHaveBeenCalledWith(req)
    expect(vi.mocked(tracer.startSpan).mock.calls[0]?.[1]?.attributes).toEqual({
      'app.tenant': 'acme',
      'url.full': 'https://tenant.example.com/events',
    })
  })

  test('should keep the resolved SSE URL in initial span options when startSpanHook is absent', async () => {
    const { tracer } = createMockTracer()
    const interceptor = createOpenTelemetrySSEInterceptor({ tracer, propagator: mockPropagator })

    await interceptor.fn(makeSSERequest(), async () => makeSSEStream())

    expect(vi.mocked(tracer.startSpan).mock.calls[0]?.[1]?.attributes).toEqual({
      'url.full': 'https://api.example.com/events',
    })
  })

  test('should continue SSE and record a hook error when startSpanHook throws', async () => {
    const { tracer } = createMockTracer()
    const next = vi.fn(async () => makeSSEStream())
    const interceptor = createOpenTelemetrySSEInterceptor({
      tracer,
      propagator: mockPropagator,
      startSpanHook: () => {
        throw new Error('start hook failed')
      },
    })

    await interceptor.fn(makeSSERequest(), next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(vi.mocked(tracer.startSpan).mock.calls[0]?.[1]?.attributes).toEqual({
      'url.full': 'https://api.example.com/events',
    })
    expect(activeSpans[0]?.addEvent).toHaveBeenCalledWith('defjs.otel.hook.error', {
      'error.type': 'Error',
      'hook.name': 'startSpanHook',
    })
  })

  test('should add sse.connected event on success', async () => {
    const { tracer } = createMockTracer()
    const interceptor = createOpenTelemetrySSEInterceptor({ tracer, propagator: mockPropagator })

    await interceptor.fn(makeSSERequest(), async () => makeSSEStream())

    expect(activeSpans[0]?.addEvent).toHaveBeenCalledWith('sse.connected')
  })

  test('should keep span open until stream.closed settles', async () => {
    const { tracer } = createMockTracer()
    const stream = makeDeferredSSEStream()
    const interceptor = createOpenTelemetrySSEInterceptor({ tracer, propagator: mockPropagator })

    await interceptor.fn(makeSSERequest(), async () => stream.stream)

    expect(activeSpans[0]?.ended).toBe(false)

    stream.close()
    await waitForSettledPromises()

    expect(activeSpans[0]?.ended).toBe(true)
  })

  test('should dispose a deferred SSE fake through its own close lifecycle once', async () => {
    const deferred = makeDeferredSSEStream()
    const close = vi.spyOn(deferred.stream, 'close')

    const first = deferred.stream[Symbol.asyncDispose]()
    const second = deferred.stream[Symbol.asyncDispose]()

    expect(second).toBe(first)
    await expect(settleWithin(Promise.resolve(first))).resolves.toBeUndefined()
    expect(close).toHaveBeenCalledOnce()
    await expect(deferred.stream.closed).resolves.toMatchObject({ kind: 'aborted' })
  })

  test('should propagate the original rejection when disposing a rejected SSE fake', async () => {
    const failure = new Error('stream failed')
    const deferred = makeDeferredSSEStream()
    const close = vi.spyOn(deferred.stream, 'close')
    deferred.reject(failure)

    await expect(settleWithin(Promise.resolve(deferred.stream[Symbol.asyncDispose]()))).rejects.toBe(failure)
    expect(close).toHaveBeenCalledOnce()
    await expect(deferred.stream.closed).rejects.toBe(failure)
  })

  test('should record sse.closed and end span when stream closes normally', async () => {
    const { tracer } = createMockTracer()
    const metrics = createMockMetrics()
    const stream = makeDeferredSSEStream()
    const interceptor = createOpenTelemetrySSEInterceptor({ tracer, propagator: mockPropagator, metrics })

    await interceptor.fn(makeSSERequest(), async () => stream.stream)
    stream.close('eof')
    await waitForSettledPromises()

    expect(activeSpans[0]?.addEvent).toHaveBeenCalledWith('sse.closed', { 'sse.close.kind': 'eof' })
    expect(activeSpans[0]?.status?.code).toBe(1)
    expect(activeSpans[0]?.ended).toBe(true)
    expect(metrics.connectionDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        'defjs.result': 'success',
        'server.address': 'api.example.com',
        'sse.close.kind': 'eof',
      }),
    )
  })

  test('should record sse.aborted without marking span as error', async () => {
    const { tracer } = createMockTracer()
    const metrics = createMockMetrics()
    const stream = makeDeferredSSEStream()
    const interceptor = createOpenTelemetrySSEInterceptor({ tracer, propagator: mockPropagator, metrics })

    await interceptor.fn(makeSSERequest(), async () => stream.stream)
    stream.close('aborted')
    await waitForSettledPromises()

    expect(activeSpans[0]?.addEvent).toHaveBeenCalledWith('sse.aborted', { 'sse.close.kind': 'aborted' })
    expect(activeSpans[0]?.recordException).not.toHaveBeenCalled()
    expect(activeSpans[0]?.status?.code).toBe(1)
    expect(metrics.connectionDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        'defjs.result': 'success',
        'sse.close.kind': 'aborted',
      }),
    )
  })

  test('should record error when stream closes with error code', async () => {
    const { tracer } = createMockTracer()
    const metrics = createMockMetrics()
    const stream = makeDeferredSSEStream()
    const interceptor = createOpenTelemetrySSEInterceptor({ tracer, propagator: mockPropagator, metrics })

    await interceptor.fn(makeSSERequest(), async () => stream.stream)
    stream.close('error', new Error('stream broken'), 'CAP_QUEUE_OVERFLOW')
    await waitForSettledPromises()

    expect(activeSpans[0]?.addEvent).toHaveBeenCalledWith('sse.error', {
      'defjs.sse.fault.code': 'CAP_QUEUE_OVERFLOW',
      'sse.close.kind': 'error',
    })
    expect(activeSpans[0]?.recordException).toHaveBeenCalled()
    expect(activeSpans[0]?.status?.code).toBe(2)
    expect(activeSpans[0]?.ended).toBe(true)
    expect(metrics.connectionDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        'defjs.result': 'error',
        'defjs.sse.fault.code': 'CAP_QUEUE_OVERFLOW',
        'error.type': 'Error',
        'sse.close.kind': 'error',
      }),
    )
  })

  test('should record error when stream.closed rejects', async () => {
    const { tracer } = createMockTracer()
    const metrics = createMockMetrics()
    const stream = makeDeferredSSEStream()
    const interceptor = createOpenTelemetrySSEInterceptor({ tracer, propagator: mockPropagator, metrics })

    await interceptor.fn(makeSSERequest(), async () => stream.stream)
    stream.reject(new TypeError('rejected'))
    await waitForSettledPromises()

    expect(activeSpans[0]?.addEvent).toHaveBeenCalledWith('sse.error', { 'error.type': 'TypeError' })
    expect(activeSpans[0]?.recordException).toHaveBeenCalled()
    expect(activeSpans[0]?.status?.code).toBe(2)
    expect(activeSpans[0]?.ended).toBe(true)
    expect(metrics.connectionDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        'defjs.result': 'error',
        'error.type': 'TypeError',
      }),
    )
  })

  test('should record error on next() exception', async () => {
    const { tracer } = createMockTracer()
    const metrics = createMockMetrics()
    const interceptor = createOpenTelemetrySSEInterceptor({ tracer, propagator: mockPropagator, metrics })

    await expect(
      interceptor.fn(makeSSERequest(), async () => {
        throw new TypeError('connect failed')
      }),
    ).rejects.toThrow('connect failed')

    expect(activeSpans[0]?.ended).toBe(true)
    expect(activeSpans[0]?.status?.code).toBe(2) // ERROR
    expect(activeSpans[0]?.recordException).toHaveBeenCalled()
    expect(metrics.connectDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        'defjs.result': 'error',
        'error.type': 'TypeError',
      }),
    )
    expect(metrics.activeStreams.add).not.toHaveBeenCalled()
  })

  test('should skip span creation when requireParentSpan and no active span', async () => {
    const { tracer } = createMockTracer()
    const interceptor = createOpenTelemetrySSEInterceptor({
      tracer,
      propagator: mockPropagator,
      requireParentSpan: true,
    })

    const next = vi.fn(async (_req: HttpRequest) => makeSSEStream())
    await interceptor.fn(makeSSERequest(), next)

    expect(activeSpans).toHaveLength(0)
    expect(next).toHaveBeenCalledTimes(1)
  })

  test('should call requestHook before request', async () => {
    const { tracer } = createMockTracer()
    const requestHook = vi.fn()
    const interceptor = createOpenTelemetrySSEInterceptor({
      tracer,
      propagator: mockPropagator,
      requestHook,
    })

    const req = makeSSERequest()
    await interceptor.fn(req, async () => makeSSEStream())

    expect(requestHook).toHaveBeenCalledTimes(1)
    expect(requestHook).toHaveBeenCalledWith(activeSpans[0], req)
  })

  test('should call responseHook after stream returned', async () => {
    const { tracer } = createMockTracer()
    const responseHook = vi.fn()
    const interceptor = createOpenTelemetrySSEInterceptor({
      tracer,
      propagator: mockPropagator,
      responseHook,
    })

    const stream = makeSSEStream()
    const req = makeSSERequest()
    await interceptor.fn(req, async () => stream)

    expect(responseHook).toHaveBeenCalledTimes(1)
    expect(responseHook).toHaveBeenCalledWith(activeSpans[0], stream, req)
  })

  test('should keep stream open when requestHook throws', async () => {
    const { tracer } = createMockTracer()
    const stream = makeDeferredSSEStream()
    const requestHook = vi.fn(() => {
      throw new Error('hook failed')
    })
    const interceptor = createOpenTelemetrySSEInterceptor({
      tracer,
      propagator: mockPropagator,
      requestHook,
    })

    const result = await interceptor.fn(makeSSERequest(), async () => stream.stream)

    expect(result).toBe(stream.stream)
    expect(activeSpans[0]?.addEvent).toHaveBeenCalledWith('defjs.otel.hook.error', expect.objectContaining({ 'hook.name': 'requestHook' }))
    expect(activeSpans[0]?.recordException).toHaveBeenCalled()

    stream.close()
    await waitForSettledPromises()
    expect(activeSpans[0]?.status?.code).toBe(1)
    expect(activeSpans[0]?.ended).toBe(true)
  })

  test('should keep stream open when responseHook throws', async () => {
    const { tracer } = createMockTracer()
    const metrics = createMockMetrics()
    const stream = makeDeferredSSEStream()
    const responseHook = vi.fn(() => {
      throw new Error('hook failed')
    })
    const interceptor = createOpenTelemetrySSEInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
      responseHook,
    })

    const result = await interceptor.fn(makeSSERequest(), async () => stream.stream)

    expect(result).toBe(stream.stream)
    expect(activeSpans[0]?.addEvent).toHaveBeenCalledWith('defjs.otel.hook.error', expect.objectContaining({ 'hook.name': 'responseHook' }))
    expect(metrics.connectDuration.record).toHaveBeenCalled()

    stream.close()
    await waitForSettledPromises()
    expect(activeSpans[0]?.status?.code).toBe(1)
    expect(activeSpans[0]?.ended).toBe(true)
  })

  test('should record connect duration and active streams on success', async () => {
    const { tracer } = createMockTracer()
    const metrics = createMockMetrics()
    const stream = makeDeferredSSEStream()
    const interceptor = createOpenTelemetrySSEInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
    })

    await interceptor.fn(makeSSERequest(), async () => stream.stream)

    expect(metrics.connectDuration.record).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({
        'defjs.result': 'success',
        'server.address': 'api.example.com',
      }),
    )
    expect(metrics.activeStreams.add).toHaveBeenCalledWith(1, expect.objectContaining({ 'server.address': 'api.example.com' }))
  })

  test('should decrement active streams exactly once when stream closes', async () => {
    const { tracer } = createMockTracer()
    const metrics = createMockMetrics()
    const stream = makeDeferredSSEStream()
    const interceptor = createOpenTelemetrySSEInterceptor({
      tracer,
      propagator: mockPropagator,
      metrics,
    })

    await interceptor.fn(makeSSERequest(), async () => stream.stream)
    stream.close()
    await waitForSettledPromises()
    stream.close()
    await waitForSettledPromises()

    expect(metrics.activeStreams.add).toHaveBeenNthCalledWith(1, 1, expect.objectContaining({ 'server.address': 'api.example.com' }))
    expect(metrics.activeStreams.add).toHaveBeenNthCalledWith(2, -1, expect.objectContaining({ 'server.address': 'api.example.com' }))
    expect(metrics.activeStreams.add).toHaveBeenCalledTimes(2)
  })

  test('should keep metric attributes low-cardinality', async () => {
    const { tracer } = createMockTracer()
    const metrics = createMockMetrics()
    const stream = makeDeferredSSEStream()
    const interceptor = createOpenTelemetrySSEInterceptor({ tracer, propagator: mockPropagator, metrics })

    await interceptor.fn(makeSSERequest(), async () => stream.stream)

    const call = vi.mocked(metrics.connectDuration.record).mock.calls[0]
    const attributes = call?.[1]

    expect(attributes).toEqual(expect.objectContaining({ 'server.address': 'api.example.com' }))
    expect(attributes).not.toHaveProperty('url.full')
    expect(attributes).not.toHaveProperty('traceparent')
  })

  test('should fall back to endpoint on invalid baseEndpoint', async () => {
    const { tracer } = createMockTracer()
    const interceptor = createOpenTelemetrySSEInterceptor({ tracer, propagator: mockPropagator })

    const req = { ...makeSSERequest(), baseEndpoint: 'not-a-url' }
    await interceptor.fn(req, async () => makeSSEStream())

    expect(activeSpans[0]?.attributes['url.full']).toBe('/events')
  })

  test('should reuse existing Headers when req.headers is already Headers', async () => {
    const { tracer } = createMockTracer()
    const interceptor = createOpenTelemetrySSEInterceptor({ tracer, propagator: mockPropagator })

    const existingHeaders = new Headers({ 'x-custom': 'value' })
    const req = { ...makeSSERequest(), headers: existingHeaders }
    const next = vi.fn(async (_req: HttpRequest) => makeSSEStream())

    await interceptor.fn(req, next)

    const calls = vi.mocked(next).mock.calls
    expect(calls[0]?.[0]?.headers).toBe(existingHeaders)
    expect(calls[0]?.[0]?.headers?.get('x-custom')).toBe('value')
    expect(calls[0]?.[0]?.headers?.get('traceparent')).toBe('mock-trace-id')
  })

  test('should create Headers when req.headers is undefined', async () => {
    const { tracer } = createMockTracer()
    const interceptor = createOpenTelemetrySSEInterceptor({ tracer, propagator: mockPropagator })

    const req = { ...makeSSERequest(), headers: undefined }
    const next = vi.fn(async (_req: HttpRequest) => makeSSEStream())

    await interceptor.fn(req, next)

    expect(mockPropagator.extract).toHaveBeenCalledWith(expect.anything(), expect.any(Headers), expect.anything())
    const calls = vi.mocked(next).mock.calls
    expect(calls[0]?.[0]?.headers).toBeInstanceOf(Headers)
    expect(calls[0]?.[0]?.headers?.get('traceparent')).toBe('mock-trace-id')
  })
})
