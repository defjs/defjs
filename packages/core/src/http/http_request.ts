/**
 * Representation used to read an HTTP body before struct validation.
 *
 * Chosen from the declared struct kind: `string` is `text`, `blob` and `file`
 * are `blob`, `arrayBuffer` is `arraybuffer` (bytes), and every other kind is
 * `json`. Not a field on `defineRequest`. It appears on `HttpRequest` as
 * `responseType` and `errorResponseType`.
 *
 * @group http
 */
export type HttpResponseType = "arraybuffer" | "blob" | "json" | "text";

/**
 * Progress snapshot passed to upload and download callbacks.
 *
 * Mirrors the `ProgressEvent` fields `loaded`, `total`, and `lengthComputable`.
 * `loaded` counts bytes read from the upload or download stream, not bytes
 * acknowledged by the server. Download bytes may already be decompressed.
 * Unknown lengths use `total: 0` and `lengthComputable: false`. A download total
 * is computable only with a positive `Content-Length` and an absent or
 * `identity` `Content-Encoding`; compressed downloads, other encoded responses,
 * and bytes exceeding `Content-Length` have an unknown decoded length. A
 * streamed upload also has an unknown total unless a valid explicit
 * `Content-Length` supplies it.
 *
 * @group http
 */
export interface HttpProgressEvent {
  readonly lengthComputable: boolean;
  readonly loaded: number;
  readonly total: number;
}

/**
 * Callback invoked as request bytes are uploaded or response bytes are downloaded.
 *
 * Passed as `onDownloadProgress` or `onUploadProgress` in `HttpExecuteOptions`.
 * Callbacks may be async and are awaited before the next chunk is processed. A
 * callback that throws or rejects fails the call with `EXT_OBSERVER_FAILED`,
 * with the thrown value as `cause`, for downloads and uploads alike. Caller
 * cancellation still takes precedence and reports `NET_ABORTED`, or `NET_TIMEOUT`
 * when the abort reason is a timeout.
 *
 * `onUploadProgress` reports progress only when the request body is a
 * `ReadableStream` that the caller passes. Any other body (`Blob`, `File`,
 * `ArrayBuffer`, `FormData`, a string, or `URLSearchParams`) is sent as built and
 * `onUploadProgress` is not called, on every runtime. The library never converts
 * a body into a stream. Download progress is unaffected.
 *
 * A `ReadableStream` request body follows the Fetch rules for streaming request
 * bodies, with or without `onUploadProgress`:
 *
 * - Chromium and WebKit accept a streaming request body only over HTTP/2 or
 *   later, so the call fails with `NET_UNREACHABLE` on HTTP/1.1, with a
 *   runtime-specific `TypeError` as `cause`. WebKit was checked manually at 27.2
 *   only; this repository does not test it. Node.js and Bun accept HTTP/1.1,
 *   which departs from the Fetch standard.
 * - Firefox cannot stream request bodies, so the call fails with
 *   `ENV_UNSUPPORTED`.
 * - In browsers, a cross-origin request needs a CORS preflight, unless the
 *   browser holds a cached preflight result, and fails unless the server
 *   answers `OPTIONS`. A same-origin request is not preflighted.
 * - A 301, 302, 307, or 308 redirect fails after the body was sent once. A 303
 *   redirect becomes a GET and succeeds.
 *
 * `fetch` gives the same network error for each of these as for an unreachable
 * endpoint, and for a source `ReadableStream` that throws while `fetch` reads
 * it, so the error does not reliably show the endpoint is down. The load
 * balancer therefore receives `{ attempted: false }` for it, as it does for a
 * throwing progress callback (`EXT_OBSERVER_FAILED`). A healthy endpoint is not
 * ejected for these failures, but a down endpoint is not detected by streamed
 * uploads alone, and a rejected streamed upload is never retried: a
 * `ReadableStream` body ends the retry flow before `shouldRetry` is asked.
 *
 * A streamed body has no known length, so the reported `total` is `0` and
 * `lengthComputable` is `false` unless the request carries a valid
 * `Content-Length` header. That header only sets the reported total, since
 * browsers do not send it. Non-identity encoded downloads also report
 * `total: 0` and `lengthComputable: false`, since `loaded` counts decoded
 * stream bytes. Cancellation releases the wrapped upload stream.
 *
 * @group http
 */
