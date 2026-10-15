/**
 * How the HTTP response body should be parsed before struct validation.
 * Chosen from the declared struct kind: string is text, blob and file are blobs,
 * arrayBuffer is bytes, and every other kind is JSON.
 */
export type HttpResponseType = 'arraybuffer' | 'blob' | 'json' | 'text'

/**
 * Progress snapshot for upload or download callbacks.
 * Mirrors the familiar `ProgressEvent` shape (`loaded` / `total` / `lengthComputable`).
 * `loaded` counts streamed bytes. Unknown lengths use `total: 0` and `lengthComputable: false`.
 * FormData uploads have no computed length; encoded responses or bytes exceeding Content-Length have an unknown decoded length.
 */
export interface HttpProgressEvent {
  readonly lengthComputable: boolean
  readonly loaded: number
  readonly total: number
}

/**
 * Callback invoked as request bytes are uploaded or response bytes are downloaded.
 *
 * A callback that throws or rejects fails the call with `EXT_OBSERVER_FAILED`.
 * Cancellation and timeout still win.
 * Upload progress for a Blob, File, ArrayBuffer, or FormData body is reported only where the runtime can
 * stream request bodies (Bun, Node, Deno); in browsers that body is sent unchanged and the callback is not called.
 * A caller-supplied ReadableStream still reports progress wherever the runtime accepts it. Download progress is unaffected.
 */
export type HttpProgressFn = (event: HttpProgressEvent) => Promise<void> | void

/**
 * Normalized outgoing HTTP request used by handlers, interceptors, and `fetchHandler`.
 *
 * After the request builder runs, `body` is already the wire value — for JSON that means a
 * **JSON text string**. Sign HMAC / digests against that string (or other final bytes), not the
 * original struct input.
 */
export interface HttpRequest {
  abort?: AbortSignal
  /** Trusted absolute base; its origin and directory bound the resolved endpoint path. */
  baseEndpoint?: string
  body?: Blob | ArrayBuffer | FormData | URLSearchParams | ReadableStream<Uint8Array> | object | string | number | boolean | null
  /**
   * Current body media type; null suppresses the header. FormData owns its boundary.
   * HTTP inference follows direct body mutations and is not copied by object spread; explicit assignments are copied.
   */
  bodyContentType?: string | null
  /** @internal Tracks which body value produced bodyContentType so interceptors cannot leave stale metadata behind. */
  bodyContentTypeSource?: unknown
  downloadProgress?: HttpProgressFn
  /** Relative path validated after building and again when an interceptor calls the transport. */
  endpoint: string
  /** HTTP interceptors see declared headers; detected Content-Type is applied at the Fetch boundary. */
  headers?: Headers
  method: string
  /** Static, low-cardinality endpoint identity for telemetry and diagnostics. */
  operation?: string
  queryParams?: URLSearchParams
  queryString?: string
  /**
   * Representation for a 2xx body, derived from the endpoint `output` struct kind.
   * Set only when `output` is declared. Interceptors that short-circuit with `makeResponse`
   * read this to match the transport. Must not be changed. `undefined` leaves the 2xx body unread.
   */
  readonly responseType?: HttpResponseType
  /**
   * Representation for a non-2xx body, derived from the endpoint `error` struct kind.
   * Set only when `error` is declared. Must not be changed. `undefined` leaves the non-2xx body
   * unread and does not fall back to `responseType`.
   */
  readonly errorResponseType?: HttpResponseType
  timeout?: number
  uploadProgress?: HttpProgressFn
  withCredentials?: boolean
  xsrf?: {
    cookieName: string
    headerName: string
    tokenProvider?: (context: { request: HttpRequest }) => string | null | undefined
  }
}
