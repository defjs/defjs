# Unreleased 0.4.x fix round

These notes describe the current repository source, not a published version. Packages remain independently versioned and tagged.

## `@defjs/core`

### User-visible fixes

- HTTP, SSE, and WebSocket require a valid absolute base endpoint and a relative definition path. Resolved paths keep the base origin and directory; C0 control characters (including tab, CR, and LF), backslashes, query/hash fragments, and directory escapes are rejected. Scheme-like and protocol-relative forms are rejected even with leading spaces; a plain inner space is allowed and sent as `%20`. Invalid URL configuration returns `REQ_BUILD_FAILED` before transport, including final interceptor rewrites, and is never retried. An interceptor may explicitly select another valid base. Deterministic URL errors from HTTP/SSE interceptor `next()` calls reject the returned promise, allowing `.then` / `.catch` recovery; unrecovered errors still report `REQ_BUILD_FAILED`.
- SSE and WebSocket retry budgets and backoff exponents apply per outage and reset after a successful handshake. `maxDelayMs` caps the final delay after jitter and rounding; `Infinity` removes that configured cap, but the platform limit of `2_147_483_647` ms still applies. Zero bases stay zero and valid-number overflow is clamped instead of throwing. Both transports validate explicit numeric reconnect options before transport, including when `attempts: 0` disables subsequent retries; invalid values return `REQ_OPTIONS_INVALID`.
- Default Struct messages say `received <kind>`, never the received value. JSON `SyntaxError` decode faults now say `Response body could not be decoded` instead of the JSON-specific wording. `String(fault)` and default `prettify()` omit received payloads; structural paths still include record keys, which may be sensitive. Raw values and parser details stay on the cause. Custom `errorMap` text is used verbatim, including `''`, and applies to bigint/date conversion failures from another Core copy.
- WebSocket `send` rejects values JSON cannot faithfully represent after struct encoding with `TypeError`, before sending or queueing. Heartbeat uses the same guard; serialization failures end the session. A throwing `binaryType` setter triggers best-effort socket closure before the attempt fails.
- Default HTTP/SSE Fetch is resolved on each call, so global replacements installed after import are used. Core can be imported without Fetch; default execution reports `ENV_UNSUPPORTED` if Fetch is still missing. Custom handles remain usable.
- Server-side FormData with `onUploadProgress` uses its serialized stream directly, preserves the multipart boundary, and sends no library-generated `Content-Length` (chunked over HTTP/1.1), so progress, timeout, and abort work without buffering the whole body. For targets that require `Content-Length`, such as some presigned uploads, omit `onUploadProgress`; platform Fetch then sends FormData with its length. Explicit `content-type` headers survive other upload conversions and interceptor body replacement. Compressed downloads report an unknown total (`lengthComputable: false`, `total: 0`). Worker XSRF injection respects `location.origin`.
- SSE sends Unicode `Last-Event-ID` as UTF-8 bytes. Its independently rewritten parser follows WHATWG SSE line and field rules, strips only one physical-stream-leading BOM, and preserves U+FEFF in values. The old parser and its `THIRD_PARTY_NOTICES.md` were removed from the current source; already published artifacts are unchanged.
- New public exports `isAbortCause` and `isTimeoutCause` recognize the cancellation sentinels' non-enumerable `Symbol.for` brands across Core copies and the supported platform error shapes. Response snapshots and transport-origin classification are isolated to each execution.

### Final closeout fixes

- HTTP and SSE command headers override matching client defaults consistently for `Headers`, scalar records, array-valued records, and tuple lists. Repeated command values retain their order; unrelated defaults remain intact.
- Endpoint input parsing treats thenables as data rather than awaiting them. HTTP, SSE, and WebSocket builders receive the parsed input without Promise assimilation, and cancellation and timeout remain effective. HTTP also preserves timeout priority when synchronous interceptor or Fetch work exceeds the deadline before throwing.
- Intersection parsing retains the union branch that actually parsed successfully, including date and bigint conversions, without reading later branches again. Outbound guides no longer mutate borrowed opaque input objects, so frozen and non-extensible inputs remain valid. Shallow-spreading a borrowed opaque value creates a fresh anonymous container: request-local provenance does not follow the copy, so tagged children use the usual anonymous-container encoding rules. The omission sentinel is private to each Core instance and cannot collide with ordinary registered-symbol field values.
- Native WebSocket sessions and wrappers forwarding the same live `connection` keep the first successful connection in the execute tuple. Wrappers that transform `connection` retain their public metadata instead; sharing `closed` does not bypass that transformation. Cancellation during injected socket listener registration also removes listeners installed after synchronous cleanup.

### HTTP Content-Type changes compared with `0.4.0-beta.1`

- HTTP no longer writes inferred Content-Type into request `headers`. The inferred type of the builder's body is carried by the plain `request.bodyContentType` field and survives `{ ...req }` copies.
- An explicit `content-type` header always wins over `bodyContentType` and detection, whether declared by the builder, client defaults, an interceptor, or a raw `fetchHandler` request, including upload progress conversions. FormData always uses its actual multipart boundary; `body: undefined` sends no library-inferred Content-Type.
- `bodyContentType` applies only while `body` is the builder's value. A replaced body is detected again, so an interceptor declares its replacement body's type with a `content-type` header.
- Signers should read `headers.get('content-type') ?? request.bodyContentType` to choose the declared header or the inferred builder-body type.

## `@defjs/opentelemetry-server`

- Caller cancellation stays excluded from Logs when the application and plugin use different Core copies. Timeouts continue to be logged.

## Repository verification

- CI runs the Bun verification gate and Core `core-server` and OpenTelemetry tests on Node 24.
- Browser API fixtures keep each setup's server cleanup separate. Documentation browser helpers clean up after the Bun test watchdog and close a late-starting browser without running the expired test body.
- Long documentation titles wrap on narrow screens, including API symbols and Markdown headings; Chromium and Firefox regressions cover 320 px and 375 px viewports.

## `@defjs/react`

- `useClient(overrideClient?: Client)` prefers an explicit client over the nearest Context value. Zero-argument calls remain supported; an `Error` is still thrown when neither source supplies a client. It remains a top-level React Hook and still subscribes to Context; the override does not provide a value to descendants.
- Documentation clarifies that importing an application-owned client, passing one explicitly, and using framework injection are all valid choices. The adapter does not create or manage clients or the work started through them.

## `@defjs/vue`

- `injectClient(key?: InjectionKey<Client>)` accepts a custom injection key. Omitted or `undefined` keys still use `HTTP_CLIENT`; missing custom keys throw without falling back to the default client. Provide custom keys through native `app.provide` / `provide`, sharing the same `Symbol` object. `createClientPlugin(client)` remains unchanged and provides `HTTP_CLIENT` only.
- Documentation clarifies optional client access patterns and Vue context boundaries, including synchronous app-level `app.runWithContext()` (Vue 3.3+). Client and operation ownership remain with the application.
