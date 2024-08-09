export const ERR_ABORTED = new Error('ERR_ABORTED')

export const ERR_TIMEOUT = new Error('ERR_TIMEOUT')

export const ERR_NETWORK = new Error('ERR_NETWORK')

export const ERR_NOT_FOUND_HANDLER = new Error('ERR_NOT_FOUND_HANDLER')

export const ERR_TRANSFORM_RESPONSE = new Error('ERR_TRANSFORM_RESPONSE')

export const ERR_STREAMING_NOT_IMPLEMENTED = new Error('ERR_STREAMING_NOT_IMPLEMENTED')

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
  readonly url: string
  readonly status: number
  readonly statusText: string
  readonly headers: Headers
  readonly body: unknown

  constructor(init: {
    error?: unknown
    status?: number
    statusText?: string
    url?: string
    headers?: Headers
    body?: unknown
  }) {
    super('HttpErrorResponse', { cause: init.error })
    this.url = init.url ?? ''
    this.status = init.status ?? 0
    this.statusText = init.statusText ?? ''
    this.headers = init.headers ?? new Headers()
    this.body = init.body
  }
}
