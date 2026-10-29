# Defjs Error, OpenTelemetry, and Async Disposal Implementation Plan

> **For the executing agent:** Execute task by task using `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`. Track progress item by item with checkboxes (`- [ ]`).

**Goal:** Improve `RequestError` logging, add a synchronous pre-span-creation attribute hook, and let SSE/WebSocket handles support explicit async resource management, while leaving existing request, `close()`, and `closed` semantics unchanged.

**Architecture:** Keep the unified error tuple from `client.execute()` and the existing transport state machine. The error factory switches to the native `Error` cause; OpenTelemetry calls an independent `startSpanHook` before each transport creates a Span; only long-lived SSE/WebSocket handles expose `Symbol.asyncDispose`. Disposal reuses the existing close entry point and caches one idempotent teardown Promise, and does not add a resource manager, a base class, a default redaction policy, or an HTTP Client disposer.

**Tech stack:** TypeScript 7, Bun 1.4.0, Vitest 4, standard `ErrorOptions`, standard `AsyncDisposable`, OpenTelemetry API 1.x.

**Design contract:** `docs/superpowers/plans/2026-08-29-defjs-error-otel-disposal.md#confirmed-design-contract`

## Global constraints

- Keep all unrelated changes and the user's existing workspace changes. Modify only the files listed in this plan.
- Do not change `client.execute()` error classification or tuple shape.
- Do not copy `StructError.format()`, `flatten()`, or `prettify()` onto `DefinitionError`. Callers narrow `error.cause` to `StructError` first, then use those methods.
- Do not add a custom error class or a custom `toString()`. Log strings use the native `Error.prototype.toString`.
- Do not build in a redactor, a sensitive-parameter list, or key/value URL rewriting. Keep the existing `url.full` data boundary: it is resolved only from `endpoint`/`baseEndpoint` and does not automatically append `req.queryString`. An application may explicitly supply its own full or redacted URL through `startSpanHook`.
- `startSpanHook` must run synchronously so that samplers and synchronous SpanProcessors can see the final initial attributes when the Span is created.
- Do not add `AsyncDisposable` to the HTTP Client or to ordinary HTTP results. The HTTP lifetime continues to be managed by request completion, `AbortSignal`, and timeout.
- Do not add a resource manager, a handle base class, a global Client disposer, `closeAndWait()`, a public close-grace configuration, a new dependency, or a new error class.
- Do not change the existing semantics of `close()` or `closed`. `close()` only requests a logical close; `closed` still means the existing logical terminal state; only `[Symbol.asyncDispose]()` waits for teardown that Defjs itself owns.
- `[Symbol.asyncDispose]()` itself must not throw synchronously. The first call must cache the Promise first, then run close side effects in a microtask. Later calls must return that same Promise strictly.
- WebSocket `finish()` remains the sole terminal owner of the queue, listeners, controller, and state. The disposer does not finalize those resources again.
- Do not claim that the WebSocket disposer can prove the physical TCP connection is closed. It only guarantees that, after a best-effort native `close()`, Defjs finishes all of its own cleanup within a bounded time.
- Edit by hand with `apply_patch`. Do not commit, push, publish, or create a PR.

## Confirmed design contract

### RequestError

1. On request validation, transport, response validation, undeclared status code, and interceptor failure, `client.execute()` continues to return `[RequestError, undefined]`.
2. `HttpStatusError`, `TransportError`, and `DefinitionError` continue to use a structured `Error` interface/intersection, and do not add a public class hierarchy.
3. Errors created by the factories have stable names: `HttpStatusError`, `TransportError`, `DefinitionError`.
4. `kind`, `code`, `status`, `response`, and `data` remain enumerable own properties for structured logging.
5. The stable error name is a non-enumerable own property. Improving `String(error)` must not add `name` to JSON.
6. `cause` is set only through `new Error(message, { cause })`, stays non-enumerable, and is available to loggers that support a cause chain.
7. `String(error)` uses the native `<name>: <message>`. Struct display helpers remain on the narrowed `StructError` cause.

### OpenTelemetry

1. Each transport option gains the same optional synchronous hook:

   ```ts
   startSpanHook?: (request: HttpRequest) => Attributes
   ```

2. Defjs generates built-in attributes first and spreads application attributes last. An application can therefore override `url.full` or other initial attributes before the Span is created.
3. HTTP `server.address` and `server.port` move into the initial attributes of `startSpan` and are no longer set after the Span is created.
4. `requestHook` and `responseHook` keep their existing post-creation semantics and asynchronous fire-and-observe behavior.
5. A throw from `startSpanHook` must not block the request: Defjs creates the Span with built-in attributes, then records the failure through the existing hook error event/exception path.
6. `startSpanHook` is configured separately under `http`, `sse`, and `webSocket`, and must not leak across transports.
7. The default `url.full` continues to resolve only `req.endpoint` and the optional `req.baseEndpoint`: a query carried by the endpoint literal is kept, and a separate `req.queryString` is not appended automatically. This is an existing field-construction boundary, not redaction by sensitive parameter.

This distinction follows OpenTelemetry HTTP and Undici instrumentation: the start-span hook supplies attributes before `startSpan`, while the request/response hooks operate on a Span that already exists.

