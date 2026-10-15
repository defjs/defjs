import type { HttpRequest } from '../src/internal/http_request'
import type { HttpResponse } from '../src/internal/http_response'
import { makeResponse } from '../src/internal/http_response'
import { resolveRequestUrl } from '../src/internal/url'

export type TestHandler = (req: HttpRequest) => Promise<HttpResponse<unknown>>

export function makeFakeHandler(init?: {
  onRequestBefore?: (req: HttpRequest) => void
  onRequestAfter?: (resp: HttpResponse<unknown>) => void
  response?: {
    timeout?: number
    status?: number
    statusText?: string
    headers?: Headers
    body?: unknown
  }
}): TestHandler {
  const { onRequestBefore, onRequestAfter, response } = init ?? {}
  const { status, statusText, body, headers } = response ?? {}
  return (req: HttpRequest) => {
    return new Promise((resolve) => {
      const url = resolveRequestUrl(req)

      onRequestBefore?.(req)

      const resp = makeResponse({
        url: url.toString(),
        status: status ?? 0,
        statusText: statusText ?? '',
        headers: headers ?? new Headers(),
        body: body ?? undefined,
      })

      onRequestAfter?.(resp)

      return resolve(resp)
    })
  }
}
