# OpenTelemetry Server Optional Logger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add an independently usable OTel `logger` to `withOpenTelemetryServer` that records failure diagnostics for outbound HTTP, SSE, and WebSocket, and deliver third-party logging-library integration docs plus a runnable, verifiable Winston example.

**Architecture:** The application injects a native `Logger` from `@opentelemetry/api-logs`. The three existing interceptors share one internal log-construction and isolation function and explicitly pass the `spanCtx` each of them saved; the application continues to own the SDK, provider, processor, exporter, and their shutdown flow. Business code joins the same logging system through a Winston transport or Pino instrumentation, and no logging-framework adapter layer is implemented inside Defjs.

**Tech Stack:** Bun `>=1.4.3`, TypeScript, Vitest, the existing Core interceptors, OTel API `1.9.1`, Logs API/SDK `0.223.0`, Winston OTel transport `0.33.0`.

**Spec:** Requirements confirmed in this session: `withOpenTelemetryServer` adds an optional `logger`; the docs and the example show how to combine third-party logging libraries and different log levels. This document freezes the implementation decisions and does not create a duplicate design document. Implemented according to this plan; actual acceptance results and limitations are at the end.

## Global Constraints

- Implement against the current workspace, keeping the existing `tracer?: Tracer` changes and the `doc/content` documentation migration; do not overwrite the workspace from the old HEAD, and do not change already-deleted old documentation paths.
- The public configuration adds only `logger?: Logger`, and does not add `logLevel`, a logger provider, an exporter, filters, log hooks, or a Pino/Winston union type.
- `tracer`, `meter`, and `logger` may be omitted independently; keep empty-config behavior, existing span/metric/propagation, and return-value behavior. Do not change the Core public contract.
- Do not automatically read the global logger, do not initialize the SDK, do not register a global provider, and do not flush/shutdown application resources when a request or connection ends.
- Add `@opentelemetry/api-logs: ^0.223.0` to the library's regular `dependencies`, lock the actually resolved version `0.223.0`, and keep it external in tsdown. It is a real dependency of the public types and severity constants; do not use an optional peer to hide a consumer missing a declared dependency.
- The SDK, Winston, Pino, and their bridge packages must not become runtime dependencies of the library; Winston example dependencies live in the `doc` workspace. Keep the repo-wide Bun toolchain.
- By default emit only failure diagnostics, with the level fixed at `WARN = 13`; the output threshold is controlled by the application logging library, the SDK processor, or the Collector.
- Newly added logs must not change business return values, the original exception object, the `closed` result, close timing, or existing metric/span behavior; this isolation requirement targets the newly added logging path and does not opportunistically refactor all telemetry exception handling.
- Do not automatically output headers, body, the full URL, query, baggage, the close reason, the exception message/stack, or the original exception object; do not copy attributes returned by `startSpanHook` onto the log.
- This plan does not authorize commit, push, publish, or deploy.

## Review Focus

1. Log emit or reading exception attributes throws: the original business exception still propagates unchanged, and the stream still closes under the original contract; verified by tasks 1, 2, and 3.
2. The active context changes after SSE/WS returns: the termination log still associates with the context saved when that lifecycle was established; verified by task 3.
3. Cancellation confused with timeout: proactive cancellation emits no diagnostic, and a timeout emits one WARN; verified by tasks 1, 2, and 3.
4. logger-only, explicit bypass after a tracer is passed, and per-protocol switches: they must not turn each other off by mistake or create a global provider; verified by tasks 1, 2, and 3.
5. Duplicate sends from a third-party bridge and a misunderstood threshold: console DEBUG and OTel INFO may coexist, and the Winston threshold does not control Defjs native logs; verified by task 4.

## Current Code Facts and Coverage Boundaries