- OpenTelemetry HTTP reference: <https://github.com/open-telemetry/opentelemetry-js/blob/main/experimental/packages/opentelemetry-instrumentation-http/src/types.ts>
- OpenTelemetry Undici reference: <https://github.com/open-telemetry/opentelemetry-js-contrib/blob/main/packages/instrumentation-undici/src/types.ts>

### AsyncDisposable

1. `EventStreamHandle<T>` and `WebSocketSession<TIncoming, TOutgoing>` extend `AsyncDisposable`.
2. `WebSocketSessionLike` likewise requires `[Symbol.asyncDispose](): PromiseLike<void>`, so interceptors and structural test doubles honor the public session contract.
3. Repeated disposer calls return the same cached Promise and issue only one close request.
4. The SSE disposer waits for `closed` and the existing `start()` lifecycle task. It guarantees that Defjs's read/reconnect loop has stopped and the reader lock has been released, but it does not wait unboundedly for a provider `ReadableStream.cancel()` Promise that is stuck.
5. The WebSocket disposer waits for the connection lifecycle and every Defjs message-pump task, stops the heartbeat, reconnect, and close timer, removes listeners, terminates the queue, and clears the current socket reference.
6. A normal WebSocket disposal waits for the native `close` event. If that event does not arrive within one second, Defjs forces logical cleanup to finish and rejects the disposer with a standard `DOMException` (`name === 'TimeoutError'`).
7. When native `close()` throws, Defjs still finishes fallback cleanup and waits for its own tasks, then rejects the disposer with the original thrown value. The original close error takes priority over a later timeout.

This follows the minimal pattern of Node HTTP/FileHandle and similar implementations: the disposer reuses the existing close entry point and waits for the real teardown Promise; it does not build a parallel lifecycle.

- Node HTTP `server[Symbol.asyncDispose]()`: <https://nodejs.org/api/http.html#serversymbolasyncdispose>
- Node FileHandle `filehandle[Symbol.asyncDispose]()`: <https://nodejs.org/api/fs.html#filehandlesymbolasyncdispose>

## File responsibilities

| Concern                 | Production files                                                                             | Primary tests                                                                          | Public docs                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Native RequestError     | `packages/core/src/error/factory.ts`                                                         | `packages/core/src/error/factory.spec.ts`, `packages/core/src/http/http.error.spec.ts` | `doc/api/errors.md`, `doc/core/errors.md`, and all enabled locales |
| SSE disposal            | `packages/core/src/sse/transport/event_stream.ts`                                            | `event_stream.advanced.spec.ts`, `sse.spec.ts`, `sse.type.test.ts`                     | `doc/api/sse.md`, `doc/core/sse.md`, and all enabled locales       |
| WebSocket disposal      | `packages/core/src/web_socket/web_socket.ts`, `packages/core/src/interceptor/interceptor.ts` | WebSocket server/real/type tests                                                       | `doc/api/web-socket.md`, `doc/core/web-socket.md`, and all locales |
| Span initial attributes | OpenTelemetry option, trace, and the three interceptors                                      | option, trace, and the three interceptor tests                                         | OpenTelemetry README, API/plugin docs, and all enabled locales     |

---

### Task 0: Establish the execution baseline

**Files:** Read-only checks of repository status, test output, and type diagnostics.

Baseline at plan-writing time (2026-08-29, for comparison only; still rerun at execution time): `tsc --noEmit` for both the Core and OpenTelemetry packages exits `0`; the Task 6 targeted tests are `370/370` and `116/116`. Both Vitest runs print the existing Vite native config warning, which does not affect the exit code.

- [ ] Run `git status --short` and save the tracked/untracked paths that already exist before execution. Do not clean, stash, or revert.
- [ ] Run `bun --version` and confirm the repository-pinned Bun `1.4.0` toolchain.
- [ ] Before adding RED tests, run the package-level TypeScript gates separately and record the exit code and every existing diagnostic:

  ```sh
  (cd packages/core && bunx tsc --project tsconfig.json --noEmit)
  (cd packages/opentelemetry-server && bunx tsc --project tsconfig.json --noEmit)
  ```

- [ ] Before adding RED tests, run the full tests of both affected packages:

  ```sh
  (cd packages/core && bun run test)
  (cd packages/opentelemetry-server && bun run test)
  ```

- [ ] If the dirty baseline already fails, keep the exact failure list. Each later RED must show a new failure directly related to this feature; each GREEN only proves that new failure is gone, and must not claim an unrelated baseline failure as fixed.

### Task 1: Native RequestError logging and the cause chain

**Files:**

- Modify: `packages/core/src/error/factory.ts`
- Modify: `packages/core/src/error/factory.spec.ts`
- Modify: `packages/core/src/http/http.error.spec.ts`

**Interfaces:**

- Keep: `createTransportError(cause): TransportError`
- Keep: the existing `createDefinitionError(...)` overloads and return types
- Keep: `createHttpStatusError(...)`
- New behavior: native `String(error)` prints the stable error name
- New behavior: native non-enumerable `cause`; Defjs metadata stays enumerable

