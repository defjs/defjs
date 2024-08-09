import { ERR_TIMEOUT, HttpErrorResponse } from '../error'
import type { HttpRequest } from '../request'
import { type HttpResponse, __makeResponse } from '../response'
import type { HttpHandler } from './handler'

export function makeFakeHandler(init: {
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
  const { onRequestBefore, onRequestAfter, response } = init
  const { timeout, status, statusText, body, headers } = response
  return (req: HttpRequest) => {
    return new Promise((resolve, reject) => {
      const url = new URL(req.endpoint, req.host)

      onRequestBefore?.(req)

      // todo
      if (timeout && timeout > 0) {
        setTimeout(() => {
          reject(
            new HttpErrorResponse({
              error: ERR_TIMEOUT,
              url: url.toString(),
            }),
          )
        }, timeout)
      }

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
