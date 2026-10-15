import type { FetchHandle } from '../../client/config'
import { DEFAULT_FETCH, PLATFORM_FETCH_HANDLE, resolveGlobalFetch } from '../../client/config'
import { awaitWithSignal, resolveAbortCause } from '../../internal/abort'
import { fetchWithSignal } from '../../internal/fetch'
import type { HttpProgressFn, HttpRequest } from '../../internal/http_request'
import type { HttpMeta, HttpResponse } from '../../internal/http_response'
import { makeResponse } from '../../internal/http_response'
import { resolveRequestUrl } from '../../internal/url'
import { applyRequestContentType } from './body'
import { BodyFailure, isBodyFailure } from './body_failure'
import {
  __resetStreamingRequestBodySupportForTests,
  createFetchInitBase,
  ERR_STREAMING_REQUEST_UNSUPPORTED,
  isReadableStreamBody,
  supportsStreamingRequestBody,
} from './fetch_init'
import { concatChunks, getContentLength, getContentType, isJsonMediaType, parseBytesBody } from './utils'

export { __resetStreamingRequestBodySupportForTests, ERR_STREAMING_REQUEST_UNSUPPORTED, isReadableStreamBody, supportsStreamingRequestBody }

const XSRF_SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE'])

function isSafeMethod(method: string): boolean {
  return XSRF_SAFE_METHODS.has(method.toUpperCase())
}

function readBrowserXSRFCookie(name: string): string | undefined {
  try {
    const cookie = document.cookie
    if (cookie === '') {
      return undefined
    }

    for (const part of cookie.split(';')) {
      const [rawName, ...rawValue] = part.trim().split('=')
      if (rawName === name) {
        return decodeURIComponent(rawValue.join('='))
      }
    }
  } catch {
    return undefined
  }

  return undefined
}

function isSameOriginRequest(request: HttpRequest): boolean {
  if (!request.baseEndpoint) {
    return false
  }

  if (typeof location === 'undefined') {
    return true
  }

  return resolveRequestUrl(request).origin === location.origin
}

function normalizeXSRFToken(token: string | null | undefined): string | undefined {
  if (typeof token !== 'string' || token === '') {
    return undefined
  }

  return token
}

function resolveXSRFToken(
  request: HttpRequest,
  xsrf: {
    cookieName: string
    headerName: string
    tokenProvider?: (context: { request: HttpRequest }) => string | null | undefined
  },
): string | undefined {
  if (xsrf.tokenProvider) {
    return normalizeXSRFToken(xsrf.tokenProvider({ request }))
  }

  if (typeof document === 'undefined') {
    return undefined
  }

  return normalizeXSRFToken(readBrowserXSRFCookie(xsrf.cookieName))
}

function applyXSRFHeaderIfNeeded(request: HttpRequest, headers: Headers): void {
  const xsrf = request.xsrf
  if (!xsrf) {
    return
  }

  if (isSafeMethod(request.method)) {
    return
  }

  if (headers.has(xsrf.headerName)) {
    return
  }

  if (!isSameOriginRequest(request)) {
    return
  }

  const token = resolveXSRFToken(request, xsrf)
  if (token === undefined) {
    return
  }

  headers.set(xsrf.headerName, token)
}

function wrapUploadProgressStream(
  stream: ReadableStream<Uint8Array>,
  onProgress: HttpProgressFn,
  total: number,
  signal: AbortSignal | undefined,
): ReadableStream<Uint8Array> {
  const reader = stream.getReader()
  let cleanedUp = false
  let loaded = 0
  const onAbort = () => cleanup(true, signal?.reason)

  function cleanup(cancel: boolean, reason?: unknown): void {
    if (cleanedUp) {
      return
    }

    cleanedUp = true
    signal?.removeEventListener('abort', onAbort)
    try {
      if (cancel) {
        void reader.cancel(reason).catch(() => undefined)
      }
    } finally {
      reader.releaseLock()
    }
  }

  const wrapped = new ReadableStream<Uint8Array>({
    cancel(reason) {
      cleanup(true, reason)
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read()

        if (cleanedUp) {
          return
        }

        if (done) {
          cleanup(false)
          controller.close()
          return
        }

        loaded += value.byteLength
        const event = { lengthComputable: total > 0, loaded, total }
        await (signal ? awaitWithSignal(() => onProgress(event), signal) : onProgress(event))
        if (cleanedUp) {
          return
        }
        controller.enqueue(value)
      } catch (error) {
        cleanup(true, error)
        controller.error(error)
      }
    },
  })

  if (signal) {
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
    }
  }

  return wrapped
}