- [ ] Add a RED factory test for each error family, asserting the exact `name`, `String(error)`, `instanceof Error`, property descriptors, and JSON behavior:

  ```ts
  expect(error.name).toBe("DefinitionError");
  expect(String(error)).toBe(`DefinitionError: ${cause.message}`);
  expect(error.cause).toBe(cause);
  expect(Object.getOwnPropertyDescriptor(error, "name")).toEqual({
    configurable: true,
    enumerable: false,
    value: "DefinitionError",
    writable: true,
  });
  expect(Object.prototype.propertyIsEnumerable.call(error, "cause")).toBe(
    false,
  );
  expect(Object.prototype.propertyIsEnumerable.call(error, "code")).toBe(true);
  expect(JSON.parse(JSON.stringify(error))).not.toHaveProperty("cause");
  expect(JSON.parse(JSON.stringify(error))).not.toHaveProperty("name");
  ```

- [ ] Cover `ABORTED`, `TIMEOUT`, `NETWORK_ERROR`, every definition code, and `HTTP_STATUS`. Include a non-`Error` cause and lock the current message conversion rule. For samples that include every optional metadata field, assert the serialized top-level keys exactly: Transport is `code/kind`, Definition is `code/kind/response`, undeclared status is `code/kind/response/status`, and HTTP status is `code/data/kind/response/status`.
- [ ] Add an integration assertion to the existing HTTP response-validation test: the tuple's first item is a `DefinitionError`; `cause` is the same `StructError`; the narrowed cause can still call `format()`, `flatten()`, and `prettify()`.
- [ ] Run the targeted tests:

  ```sh
  (cd packages/core && bunx vitest run --config vitest.config.server.ts src/error/factory.spec.ts src/http/http.error.spec.ts)
  ```

  Expected RED: current factory errors use the default `Error` name, and `cause` is enumerable.

- [ ] Change every `Object.assign(new Error(...), { cause, ...metadata })` to native construction plus direct metadata assignment. Only errors that have a cause use the constructor option:

  ```ts
  const error = new Error(message, { cause }) as DefinitionError;
  Object.defineProperty(error, "name", {
    configurable: true,
    enumerable: false,
    value: "DefinitionError",
    writable: true,
  });
  error.code = code;
  error.kind = "definition";
  error.response = response;
  return error;
  ```

- [ ] Transport errors use the same pattern. `HttpStatusError` has no cause and uses `new Error(message)`. Keep the existing message, code, overloads, and metadata enumerability.
- [ ] Rerun the targeted Vitest and confirm the descriptor, string, JSON, and Struct cause assertions all pass.
- [ ] Run `(cd packages/core && bunx tsc --project tsconfig.json --noEmit)` and confirm the structured casts keep the existing public error types, with exit code `0`.

### Task 2: Synchronous OpenTelemetry Span initial attributes

**Files:**

- Modify: `packages/opentelemetry-server/src/option.ts`
- Modify: `packages/opentelemetry-server/src/option.type.test.ts`
- Modify: `packages/opentelemetry-server/src/option.spec.ts`
- Modify: `packages/opentelemetry-server/src/telemetry/trace.ts`
- Modify: `packages/opentelemetry-server/src/telemetry/trace.spec.ts`
- Modify: `packages/opentelemetry-server/src/interceptor/http.ts`
- Modify: `packages/opentelemetry-server/src/interceptor/http.spec.ts`
- Modify: `packages/opentelemetry-server/src/interceptor/sse.ts`
- Modify: `packages/opentelemetry-server/src/interceptor/sse.spec.ts`
- Modify: `packages/opentelemetry-server/src/interceptor/web_socket.ts`
- Modify: `packages/opentelemetry-server/src/interceptor/web_socket.spec.ts`

**Interfaces:**

- `OpenTelemetryServerTransportOptions<TResponse>` gains:

  ```ts
  startSpanHook?: (request: HttpRequest) => Attributes
  ```

- The three internal interceptor option interfaces gain the same field.
- `createHttpSpan`, `createSSESpan`, and `createWebSocketSpan` gain a final optional `Attributes` parameter.
- Add one internal synchronous hook resolver, and do not export it from the package public API.

- [ ] Add a RED type test: the hook parameter must be `HttpRequest`, the return value must be `Attributes`, and it exists only on the `http`, `sse`, and `webSocket` transport options.
- [ ] Add a compile-time rejection of an async callback:

  ```ts
  withOpenTelemetryServer({
    tracer,
    http: {
      // @ts-expect-error startSpanHook must synchronously return Attributes
      startSpanHook: async () => ({ "app.tenant": "a" }),
    },
  });
  ```

