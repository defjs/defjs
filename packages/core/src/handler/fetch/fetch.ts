import { __concatChunks, __getContentLength, __getContentType, __parseBody } from '@src/handler/util'
import { type HttpRequest, __detectContentTypeHeader, __serializeBody } from '@src/request'
import { ERR_ABORTED, ERR_TIMEOUT, type HttpResponse, type HttpResponseBody, __makeResponse } from '@src/response'

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

  return new Request(url, {
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
  const abortSignal = httpRequest.abort
  let response: Response

  try {
    response = await globalThis.fetch(request)
  } catch (error) {
    // Because Safari throws an AbortError instead of a TimeoutError when using AbortSignal.timeout.
    // So when handling an `AbortError`, one needs to determine whether the reason for the abort is a `TimeoutError` or another `AbortError`.
    if (abortSignal?.aborted && abortSignal.reason instanceof Error) {
      switch (true) {
        case abortSignal.reason.name === 'AbortError':
          return __makeResponse({ error: ERR_ABORTED })
        case abortSignal.reason.name === 'TimeoutError':
          return __makeResponse({ error: ERR_TIMEOUT })
      }
    }

    return __makeResponse({ error })
  }

  const { headers, status, statusText, url } = response
  const contentLength = __getContentLength(headers)
  const contentType = __getContentType(headers)
  let body: HttpResponseBody = null

  /* istanbul ignore if -- @preserve */
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

    const chunksAll = __concatChunks(chunks, receivedLength)

    try {
      body = __parseBody({
        request: httpRequest,
        content: chunksAll,
        contentType,
      })
    } catch (error) {
      return __makeResponse({
        error,
        status,
        statusText,
        headers,
        url,
      })
    }
  }

  return __makeResponse({
    status,
    statusText,
    headers,
    url,
    body,
  })
}
