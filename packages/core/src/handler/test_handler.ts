import type { HttpRequest } from '../request'
import { makeResponse } from '../response'
import type { HttpHandler } from './handler'

export function makeFakeHandler(init: {
  onRequestBefore?: (req: HttpRequest) => void
  response?: {
    timeout?: number
    status?: number
    statusText?: string
    headers?: Headers
    body?: unknown
  }
}): HttpHandler {
  const { onRequestBefore, response } = init
  return (req: HttpRequest) => {
    return new Promise((resolve, reject) => {
      const url = new URL(req.endpoint, req.host)

      onRequestBefore?.(req)

      // todo
      if (response?.timeout && response.timeout > 0) {
        setTimeout(() => {
          reject(
            makeResponse({
              url: url.toString(),
              statusText: 'Timeout',
            }),
          )
        }, response.timeout)
      }

      return resolve(
        makeResponse({
          url: url.toString(),
          status: response?.status || 0,
          statusText: response?.statusText || '',
          headers: response?.headers || new Headers(),
          body: response?.body || undefined,
        }),
      )
    })
  }
}
