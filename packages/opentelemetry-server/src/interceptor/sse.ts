import type { EventStreamCloseInfo, EventStreamHandle, HttpRequest } from '@defjs/core'
import { createSSEInterceptor } from '@defjs/core'
import type { Attributes, Span, TextMapPropagator, Tracer } from '@opentelemetry/api'
import { context, trace } from '@opentelemetry/api'
import type { Logger } from '@opentelemetry/api-logs'
import { headersGetter, headersSetter } from '../propagation/carrier'
import { emitClientException } from '../telemetry/logs'
import type { SSEClientMetrics } from '../telemetry/metrics'
import {
  createConnectionMetricAttributes,
  createErrorMetricAttributes,
  createServerMetricAttributes,
  durationSeconds,
} from '../telemetry/metrics'
import { addSpanEvent, createSSESpan, endSpan, resolveStartSpanHook, runSpanHook, setSpanError } from '../telemetry/trace'
import { resolveUrl } from '../telemetry/url'

export interface SSEInterceptorOptions {
  tracer?: Tracer
  logger?: Logger
  propagator: TextMapPropagator
  metrics?: SSEClientMetrics
  requireParentSpan?: boolean
  startSpanHook?: (request: HttpRequest) => Attributes
  requestHook?: (span: Span, req: HttpRequest) => Promise<void> | void
  responseHook?: (span: Span, stream: EventStreamHandle<unknown>, req: HttpRequest) => Promise<void> | void
}

export function createOpenTelemetrySSEInterceptor(options: SSEInterceptorOptions): ReturnType<typeof createSSEInterceptor> {
  return createSSEInterceptor(async (req, next) => {
    const { tracer, logger, propagator, metrics, requireParentSpan, startSpanHook, requestHook, responseHook } = options

    if (tracer && requireParentSpan && !trace.getActiveSpan()) {
      return next(req)
    }

    const parentCtx = propagator.extract(context.active(), req.headers ?? new Headers(), headersGetter)
    const url = resolveUrl(req.endpoint, req.baseEndpoint)
    let span: Span | undefined
    if (tracer) {
      const startSpanHookResult = resolveStartSpanHook(startSpanHook, req)
      span = createSSESpan(tracer, url, parentCtx, req.operation, startSpanHookResult.ok ? startSpanHookResult.attributes : undefined)
      if (!startSpanHookResult.ok) {
        runSpanHook(span, 'startSpanHook', () => {
          throw startSpanHookResult.error
        })
      }
    }
    const spanCtx = span ? trace.setSpan(parentCtx, span) : parentCtx
    const headers = req.headers instanceof Headers ? req.headers : new Headers(req.headers)
    propagator.inject(spanCtx, headers, headersSetter)

    if (span) runSpanHook(span, 'requestHook', () => requestHook?.(span, req))

    const connectStartMs = performance.now()

    try {
      const stream = await next({ ...req, headers })
      const connectedAtMs = performance.now()
      const activeAttributes = createServerMetricAttributes(req)

      if (span) {
        runSpanHook(span, 'responseHook', () => responseHook?.(span, stream, req))
        addSpanEvent(span, 'sse.connected')
      }

      metrics?.connectDuration.record(durationSeconds(connectStartMs, connectedAtMs), createConnectionMetricAttributes(req, 'success'))
      metrics?.activeStreams.add(1, activeAttributes)

      const closeActiveStream = () => {
        metrics?.activeStreams.add(-1, activeAttributes)
      }

      stream.closed.then(
        (closeInfo: EventStreamCloseInfo) => {
          closeActiveStream()
          const closeAttributes = {
            'sse.close.kind': closeInfo.kind,
            ...(closeInfo.kind === 'error' ? { 'defjs.sse.fault.code': closeInfo.code } : {}),
          }

          if (closeInfo.kind === 'error') {
            emitClientException(logger, {
              request: req,
              context: spanCtx,
              error: closeInfo.cause,
              transport: 'sse',
              phase: 'connection',
              closeInfo,
            })
            if (span) addSpanEvent(span, 'sse.error', closeAttributes)
            metrics?.connectionDuration.record(
              durationSeconds(connectedAtMs),
              createConnectionMetricAttributes(req, 'error', {
                ...closeAttributes,
                ...createErrorMetricAttributes(closeInfo.cause),
              }),
            )
            if (span) setSpanError(span, closeInfo.cause)
            return
          }

          if (span) addSpanEvent(span, closeInfo.kind === 'aborted' ? 'sse.aborted' : 'sse.closed', closeAttributes)
          metrics?.connectionDuration.record(
            durationSeconds(connectedAtMs),
            createConnectionMetricAttributes(req, 'success', closeAttributes),
          )
          if (span) endSpan(span)
        },
        (error: unknown) => {
          closeActiveStream()
          emitClientException(logger, { request: req, context: spanCtx, error, transport: 'sse', phase: 'connection' })
          if (span) addSpanEvent(span, 'sse.error', createErrorMetricAttributes(error))
          metrics?.connectionDuration.record(
            durationSeconds(connectedAtMs),
            createConnectionMetricAttributes(req, 'error', createErrorMetricAttributes(error)),
          )
          if (span) setSpanError(span, error)
        },
      )

      return stream
    } catch (error) {
      emitClientException(logger, { request: req, context: spanCtx, error, transport: 'sse', phase: 'connect' })
      metrics?.connectDuration.record(
        durationSeconds(connectStartMs),
        createConnectionMetricAttributes(req, 'error', createErrorMetricAttributes(error)),
      )
      if (span) setSpanError(span, error)
      throw error
    }
  })
}