- `src/option.ts` configures outbound requests through three interceptors; `tracer` is already optional, and the new feature should continue that implementation.
- The three interceptors already establish `spanCtx = span ? trace.setSpan(parentCtx, span) : parentCtx`, but do not set it as the global active context. Logs must set `LogRecord.context`, must not re-read `context.active()` on async close, and must not simulate trace/span IDs with string attributes.
- `tracer && requireParentSpan && !trace.getActiveSpan()` currently skips the entire instrumentation. Keep that behavior, including the new logs; when no tracer is passed, ignore `requireParentSpan`, and logger-only works normally.
- HTTP parameter checks, partial decoding, and Struct validation sit outside the interceptor; these logs cannot be claimed to cover every `client.execute()` fault.
- A non-2xx SSE handshake appears inside the interceptor as a connection rejection, and only the outer layer constructs `HTTP_STATUS`. This change treats that as an SSE connection-establishment failure diagnostic, and does not read Core's private `statusSignal` or add a Core API; an ordinary HTTP 4xx/5xx does not emit an extra exception log.
- Existing WebSocket span/metric counts `kind: 'aborted'` as an error, and tests constrain that behavior. The new logs exclude proactive cancellation, but this change does not modify those existing metrics.
- `EventStreamHandle.closed` and `WebSocketSessionLike.closed` are lifecycle termination signals. Subscribe only to them; do not also subscribe to message-iteration errors, `onRuntimeError`, or every internal reconnect, so the same termination is not sent more than once.

## Log Contract

| Condition                                                                                                                           | eventName                          | phase        | Level / count                         |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------ | ------------------------------------- |
| HTTP `next()` rejects, excluding cancellation and the public `HTTP_STATUS` fault                                                    | `http.client.request.exception`    | `request`    | WARN, once                            |
| HTTP returns 2xx/4xx/5xx or a synthetic status 0                                                                                    | —                                  | —            | no log; keep the existing span/metric |
| SSE connection establishment rejects, excluding cancellation                                                                        | `defjs.client.sse.exception`       | `connect`    | WARN, once                            |
| SSE `closed` is `error` or rejects, excluding cancellation                                                                          | `defjs.client.sse.exception`       | `connection` | WARN, once                            |
| SSE `eof` / `aborted`                                                                                                               | —                                  | —            | no log                                |
| WebSocket connection establishment rejects, excluding cancellation                                                                  | `defjs.client.websocket.exception` | `connect`    | WARN, once                            |
| WebSocket `closed` is `error`, rejects, or, on the existing compatibility path, has no kind but has a cause, excluding cancellation | `defjs.client.websocket.exception` | `connection` | WARN, once                            |
| WebSocket `closed` / `aborted`, or an existing normal compatibility result with no kind and no cause                                | —                                  | —            | no log                                |
| Success, connection established, messages, normal close, telemetry hook errors                                                      | —                                  | —            | no new logs                           |

`http.client.request.exception` and WARN 13 follow the OTel HTTP exception convention, which is currently Development; SSE/WS use Defjs-owned names and do not impersonate standard events. "Once" means the request or connection lifecycle observed by one interceptor invocation; an outer retry that calls the interceptor again is a new lifecycle. Global deduplication against business logs the application writes itself, or against other HTTP instrumentation, cannot be guaranteed.

Every log includes `severityNumber: SeverityNumber.WARN`, `severityText: 'WARN'`, and an explicit `context`. The fixed bodies are `HTTP client request failed`, `SSE client connection failed`, and `WebSocket client connection failed`. The attribute allowlist is:

- `defjs.phase`: the phase from the table.
- `exception.type`: reuse `getErrorType(error)`; do not `String(error)` or expand the object.
- `defjs.operation`, `server.address`, `server.port`: reuse the existing `createServerMetricAttributes(req)`, and include only fields that function already has.
- HTTP's `http.request.method`; `defjs.sse.fault.code` for a terminating SSE error; the numeric `websocket.close.code` when available for a terminating WebSocket error.

`defjs.operation` is supplied by the application and should be a stable operation name; the docs remind readers not to put a customer identity or a secret there. Error details are still recorded by the business layer under its own redaction rules. Do not use the SDK's experimental `LogRecord.exception` field, because it would let raw error details enter later processing.

## File Scope

