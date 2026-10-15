import { ROOT_CONTEXT, SpanKind, SpanStatusCode } from '@opentelemetry/api'
import { describe, expect, test, vi } from 'vitest'
import { createMockTracer, makeHttpRequest } from '../test-utils'
import {
  addSpanEvent,
  createHttpSpan,
  createSSESpan,
  createWebSocketSpan,
  endSpan,
  resolveStartSpanHook,
  runSpanHook,
  setSpanError,
  setSpanHttpResponse,
} from './trace'

describe('trace helpers', () => {
  test('createHttpSpan', () => {
    const { tracer, spans } = createMockTracer()
    createHttpSpan(tracer, 'POST', 'https://api.example.com/test', ROOT_CONTEXT)

    expect(spans).toHaveLength(1)
    expect(spans[0]?.name).toBe('POST')
    expect(spans[0]?.kind).toBe(SpanKind.CLIENT)
    expect(spans[0]?.attributes['http.request.method']).toBe('POST')
    expect(spans[0]?.attributes['url.full']).toBe('https://api.example.com/test')
  })

  test('createSSESpan', () => {
    const { tracer, spans } = createMockTracer()
    createSSESpan(tracer, 'https://api.example.com/events', ROOT_CONTEXT)

    expect(spans).toHaveLength(1)
    expect(spans[0]?.name).toBe('SSE')
    expect(spans[0]?.kind).toBe(SpanKind.CLIENT)
    expect(spans[0]?.attributes['url.full']).toBe('https://api.example.com/events')
  })

  test('createWebSocketSpan', () => {
    const { tracer, spans } = createMockTracer()
    createWebSocketSpan(tracer, 'wss://api.example.com/ws', ROOT_CONTEXT)

    expect(spans).toHaveLength(1)
    expect(spans[0]?.name).toBe('WebSocket')
    expect(spans[0]?.kind).toBe(SpanKind.CLIENT)
    expect(spans[0]?.attributes['url.full']).toBe('wss://api.example.com/ws')
  })

  test('span creators merge application attributes into initial startSpan options last', () => {
    const { tracer } = createMockTracer()

    createHttpSpan(tracer, 'POST', 'https://api.example.com/test', ROOT_CONTEXT, undefined, {
      'app.tenant': 'http',
      'url.full': 'https://tenant.example/http',
    })
    createSSESpan(tracer, 'https://api.example.com/events', ROOT_CONTEXT, undefined, {
      'app.tenant': 'sse',
      'url.full': 'https://tenant.example/sse',
    })
    createWebSocketSpan(tracer, 'wss://api.example.com/ws', ROOT_CONTEXT, undefined, {
      'app.tenant': 'webSocket',
      'url.full': 'wss://tenant.example/socket',
    })

    expect(vi.mocked(tracer.startSpan).mock.calls.map((call) => call[1]?.attributes)).toEqual([
      {
        'app.tenant': 'http',
        'http.request.method': 'POST',
        'url.full': 'https://tenant.example/http',
      },
      { 'app.tenant': 'sse', 'url.full': 'https://tenant.example/sse' },
      { 'app.tenant': 'webSocket', 'url.full': 'wss://tenant.example/socket' },
    ])
  })

  test('resolveStartSpanHook returns synchronous application attributes', () => {
    const request = makeHttpRequest()
    const hook = vi.fn(() => ({ 'app.tenant': 'acme' }))

    expect(resolveStartSpanHook(hook, request)).toEqual({ ok: true, attributes: { 'app.tenant': 'acme' } })
    expect(hook).toHaveBeenCalledWith(request)
  })

  test('resolveStartSpanHook returns no attributes when omitted', () => {
    expect(resolveStartSpanHook(undefined, makeHttpRequest())).toEqual({ ok: true })
  })

  test('resolveStartSpanHook preserves throw undefined with an explicit failure discriminator', () => {
    expect(
      resolveStartSpanHook(() => {
        throw undefined
      }, makeHttpRequest()),
    ).toEqual({ ok: false, error: undefined })
  })

  test('uses an explicit static operation without deriving identity from the URL', () => {
    const { tracer, spans } = createMockTracer()

    createHttpSpan(tracer, 'GET', 'https://api.example.com/users/42', ROOT_CONTEXT, 'users.read')
    createSSESpan(tracer, 'https://api.example.com/users/42/events', ROOT_CONTEXT, 'users.watch')
    createWebSocketSpan(tracer, 'wss://api.example.com/users/42/socket', ROOT_CONTEXT, 'users.connect')

    expect(spans.map(({ name }) => name)).toEqual(['GET users.read', 'SSE users.watch', 'WebSocket users.connect'])
    expect(spans.map(({ attributes }) => attributes['defjs.operation'])).toEqual(['users.read', 'users.watch', 'users.connect'])
  })

  test('setSpanHttpResponse with 2xx status', () => {
    const { tracer, spans } = createMockTracer()
    const span = tracer.startSpan('test')
    setSpanHttpResponse(span, 200)

    expect(spans[0]?.attributes['http.response.status_code']).toBe(200)
    expect(spans[0]?.attributes['error.type']).toBeUndefined()
    expect(spans[0]?.status).toBeUndefined()
    expect(spans[0]?.ended).toBe(true)
  })

  test.each([400, 404, 500, 599])('setSpanHttpResponse with error status %i', (status) => {
    const { tracer, spans } = createMockTracer()
    const span = tracer.startSpan('test')
    setSpanHttpResponse(span, status)

    expect(spans[0]?.attributes['http.response.status_code']).toBe(status)
    expect(spans[0]?.attributes['error.type']).toBe(String(status))
    expect(spans[0]?.status?.code).toBe(SpanStatusCode.ERROR)
    expect(spans[0]?.ended).toBe(true)
  })

  test('setSpanHttpResponse leaves a status-0 response unattributed', () => {
    // A real transport failure is a fault and never arrives as a response; status 0 can only come
    // from a synthetic interceptor response, which carries nothing to report.
    const { tracer, spans } = createMockTracer()
    const span = tracer.startSpan('test')
    setSpanHttpResponse(span, 0)

    expect(spans[0]?.attributes['http.response.status_code']).toBeUndefined()
    expect(spans[0]?.attributes['error.type']).toBeUndefined()
    expect(spans[0]?.status).toBeUndefined()
    expect(spans[0]?.ended).toBe(true)
  })

  test('setSpanError with Error instance', () => {
    const { tracer, spans } = createMockTracer()
    const span = tracer.startSpan('test')
    setSpanError(span, new Error('boom'))

    expect(spans[0]?.attributes['error.type']).toBe('Error')
    expect(spans[0]?.status?.code).toBe(SpanStatusCode.ERROR)
    expect(spans[0]?.ended).toBe(true)
  })

  test('setSpanError with non-Error value', () => {
    const { tracer, spans } = createMockTracer()
    const span = tracer.startSpan('test')
    setSpanError(span, 'string error')

    expect(spans[0]?.attributes['error.type']).toBe('string')
    expect(spans[0]?.status?.code).toBe(SpanStatusCode.ERROR)
    expect(spans[0]?.ended).toBe(true)
  })

  test('setSpanError with undefined', () => {
    const { tracer, spans } = createMockTracer()
    const span = tracer.startSpan('test')
    setSpanError(span, undefined)

    expect(spans[0]?.attributes['error.type']).toBe('_OTHER')
    expect(spans[0]?.status?.code).toBe(SpanStatusCode.ERROR)
    expect(spans[0]?.ended).toBe(true)
  })

  test('setSpanError uses the fallback error type for null', () => {
    const { tracer, spans } = createMockTracer()
    const span = tracer.startSpan('test')
    setSpanError(span, null)

    expect(spans[0]?.attributes['error.type']).toBe('_OTHER')
    expect(spans[0]?.status?.code).toBe(SpanStatusCode.ERROR)
    expect(spans[0]?.ended).toBe(true)
  })

  test('endSpan', () => {
    const { tracer, spans } = createMockTracer()
    const span = tracer.startSpan('test')
    endSpan(span)

    expect(spans[0]?.status?.code).toBe(SpanStatusCode.OK)
    expect(spans[0]?.ended).toBe(true)
  })

  test('runSpanHook returns without calling missing hook', () => {
    const { tracer, spans } = createMockTracer()
    const span = tracer.startSpan('test')
    runSpanHook(span, 'missingHook', undefined)

    expect(spans[0]?.addEvent).not.toHaveBeenCalled()
    expect(spans[0]?.recordException).not.toHaveBeenCalled()
  })

  test('runSpanHook calls provided hook', () => {
    const { tracer } = createMockTracer()
    const span = tracer.startSpan('test')
    const hook = vi.fn()
    runSpanHook(span, 'requestHook', hook)

    expect(hook).toHaveBeenCalledTimes(1)
  })

  test.each([
    { error: new Error('async hook failed'), errorType: 'Error' },
    { error: 'async hook failed', errorType: 'string' },
  ])('runSpanHook records async $errorType hook failures without an unhandled rejection', async ({ error, errorType }) => {
    const { tracer, spans } = createMockTracer()
    const span = tracer.startSpan('test')
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)

    try {
      runSpanHook(span, 'requestHook', async () => {
        throw error
      })
      await Promise.resolve()
      await Promise.resolve()

      expect(spans[0]?.addEvent).toHaveBeenCalledWith('defjs.otel.hook.error', {
        'error.type': errorType,
        'hook.name': 'requestHook',
      })
      expect(spans[0]?.recordException).toHaveBeenCalledWith(error instanceof Error ? error : new Error(error))
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  test('runSpanHook does not wait for a pending async hook', () => {
    const { tracer, spans } = createMockTracer()
    const span = tracer.startSpan('test')
    const pending = new Promise<void>(() => undefined)

    runSpanHook(span, 'requestHook', () => pending)

    expect(spans[0]?.addEvent).not.toHaveBeenCalled()
    expect(spans[0]?.recordException).not.toHaveBeenCalled()
  })

  test('runSpanHook isolates failures while recording an async hook rejection', async () => {
    const { tracer, spans } = createMockTracer()
    const span = tracer.startSpan('test')
    spans[0]?.addEvent.mockImplementation(() => {
      throw new Error('addEvent failed')
    })
    spans[0]?.recordException.mockImplementation(() => {
      throw new Error('recordException failed')
    })
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)

    try {
      runSpanHook(span, 'requestHook', async () => {
        throw new Error('async hook failed')
      })
      await Promise.resolve()
      await Promise.resolve()

      expect(spans[0]?.addEvent).toHaveBeenCalledTimes(1)
      expect(spans[0]?.recordException).toHaveBeenCalledTimes(1)
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  test('runSpanHook records non-Error hook failures', () => {
    const { tracer, spans } = createMockTracer()
    const span = tracer.startSpan('test')
    const error: unknown = 'boom'
    runSpanHook(span, 'requestHook', () => {
      throw error
    })

    expect(spans[0]?.addEvent).toHaveBeenCalledWith('defjs.otel.hook.error', {
      'error.type': 'string',
      'hook.name': 'requestHook',
    })
    expect(spans[0]?.recordException).toHaveBeenCalledWith(new Error('boom'))
  })

  test('runSpanHook uses Error default name when Error name is empty', () => {
    const { tracer, spans } = createMockTracer()
    const span = tracer.startSpan('test')
    const error = new Error('boom')
    error.name = ''

    runSpanHook(span, 'requestHook', () => {
      throw error
    })

    expect(spans[0]?.addEvent).toHaveBeenCalledWith('defjs.otel.hook.error', {
      'error.type': 'Error',
      'hook.name': 'requestHook',
    })
    expect(spans[0]?.recordException).toHaveBeenCalledWith(error)
  })

  test('runSpanHook records non-string non-Error hook failures', () => {
    const { tracer, spans } = createMockTracer()
    const span = tracer.startSpan('test')
    runSpanHook(span, 'requestHook', () => {
      throw 42
    })

    expect(spans[0]?.addEvent).toHaveBeenCalledWith('defjs.otel.hook.error', {
      'error.type': 'number',
      'hook.name': 'requestHook',
    })
    expect(spans[0]?.recordException).toHaveBeenCalledWith(new Error('42'))
  })

  test('endSpan does not overwrite already set status', () => {
    const { tracer, spans } = createMockTracer()
    const span = tracer.startSpan('test')
    setSpanError(span, new Error('boom'))
    endSpan(span)

    expect(spans[0]?.status?.code).toBe(SpanStatusCode.ERROR)
    expect(spans[0]?.ended).toBe(true)
  })

  test('addSpanEvent calls span.addEvent without attributes', () => {
    const { tracer, spans } = createMockTracer()
    const span = tracer.startSpan('test')
    addSpanEvent(span, 'custom.event')

    expect(spans[0]?.addEvent).toHaveBeenCalledWith('custom.event')
  })

  test('addSpanEvent calls span.addEvent with attributes', () => {
    const { tracer, spans } = createMockTracer()
    const span = tracer.startSpan('test')
    addSpanEvent(span, 'custom.event', { 'custom.key': 'value' })

    expect(spans[0]?.addEvent).toHaveBeenCalledWith('custom.event', { 'custom.key': 'value' })
  })
})