- [ ] Run `(cd packages/opentelemetry-server && bunx tsc --project tsconfig.json --noEmit)`. Expected RED: `startSpanHook` does not exist yet, so there is a new and exact option type diagnostic.
- [ ] Extend the option wiring tests: each transport receives only its own hook reference; omitting the hook keeps `undefined`.
- [ ] Read initial attributes directly from `vi.mocked(tracer.startSpan).mock.calls`. Do not infer them from the mock Span `attributes` bag, which is mutated later, and do not add a tracer helper.
- [ ] Add RED interceptor tests for all three transports: custom attributes appear directly in the `startSpan` options; `url.full` can be overridden before creation; omitting the hook keeps the current URL.
- [ ] The HTTP RED test has the hook override `url.full`, `server.address`, and `server.port` together, and asserts in the raw `startSpan` attributes that the application values win, so the merge order cannot be reversed.
- [ ] Add three URL boundary tests: a query carried by the endpoint literal is kept as-is; when only `req.queryString` is set, the default `url.full` still omits it; the application can read the request in `startSpanHook` and explicitly override `url.full` to include the queryString. Test names and docs must not call the existing omission redaction.
- [ ] Add a hook-failure test on all three transports: after a synchronous `throw`, `next` is still called, built-in initial attributes are kept, and `defjs.otel.hook.error` is recorded after Span creation with `hook.name === 'startSpanHook'`. Also add a `throw undefined` case that locks the explicit discriminator.
- [ ] Run the targeted tests:

  ```sh
  (cd packages/opentelemetry-server && bunx vitest run --config vitest.config.server.ts src/option.spec.ts src/telemetry/trace.spec.ts src/interceptor/http.spec.ts src/interceptor/sse.spec.ts src/interceptor/web_socket.spec.ts)
  ```

  Expected RED: the option and initial-attribute contract do not exist yet; HTTP server attributes are still set after `startSpan`.

- [ ] In `option.ts`, import `Attributes` as a type import, add `startSpanHook` to the shared transport option, and forward it per transport inside `withOpenTelemetryServer`. Do not add a global hook option.
- [ ] In `telemetry/trace.ts`, add a minimal internal resolver:

  ```ts
  type StartSpanHookResult =
    { ok: true; attributes?: Attributes } | { ok: false; error: unknown };

  export function resolveStartSpanHook(
    hook: ((request: HttpRequest) => Attributes) | undefined,
    request: HttpRequest,
  ): StartSpanHookResult;
  ```

  It only returns attributes or the thrown value. It does not create a Span, await a Promise, or modify the request.

- [ ] The three Span creators merge attributes only once at creation time; built-in attributes come first, application attributes come last:

  ```ts
  attributes: {
    ...builtInAttributes,
    ...startAttributes,
  }
  ```

- [ ] The HTTP interceptor first builds the extra initial attributes: `server.address`/`server.port` first, then the successful hook attributes. Pass the result to `createHttpSpan` and delete the post-creation `setAttribute`. The Span helper itself still places method, URL, and operation built-in attributes first.
- [ ] Each interceptor resolves the hook immediately before creating the Span and discriminates explicitly with `result.ok`, so `throw undefined` is handled correctly. On failure, create the Span with built-in attributes first, then synchronously rethrow the captured value through the existing `runSpanHook` to record the error. The request and propagation flow continue.
- [ ] Rerun the targeted OpenTelemetry Vitest and confirm initial attributes, override order, exception isolation, and transport scope all pass.
- [ ] Rerun `(cd packages/opentelemetry-server && bunx tsc --project tsconfig.json --noEmit)` and confirm the exit code is `0`. An async `startSpanHook` is still rejected, and the existing request/response hooks stay compatible.

### Task 3: SSE AsyncDisposable lifecycle

**Files:**

- Modify: `packages/core/src/sse/transport/event_stream.ts`
- Modify: `packages/core/src/sse/transport/event_stream.advanced.spec.ts`
- Modify: `packages/core/src/sse/sse.spec.ts`
- Modify: `packages/core/src/sse/sse.type.test.ts`
- Modify: `packages/opentelemetry-server/src/test-utils.ts`

**Interfaces:**

- Change `EventStreamHandle<TEvent>` to `extends AsyncIterable<TEvent>, AsyncDisposable`
- Add the required `[Symbol.asyncDispose](): PromiseLike<void>` through the standard `AsyncDisposable` contract
- Keep `close(reason?: unknown): void`
- Keep `closed: Promise<EventStreamCloseInfo>` and its existing logical timing

- [ ] Add a RED type test: `EventStreamHandle` is assignable to `AsyncDisposable`, and `await using` works without a cast.
- [ ] Run `(cd packages/core && bunx tsc --project tsconfig.json --noEmit)`. Expected RED: the handle has no `[Symbol.asyncDispose]` yet, so there is a new and exact type diagnostic.
- [ ] Using the existing local stream that never ends, add a RED runtime test: calling the disposer itself must not throw synchronously; calling `[Symbol.asyncDispose]()` twice on the same handle must return the strictly identical Promise.
- [ ] Assert that the disposer requests cancellation only once, stops later reads/reconnects, releases the reader lock, and eventually settles. Reuse the parser's existing bounded-cancel behavior. Do not require a deliberately stuck provider `cancel()` Promise to complete.
- [ ] Add an error-terminal test: the disposer waits for teardown, but must not change an already settled `closed` result, and must not add a second error channel.
- [ ] Run the targeted tests:

  ```sh
  (cd packages/core && bunx vitest run --config vitest.config.server.ts src/sse/transport/event_stream.advanced.spec.ts src/sse/sse.spec.ts)
  ```

  Expected RED: the handle has no `Symbol.asyncDispose`, and the fire-and-forget `start()` Promise also cannot be awaited by the disposer.