| Path                                                                                                                                 | Work                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `packages/opentelemetry-server/package.json`, `tsdown.config.ts`, `bun.lock`                                                         | Logs API dependency and publish boundary                                  |
| `packages/opentelemetry-server/src/option.ts`, `option.spec.ts`, `option.type.test.ts`                                               | Public options, config passing, and independent signal combinations       |
| `packages/opentelemetry-server/src/telemetry/logs.ts`, `logs.spec.ts` (new)                                                          | Allowlisted logs, cancellation detection, and log-failure isolation       |
| `packages/opentelemetry-server/src/test-utils.ts`                                                                                    | A mock that satisfies the native Logger type                              |
| `packages/opentelemetry-server/src/interceptor/{http,sse,web_socket}.ts` and the same-named `.spec.ts`                               | Wire in and verify against the existing lifecycle                         |
| `packages/opentelemetry-server/e2e.spec.ts`                                                                                          | Real Core boundary verification through `client.execute`                  |
| `doc/examples/opentelemetry-logging/winston.ts`, `README.md` (new)                                                                   | A runnable third-party logger case and run instructions                   |
| `doc/test/opentelemetry-logging.test.ts` (new), `doc/package.json`, `doc/tsconfig.json`                                              | Real SDK/bridge tests and example type checking                           |
| `packages/opentelemetry-server/README.md`                                                                                            | Package install and logger-only / three-signal usage                      |
| `doc/content/<locale>/docs/integrations/opentelemetry-server.md`                                                                     | 11-locale contract sync; full teaching in Chinese and English             |
| `doc/content/<locale>/api/opentelemetry-server.md` and the `.mdx` pages in the same-named directory that cover Options and functions | Hand-written interface, parameter, and example sync                       |
| `doc/examples/contexts.json`, `content-map.json`                                                                                     | Precisely update changed code-block context and content-revision evidence |

Do not add navigation, a recipe page, or a generic logger facade. API components will not infer the new field from TypeScript source automatically; the existing `api-parameters.ts` has no OTel parameter table, so this change does not need to extend that table or change `ApiReference`. `public_api.ts` already exports `OpenTelemetryServerOptions`; adding only a field needs no new public symbol.

## Task 1: Add the native Logger contract and a safe log function

**Files:** The dependencies, build config, `option.*`, `telemetry/logs.*`, and `test-utils.ts` from the table above, plus the options types of the three interceptors.

**Interfaces:**

- Public: `OpenTelemetryServerOptions.logger?: Logger`, with the type from `@opentelemetry/api-logs`.
- Internal: `HttpInterceptorOptions`, `SSEInterceptorOptions`, and `WebSocketInterceptorOptions` each receive the same optional `logger`.
- Internally add `emitClientException(logger: Logger | undefined, details: ClientExceptionLog): void`; `ClientExceptionLog` is a named interface whose fields are `request: HttpRequest`, `context: Context`, `transport: 'http' | 'sse' | 'websocket'`, `phase: 'request' | 'connect' | 'connection'`, `error: unknown`, and optional `closeInfo: { code?: unknown }` (read inside the log isolation boundary and validate `code` per protocol). Do not export it from `public_api.ts`.

