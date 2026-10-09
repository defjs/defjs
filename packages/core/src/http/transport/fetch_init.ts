import type { HttpRequest } from '../../internal/http_request'
import { isReadableStream } from '../../internal/type_guards'
import { serializeHttpBody } from './body'

export const ERR_STREAMING_REQUEST_UNSUPPORTED = new Error('ERR_STREAMING_REQUEST_UNSUPPORTED')

export function isReadableStreamBody(body: HttpRequest['body'] | unknown): body is ReadableStream<Uint8Array> {
  return isReadableStream(body)
}

let streamingRequestBodySupport: boolean | undefined

export function supportsStreamingRequestBody(): boolean {
  if (streamingRequestBodySupport !== undefined) {
    return streamingRequestBodySupport
  }

  if (typeof Request !== 'function' || typeof ReadableStream === 'undefined') {
    streamingRequestBodySupport = false
    return streamingRequestBodySupport
  }

  try {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close()
      },
    })
    const request = new Request('https://example.com', {
      body: stream,
      duplex: 'half',
      method: 'POST',
    } as RequestInit & { duplex?: 'half' })

    streamingRequestBodySupport = request.body !== null
    return streamingRequestBodySupport
  } catch {
    streamingRequestBodySupport = false
    return streamingRequestBodySupport
  }
}

export function __resetStreamingRequestBodySupportForTests(): void {
  streamingRequestBodySupport = undefined
}

export function createFetchInitBase(
  request: HttpRequest,
  options: {
    defaultAccept: string
    headers: Headers
    signal?: AbortSignal
    streamingRequestUnsupportedError: unknown
    wrapReadableStreamBody?: (body: ReadableStream<Uint8Array>) => ReadableStream<Uint8Array>
  },
): RequestInit & { duplex?: 'half' } {
  const { headers } = options
  if (!headers.has('Accept')) {
    headers.set('Accept', options.defaultAccept)
  }

  const credentials: RequestCredentials | undefined = request.withCredentials ? 'include' : undefined
  let body = serializeHttpBody(request.body)
  const init: RequestInit & { duplex?: 'half' } = {
    body,
    credentials,
    headers,
    method: request.method,
    signal: options.signal,
  }

  if (isReadableStreamBody(body)) {
    if (!supportsStreamingRequestBody()) {
      throw options.streamingRequestUnsupportedError
    }

    body = options.wrapReadableStreamBody?.(body) ?? body
    init.body = body
    init.duplex = 'half'
  }

  return init
}
