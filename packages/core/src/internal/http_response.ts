import type { HttpRequest } from './http_request'
import { resolveRequestUrl } from './url'

const HTTP_RESPONSE: unique symbol = Symbol('HttpResponse')

/**
 * Wire-shape HTTP response returned by transports and accepted by interceptors.
 * `ok` is true for status codes in the 2xx range. A transport failure is a fault, never a response.
 */
export type HttpResponse<R> = {
  readonly [HTTP_RESPONSE]: true
  readonly url: string
  readonly status: number
  readonly statusText: string
  readonly headers: Headers
  /** Absent when no body was present. JSON `null` stays `null`. */
  readonly body: R | null | undefined
  readonly ok: boolean
}

/**
 * Response metadata, available whenever a response reached the client.
 *
 * Carries no body: a body only exists once a declared struct decoded it.
 */
export type HttpMeta = {
  readonly headers: Headers
  readonly ok: boolean
  readonly status: number
  readonly statusText: string
  readonly url: string
}

/**
 * Response whose body decoded successfully against a declared struct.
 *
 * Reaching this type is the proof that decoding happened; a failed decode is reported
 * as a fault carrying `HttpMeta` alone.
 */
export type DecodedResponse<TBody> = HttpMeta & { readonly body: TBody }

/**
 * Fields accepted by `makeResponse` when building a synthetic `HttpResponse` (for example in interceptors).
 */
export type MakeResponseOptions<R> = {
  status?: number
  statusText?: string
  url?: string
  headers?: Headers
  body?: R | null
  request?: HttpRequest
}

/**
 * Build an `HttpResponse` value without performing a network call.
 * Useful in interceptors that short-circuit `next`, and in tests.
 *
 * @param options - Status, headers, body, and an optional request to copy headers/url from; defaults yield status `0`.
 * @returns An `HttpResponse` with `ok` derived from the status code.
 */
export function makeResponse<R>(options?: MakeResponseOptions<R>): HttpResponse<R> {
  const status = options?.status ?? 0
  const ok = status >= 200 && status < 300
  const statusText = options?.statusText ?? ''
  const url = options?.url ?? requestUrl(options?.request)
  const headers = options?.headers ?? new Headers(options?.request?.headers)
  // Omitted and explicit null are different: only a caller-supplied null is a JSON null.
  const body = options?.body

  return {
    [HTTP_RESPONSE]: true,
    status,
    statusText,
    url,
    headers,
    body,
    ok,
  }
}

export function getHttpErrorMessage(response: { readonly status: number; readonly statusText: string; readonly url: string }): string {
  let message = `Http failure response: ${response.status}`
  if (response.statusText) {
    message += ` - ${response.statusText}`
  }
  return message
}

function requestUrl(request: HttpRequest | undefined): string {
  if (!request) {
    return ''
  }
  if (!request.baseEndpoint) {
    return request.endpoint
  }
  return resolveRequestUrl(request).href
}