- [x] Update the dependency manifest and update the lockfile with Bun; check that the lock diff contains only this feature and the later example's necessary dependencies, and keep existing changes. Add the Logs API to `deps.neverBundle` in `tsdown.config.ts`.
- [x] Write type cases in `option.type.test.ts`: logger-only, logger+meter, logger+tracer, all three signals, and an empty config are all accepted; a plain `{ info() {} }` logger cannot be passed; the existing no-argument and old-API negative cases still hold.
- [x] Add behavior tests for the new helper: fixed event/body/level and allowlisted fields for the three protocols, and a missing logger does no log work; `ERR_ABORTED`, `DOMException('...', 'AbortError')`, and the public `NET_ABORTED` fault do not emit; `ERR_TIMEOUT` and `TimeoutError` still emit; a non-Error cause records only the type.
- [x] Add privacy and failure tests: put a recognizable secret in the request and the error, and assert that body/attributes contain no URL/query/header/body/message/stack/cause; neither a throwing `emit()` nor a throwing property getter on the error object throws to the caller. The type mock implements `Logger.emit` and `Logger.enabled`, and does not assume the logger is Winston.
- [x] Run `bun run --cwd packages/opentelemetry-server test --coverage.enabled=false src/telemetry/logs.spec.ts` and confirm it fails because the helper is unimplemented; run `bun check --project tsconfig.json` and confirm the new option type cases fail before implementation.
- [x] Implement the allowlisted log function and option passing. Reuse the existing error-type and server-attribute functions; cancellation detection follows Core's current rules, stays compatible with `NET_ABORTED`, does not recurse deeply into cause, and does not use `req.abort.aborted` as a blanket skip that would also skip timeouts. There is no need to call `Logger.enabled()` or to provide extra filter state.
- [x] Inside the helper, wrap the new log construction and `emit()`; on failure, report only the fixed text `@defjs/opentelemetry-server: failed to emit client diagnostic log` through `diag.error`, do not attach the original error, and do not use the business logger again. A throw from diag itself must not leak out.
- [x] Re-run the helper and option type checks, and confirm the positive cases pass while the negative cases are still verified by `@ts-expect-error`. There is no need to create a global logger, a provider, or a new public error type.

## Task 2: HTTP failure logs and configuration combinations

**Files:** `src/interceptor/http.ts`, `http.spec.ts`, `option.spec.ts`, `e2e.spec.ts`.

**Interfaces:** Consume the logger and `emitClientException` from task 1, and record `http/request` using the existing `spanCtx`, `req`, and the captured original error.

- [x] In the HTTP tests, add `logger-only emits one WARN for a rejected next and preserves the cause`; assert emit once, the context is correct, and the error is still the same object. Parameterize coverage for no tracer and with a tracer.
- [x] Add cases for cancellation, timeout, 200/404/500/0, and the public `HTTP_STATUS` fault: cancellation and status responses are zero logs, and a timeout is one WARN; do not map a span ERROR status directly to an ERROR log.
- [x] In `option.spec.ts`, verify the logger is passed to every enabled protocol and a disabled protocol produces no log; logger-only does not read the global tracer/logger, and `requireParentSpan: true` does not block it. When a tracer is passed explicitly and there is no active parent, keep the whole-section bypass, including not emitting.
- [x] Run `bun run --cwd packages/opentelemetry-server test --coverage.enabled=false src/interceptor/http.spec.ts src/option.spec.ts` and confirm the new log assertions fail.
- [x] Wire the helper into the existing transport-failure path; the HTTP success path does not emit. The new logging does not widen the execution scope of existing hooks, spans, or metrics, and does not turn a helper failure into a new transport failure.
- [x] Through the local handle in `e2e.spec.ts`, verify there is one diagnostic when `client.execute` returns `NET_UNREACHABLE`; when the logger throws, the tuple and cause are unchanged; input-validation failure, HTTP status errors, and decode failures outside the interceptor do not invent a log. Reuse existing fixtures and do not connect to the public network.
- [x] Re-run the cases above and `e2e.spec.ts`; the results should exactly satisfy the log-count, associated-context, and original-return-value assertions.

## Task 3: SSE and WebSocket termination logs

**Files:** `src/interceptor/sse.ts`, `sse.spec.ts`, `web_socket.ts`, `web_socket.spec.ts`; reuse the existing deferred stream/session helpers.

**Interfaces:** Consume the helper from task 1; connection-establishment rejection uses `connect`, and the failure branch of `closed` uses `connection`. Use the same `spanCtx` saved when the interceptor was established.