export type HttpProgressFn = (event: HttpProgressEvent) => Promise<void> | void;

/**
 * Normalized outgoing HTTP request seen by transports, handlers, interceptors, and `fetchHandler` after the builder runs.
 *
 * `body` is already the wire value. For JSON that is a **JSON text string**;
 * sign HMAC or digests against that string (or other final bytes), not the
 * original struct input.
 *
 * - `bodyContentType` holds the inferred type of the builder's body. `null` suppresses that header. FormData owns its multipart boundary. HTTP inference follows a direct write to `body` and is not copied by object spread; an explicit `bodyContentType` assignment is copied. A replacement body is detected again, so declare its type with a `content-type` header. For the unchanged body, `null` suppresses library inference when there is no explicit header, but native Fetch may add its own string type.
 * - HTTP never writes inferred Content-Type into `headers`; interceptors see only declared headers. An explicit `content-type` header always wins over `bodyContentType` and detection, whether set by the builder, client defaults, an interceptor, or a raw `fetchHandler` request. `body: undefined` has no library-inferred Content-Type. Signers should read `headers.get('content-type') ?? request.bodyContentType`; do not configure internal fields.
 * - `endpoint` is the path with path parameters filled in; `baseEndpoint` is the endpoint selected for this call.
 * - `query` is the one query the request sends. Interceptors change it in place or pass a replacement to `next()`. A builder that returns `URLSearchParams` has it copied, and a `QuerySerializer` string is parsed into it.
 * - `operation` is a static, low-cardinality endpoint identity for telemetry and diagnostics.
 * - `downloadProgress` and `uploadProgress` are the `onDownloadProgress` and `onUploadProgress` hooks of `HttpExecuteOptions`.
 * - `responseType` and `errorResponseType` are readonly: they are derived from the endpoint's `output` and `error` struct kinds and must not be changed. Each is set only when its struct is declared. An interceptor that short-circuits with `makeResponse` reads them to match the transport.
 *
 * @group http
 */
export interface HttpRequest {
  signal?: AbortSignal;
  /** Endpoint selected for this call; its origin and directory bound the resolved path. */
  baseEndpoint?: string;
  body?:
    | Blob
    | ArrayBuffer
    | FormData
    | URLSearchParams
    | ReadableStream<Uint8Array>
    | object
    | string
    | number
    | boolean
    | null;
  /**
   * Current body media type; null suppresses the header. FormData owns its boundary.
   * HTTP inference follows direct body mutations and is not copied by object spread; explicit assignments are copied.
   */
  bodyContentType?: string | null;
  /** @internal Tracks which body value produced bodyContentType so interceptors cannot leave stale metadata behind. */
  bodyContentTypeSource?: unknown;
  downloadProgress?: HttpProgressFn;
  /** Relative path validated after building and again when an interceptor calls the transport. */
  endpoint: string;
  /** HTTP interceptors see declared headers; detected Content-Type is applied at the Fetch boundary. */
  headers?: Headers;
  method: string;
  /** Static, low-cardinality endpoint identity for telemetry and diagnostics. */
  operation?: string;
  /** The query the request sends. Its wire form is `query.toString()`, the URL Standard's application/x-www-form-urlencoded serialization, so a space is `+`. An empty query adds no `?`. */
  query?: URLSearchParams;
  /**
   * Representation for a 2xx body, derived from the endpoint `output` struct kind.
   * Set only when `output` is declared. Interceptors that short-circuit with `makeResponse`
   * read this to match the transport. Must not be changed. `undefined` leaves the 2xx body unread.
   */
  readonly responseType?: HttpResponseType;
  /**
   * Representation for a non-2xx body, derived from the endpoint `error` struct kind.
   * Set only when `error` is declared. Must not be changed. `undefined` leaves the non-2xx body
   * unread and does not fall back to `responseType`.
   */
  readonly errorResponseType?: HttpResponseType;
  uploadProgress?: HttpProgressFn;
  withCredentials?: boolean;
  /**
   * Called once per HTTP attempt. The hook receives the outgoing headers after interceptors and before the default `Accept` is filled in, plus the resolved URL.
   * A throw fails the call with `EXT_HOOK_FAILED`, with the thrown value as `cause`. It is not an endpoint attempt and is not retried.
   */
  finalizeHeaders?: (request: HttpRequest, headers: Headers, url: URL) => void;
}
