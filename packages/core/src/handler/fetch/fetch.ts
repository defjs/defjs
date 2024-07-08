import { makeHttpContextToken } from '../../context'
import { type HttpRequest, __detectContentTypeHeader, __serializeBody } from '../../request'
import { type HttpResponse, type HttpResponseBody, makeResponse } from '../../response'
import { concatChunks, getContentLength, getContentType, parseBody } from '../util'

export interface FetchConfig {
  /** A string indicating how the request will interact with the browser's cache to set request's cache. */
  cache?: RequestCache
  /** A string indicating whether credentials will be sent with the request always, never, or only when sent to a same-origin URL. Sets request's credentials. */
  credentials?: RequestCredentials
  /** A boolean to set request's keepalive. */
  keepalive?: boolean
  /** A string to indicate whether the request will use CORS, or will be restricted to same-origin URLs. Sets request's mode. */
  mode?: RequestMode
  priority?: RequestPriority
  /** A string indicating whether request follows redirects, results in an error upon encountering a redirect, or returns the redirect (in an opaque fashion). Sets request's redirect. */
  redirect?: RequestRedirect
  /** A string whose value is a same-origin URL, "about:client", or the empty string, to set request's referrer. */
  referrer?: string
  /** A referrer policy to set request's referrerPolicy. */
  referrerPolicy?: ReferrerPolicy
}

export const FETCH_CONFIG_KEY = makeHttpContextToken<FetchConfig>(() => ({}))

export function __createRequest(request: HttpRequest): Request {
  const url = new URL(request.endpoint, request.host)

  if (request.queryParams) {
    url.search = request.queryParams.toString()
  }

  const headers = request.headers ?? new Headers()
  if (!headers.has('Content-Type')) {
    const detectedType = __detectContentTypeHeader(request.body)
    if (detectedType) {
      headers.set('Content-Type', detectedType)
    }
  }

  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json, text/plain, */*')
  }

  const credentials = request.withCredentials ? 'include' : undefined

  const fetchConfig = request.context?.get(FETCH_CONFIG_KEY) || {}

  return new Request(url, {
    ...fetchConfig,
    headers,
    method: request.method,
    body: __serializeBody(request.body),
    signal: request.abort,
    credentials,
  })
}

export async function fetchHandler(httpRequest: HttpRequest): Promise<HttpResponse<unknown>> {
  const downloadProgress = httpRequest.downloadProgress
  const request = __createRequest(httpRequest)
  const response: Response = await (globalThis || window).fetch(request)
  const { headers, status, statusText, url } = response
  const contentLength = getContentLength(headers)
  const contentType = getContentType(headers)
  let body: HttpResponseBody = null

  if (response.body) {
    const chunks: Uint8Array[] = []
    const reader = response.body.getReader()
    let receivedLength = 0

    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      chunks.push(value)
      receivedLength += value.length

      downloadProgress?.({
        lengthComputable: contentLength > 0,
        loaded: receivedLength,
        total: contentLength,
      })
    }

    const chunksAll = concatChunks(chunks, receivedLength)

    body = parseBody({
      request: httpRequest,
      content: chunksAll,
      contentType,
    })
  }

  return makeResponse({
    url,
    status,
    statusText,
    headers,
    body,
  })
}
