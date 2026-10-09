import type { ClientConfig, HttpInterceptor, SSEInterceptor, WebSocketInterceptor } from '@defjs/core'
import type { Context, Meter, TextMapPropagator } from '@opentelemetry/api'
import { describe, expect, test, vi } from 'vitest'
import { withOpenTelemetryServer } from './option'
import {
  createMockTracer,
  makeHttpRequest,
  makeHttpResponse,
  makeSSERequest,
  makeSSEStream,
  makeWsRequest,
  makeWsSession,
} from './test-utils'

function makeConfig(): ClientConfig {
  const sharedFetch = globalThis.fetch.bind(globalThis) as typeof fetch

  return {
    endpoint: 'https://api.example.com',
    http: { handle: sharedFetch },
    interceptors: [],
    sse: { handle: sharedFetch },
    webSocket: { handle: globalThis.WebSocket },
  }
}

function makeMeter(): Meter {
  return {
    createCounter: vi.fn(() => ({ add: vi.fn() })),
    createHistogram: vi.fn(() => ({ record: vi.fn() })),
    createGauge: vi.fn(() => ({ record: vi.fn() })),
    createUpDownCounter: vi.fn(() => ({ add: vi.fn() })),
    createObservableCounter: vi.fn(() => ({ addCallback: vi.fn(), removeCallback: vi.fn() })),
    createObservableGauge: vi.fn(() => ({ addCallback: vi.fn(), removeCallback: vi.fn() })),
    createObservableUpDownCounter: vi.fn(() => ({ addCallback: vi.fn(), removeCallback: vi.fn() })),
    addBatchObservableCallback: vi.fn(),
    removeBatchObservableCallback: vi.fn(),
  }
}

function makePropagator(): TextMapPropagator {
  return {
    inject: vi.fn(),
    extract: vi.fn((ctx: Context, _carrier?: unknown, _getter?: unknown) => ctx),
    fields: vi.fn(() => ['traceparent']),
  }
}

function httpInterceptor(config: ClientConfig): HttpInterceptor {
  const interceptor = config.interceptors.find((item) => item.kind === 'http')
  if (interceptor?.kind !== 'http') {
    throw new Error('Expected HTTP interceptor')
  }
  return interceptor
}

function sseInterceptor(config: ClientConfig): SSEInterceptor {
  const interceptor = config.interceptors.find((item) => item.kind === 'sse')
  if (interceptor?.kind !== 'sse') {
    throw new Error('Expected SSE interceptor')
  }
  return interceptor
}

function webSocketInterceptor(config: ClientConfig): WebSocketInterceptor {
  const interceptor = config.interceptors.find((item) => item.kind === 'web-socket')
  if (interceptor?.kind !== 'web-socket') {
    throw new Error('Expected WebSocket interceptor')
  }
  return interceptor
}