function cancelWrappedUploadBody(request: HttpRequest, body: unknown, reason: unknown): void {
  if (request.uploadProgress && isReadableStreamBody(request.body) && isReadableStreamBody(body)) {
    void body.cancel(reason).catch(() => undefined)
  }
}

function cancelLateResponseBody(body: ReadableStream<Uint8Array>, signal: AbortSignal): void {
  void body.cancel(signal.reason).catch(() => undefined)
}

export function createFetchRequestInit(request: HttpRequest): RequestInit & { duplex?: 'half' } {
  const headers = new Headers(request.headers)
  const uploadProgress = request.uploadProgress
  applyRequestContentType(request, headers)
  applyXSRFHeaderIfNeeded(request, headers)

  return createFetchInitBase(request, {
    defaultAccept: 'application/json, text/plain, */*',
    headers,
    signal: request.abort,
    wrapReadableStreamBody: uploadProgress
      ? (body) => wrapUploadProgressStream(body, uploadProgress, getContentLength(headers), request.abort)
      : undefined,
  })
}

export function createFetchRequest(request: HttpRequest): Request {
  const url = resolveRequestUrl(request)
  const init = createFetchRequestInit(request)

  try {
    return new Request(url, init)
  } catch (error) {
    cancelWrappedUploadBody(request, init.body, error)
    throw error
  }
}

/** Release a body we will not read, ignoring a cancellation the provider refuses. */
function discardBody(body: ReadableStream<Uint8Array>): void {
  void body.cancel().catch(() => undefined)
}

/**
 * Reads a whole body in one call. Only for a response that the platform fetch returned for `signal`: the fetch spec binds that
 * body to the signal, so an abort errors the stream and frees the connection, and the race only makes this call settle promptly.
 */
async function readWholeBody(response: Response, signal: AbortSignal | undefined, meta: HttpMeta): Promise<Uint8Array> {
  try {
    return new Uint8Array(await (signal ? awaitWithSignal(() => response.arrayBuffer(), signal) : response.arrayBuffer()))
  } catch (error) {
    // Cancellation outranks body classification, and `fetchHandler` turns it into an abort result.
    if (signal?.aborted) {
      throw error
    }
    throw new BodyFailure('NET_BODY_INCOMPLETE', error, meta)
  }
}

