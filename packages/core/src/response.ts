const HTTP_RESPONSE = Symbol('HTTP_RESPONSE')

export type HttpResponseBody = string | ArrayBuffer | Blob | object | null

export type HttpResponse<R> = {
  readonly ok: boolean
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

export type MakeResponseOptions<R> = {
  status?: number
  statusText?: string
  url?: string
  headers?: Headers
  body?: R | null
}

export function __makeResponse<R>(options: MakeResponseOptions<R>): HttpResponse<R> {
  const status = options.status ?? 0
  const ok = status >= 200 && status < 300
  const statusText = options.statusText ?? ''
  const url = options.url ?? ''
  const headers = options.headers ?? new Headers()
  const body = options.body ?? null

  // const error = options.error || new Error(`Http failure response for ${options.url}: ${status} ${statusText}`)

  return {
    ok,
    status,
    statusText,
    url,
    headers,
    body,
    [HTTP_RESPONSE]: null,
  }
}
