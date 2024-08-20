import type { HttpRequest } from '../request'
import { type HttpResponse, __makeResponse } from '../response'
import type { HttpHandler } from './handler'

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
}): HttpHandler {
  const { onRequestBefore, onRequestAfter, response } = init ?? {}
  const { status, statusText, body, headers } = response ?? {}
  return (req: HttpRequest) => {
    return new Promise(resolve => {
      const url = new URL(req.endpoint, req.host)

      onRequestBefore?.(req)

      const resp = __makeResponse({
        url: url.toString(),
        status: status || 0,
        statusText: statusText || '',
        headers: headers || new Headers(),
        body: body || undefined,
      })

      onRequestAfter?.(resp)

      return resolve(resp)
    })
  }
}
