import type { QuerySerializer } from '../client/config'
import { applyRequestContentType } from '../http/transport/body'
import type { HttpRequest } from './http_request'
import type { OutboundBuilder } from './outbound_request'
import { materializeOutboundRequest, runOutboundBuilder } from './outbound_request'
import type { RequestBuildValue } from './request_values'
import { appendRecordToHeaders, fillUrl, resolveTransportQuery } from './url'

type BaseTransport = 'http' | 'sse'

type BaseTransportRequest = HttpRequest & {
  abort: AbortSignal
  baseEndpoint: string
  headers: Headers
  queryParams: URLSearchParams
  queryString: string
}

export type BaseTransportRequestOptions<TTransport extends BaseTransport> = {
  abort: AbortSignal
  baseEndpoint: string
  defaultHeaders?: Headers
  operation?: string
  querySerializer?: QuerySerializer
  timeout?: number
  transport: TTransport
  withCredentials?: boolean
}

export function createBaseTransportRequest<TTransport extends BaseTransport>(
  method: string,
  path: string,
  input: unknown,
  builder: OutboundBuilder | undefined,
  options: BaseTransportRequestOptions<TTransport>,
): BaseTransportRequest {
  const built = materializeOutboundRequest(runOutboundBuilder(input, builder), options.transport)
  // A body is a build error here: Bun's Request accepts a GET/HEAD body and only fetch() throws.
  if (built.body !== undefined && (method.toUpperCase() === 'GET' || method.toUpperCase() === 'HEAD')) {
    throw new TypeError('GET/HEAD requests cannot have a body')
  }
  const { queryParams, queryString } = resolveTransportQuery(built.query, options.querySerializer)
  const headers = options.defaultHeaders ? new Headers(options.defaultHeaders) : new Headers()

  appendRecordToHeaders(headers, built.headers as HeadersInit | { [key: string]: RequestBuildValue } | undefined)
  if (built.defaultContentType && !headers.has('content-type')) {
    headers.set('content-type', built.defaultContentType)
  }

  const request: BaseTransportRequest = {
    abort: options.abort,
    baseEndpoint: options.baseEndpoint,
    body: built.body as HttpRequest['body'],
    bodyContentTypeSource: built.body,
    endpoint: fillUrl(path, built.params),
    headers,
    method,
    operation: options.operation,
    queryParams,
    queryString,
    timeout: options.timeout,
    withCredentials: options.withCredentials ?? false,
  }

  applyRequestContentType(request, headers)
  return request
}
