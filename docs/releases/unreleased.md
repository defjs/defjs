# Unreleased 0.4.x fix round

These notes describe the current repository source, not a published version. Packages remain independently versioned and tagged.

## `@defjs/core`

### User-visible fixes

- HTTP, SSE, and WebSocket require a valid absolute base endpoint and a relative definition path. Resolved paths keep the base origin and directory; C0 control characters (including tab, CR, and LF), backslashes, query/hash fragments, and directory escapes are rejected. Scheme-like and protocol-relative forms are rejected even with leading spaces; a plain inner space is allowed and sent as `%20`. Invalid URL configuration returns `REQ_BUILD_FAILED` before transport, including final interceptor rewrites, and is never retried. An interceptor may explicitly select another valid base. Deterministic URL errors from HTTP/SSE interceptor `next()` calls reject the returned promise, allowing `.then` / `.catch` recovery; unrecovered errors still report `REQ_BUILD_FAILED`.
- SSE and WebSocket retry budgets and backoff exponents apply per outage and reset after a successful handshake. `maxDelayMs` caps the final delay after jitter and rounding; zero bases stay zero and valid-number overflow is clamped instead of throwing. Invalid numeric reconnect options return `REQ_OPTIONS_INVALID` before transport. WebSocket `attempts: 0` disables retry immediately and ignores the unused fields; SSE still validates them.
- Default Struct messages say `received <kind>`, never the received value. JSON `SyntaxError` decode faults now say `Response body could not be decoded` instead of the JSON-specific wording. `String(fault)` and default `prettify()` omit received payloads; structural paths still include record keys, which may be sensitive. Raw values and parser details stay on the cause. Custom `errorMap` text is used verbatim, including `''`, and applies to bigint/date conversion failures from another Core copy.
- WebSocket `send` rejects values JSON cannot faithfully represent after struct encoding with `TypeError`, before sending or queueing. Heartbeat uses the same guard; serialization failures end the session. A throwing `binaryType` setter triggers best-effort socket closure before the attempt fails.
- Default HTTP/SSE Fetch is resolved on each call, so global replacements installed after import are used. Core can be imported without Fetch; default execution reports `ENV_UNSUPPORTED` if Fetch is still missing. Custom handles remain usable.
- Server-side FormData with `onUploadProgress` uses its serialized stream directly, preserves the multipart boundary, and sends no library-generated `Content-Length` (chunked over HTTP/1.1), so progress, timeout, and abort work without buffering the whole body. For targets that require `Content-Length`, such as some presigned uploads, omit `onUploadProgress`; platform Fetch then sends FormData with its length. Explicit `content-type` headers survive other upload conversions and interceptor body replacement. Compressed downloads report an unknown total (`lengthComputable: false`, `total: 0`). Worker XSRF injection respects `location.origin`.
- SSE sends Unicode `Last-Event-ID` as UTF-8 bytes. Its independently rewritten parser follows WHATWG SSE line and field rules, strips only one physical-stream-leading BOM, and preserves U+FEFF in values. The old parser and its `THIRD_PARTY_NOTICES.md` were removed from the current source; already published artifacts are unchanged.
- New public exports `isAbortCause` and `isTimeoutCause` recognize the cancellation sentinels' non-enumerable `Symbol.for` brands across Core copies and the supported platform error shapes. Response snapshots and transport-origin classification are isolated to each execution.

### HTTP Content-Type changes compared with `0.4.0-beta.1`

- HTTP no longer writes inferred Content-Type into request `headers`. The inferred type of the builder's body is carried by the plain `request.bodyContentType` field and survives `{ ...req }` copies.
- An explicit `content-type` header always wins over `bodyContentType` and detection, whether declared by the builder, client defaults, an interceptor, or a raw `fetchHandler` request, including upload progress conversions. FormData always uses its actual multipart boundary; `body: undefined` sends no library-inferred Content-Type.
- `bodyContentType` applies only while `body` is the builder's value. A replaced body is detected again, so an interceptor declares its replacement body's type with a `content-type` header.
- Signers should read `headers.get('content-type') ?? request.bodyContentType` to choose the declared header or the inferred builder-body type.

## `@defjs/opentelemetry-server`

- Caller cancellation stays excluded from Logs when the application and plugin use different Core copies. Timeouts continue to be logged.

## Repository verification

- CI runs the Bun verification gate, Core `core-server` and OpenTelemetry tests on Node 24, and a Deno 2 smoke test against the built Core bundle's HTTP, SSE, WebSocket, and Struct APIs. Deno coverage is a smoke check, not the complete Vitest suite or a packed-consumer check.
