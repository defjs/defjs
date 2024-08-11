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

export function __withErrorCause<T>(err: Error, cause: T): Error {
  err.cause = cause
  return err
}

export class HttpErrorResponse extends Error {
  readonly status: number
  readonly statusText: string
  readonly url: string | null
  readonly headers: Headers
  readonly ok: boolean
  readonly body: unknown

  constructor(init: {
    error?: Error | string | unknown
    status?: number
    statusText?: string
    url?: string
    headers?: Headers
    body?: unknown
  }) {
    const status: number = init.status ?? 0
    const statusText = init.statusText ?? ''
    const ok = status >= 200 && status < 300
    const headers = init.headers ?? new Headers()
    const url = init.url ?? null
    const body = init.body ?? null
    let message: string

    if (ok) {
      message = `Http failure during parsing for ${init.url || '(unknown url)'}`
    } else {
      message = `Http failure response for ${init.url || '(unknown url)'}: ${init.status} ${init.statusText}`
    }

    super(message, { cause: init.error })

    super.name = 'HttpErrorResponse'
    this.statusText = statusText
    this.url = url
    this.headers = headers
    this.status = status
    this.ok = ok
    this.body = body
  }
}