- [ ] Save the current `start()` call as `lifecycleTask`, and keep the existing terminal `finishError` fallback:

  ```ts
  const lifecycleTask = start().catch((error: unknown) => {
    finishError(error);
  });
  ```

- [ ] Add only a closure-scoped `disposeTask: Promise<void> | undefined` and a non-`async` helper. Cache the Promise first, then call the existing `handle.close()` in a microtask, so synchronous re-entry does not create a second Promise, and convert any synchronous close exception into a Promise rejection:

  ```ts
  function disposeHandle(): Promise<void> {
    return (disposeTask ??= Promise.resolve().then(disposeOnce));
  }

  async function disposeOnce(): Promise<void> {
    handle.close();
    await Promise.all([closedDeferred.promise, lifecycleTask]);
  }
  ```

- [ ] The handle's `[Symbol.asyncDispose]()` returns `disposeHandle()` directly. Do not add an AbortController, and do not modify `close()`/`settleClosed()`.
- [ ] In `sse.spec.ts`, the short-circuit stream that actually owns the resource gains the same symbol and delegates to the existing `close()`/`closed`. Do not hide the contract with a cast.
- [ ] The SSE fake disposer in `packages/opentelemetry-server/src/test-utils.ts` caches one Promise, calls the fake's existing `close()` inside it, and waits for the same `closed`. It must not return a `Promise.resolve()` unrelated to the fake lifecycle.
- [ ] Rerun the targeted SSE Vitest and confirm types, Promise identity, a single close, reader release, and lifecycle completion.
- [ ] Rerun `(cd packages/core && bunx tsc --project tsconfig.json --noEmit)` and `(cd packages/opentelemetry-server && bunx tsc --project tsconfig.json --noEmit)`, and confirm both exit codes are `0` and the SSE structural fake also satisfies the new contract.

### Task 4: Bounded WebSocket AsyncDisposable lifecycle

**Files:**

- Modify: `packages/core/src/web_socket/web_socket.ts`
- Modify: `packages/core/src/interceptor/interceptor.ts`
- Modify: `packages/core/src/interceptor/interceptor.type.test.ts`
- Modify: `packages/core/src/client/client.type.test.ts`
- Modify: `packages/core/src/web_socket/web_socket.server.spec.ts`
- Modify: `packages/core/src/web_socket/web_socket.spec.ts`
- Modify: `packages/core/src/web_socket/web_socket.type.test.ts`
- Modify: `packages/opentelemetry-server/src/test-utils.ts`

**Interfaces:**

- `WebSocketSession<TIncoming, TOutgoing>` extends `AsyncDisposable`
- `WebSocketSessionLike` extends `AsyncDisposable`
- Structural implementations must provide `[Symbol.asyncDispose](): PromiseLike<void>`
- Keep the synchronous `close(code?, reason?): void`
- Keep the existing logical result of `closed: Promise<WebSocketCloseInfo>`
- Internally rename `ERROR_CLOSE_GRACE_MS` to `SOCKET_CLOSE_GRACE_MS`; the value stays `1_000`

- [ ] Add RED tests in `web_socket.type.test.ts` and `interceptor.type.test.ts`: both session interfaces are `AsyncDisposable`, a real session can be used with `await using`, and the symbol returns `PromiseLike<void>`.
- [ ] Add a negative assertion in `client.type.test.ts`: `Client` has no `[Symbol.asyncDispose]`.
- [ ] Run `(cd packages/core && bunx tsc --project tsconfig.json --noEmit)`. Expected RED: the session disposer assertion produces a new type diagnostic; the Client negative assertion already passes.
- [ ] Extend only the existing mock WebSocket constructor: count closes, delay or omit the close event, make `close()` throw, and report the listener count. Do not add a parallel socket mock. `closeErrors` must decide whether to throw by whether the array index exists, not by `typeof value !== 'undefined'`, so `throw undefined` can be simulated for real.
- [ ] Add RED runtime tests for these exact scenarios:

  | Scenario                                              | Required result                                                                                                                                                                                  |
  | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | Normal open socket                                    | The call itself does not throw synchronously; two calls return the same Promise; native `close()` is requested only once; the Promise does not resolve before the close event and lifecycle exit |
  | Reconnect delay in progress                           | The reconnect/heartbeat timer stops, and the disposer resolves                                                                                                                                   |
  | `onInvalidEvent` callback stuck                       | The callback wait uses the message signal; after the disposer aborts, it waits for the message-pump task to exit                                                                                 |
  | No close event sent                                   | `closed` still resolves to the manual `kind: 'closed'`; logical cleanup finishes within the one-second grace; only the disposer rejects with a `DOMException` whose `name === 'TimeoutError'`    |
  | native `close()` throws (including `throw undefined`) | Calling the disposer itself does not throw; listeners/queue/tasks are still cleaned up; the Promise finally rejects with that same original value                                                |
  | Already in the aborted/error terminal state           | The disposer only waits for its own teardown and does not reinterpret the logical `closed` as a physical clean close                                                                             |