- [x] For both protocols, add logger-only and tracer+logger cases for connection-establishment failure, normal termination, error termination, and closed rejection. SSE verifies the fault code; WS verifies the close code and the existing legacy close compatibility branch.
- [x] Add separate cases for proactive cancellation: SSE/WS `kind: 'aborted'` does not emit even with an ordinary Error cause; the original cancellation cause of a connection-establishment rejection and the `NET_ABORTED` fault do not emit; a timeout is still WARN. The existing WS span/metric assertions stay unchanged.
- [x] Construct a stream and a session opened in context A and terminated in context B, and assert the log `context` matches the saved A/outbound span; with no tracer, keep the extracted parent context, and this library does not discard an unsampled context on its own.
- [x] Assert that connection-establishment failure and post-success termination are each at most once; a repeated close call, then later consuming the same termination error, does not add a log; do not listen to `onRuntimeError`, and do not count internal reconnect attempts one by one. When a Promise's single settle and the unique termination subscription are already enough, do not also create a global dedup table.
- [x] Add close verification after the logger throws: the original `closed` value or rejection reason is unchanged, the active metric returns to zero the same number of times, the span still ends under the original logic, and there is no new unhandled rejection.
- [x] Run `bun run --cwd packages/opentelemetry-server test --coverage.enabled=false src/interceptor/sse.spec.ts src/interceptor/web_socket.spec.ts`, confirm the new assertions fail, then wire the helper only into the failure paths that correspond to the table.
- [x] Re-run the full tests for both protocols. SSE uses the explicit close kind directly; WS log judgment excludes aborted on its own, and does not change the existing meaning of `failed` for span/metric.

## Task 4: Runnable Winston example and real SDK verification

**Files:** Add `doc/examples/opentelemetry-logging/winston.ts`, that directory's `README.md`, and `doc/test/opentelemetry-logging.test.ts`; modify `doc/package.json`, `doc/tsconfig.json`, and `bun.lock`.

**Interfaces:** The example exports `runWinstonLoggingExample(loggerProvider: LoggerProvider, otelLevel: 'info' | 'error' = 'info'): Promise<void>`. The second parameter only sets the Winston OTel transport threshold inside the example; the CLI and the tests run the same business example. The caller creates and registers the provider and context manager, and is responsible for flush/shutdown and global cleanup; the function creates, finishes writing, and closes its own Winston logger. The script starts the example when `import.meta.main`, and does not run automatically when imported by a test.

- [x] Add `@opentelemetry/api-logs: 0.223.0`, `@opentelemetry/sdk-logs: 0.223.0`, `@opentelemetry/context-async-hooks: 2.12.0`, `@opentelemetry/winston-transport: 0.33.0`, and a compatible Winston 3.x development dependency to `doc`; when implementing, consult the official declarations and record the versions actually locked, and do not install the SDK into the library itself.
- [x] Include `examples/**/*.ts` in `doc/tsconfig.json`, and add the script `example:otel-logging` with the command `bun examples/opentelemetry-logging/winston.ts`.
- [x] Write the real SDK test first: `LoggerProvider` + `SimpleLogRecordProcessor({ exporter })` + `InMemoryLogRecordExporter`; business code uses a real `OpenTelemetryTransportV3`, and Defjs uses `getLogger('@defjs/opentelemetry-server')` from the same provider. The test does not mock the bridge or the SDK.
- [x] The CLI and the test register a real `AsyncLocalStorageContextManager`, build a demo parent context with `trace.setSpanContext(ROOT_CONTEXT, { traceId: '11111111111111111111111111111111', spanId: '2222222222222222', traceFlags: TraceFlags.SAMPLED })`, and run the example inside `context.with(parentContext, ...)`. The example uses logger-only; assert that both actually exported records carry that parent traceId/spanId. When a tracer is also present, logs may associate with the outbound child span, and "the two paths have the same spanId" must not be written as a general requirement; the child span is already verified by tasks 2 and 3, so do not install a full Trace SDK for this.
- [x] The test captures the example's console output and checks the exporter: the DEBUG business message appears only on the console, and the INFO/WARN business messages enter OTel, one each; a locally rejected request produces one Defjs WARN whose scope differs from the business transport scope but whose exporter is the same.
- [x] Call `runWinstonLoggingExample(provider, 'error')` again on the same provider, and assert the second business INFO/WARN did not enter the exporter while the second native Defjs WARN still did; slice the increment from the record count after the first flush, and do not write a second fake example. Clearly distinguish Winston's default logger level from the transport's explicit level; the latter can override the former, and do not write the incorrect claim that "changing appLogger.level controls every log".
- [x] Implement the example: construct the Winston transport only after the global provider is registered; set `Console` to DEBUG, and have the OTel transport use the passed `otelLevel`, defaulting to INFO; enable only this one Winston OTel send path. Demonstrate failure with a controllable rejection from `withHTTPHandle`, and do not depend on the external network or a Collector.
- [x] In `finally`, the example function waits for its own Winston logs to be written and then closes; the caller then `forceFlush()`. After the test reads the exporter, `finally` shuts down the provider, calls `logs.disable()` and `context.disable()`, and closes the corresponding context manager so later tests do not share state. The CLI also closes resources in `finally` and does not use `process.exit()` to cut off the queue; one test assembly registers the provider once, then calls the example twice.
- [x] Run `bun run --cwd doc example:otel-logging` and `bun test --cwd doc ./test/opentelemetry-logging.test.ts`, and assert the actual record count, severity, context fields, and cleanup. The docs state clearly that the Console exporter is convenient for local observation and that production may replace it with an OTLP exporter chosen by the application.