describe('withOpenTelemetryServer', () => {
  test('should create interceptors for all transports by default', () => {
    const config = makeConfig()
    const option = withOpenTelemetryServer({ tracer: createMockTracer().tracer })
    option(config)

    expect(config.interceptors.map((interceptor) => interceptor.kind)).toEqual(['http', 'sse', 'web-socket'])
  })

  test('should disable HTTP interceptor when http.enabled is false', () => {
    const config = makeConfig()
    const option = withOpenTelemetryServer({ tracer: createMockTracer().tracer, http: { enabled: false } })
    option(config)

    expect(config.interceptors.map((interceptor) => interceptor.kind)).toEqual(['sse', 'web-socket'])
  })

  test('should disable SSE interceptor when sse.enabled is false', () => {
    const config = makeConfig()
    const option = withOpenTelemetryServer({ tracer: createMockTracer().tracer, sse: { enabled: false } })
    option(config)

    expect(config.interceptors.map((interceptor) => interceptor.kind)).toEqual(['http', 'web-socket'])
  })

  test('should disable WebSocket interceptor when webSocket.enabled is false', () => {
    const config = makeConfig()
    const option = withOpenTelemetryServer({ tracer: createMockTracer().tracer, webSocket: { enabled: false } })
    option(config)

    expect(config.interceptors.map((interceptor) => interceptor.kind)).toEqual(['http', 'sse'])
  })

  test('should enable transport when transport option object is empty', () => {
    const config = makeConfig()
    const option = withOpenTelemetryServer({
      tracer: createMockTracer().tracer,
      http: {},
      sse: {},
      webSocket: {},
    })
    option(config)

    expect(config.interceptors).toHaveLength(3)
    expect(config.http.handle).toBe(config.sse.handle)
  })

  test('should route each startSpanHook only to its transport', async () => {
    const { tracer } = createMockTracer()
    const httpStartSpanHook = vi.fn(() => ({ 'app.transport': 'http' }))
    const sseStartSpanHook = vi.fn(() => ({ 'app.transport': 'sse' }))
    const webSocketStartSpanHook = vi.fn(() => ({ 'app.transport': 'webSocket' }))
    const config = makeConfig()

    withOpenTelemetryServer({
      tracer,
      http: { startSpanHook: httpStartSpanHook },
      sse: { startSpanHook: sseStartSpanHook },
      webSocket: { startSpanHook: webSocketStartSpanHook },
    })(config)

    const httpRequest = makeHttpRequest()
    await httpInterceptor(config).fn(httpRequest, async () => makeHttpResponse())
    expect(httpStartSpanHook).toHaveBeenCalledWith(httpRequest)
    expect(sseStartSpanHook).not.toHaveBeenCalled()
    expect(webSocketStartSpanHook).not.toHaveBeenCalled()

    const sseRequest = makeSSERequest()
    await sseInterceptor(config).fn(sseRequest, async () => makeSSEStream())
    expect(sseStartSpanHook).toHaveBeenCalledWith(sseRequest)
    expect(webSocketStartSpanHook).not.toHaveBeenCalled()

    const webSocketRequest = makeWsRequest()
    await webSocketInterceptor(config).fn(webSocketRequest, async () => makeWsSession())
    expect(webSocketStartSpanHook).toHaveBeenCalledWith(webSocketRequest)
  })

  test('should keep initial transport attributes when startSpanHook is omitted', async () => {
    const { tracer } = createMockTracer()
    const config = makeConfig()
    withOpenTelemetryServer({ tracer })(config)

    await httpInterceptor(config).fn(makeHttpRequest(), async () => makeHttpResponse())
    await sseInterceptor(config).fn(makeSSERequest(), async () => makeSSEStream())
    await webSocketInterceptor(config).fn(makeWsRequest(), async () => makeWsSession())

    expect(vi.mocked(tracer.startSpan).mock.calls.map((call) => call[1]?.attributes?.['url.full'])).toEqual([
      'https://api.example.com/test',
      'https://api.example.com/events',
      'wss://api.example.com/ws',
    ])
  })

  test('should disable all interceptors when all transports are disabled', () => {
    const config = makeConfig()
    const option = withOpenTelemetryServer({
      tracer: createMockTracer().tracer,
      http: { enabled: false },
      sse: { enabled: false },
      webSocket: { enabled: false },
    })
    option(config)

    expect(config.interceptors).toHaveLength(0)
  })

  test('should accept external meter', () => {
    const meter = makeMeter()

    const option = withOpenTelemetryServer({ tracer: createMockTracer().tracer, meter })
    expect(typeof option).toBe('function')
  })

  test('should apply interceptors with external meter', () => {
    const meter = makeMeter()
    const config = makeConfig()

    withOpenTelemetryServer({ tracer: createMockTracer().tracer, meter })(config)

    expect(config.interceptors).toHaveLength(3)
  })

  test('should accept custom propagator', () => {
    const propagator = makePropagator()

    const option = withOpenTelemetryServer({ tracer: createMockTracer().tracer, propagator })
    expect(typeof option).toBe('function')
  })

  test('should default WebSocket query propagation to off', async () => {
    const { tracer } = createMockTracer()
    const propagator = makePropagator()
    const config = makeConfig()

    withOpenTelemetryServer({
      tracer,
      propagator,
      http: { enabled: false },
      sse: { enabled: false },
    })(config)

    const req = makeWsRequest(new URLSearchParams({ room: 'alpha' }))
    const next = vi.fn(async () => makeWsSession())
    await webSocketInterceptor(config).fn(req, next)

    expect(propagator.inject).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ queryParams: req.queryParams, queryString: 'room=alpha' }))
  })

  test('should pass HTTP hooks only to HTTP interceptor', async () => {
    const { tracer } = createMockTracer()
    const requestHook = vi.fn()
    const responseHook = vi.fn()
    const config = makeConfig()

    withOpenTelemetryServer({
      tracer,
      sse: { enabled: false },
      webSocket: { enabled: false },
      http: { requestHook, responseHook },
    })(config)

    const res = makeHttpResponse()
    await httpInterceptor(config).fn(makeHttpRequest(), async () => res)

    expect(requestHook).toHaveBeenCalledTimes(1)
    expect(responseHook).toHaveBeenCalledTimes(1)
  })

  test('should pass SSE hooks only to SSE interceptor', async () => {
    const { tracer } = createMockTracer()
    const requestHook = vi.fn()
    const responseHook = vi.fn()
    const config = makeConfig()

    withOpenTelemetryServer({
      tracer,
      http: { enabled: false },
      webSocket: { enabled: false },
      sse: { requestHook, responseHook },
    })(config)

    const stream = makeSSEStream()
    await sseInterceptor(config).fn(makeSSERequest(), async () => stream)

    expect(requestHook).toHaveBeenCalledTimes(1)
    expect(responseHook).toHaveBeenCalledTimes(1)
  })

  test('should pass WebSocket hooks and explicit query propagation to WebSocket interceptor', async () => {
    const { tracer } = createMockTracer()
    const requestHook = vi.fn()
    const responseHook = vi.fn()
    const propagator = makePropagator()
    const config = makeConfig()

    withOpenTelemetryServer({
      tracer,
      propagator,
      http: { enabled: false },
      sse: { enabled: false },
      webSocket: { queryPropagation: true, requestHook, responseHook },
    })(config)

    await webSocketInterceptor(config).fn(makeWsRequest(), async () => makeWsSession())

    expect(requestHook).toHaveBeenCalledTimes(1)
    expect(responseHook).toHaveBeenCalledTimes(1)
    expect(propagator.inject).toHaveBeenCalledTimes(1)
  })
})
