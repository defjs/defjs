const HTTP_RESPONSE = Symbol('HTTP_RESPONSE')

export type HttpResponseBody = string | ArrayBuffer | Blob | object | null

export type HttpResponse<R> = (
  | {
      readonly ok: true
      readonly error: null
    }
  | {
      readonly ok: false
      readonly error: Error
    }
) & {
  readonly url: string
  readonly status: number
  readonly statusText: string
  readonly headers: Headers
  readonly body: R | null

  readonly [HTTP_RESPONSE]: unknown
}

export function isHttpResponse<R>(value: unknown): value is HttpResponse<R> {
  return typeof value === 'object' && value !== null && HTTP_RESPONSE in value
}

export function isHttpResponseError<R>(value: unknown): value is HttpResponse<R> & { ok: false } {
  return isHttpResponse(value) && !value.ok
}

export type MakeResponseOptions<R> = {
  status?: number
  statusText?: string
  url?: string
  headers?: Headers
  body?: R | null
  error?: Error
}

export function makeResponse<R>(options: MakeResponseOptions<R>): HttpResponse<R> {
  const status = options.status ?? 0
  const statusText = options.statusText ?? ''
  const ok = status >= 200 && status < 300
  const url = options.url ?? ''
  const headers = options.headers ?? new Headers()
  const body = options.body ?? null

  if (!ok || options.error) {
    const error = options.error || new Error(`Http failure response for ${options.url}: ${status} ${statusText}`)

    return {
      ok: false,
      error,
      status,
      statusText,
      url,
      headers,
      body,
      [HTTP_RESPONSE]: null,
    }
  }

  return {
    ok: true,
    error: null,
    status,
    statusText,
    url,
    headers,
    body,
    [HTTP_RESPONSE]: null,
  }
}