## Task 5: Documentation, third-party integration, and level explanation

**Files:** The package README above, the 11-locale integration/API pages, the example README, `doc/examples/contexts.json`, and `doc/examples/content-map.json`.

**Interfaces:** All code uses the native Logger option from task 1; the full runnable Winston case links to the task 4 files and does not copy a second implementation.

- [x] Sync the 11 locales: `en-US`, `zh-Hans`, `zh-Hant-TW`, `zh-Hant-HK`, `ja-JP`, `ko-KR`, `de-DE`, `fr-FR`, `es-ES`, `ru-RU`, and `ar`. Update the hand-written options/interface, the install instructions, and the no-longer-accurate "tracer/meter only" description; keep the existing optional-tracer content.
- [x] The Chinese and English integration pages fully show logger-only, three-signal injection, the explicit Winston transport, and the application shutdown flow; the other languages sync the public contract and accurately link the full example. Existing pages link the executable example directly and do not add a recipe or a navigation item.
- [x] Give Pino a complete Node initialization-order example: the application configures the Logs processor, registers `PinoInstrumentation`, and loads Pino after starting the SDK; explain log correlation and log sending separately. Dependencies that need code-block type checking are added only to `doc` devDependencies: `@opentelemetry/sdk-node: 0.223.0`, `@opentelemetry/instrumentation-pino: 0.69.0`, and a compatible Pino 10.x, locking the actual versions checked at implementation time. State clearly that this passage is a Node reference integration, that Bun type checking does not prove automatic instrumentation runs, and do not switch the repo runtime or invent an adapter for it. State that a Pino worker transport can use an independent provider, and do not claim that it automatically shares the main-thread provider.
- [x] Add a level mapping table: the base values of OTel TRACE/DEBUG/INFO/WARN/ERROR/FATAL are 1/5/9/13/17/21; Pino 10/20/30/40/50/60 correspond; among Winston's default npm levels, silly/debug/info/warn/error correspond to 1/5/9/13/17, http is 7, verbose is 6, and fatal is not provided by default. Custom levels must be mapped explicitly; a third-party number must not be treated directly as an OTel severity.
- [x] Distinguish event level from output threshold, and explain that DEBUG discarded upstream cannot be recovered downstream; the Winston threshold does not control logs that Defjs emits directly. The Logs API is not a third-party business Logger; the log TRACE level is not the Tracer signal.
- [x] The docs list this plan's event table, logger-only behavior, the `requireParentSpan` compatibility rule, interceptor coverage, the privacy allowlist, OTel Logs' explicit association with span context, and the fact that injecting a logger alone does not make arbitrary business logs automatically enter the Defjs outbound span.
- [x] State the deduplication boundary: Winston's explicit transport and automatic log sending are alternatives; Defjs only guarantees the diagnostic count of its own single lifecycle, and other automatic HTTP instrumentation plus application re-reporting must be coordinated by the application. Do not expose the experimental `loggerConfigurator` as a Defjs API.
- [x] For changed TS code blocks, precisely maintain the ordinal and companion code in `contexts.json`, using real dependencies and a complete type context, and do not bypass validation with a `declare` placeholder. Keep the original migration hash in `content-map.json`, and only append or update `approvedProseRevision` for the target pages of this change; keep the existing optional-tracer revision reason, and do not rebuild the whole baseline.
- [x] Run `bun run --cwd doc check:examples`, `bun run --cwd doc test`, and `bun run typecheck`; link and content checks must not pass by disabling assertions or excluding the new example.

