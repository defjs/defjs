export type HttpResponseBody = string | ArrayBuffer | Blob | object | null

export type HttpResponse<R> = {
  readonly url: string
  readonly status: number
  readonly statusText: string
  readonly headers: Headers
  readonly body: R | null
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
  const statusText = options.statusText ?? ''
  const url = options.url ?? ''
  const headers = options.headers ?? new Headers()
  const body = options.body ?? null

  // const error = options.error || new Error(`Http failure response for ${options.url}: ${status} ${statusText}`)

  return {
    status,
    statusText,
    url,
    headers,
    body,
  }
}