- [ ] Each terminal state proves teardown through observable behavior: the callback has exited, the listener count is zero, no reconnect socket is created again, and the queue has terminated. Do not add a production debug getter for the test.
- [ ] In `web_socket.spec.ts`, add one `await using` smoke against the existing real local WebSocket server, proving the real handshake, message, and exit path can run. Keep the bounded exception branches in the server mock spec.
- [ ] Run the targeted tests:

  ```sh
  (cd packages/core && bunx vitest run --config vitest.config.server.ts src/web_socket/web_socket.server.spec.ts src/web_socket/web_socket.spec.ts)
  ```

  Expected RED: the session has no disposer, `run()`/the message pump is still fire-and-forget, and a missing close event also has no awaitable bounded teardown result.

- [ ] Save the existing `run()` Promise as `lifecycleTask` and keep the current failure-to-`finish` behavior. Add each message-pump Promise to a `Set<Promise<void>>` and delete it in `finally`.
- [ ] Pass the existing message signal to `notifyWebSocketInvalidEvent`, and wait for the callback through the existing `awaitWithSignal`, so abort can end the callback wait. Do not add another timeout helper.
- [ ] Add only closure-scoped disposal state:

  ```ts
  let disposeTask: Promise<void> | undefined;
  let disposeTimer: ReturnType<typeof setTimeout> | undefined;
  let disposeTimeout: DOMException | undefined;
  let hasCloseError = false;
  let closeError: unknown;
  let physicalCleanupDetach: (() => void) | undefined;
  ```

- [ ] Make `installPhysicalCleanup` return an idempotent detacher, and save it only on the existing double-native-close failure branch. The disposer's `finally` calls that detacher when it exists. The ordinary path still clears the socket through the existing attempt cleanup, and the old behavior of calling only `close()` stays unchanged.
- [ ] Implement a non-`async` `disposeSession()`: cache the Promise with `disposeTask ??= Promise.resolve().then(disposeOnce)` before any close side effect. The first `disposeOnce` runs in this order:

  1. Call the existing `session.close()` once. If it throws, record the original value, but keep cleaning up.
  2. If the lifecycle is not yet terminal, start the internal `SOCKET_CLOSE_GRACE_MS` timer.
  3. The timer callback checks `finished` again first. Only if it is not yet terminal, create `new DOMException('WebSocket close event was not observed before teardown timeout', 'TimeoutError')` and call `finish(toClosedInfo({}, manualClose), { skipNativeClose: true })`. `closed` therefore keeps the existing manual close `kind: 'closed'`, and only the disposer rejects on timeout.
  4. Wait for `lifecycleTask`. After it exits, wait for a stable snapshot of the remaining message-pump tasks. No new pump may be created after terminal.
  5. In `finally`, clear the disposer timer, and call the optional physical detacher only when it exists. The queue, listeners, controller, and state are still finalized only by `finish()`.
  6. If a native close error was captured, reject with it; otherwise, if the timer fired, reject with `disposeTimeout`; otherwise resolve.

- [ ] Do not use truthiness to decide whether close threw, because JavaScript allows `throw undefined`. Keep the explicit `hasCloseError`.
- [ ] The returned session's `[Symbol.asyncDispose]()` returns `disposeSession()` directly, so repeated calls keep Promise identity.
- [ ] Pass `disposeSession` to `createWebSocketSession` as a callback alongside `requestClose`, and expose it on the returned object. Do not add a class or a wrapper.
- [ ] `interceptor.type.test.ts` asserts that the symbol returns `PromiseLike<void>`.
- [ ] Explicit `WebSocketSessionLike` object literals in `web_socket.spec.ts` and `web_socket.server.spec.ts` gain the symbol and delegate to their existing `close()`/`closed`.
- [ ] The WebSocket fake disposer in `packages/opentelemetry-server/src/test-utils.ts` caches one Promise, calls the fake's existing `close()` inside it, and waits for the same `closed`. It must not return a separate resolved Promise.
- [ ] Rerun the targeted WebSocket Vitest and confirm every scenario in the table, the cleanup assertions, error priority, and the type contract.
- [ ] Rerun `(cd packages/core && bunx tsc --project tsconfig.json --noEmit)` and `(cd packages/opentelemetry-server && bunx tsc --project tsconfig.json --noEmit)`, and confirm both exit codes are `0` and the HTTP Client negative assertion still passes.

### Task 5: Public docs and source-compatibility audit

**Files:**

- Modify: `packages/core/README.md`
- Modify: `packages/opentelemetry-server/README.md`
- Modify: `doc/api/errors.md`
- Modify: `doc/core/errors.md`
- Modify: `doc/api/sse.md`
- Modify: `doc/core/sse.md`
- Modify: `doc/api/web-socket.md`
- Modify: `doc/core/web-socket.md`
- Modify: `doc/api/interceptors.md`
- Modify: `doc/core/interceptors.md`
- Modify: `doc/api/opentelemetry-server.md`
- Modify: `doc/plugins/opentelemetry-server.md`
- Modify (the brace expression below is an exact set of 100 files, not an open wildcard): `doc/{ar,de-DE,es-ES,fr-FR,ja-JP,ko-KR,ru-RU,zh-Hans,zh-Hant-HK,zh-Hant-TW}/{api/errors.md,core/errors.md,api/sse.md,core/sse.md,api/web-socket.md,core/web-socket.md,api/interceptors.md,core/interceptors.md,api/opentelemetry-server.md,plugins/opentelemetry-server.md}`
- Modify: `scripts/verify-packed-consumer.ts`

