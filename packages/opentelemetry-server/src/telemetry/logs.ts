import type { HttpRequest } from '@defjs/core'
import { isAbortCause, isTimeoutCause } from '@defjs/core'
import type { Context } from '@opentelemetry/api'
import { diag } from '@opentelemetry/api'
import type { Logger, LogAttributes } from '@opentelemetry/api-logs'
import { SeverityNumber } from '@opentelemetry/api-logs'
import { createServerMetricAttributes } from './metrics'
import { getErrorType } from './trace'

const CLIENT_EXCEPTIONS = {
  http: { eventName: 'http.client.request.exception', body: 'HTTP client request failed' },
  sse: { eventName: 'defjs.client.sse.exception', body: 'SSE client connection failed' },
  websocket: { eventName: 'defjs.client.websocket.exception', body: 'WebSocket client connection failed' },
} as const

interface ClientExceptionLog {
  request: HttpRequest
  context: Context
  transport: 'http' | 'sse' | 'websocket'
  phase: 'request' | 'connect' | 'connection'
  error: unknown
  closeInfo?: { code?: unknown }
}

/**
 * Caller cancellation produces no log. A timeout still logs.
 *
 * The request signal alone is not cancellation: WebSocket `finish()` aborts that same signal
 * when a connect fails. Cancellation is an abort sentinel from any `@defjs/core` copy, or an
 * `AbortError`, on the rejection or on the signal reason. `TimeoutError` and `ERR_TIMEOUT` log.
 */
function isCallerCancellation(request: HttpRequest, error: unknown): boolean {
  const reason = request.abort?.reason
  if (isTimeoutCause(error) || isTimeoutCause(reason)) return false
  return isAbortCause(error) || isAbortCause(reason)
}

export function emitClientException(logger: Logger | undefined, details: ClientExceptionLog): void {
  if (!logger) return

  try {
    const { error, transport, request } = details
    if (isCallerCancellation(request, error)) return
    if (error instanceof Error && 'code' in error) {
      if (error.code === 'NET_ABORTED' || (transport === 'http' && error.code === 'HTTP_STATUS')) return
    }

    const attributes: LogAttributes = {
      ...createServerMetricAttributes(request),
      'defjs.phase': details.phase,
      'exception.type': getErrorType(error),
    }
    if (transport === 'http') attributes['http.request.method'] = request.method
    const closeCode = details.closeInfo?.code
    if (transport === 'sse' && typeof closeCode === 'string') attributes['defjs.sse.fault.code'] = closeCode
    if (transport === 'websocket' && typeof closeCode === 'number') attributes['websocket.close.code'] = closeCode

    logger.emit({
      ...CLIENT_EXCEPTIONS[transport],
      context: details.context,
      severityNumber: SeverityNumber.WARN,
      severityText: 'WARN',
      attributes,
    })
  } catch {
    try {
      diag.error('@defjs/opentelemetry-server: failed to emit client diagnostic log')
    } catch {
      // Diagnostic reporting must not replace the transport outcome either.
    }
  }
}