## Task 6: Publish compatibility and final acceptance

**Files:** Only the files above; if something fails, first distinguish this change from an existing workspace problem, and do not opportunistically widen the scope.

- [x] Run `bun run --cwd packages/opentelemetry-server test`, and keep that package's current 100% coverage gate for branches/functions/lines/statements. The new private log module must not be added to the coverage exclude.
- [x] Run `bun run verify` once, and read the exit code and the full failure summary. That command covers lint, format, all workspace tests, type/build, and site e2e; do not reuse verification results from before this change.
- [x] Reuse the build artifacts produced by a successful verify: check that `dist/index.d.ts` exposes the native Logger type and that `dist/package.json` contains the Logs API as a regular dependency; the artifacts contain neither the SDK, Winston/Pino, global SDK initialization, nor the documentation example. If verify exits before the build because of an existing problem, build the relevant packages separately for the consumer check below, state the verification scope clearly, and do not pass off old artifacts as this build.
- [x] In a temporary consumer directory, test the built package or tarball, install its declared dependencies, and set `skipLibCheck: false`: the original `{ tracer }`, `{ meter }`, and `{}` calls compile without manually adding a new peer; the new `{ logger }` call also compiles. Use only Bun to install and check; keep the temporary directory outside the workspace, and delete the directory created for this check afterward.
- [x] Finally inspect `git diff` and the workspace status, and confirm only in-plan changes are included; report the separate results of the local tests, the repo-wide checks, the consumer declaration check, and the real Winston run. If an existing browser test or site check fails, keep the cause and state clearly that a repo-wide pass cannot be claimed.

The acceptance results must prove all of the following at once: behavior without a logger stays compatible; logger-only works; the three protocols emit or suppress logs according to the table; context is saved; a failure of the new logs does not change the business result; real third-party logs and Defjs logs enter the same pipeline; and the documentation of different levels and thresholds has runtime evidence. Real Collector receipt, production throughput, and automatic Pino instrumentation on Bun are outside what this change verified.

## References and pre-implementation review