**Documentation contract:**

- Error: the unified tuple stays unchanged; `String(error)` can be logged directly; metadata is enumerable; `cause` uses the native cause chain; Struct helpers require cause narrowing.
- Telemetry: do not add a redactor or a sensitive-key policy; state clearly that the default `url.full` still does not append a separate `req.queryString`; show the application building its own full or redacted URL through `startSpanHook`; explain that the hook runs synchronously before Span creation, and a throw is only recorded and does not affect the request.
- SSE: show `await using`. The guarantee covers Defjs stopping reads/reconnects and releasing the reader lock, not completion of the provider cancel.
- WebSocket: show `await using`. Distinguish logical `closed` from bounded teardown, and state clearly that the API cannot prove the physical TCP connection is closed.
- HTTP: ordinary HTTP is request-scoped and is managed with timeout/`AbortSignal`, so Client is not `AsyncDisposable`.
- Consumer: the minimum lib contract of the public `.d.ts` is `ES2022`, `ESNext.Disposable`, `DOM`, and `DOM.Iterable`. The repository continues to verify with the pinned TypeScript 7 and does not promise untested older compiler versions.

- [ ] Before editing, search for stale wording:

  ```sh
  rg -n "toDiagnosticError|Object\.assign|requestHook|responseHook|\.close\(|\.closed|AsyncDisposable|redact|saniti" packages/core/README.md packages/opentelemetry-server/README.md doc
  ```

- [ ] Delete the stale `toDiagnosticError` adapter in `doc/core/errors.md`. Replace it with native `String(error)` and an explicit `error.cause instanceof StructError` narrowing.
- [ ] Update root English and the exact page set of all 10 enabled locales together. Each page keeps its existing language. Examples stay executable TypeScript, and terms must match the public interfaces.
- [ ] Add a source-compatibility note for custom `EventStreamHandle` and `WebSocketSessionLike` implementations: they must now implement `[Symbol.asyncDispose]`. This is a compile-time breaking change for structural implementations, but callers that only receive a Defjs handle gain no new runtime call requirement.
- [ ] In the interceptor docs for root English and every locale, add the standard disposer member of `WebSocketSessionLike`, and state that wrapping or forwarding a session must preserve that symbol.
- [ ] Tighten the packed consumer tsconfig from the broad `lib: ['ESNext', 'DOM']` to `['ES2022', 'ESNext.Disposable', 'DOM', 'DOM.Iterable']`, with target `ES2022`.
- [ ] Expand the generated `type-consumer.ts`: import `EventStreamHandle`, `WebSocketSession`, and `WebSocketSessionLike` from the packed `@defjs/core`, and compile all three handles with a `readonly AsyncDisposable[]` assignment and real `await using` syntax. Do not rely only on the `lib` setting to prove the declarations indirectly. That consumer is compiled only by `tsc --noEmit` and is not executed in the runtime smoke.

  ```ts
  import {
    createClient,
    type Client,
    type EventStreamHandle,
    type WebSocketSession,
    type WebSocketSessionLike,
  } from "@defjs/core";

  declare const stream: EventStreamHandle<unknown>;
  declare const session: WebSocketSession;
  declare const sessionLike: WebSocketSessionLike;

  const disposables: readonly AsyncDisposable[] = [
    stream,
    session,
    sessionLike,
  ];

  async function consumeManagedHandles(): Promise<void> {
    await using streamResource = stream;
    await using sessionResource = session;
    await using interceptorResource = sessionLike;
    void streamResource;
    void sessionResource;
    void interceptorResource;
  }

  void disposables;
  void consumeManagedHandles;
  ```

- [ ] Keep using the existing `test:packed` to verify the built `.d.ts`. Do not add a script or a test framework.
- [ ] Cover documentation code with the repository's existing test/build pipeline. Do not add a documentation test framework.
- [ ] Run a per-file content gate on every target document, so no locale is "listed in the file inventory but missing the content":

  ```sh
  for file in \
    doc/{api,core}/errors.md \
    doc/{ar,de-DE,es-ES,fr-FR,ja-JP,ko-KR,ru-RU,zh-Hans,zh-Hant-HK,zh-Hant-TW}/{api,core}/errors.md; do
    rg -q 'String\(error\)' "$file" && rg -q 'cause' "$file" || { echo "missing native error docs: $file"; exit 1; }
  done

  for file in \
    doc/{api,core}/{sse,web-socket,interceptors}.md \
    doc/{ar,de-DE,es-ES,fr-FR,ja-JP,ko-KR,ru-RU,zh-Hans,zh-Hant-HK,zh-Hant-TW}/{api,core}/{sse,web-socket,interceptors}.md; do
    rg -q 'AsyncDisposable|asyncDispose|await using' "$file" || { echo "missing disposal docs: $file"; exit 1; }
  done

  for file in \
    doc/{api,plugins}/opentelemetry-server.md \
    doc/{ar,de-DE,es-ES,fr-FR,ja-JP,ko-KR,ru-RU,zh-Hans,zh-Hant-HK,zh-Hant-TW}/{api,plugins}/opentelemetry-server.md; do
    rg -q 'startSpanHook' "$file" || { echo "missing startSpanHook docs: $file"; exit 1; }
  done
  ```

