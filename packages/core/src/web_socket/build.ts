import type { QuerySerializer } from '../client/config'
import type { HttpRequest } from '../internal/http_request'
import type { RequestBuildValue } from '../internal/request_values'
import { fillUrl, resolveRequestUrl, resolveTransportQuery } from '../internal/url'

export function createWebSocketRequest(params: {
  abort: AbortSignal
  baseEndpoint: string
  operation?: string
  params?: { [key: string]: RequestBuildValue }
  path: string
  query?: URLSearchParams | { [key: string]: unknown }
  querySerializer?: QuerySerializer
  withCredentials?: boolean
}): HttpRequest {
  const { queryParams, queryString } = resolveTransportQuery(params.query, params.querySerializer)
  const request: HttpRequest = {
    abort: params.abort,
    baseEndpoint: params.baseEndpoint,
    endpoint: fillUrl(params.path, params.params),
    headers: new Headers(),
    method: 'GET',
    operation: params.operation,
    queryParams,
    queryString,
    withCredentials: params.withCredentials ?? false,
  }
  resolveRequestUrl(request)
  return request
}

export function createWebSocketUrlFromRequest(request: HttpRequest): string {
  const url = resolveRequestUrl(request)
  if (url.protocol === 'https:') {
    url.protocol = 'wss:'
  } else if (url.protocol === 'http:') {
    url.protocol = 'ws:'
  }
  return url.toString()
}