- [OTel HTTP exception semantic conventions](https://opentelemetry.io/docs/specs/semconv/http/http-exceptions/): currently Development; an HTTP client exception recommends WARN 13; do not turn every HTTP error status into an exception log.
- [Logs API Logger and version source](https://github.com/open-telemetry/opentelemetry-js/blob/92b844e8aa7d9655e4b3560154e912c4c1ced64d/experimental/packages/api-logs/src/types/Logger.ts): this plan is based on the published `0.223.0` and does not mix in future APIs from main.
- [Winston transport](https://github.com/open-telemetry/opentelemetry-js-contrib/blob/cc263ac4e94320402ac3afe50d50eb00905e1bb8/packages/winston-transport/README.md) and [level conversion](https://github.com/open-telemetry/opentelemetry-js-contrib/blob/cc263ac4e94320402ac3afe50d50eb00905e1bb8/packages/winston-transport/src/utils.ts).
- [Pino instrumentation](https://github.com/open-telemetry/opentelemetry-js-contrib/blob/cc263ac4e94320402ac3afe50d50eb00905e1bb8/packages/instrumentation-pino/README.md): keep the Node initialization order and the provider ownership boundary.

The plan-writing phase only finished the source, call-graph, test, documentation-layout, and upstream-interface investigation; it did not install dependencies, implement the feature, or run the to-be-developed tests listed above.

## Implementation and acceptance record (2026-10-11)

Implementation and checks for tasks 1-6 were executed. The original workspace's optional-tracer work and the Fumadocs migration were kept; nothing was committed, pushed, published, or deployed. The checkboxes above mean the steps were executed. Actual results of the full checks are governed by this section, and they do not mean every first run passed.

- The public API adds a native optional Logger; HTTP/SSE/WS failure diagnostics use WARN 13, allowlisted fields, and the saved context, and passing no logger adds no log behavior.
- The library adds only the Logs API as a regular dependency; the SDK, Winston/Pino, and the bridge packages are used only as documentation development dependencies. The real Winston example is owned by the application, which holds the provider and closes resources.
- Updated 44 related documentation pages across 11 locales, plus the package and example READMEs. The Chinese and English guides include logger-only, the three signals, Winston, Pino, and the level and filtering explanation; the other locales sync the public contract and link the full case.
- TDD recorded RED to GREEN for the public API types and behavior, HTTP, SSE/WS, and the real Winston exporter. An independent review found that the SSE close cause getter was read outside the log isolation boundary; two new regression cases reproduced it first, then the read was deferred into the helper's protected scope. After the review recheck there were no unclosed findings.

| Verification                 | Actual result                                                                                                                                                                                                                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenTelemetry package        | 274/274 tests, 11 files; statements/branches/functions/lines all 100%                                                                                                                                                                                                 |
| Workspace tests              | Core 1,780, OTel 274, React 12, Vue 14, doc 32, all passed                                                                                                                                                                                                            |
| Types and doc examples       | Root 257 files, doc 157 files; 1,062 complete examples / 86 distinct, all passed                                                                                                                                                                                      |
| lint / format                | Repo-wide pass; the format check covered 2,708 files                                                                                                                                                                                                                  |
| build / links                | All packages and the docs site built; link checks passed for 2,279 generated pages                                                                                                                                                                                    |
| Winston runtime              | The Bun 1.4.3 real run exited 0; the real SDK test was 1/1 with 10 assertions passed, including level thresholds and trace/span association                                                                                                                           |
| Packed consumer              | The newly built tarball was installed in a temporary directory; api-logs was not declared manually, and the old and new configs passed with skipLibCheck:false; the actual call produced one WARN and kept the original cause; the temporary directory was cleaned up |
| First bun run verify         | Exited 1; the preceding checks passed, site tests were 14/15, and Firefox timed out waiting for the search dialog at site.test.ts:116                                                                                                                                 |
| Firefox failing-case recheck | Same build, with the implementation and assertions unmodified; the single case passed 1/1 with 968 assertions; the root cause of the first failure was not confirmed, so the first verify cannot be described as a pass                                               |

During implementation, the documentation boundary was corrected against the real Core flow: a response read or JSON parse failure inside the handler may emit a WARN first and then become RES_DECODE_FAILED; a later Struct or media-type check produces no log. The internal helper was changed to read the close code inside the protected region; the SSE cause uses a deferred read, and the public API was not widened.

The full RED/GREEN, CLI, repo-wide verification, and consumer logs are kept in the repository at .superpowers/sdd/2026-10-11-opentelemetry-server-logger/. The key records are 23-sse-getter-green.log, 30-verify.log, 31-consumer.log, and 32-firefox-recheck.log; feature.patch is compared against the dirty-worktree snapshot from when this task started, so earlier changes are not mixed in.

On consumer install, Bun warns about the current Core registry peer range; the Core tarball built this time was provided explicitly on the local machine, and the type and runtime checks passed. This is not an npm publish-availability verification. Real Collector receipt, production throughput, and Pino automatic instrumentation running under Bun were not verified; the Pino docs are a Node initialization-order reference. Existing span/metric exception handling keeps its original behavior.