- [ ] Rerun the scoped search and inspect every remaining match by hand.

### Task 6: Cross-package verification and final review

**Files:** Review every file modified by Tasks 1-5. Do not modify unrelated dirty files for global formatting or lint output.

- [ ] Run the Core targeted server tests:

  ```sh
  (cd packages/core && bunx vitest run --config vitest.config.server.ts src/error/factory.spec.ts src/http/http.error.spec.ts src/sse/transport/event_stream.advanced.spec.ts src/sse/sse.spec.ts src/web_socket/web_socket.server.spec.ts src/web_socket/web_socket.spec.ts)
  ```

- [ ] Run the OpenTelemetry targeted tests:

  ```sh
  (cd packages/opentelemetry-server && bunx vitest run --config vitest.config.server.ts src/option.spec.ts src/telemetry/trace.spec.ts src/interceptor/http.spec.ts src/interceptor/sse.spec.ts src/interceptor/web_socket.spec.ts)
  ```

- [ ] Run the type gates of the two packages separately:

  ```sh
  (cd packages/core && bunx tsc --project tsconfig.json --noEmit)
  (cd packages/opentelemetry-server && bunx tsc --project tsconfig.json --noEmit)
  ```

- [ ] Run the full `bun run verify` and record the exit code. Separate new failures from dirty-baseline failures. Do not report a partial gate as full success.
- [ ] Run format and whitespace checks only on the paths listed in this plan, then check the scoped diff and `git status --short`. `oxfmt` must cover target files that are still untracked, because `git diff --check` does not check them:

  ```sh
  scoped_paths=(
    packages/core/src/error/factory.ts packages/core/src/error/factory.spec.ts packages/core/src/http/http.error.spec.ts \
    packages/core/src/sse/transport/event_stream.ts packages/core/src/sse/transport/event_stream.advanced.spec.ts packages/core/src/sse/sse.spec.ts packages/core/src/sse/sse.type.test.ts \
    packages/core/src/web_socket/web_socket.ts packages/core/src/web_socket/web_socket.server.spec.ts packages/core/src/web_socket/web_socket.spec.ts packages/core/src/web_socket/web_socket.type.test.ts \
    packages/core/src/interceptor/interceptor.ts packages/core/src/interceptor/interceptor.type.test.ts packages/core/src/client/client.type.test.ts \
    packages/opentelemetry-server/src/option.ts packages/opentelemetry-server/src/option.type.test.ts packages/opentelemetry-server/src/option.spec.ts packages/opentelemetry-server/src/test-utils.ts \
    packages/opentelemetry-server/src/telemetry/trace.ts packages/opentelemetry-server/src/telemetry/trace.spec.ts \
    packages/opentelemetry-server/src/interceptor/http.ts packages/opentelemetry-server/src/interceptor/http.spec.ts packages/opentelemetry-server/src/interceptor/sse.ts packages/opentelemetry-server/src/interceptor/sse.spec.ts packages/opentelemetry-server/src/interceptor/web_socket.ts packages/opentelemetry-server/src/interceptor/web_socket.spec.ts \
    packages/core/README.md packages/opentelemetry-server/README.md scripts/verify-packed-consumer.ts \
    doc/api/errors.md doc/core/errors.md doc/api/sse.md doc/core/sse.md doc/api/web-socket.md doc/core/web-socket.md \
    doc/api/interceptors.md doc/core/interceptors.md doc/api/opentelemetry-server.md doc/plugins/opentelemetry-server.md \
    doc/{ar,de-DE,es-ES,fr-FR,ja-JP,ko-KR,ru-RU,zh-Hans,zh-Hant-HK,zh-Hant-TW}/{api/errors.md,core/errors.md,api/sse.md,core/sse.md,api/web-socket.md,core/web-socket.md,api/interceptors.md,core/interceptors.md,api/opentelemetry-server.md,plugins/opentelemetry-server.md}
  )
  bunx oxfmt --check "${scoped_paths[@]}"
  git diff --check -- "${scoped_paths[@]}"
  ```

- [ ] Use a scoped search to verify the forbidden items:

  ```sh
  rg -n "class (HttpStatusError|TransportError|DefinitionError)|closeAndWait|ResourceManager|redact|sensitiveKeys" packages/core/src packages/opentelemetry-server/src
  rg -n -g '!*.spec.ts' -g '!*.test.ts' "async startSpanHook|startSpanHook: async" packages doc
  ```

- [ ] Start one read-only whole-plan acceptance review. Fix correctness/compatibility findings that are inside this plan's scope, then rerun the targeted tests that cover that fix and the full gate.

No commit step is included, because the user has not authorized a commit.
