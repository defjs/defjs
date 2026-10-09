import type { QuerySerializer } from '../client/config'
import type { HttpProgressFn, HttpRequest, HttpResponseType } from '../internal/http_request'
import type { OutboundBuilder } from '../internal/outbound_request'
import { createBaseTransportRequest } from '../internal/transport_request'

export function createHttpRequest(
  method: string,
  path: string,
  input: unknown,
  builder: OutboundBuilder | undefined,
  options: {
    abort: AbortSignal
    baseEndpoint: string
    defaultHeaders?: Headers
    downloadProgress?: HttpProgressFn
    operation?: string
    errorResponseType?: HttpResponseType
    querySerializer?: QuerySerializer
    responseType?: HttpResponseType
    timeout?: number
    uploadProgress?: HttpProgressFn
    withCredentials?: boolean
    xsrf?: {
      cookieName: string
      headerName: string
      tokenProvider?: (context: { request: HttpRequest }) => string | null | undefined
    }
  },
): HttpRequest {
  const request = createBaseTransportRequest(method, path, input, builder, {
    abort: options.abort,
    baseEndpoint: options.baseEndpoint,
    defaultHeaders: options.defaultHeaders,
    operation: options.operation,
    querySerializer: options.querySerializer,
    timeout: options.timeout,
    transport: 'http',
    withCredentials: options.withCredentials,
  })

  return {
    ...request,
    downloadProgress: options.downloadProgress,
    errorResponseType: options.errorResponseType,
    responseType: options.responseType,
    uploadProgress: options.uploadProgress,
    xsrf: options.xsrf,
  }
}
