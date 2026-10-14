import type { QuerySerializer } from '../client/config'
import { isPlainObject } from '../struct/utils'
import type { HttpRequest } from './http_request'
import type { RequestBuildValue, RequestScalarValue } from './request_values'
import { isRequestScalarValue, serializeRequestScalarValue } from './request_values'

export class RequestUrlError extends TypeError {}

type UrlScalarValue = Exclude<RequestScalarValue, bigint>

export function fillUrl(path: string, params?: { [key: string]: RequestBuildValue }): string {
  const paramMap = new Map<string, string>()
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'undefined') {
        continue
      }

      if (Array.isArray(value)) {
        const first = value[0]
        if (typeof first !== 'undefined') {
          if (!isUrlScalarValue(first)) {
            throw new TypeError(`path value for "${key}" requires a scalar value`)
          }
          paramMap.set(key, encodePathSegment(key, serializeRequestScalarValue(first)))
        }
        continue
      }

      if (!isUrlScalarValue(value)) {
        throw new TypeError(`path value for "${key}" requires a scalar value`)
      }

      paramMap.set(key, encodePathSegment(key, serializeRequestScalarValue(value)))
    }
  }

  return path.replace(/:([^/]+)/g, (_, part: string) => {
    const value = paramMap.get(part)
    if (typeof value === 'undefined') {
      throw new TypeError(`Missing path param: ${part}`)
    }
    return value
  })
}

function encodePathSegment(key: string, value: string): string {
  if (value === '') {
    throw new TypeError(`path value for "${key}" must be a non-empty path segment`)
  }
  if (value === '.' || value === '..') {
    throw new TypeError(`path value for "${key}" must not be a dot segment`)
  }
  return encodeURIComponent(value)
}

export function createSearchParams(query?: { [key: string]: unknown }): URLSearchParams {
  const searchParams = new URLSearchParams()
  if (!query) {
    return searchParams
  }

  for (const [key, value] of Object.entries(query)) {
    appendToSearchParams(searchParams, key, value)
  }

  return searchParams
}

export function resolveTransportQuery(
  query: URLSearchParams | { [key: string]: unknown } | undefined,
  serializer?: QuerySerializer,
): { queryParams: URLSearchParams; queryString: string } {
  if (typeof URLSearchParams !== 'undefined' && query instanceof URLSearchParams) {
    return { queryParams: query, queryString: query.toString() }
  }

  if (!isPlainObject(query)) {
    const queryParams = createSearchParams()
    return { queryParams, queryString: queryParams.toString() }
  }

  if (!serializer) {
    const queryParams = createSearchParams(query)
    return { queryParams, queryString: queryParams.toString() }
  }

  const queryString = serializer(query)
  return {
    queryParams: new URLSearchParams(queryString),
    queryString,
  }
}

export function appendRecordToHeaders(headers: Headers, value?: HeadersInit | { [key: string]: RequestBuildValue }): void {
  if (!value) {
    return
  }

  if (value instanceof Headers) {
    value.forEach((headerValue, key) => {
      headers.set(key, headerValue)
    })
    return
  }

  if (Array.isArray(value)) {
    for (const [key, headerValue] of value) {
      headers.append(key, headerValue)
    }
    return
  }

  for (const [key, headerValue] of Object.entries(value)) {
    if (typeof headerValue === 'undefined') {
      continue
    }

    if (Array.isArray(headerValue)) {
      for (const item of headerValue) {
        if (!isUrlScalarValue(item)) {
          throw new TypeError(`header value for "${key}" requires a scalar value`)
        }
        headers.append(key, serializeRequestScalarValue(item))
      }
      continue
    }

    if (!isUrlScalarValue(headerValue)) {
      throw new TypeError(`header value for "${key}" requires a scalar value`)
    }

    headers.set(key, serializeRequestScalarValue(headerValue))
  }
}

/**
 * Resolve a relative definition path under the base endpoint's origin and directory.
 * Reject absolute paths, backslashes, C0 controls, query/hash and directory escapes; encode plain path spaces.
 * @throws TypeError when the endpoint or path is invalid.
 */
export function createResolvedRequestUrl(baseEndpoint: string, path: string, queryString = ''): URL {
  const base = createEndpointDirectoryBase(baseEndpoint)
  let url: URL
  try {
    url = new URL(path.replace(/^\/(?!\/)/, ''), base)
  } catch {
    throw new RequestUrlError('Endpoint path must resolve to a valid URL')
  }
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
    throw new RequestUrlError('Endpoint path must not be an absolute URL or leave the client endpoint directory')
  }
  validateEndpointPath(path)
  // The validated path carries no query, so an empty string would only reassign an empty search.
  if (queryString) {
    url.search = queryString
  }
  return url
}

// HttpRequest-flavored convenience: resolve endpoint + base + query string in one go.
// Replaces the near-identical `createRequestUrl` helpers previously duplicated in fetch/sse/test_handler.
export function resolveRequestUrl(request: HttpRequest): URL {
  if (!request.baseEndpoint) {
    throw new RequestUrlError('Client endpoint is required')
  }
  const queryString =
    typeof request.queryString === 'string' ? request.queryString : request.queryParams ? request.queryParams.toString() : ''
  return createResolvedRequestUrl(request.baseEndpoint, request.endpoint, queryString)
}

function appendToSearchParams(searchParams: URLSearchParams, key: string, value: unknown): void {
  if (typeof value === 'undefined') {
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'undefined') {
        continue
      }
      appendQueryLeaf(searchParams, key, item)
    }
    return
  }

  appendQueryLeaf(searchParams, key, value)
}

function appendQueryLeaf(searchParams: URLSearchParams, key: string, value: unknown): void {
  if (value === null) {
    throw new TypeError(`query value for "${key}" must not be null`)
  }
  if (isRequestScalarValue(value)) {
    searchParams.append(key, serializeRequestScalarValue(value))
    return
  }
  throw new TypeError(`a query serializer is required for nested query value "${key}"`)
}

function isUrlScalarValue(value: unknown): value is UrlScalarValue {
  return isRequestScalarValue(value) && typeof value !== 'bigint'
}

// One client usually talks to one endpoint. `new URL(path, base)` only reads the base, so it is shared.
let lastEndpoint: string | undefined
let lastBase: URL | undefined

function createEndpointDirectoryBase(baseEndpoint: string): URL {
  if (baseEndpoint === lastEndpoint) {
    return lastBase as URL
  }
  let base: URL
  try {
    base = new URL(baseEndpoint)
  } catch {
    throw new RequestUrlError('Client endpoint must be a valid URL')
  }

  base.search = ''
  base.hash = ''

  if (!base.pathname.endsWith('/')) {
    base.pathname = `${base.pathname}/`
  }

  lastEndpoint = baseEndpoint
  lastBase = base
  return base
}

function validateEndpointPath(path: string): void {
  if (URL.canParse(path) || /^ *\/\//.test(path)) {
    throw new RequestUrlError('Endpoint path must not be an absolute URL')
  }

  if (path.includes('?') || path.includes('#')) {
    throw new RequestUrlError('Endpoint path must not include query or hash')
  }

  // eslint-disable-next-line no-control-regex -- C0 controls are an intentional request URL security boundary.
  if (/[\u0000-\u001f\\]/.test(path)) {
    throw new RequestUrlError('Endpoint path must not include C0 controls or backslashes')
  }
}