/** @param platform - `response` came straight from the platform fetch called with the request signal. */
async function parseFetchResponse(
  httpRequest: HttpRequest,
  response: Response,
  fallbackUrl: string,
  platform: boolean,
): Promise<HttpResponse<unknown>> {
  const downloadProgress = httpRequest.downloadProgress
  const { headers, status, statusText } = response
  const url = response.url || fallbackUrl
  // 2xx uses responseType; every other status uses errorResponseType.
  // Either one being unset means that side was not declared, so the body is cancelled unread.
  const responseType = status >= 200 && status < 300 ? httpRequest.responseType : httpRequest.errorResponseType

  if (response.body && responseType === undefined) {
    discardBody(response.body)
    return makeResponse({ status, statusText, headers, url })
  }

  const contentEncoding = headers.get('Content-Encoding')?.trim().toLowerCase()
  let contentLength = contentEncoding !== undefined && contentEncoding !== 'identity' ? 0 : getContentLength(headers)
  const contentType = getContentType(headers)
  const meta: HttpMeta = { headers, ok: status >= 200 && status < 300, status, statusText, url }
  // No stream is an absent body. A parsed JSON null stays null.
  let body: unknown = undefined

  // Philosophy 3: the declared representation is part of the assertion. Checking it before the
  // body is read turns "I asked for JSON and got HTML" into one precise fault, and skips the
  // read, the parse, and the struct entirely.
  if (response.body && responseType === 'json' && !isJsonMediaType(contentType)) {
    discardBody(response.body)
    const cause = new TypeError(`Expected a JSON media type, received ${contentType || '<none>'}`)
    throw new BodyFailure('RES_MEDIA_TYPE_INVALID', cause, meta)
  }

  // Progress needs the chunks, so only an unobserved read takes the bulk path.
  if (response.body && platform && !downloadProgress) {
    const bytes = await readWholeBody(response, httpRequest.abort, meta)
    try {
      body = parseBytesBody(responseType, bytes, contentType)
    } catch (error) {
      throw new BodyFailure('RES_DECODE_FAILED', error, meta)
    }
  } else if (response.body) {
    const chunks: Uint8Array[] = []
    const reader = response.body.getReader()
    const signal = httpRequest.abort
    // One listener covers every read: cancelling settles a pending read as done, and the loop then
    // reports the abort. Racing each read would add a listener and three promises per chunk.
    const cancelRead = () => void reader.cancel(signal?.reason).catch(() => undefined)
    signal?.addEventListener('abort', cancelRead, { once: true })
    let receivedLength = 0

    try {
      while (true) {
        signal?.throwIfAborted()
        const result = await reader.read()
        signal?.throwIfAborted()
        if (result.done) {
          break
        }

        chunks.push(result.value)
        receivedLength += result.value.byteLength
        if (receivedLength > contentLength) {
          contentLength = 0
        }

        if (downloadProgress) {
          const event = { lengthComputable: contentLength > 0, loaded: receivedLength, total: contentLength }
          try {
            await (signal ? awaitWithSignal(() => downloadProgress(event), signal) : downloadProgress(event))
          } catch (error) {
            throw new BodyFailure('EXT_OBSERVER_FAILED', error, meta)
          }
        }
      }
    } catch (error) {
      // The stream is cancelled with the original reason; the tag is ours, not its concern.
      void reader.cancel(isBodyFailure(error) ? error.cause : error).catch(() => undefined)
      // Cancellation outranks body classification, and `fetchHandler` turns it into an abort result.
      if (signal?.aborted) {
        throw error
      }
      throw isBodyFailure(error) ? error : new BodyFailure('NET_BODY_INCOMPLETE', error, meta)
    } finally {
      signal?.removeEventListener('abort', cancelRead)
      reader.releaseLock()
    }

    try {
      body = parseBytesBody(responseType, concatChunks(chunks, receivedLength), contentType)
    } catch (error) {
      throw new BodyFailure('RES_DECODE_FAILED', error, meta)
    }
  }

  return makeResponse({
    status,
    statusText,
    headers,
    url,
    body,
  })
}

/**
 * Default HTTP transport: perform `httpRequest` with `fetch` and return an `HttpResponse`.
 * The client always uses it; `withHTTPHandle` only supplies the `fetchImpl` it calls. Also usable in tests and custom handlers.
 *
 * @param httpRequest - Normalized request (URL, headers, body, abort, progress hooks).
 * @param fetchImpl - Fetch implementation; defaults to global `fetch`. The library default handle is called as
 *   `(url, init)` while the global is untouched, and its body is read in one piece unless download progress is observed. Any other handle receives a
 *   `Request` and its body is read chunk by chunk.
 * @returns Parsed `HttpResponse`. Rejects when no response reached the client, when reading the body
 *   failed, or when an upload observer threw (`EXT_OBSERVER_FAILED`). Cancellation still wins.
 */
export async function fetchHandler(
  httpRequest: HttpRequest,
  fetchImpl: FetchHandle = resolveGlobalFetch(),
): Promise<HttpResponse<unknown>> {
  if (fetchImpl === DEFAULT_FETCH) {
    fetchImpl = resolveGlobalFetch()
  }
  const uploadProgress = httpRequest.uploadProgress
  if (!uploadProgress) {
    return sendFetchRequest(httpRequest, fetchImpl)
  }

  let observerFailure: BodyFailure<'EXT_OBSERVER_FAILED'> | undefined
  const observed: HttpRequest = {
    ...httpRequest,
    uploadProgress: async (event) => {
      try {
        await uploadProgress(event)
      } catch (error) {
        observerFailure ??= new BodyFailure('EXT_OBSERVER_FAILED', error, undefined)
        throw error
      }
    },
  }

  let response: HttpResponse<unknown>
  try {
    response = await sendFetchRequest(observed, fetchImpl)
  } catch (error) {
    // sendFetchRequest already turned cancellation into the abort cause, and cancellation outranks the observer.
    throw observerFailure !== undefined && !httpRequest.abort?.aborted ? observerFailure : error
  }
  // A handle can swallow the errored upload body and still answer, or the observer can fail while the response is read.
  if (observerFailure !== undefined) {
    throw observerFailure
  }
  return response
}

