import type { HttpRequest, WebSocketSessionLike } from '@defjs/core'
import { createWebSocketInterceptor, ERR_ABORTED } from '@defjs/core'
import type { Attributes, Span, TextMapPropagator, Tracer } from '@opentelemetry/api'
import { context, trace } from '@opentelemetry/api'
import type { Logger } from '@opentelemetry/api-logs'
import { headersGetter, queryStringSetter } from '../propagation/carrier'
import { emitClientException } from '../telemetry/logs'
import type { WebSocketClientMetrics } from '../telemetry/metrics'
import {
  createConnectionMetricAttributes,
  createErrorMetricAttributes,
  createServerMetricAttributes,
  durationSeconds,
} from '../telemetry/metrics'
import { addSpanEvent, createWebSocketSpan, endSpan, resolveStartSpanHook, runSpanHook, setSpanError } from '../telemetry/trace'
import { resolveUrl } from '../telemetry/url'

export interface WebSocketInterceptorOptions {
  tracer?: Tracer
  logger?: Logger
  propagator: TextMapPropagator
  metrics?: WebSocketClientMetrics
  requireParentSpan?: boolean
  queryPropagation?: boolean
  startSpanHook?: (request: HttpRequest) => Attributes
  requestHook?: (span: Span, req: HttpRequest) => Promise<void> | void
  responseHook?: (span: Span, session: WebSocketSessionLike, req: HttpRequest) => Promise<void> | void
}

export function createOpenTelemetryWebSocketInterceptor(
  options: WebSocketInterceptorOptions,
): ReturnType<typeof createWebSocketInterceptor> {
  return createWebSocketInterceptor(async (req, next) => {
    const {
      tracer,
      logger,
      propagator,
      metrics,
      requireParentSpan,
      queryPropagation = false,
      startSpanHook,
      requestHook,
      responseHook,
    } = options

    if (tracer && requireParentSpan && !trace.getActiveSpan()) {
      return next(req)
    }

    const url = resolveUrl(req.endpoint, req.baseEndpoint)

    const parentCtx = propagator.extract(context.active(), req.headers ?? new Headers(), headersGetter)
    let span: Span | undefined
    if (tracer) {
      const startSpanHookResult = resolveStartSpanHook(startSpanHook, req)
      span = createWebSocketSpan(tracer, url, parentCtx, req.operation, startSpanHookResult.ok ? startSpanHookResult.attributes : undefined)
      if (!startSpanHookResult.ok) {
        runSpanHook(span, 'startSpanHook', () => {
          throw startSpanHookResult.error
        })
      }
    }
    const spanCtx = span ? trace.setSpan(parentCtx, span) : parentCtx

    let queryParams = req.queryParams
    let queryString = req.queryString

    if (queryPropagation) {
      const originalParams = new URLSearchParams(queryParams)
      const carrier = { params: new URLSearchParams(queryParams) }
      propagator.inject(spanCtx, carrier, queryStringSetter)
      queryParams = carrier.params
      queryString = appendInjectedQueryString(queryString, originalParams, carrier.params)
    }

    if (span) runSpanHook(span, 'requestHook', () => requestHook?.(span, req))

    const connectStartMs = performance.now()

    try {
      const session = await next({ ...req, queryParams, queryString })
      const connectedAtMs = performance.now()
      const activeAttributes = createServerMetricAttributes(req)

      if (span) {
        runSpanHook(span, 'responseHook', () => responseHook?.(span, session, req))
        addSpanEvent(span, 'websocket.connected')
      }

      metrics?.connectDuration.record(durationSeconds(connectStartMs, connectedAtMs), createConnectionMetricAttributes(req, 'success'))
      metrics?.activeConnections.add(1, activeAttributes)

      const closeActiveConnection = () => {
        metrics?.activeConnections.add(-1, activeAttributes)
      }

      session.closed.then(
        (closeInfo: unknown) => {
          closeActiveConnection()
          const runtimeCloseInfo =
            typeof closeInfo === 'object' && closeInfo !== null ? (closeInfo as { cause?: unknown; kind?: unknown; code?: unknown }) : {}
          const closeKind = runtimeCloseInfo.kind
          const closeCause = runtimeCloseInfo.cause
          const failed = typeof closeKind === 'string' ? closeKind !== 'closed' : typeof closeCause !== 'undefined'
          if (failed) {
            const error = typeof closeKind === 'string' ? (closeKind === 'error' ? closeCause : (closeCause ?? ERR_ABORTED)) : closeCause
            if (closeKind !== 'aborted') {
              emitClientException(logger, {
                request: req,
                context: spanCtx,
                error,
                transport: 'websocket',
                phase: 'connection',
                closeInfo: runtimeCloseInfo,
              })
            }
            if (span) addSpanEvent(span, 'websocket.error', createErrorMetricAttributes(error))
            metrics?.connectionDuration.record(
              durationSeconds(connectedAtMs),
              createConnectionMetricAttributes(req, 'error', createErrorMetricAttributes(error)),
            )
            if (span) setSpanError(span, error)
            return
          }

          if (span) addSpanEvent(span, 'websocket.closed')
          metrics?.connectionDuration.record(durationSeconds(connectedAtMs), createConnectionMetricAttributes(req, 'success'))
          if (span) endSpan(span)
        },
        (error: unknown) => {
          closeActiveConnection()
          emitClientException(logger, { request: req, context: spanCtx, error, transport: 'websocket', phase: 'connection' })
          if (span) addSpanEvent(span, 'websocket.error', createErrorMetricAttributes(error))
          metrics?.connectionDuration.record(
            durationSeconds(connectedAtMs),
            createConnectionMetricAttributes(req, 'error', createErrorMetricAttributes(error)),
          )
          if (span) setSpanError(span, error)
        },
      )

      return session
    } catch (error) {
      emitClientException(logger, { request: req, context: spanCtx, error, transport: 'websocket', phase: 'connect' })
      metrics?.connectDuration.record(
        durationSeconds(connectStartMs),
        createConnectionMetricAttributes(req, 'error', createErrorMetricAttributes(error)),
      )
      if (span) setSpanError(span, error)
      throw error
    }
  })
}

function appendInjectedQueryString(queryString: string | undefined, originalParams: URLSearchParams, nextParams: URLSearchParams): string {
  const injectedParams = new URLSearchParams()

  nextParams.forEach((value, key) => {
    if (originalParams.getAll(key).includes(value)) {
      return
    }
    injectedParams.append(key, value)
  })

  const injectedQueryString = injectedParams.toString()
  if (!injectedQueryString) {
    return queryString ?? ''
  }
  if (!queryString) {
    return injectedQueryString
  }
  return `${queryString}&${injectedQueryString}`
}
