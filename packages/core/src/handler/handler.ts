import type { HttpRequest } from '../request'
import type { HttpResponse } from '../response'

export type HttpHandler = (req: HttpRequest) => Promise<HttpResponse<unknown>>

let globalHttpHandler: HttpHandler | undefined = undefined

export const setGlobalHttpHandler = (handler: HttpHandler) => {
  globalHttpHandler = handler
}

export const getGlobalHttpHandler = () => globalHttpHandler