async function sendFetchRequest(httpRequest: HttpRequest, fetchImpl: FetchHandle): Promise<HttpResponse<unknown>> {
  const abortSignal = httpRequest.abort
  const platform = fetchImpl === PLATFORM_FETCH_HANDLE
  let prepared = httpRequest
  let request: Request | undefined
  let platformBody: RequestInit['body']
  let fallbackUrl = ''
  let response: Response

  try {
    prepared = await prepareUploadProgressRequest(httpRequest)
    if (platform) {
      // fetch(url, init) builds the Request itself, so building one here would only do that work twice.
      const url = resolveRequestUrl(prepared)
      const init = createFetchRequestInit(prepared)
      platformBody = init.body
      fallbackUrl = url.href
      response = await fetchWithSignal(() => fetchImpl(url, init), abortSignal, cancelLateResponseBody)
    } else {
      const built = createFetchRequest(prepared)
      request = built
      fallbackUrl = built.url
      response = await fetchWithSignal(() => fetchImpl(built), abortSignal, cancelLateResponseBody)
    }
  } catch (error) {
    cancelWrappedUploadBody(prepared, request?.body ?? platformBody, error)
    throw (abortSignal && resolveAbortCause(abortSignal)) ?? error
  }

  try {
    return await parseFetchResponse(httpRequest, response, fallbackUrl, platform)
  } catch (error) {
    throw (abortSignal && resolveAbortCause(abortSignal)) ?? error
  }
}

function isBrowserWindowOrWorker(): boolean {
  return typeof location !== 'undefined' || typeof document !== 'undefined' || 'importScripts' in globalThis
}

/**
 * Turns Blob/File, ArrayBuffer, and FormData into a stream to count bytes, only where the runtime streams
 * request bodies over any HTTP version (Bun, Node, Deno). Browsers are excluded: Chromium rejects a streamed
 * body on HTTP/1.1 and the protocol is unknown beforehand, and Firefox cannot stream request bodies.
 * `location`, `document`, or `importScripts` mark browser windows/workers: there the body is sent unchanged
 * and `onUploadProgress` is not called. Download progress is unaffected.
 * FormData uses the serialized stream and boundary directly; its total length is unknown unless declared in a header.
 */
async function prepareUploadProgressRequest(request: HttpRequest): Promise<HttpRequest> {
  const { uploadProgress, body } = request
  if (!uploadProgress || body == null || isReadableStreamBody(body) || !supportsStreamingRequestBody() || isBrowserWindowOrWorker()) {
    return request
  }

  request.abort?.throwIfAborted()
  const converted = convertBodyToUploadStream(body)
  if (!converted) {
    return request
  }

  const headers = new Headers(request.headers)
  applyRequestContentType(request, headers)
  if (converted.contentType && (body instanceof FormData || (!headers.has('Content-Type') && request.bodyContentType !== null))) {
    headers.set('Content-Type', converted.contentType)
  }
  if (converted.total > 0) {
    headers.set('Content-Length', String(converted.total))
  }

  const total = getContentLength(headers)
  const startEvent = { lengthComputable: total > 0, loaded: 0, total }
  try {
    if (request.abort) {
      await awaitWithSignal(() => uploadProgress(startEvent), request.abort)
    } else {
      await uploadProgress(startEvent)
    }
  } catch (error) {
    void converted.stream.cancel(error).catch(() => undefined)
    throw error
  }

  return {
    ...request,
    body: converted.stream,
    bodyContentType: headers.get('Content-Type'),
    bodyContentTypeSource: converted.stream,
    headers,
  }
}

function convertBodyToUploadStream(
  body: HttpRequest['body'],
): { contentType?: string | null; stream: ReadableStream<Uint8Array>; total: number } | undefined {
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return { contentType: body.type || undefined, stream: body.stream(), total: body.size }
  }

  if (body instanceof ArrayBuffer) {
    return {
      contentType: 'application/octet-stream',
      stream: new Blob([body]).stream(),
      total: body.byteLength,
    }
  }

  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const serialized = new Response(body)
    const contentType = serialized.headers.get('Content-Type')
    return { contentType, stream: serialized.body as ReadableStream<Uint8Array>, total: 0 }
  }

  return undefined
}
