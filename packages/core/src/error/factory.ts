import type { DecodedResponse, HttpMeta } from '../internal/http_response'
import { getHttpErrorMessage } from '../internal/http_response'
import { describeCause, ERR_ABORTED, ERR_TIMEOUT, isAbortCause, isTimeoutCause } from './cause'

export { ERR_ABORTED, ERR_TIMEOUT, isAbortCause, isTimeoutCause } from './cause'
import type { DecodeFault, DecodeFaultCode, HttpStatusFaultOf, PreflightFault, PreflightFaultCode } from './types'

const FAULT_NAME = 'DefjsFault'

function createFault<TFault extends Error>(message: string, cause?: unknown): TFault {
  const fault = (cause === undefined ? new Error(message) : new Error(message, { cause })) as TFault
  Object.defineProperty(fault, 'name', { configurable: true, enumerable: false, value: FAULT_NAME, writable: true })
  if (cause === undefined) {
    Object.defineProperty(fault, 'cause', { configurable: true, enumerable: false, value: undefined, writable: true })
  }
  return fault
}

function buildHttpStatusFault<TData>(response: HttpMeta, data: TData): HttpStatusFaultOf<TData> {
  const fault = createFault<HttpStatusFaultOf<TData>>(getHttpErrorMessage(response))
  fault.code = 'HTTP_STATUS'
  fault.data = data
  fault.response = response as HttpStatusFaultOf<TData>['response']
  fault.status = response.status
  return fault
}

/**
 * Build the fault for a non-2xx response whose body decoded against the declared `error` struct.
 *
 * @param response - The response, carrying the decoded body.
 * @returns An `HTTP_STATUS` fault whose `data` is that body.
 */
export function createHttpStatusFault<TData>(response: DecodedResponse<TData>): HttpStatusFaultOf<TData> {
  return buildHttpStatusFault(response, response.body)
}

/**
 * Build the fault for a non-2xx response that was never decoded, because the endpoint
 * declared no `error` struct.
 *
 * @param response - Metadata of the response; no body was read.
 * @returns An `HTTP_STATUS` fault whose `data` is `undefined`.
 */
export function createUndecodedHttpStatusFault(response: HttpMeta): HttpStatusFaultOf<undefined> {
  return buildHttpStatusFault(response, undefined)
}

/**
 * Build the fault for a response that arrived but could not be read as declared.
 *
 * Carries metadata only: a body is a decoded value, and decoding is what failed.
 * A `SyntaxError` is reported as `Response body could not be decoded`. The original error stays on `cause`,
 * so `String(fault)` does not include a body fragment.
 *
 * @param code - Which read step failed.
 * @param cause - Underlying parser or struct failure.
 * @param response - Metadata of the response that could not be read.
 * @returns A decode fault with no body.
 */
export function createDecodeFault(code: DecodeFaultCode, cause: unknown, response: HttpMeta): DecodeFault {
  const message =
    code === 'RES_DECODE_FAILED' && cause instanceof Error && cause.name === 'SyntaxError'
      ? 'Response body could not be decoded'
      : describeCause(cause)
  const fault = createFault<DecodeFault>(message, cause)
  fault.code = code
  fault.response = response
  fault.status = response.status
  return fault
}

/**
 * Build a fault for a failure that may have happened before any response existed.
 *
 * @param code - The specific failure.
 * @param cause - Underlying value, when there is one; the code becomes the message otherwise.
 * @param response - Metadata, only where the transport already had some to report.
 * @returns A preflight fault.
 */
export function createPreflightFault(code: PreflightFaultCode, cause?: unknown, response?: HttpMeta): PreflightFault {
  const fault = createFault<PreflightFault>(cause === undefined ? code : describeCause(cause), cause)
  fault.code = code
  if (response !== undefined) {
    fault.response = response
  }
  return fault
}

/**
 * Build a `NET_*` fault, choosing the code from the shape of `cause`.
 *
 * Recognizes the shared abort/timeout sentinels and the platform's `AbortError`/`TimeoutError`;
 * anything else is reported as unreachable.
 *
 * @param cause - Underlying cancellation, timeout, or transport failure.
 * @param response - Metadata, only where the transport already had some to report.
 * @returns A `NET_ABORTED`, `NET_TIMEOUT`, or `NET_UNREACHABLE` fault.
 */
export function createNetworkFault(cause: unknown, response?: HttpMeta): PreflightFault {
  if (isAbortCause(cause)) {
    return withResponse(createFault<PreflightFault>(ERR_ABORTED.message, cause), 'NET_ABORTED', response)
  }

  if (isTimeoutCause(cause)) {
    const message = cause instanceof Error && cause.message ? cause.message : ERR_TIMEOUT.message
    return withResponse(createFault<PreflightFault>(message, cause), 'NET_TIMEOUT', response)
  }

  return withResponse(createFault<PreflightFault>(describeCause(cause), cause), 'NET_UNREACHABLE', response)
}

function withResponse(fault: PreflightFault, code: PreflightFaultCode, response?: HttpMeta): PreflightFault {
  fault.code = code
  if (response !== undefined) {
    fault.response = response
  }
  return fault
}
