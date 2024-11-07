export const ERR_ABORTED = new Error('ERR_ABORTED')

export const ERR_TIMEOUT = new Error('ERR_TIMEOUT')

export const ERR_NETWORK = new Error('ERR_NETWORK')

export const ERR_NOT_FOUND_HANDLER = new Error('ERR_NOT_FOUND_HANDLER')

export const ERR_OBSERVE = new Error('ERR_OBSERVE')

export const ERR_NOT_SET_ALIAS = new Error('ERR_NOT_SET_ALIAS')

export const ERR_UNSUPPORTED_FIELD_TYPE = new Error('ERR_UNSUPPORTED_FIELD_TYPE')

export const ERR_INVALID_CLIENT = new Error('ERR_INVALID_CLIENT')

export const ERR_NOT_FOUND_GLOBAL_CLIENT = new Error('ERR_NOT_FOUND_GLOBAL_CLIENT')

export const ERR_INVALID_HTTP_CONTEXT_TOKEN = new Error('ERR_INVALID_HTTP_CONTEXT_TOKEN')

export const ERR_UNKNOWN = new Error('ERR_UNKNOWN')

export type HttpResponseBody = string | ArrayBuffer | Blob | object | null

export type HttpResponse<R> = {
  readonly url: string
  readonly status: number
  readonly statusText: string
  readonly headers: Headers
  readonly body: R | null
  readonly error?: Error | string | unknown
}

export type MakeResponseOptions<R> = {
  status?: number
  statusText?: string
  url?: string
  headers?: Headers
  body?: R | null
  error?: Error | string | unknown
}

export function __makeResponse<R>(options?: MakeResponseOptions<R>): HttpResponse<R> {
  const status = options?.status ?? 0
  const ok = status >= 200 && status < 300
  const statusText = options?.statusText ?? ''
  const url = options?.url ?? ''
  const headers = options?.headers ?? new Headers()
  const body = options?.body ?? null
  let error = options?.error

  if (!error && !ok) {
    let message = `Http failure response for ${url || '(unknown url)'}: ${status}`
    if (statusText) {
      message += ` - ${statusText}`
    }
    error = new Error(message)
  }

  return {
    status,
    statusText,
    url,
    headers,
    body,
    error,
  }
}
