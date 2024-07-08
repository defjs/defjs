import type { HttpHandler } from '../handler'
import type { HttpRequest } from '../request'
import type { HttpResponse } from '../response'

export type InterceptorFn = (req: HttpRequest, next: HttpHandler) => Promise<HttpResponse<unknown>>

export function makeInterceptorChain(interceptors: InterceptorFn[]): InterceptorFn {
  return interceptors.reduceRight(
    (fn, interceptor) => {
      return (initReq, finalHandlerFn) => interceptor(initReq, req => fn(req, finalHandlerFn))
    },
    (req, fn) => fn(req),
  )
}
