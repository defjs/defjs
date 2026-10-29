# @defjs/core Hotspot and Optimization Analysis (2026-10-01)

The subject is `packages/core` in the current workspace (`feat/up`, including uncommitted changes). Every conclusion comes with a reproducible measurement, every change is delivered as a patch, and each patch passed the project gates on its own. This analysis did not modify any source code.

> **Second-round update (2026-10-01)**: All 10 patches have been applied to the workspace. N1-N8 and D1-D5 have also been implemented item by item, or kept after evaluation, and measurements were completed in real Chromium, Firefox, and WebKit browsers. Final results, new findings, and corrections to the earlier text of this report are in **Section 9**; Sections 1-8 keep the first-round original text.

## Conclusion

| Priority | Problem                                                                                                                                  | Result                                                                                                                                                                                                      | Patch      |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **P0**   | `deadline.release` is attached to the request signal and never removed, so HTTP, SSE, and WebSocket requests stay permanently referenced | With only `timeout` set, Node leaks +97 MB per 60k requests, Bun +21 MB; after the fix, essentially flat                                                                                                    | 0001       |
| P1       | HTTP `race`s repeatedly on the composite signal for every request                                                                        | Single item: Node `get-small` about −27% (three steps compounded inside 0002), `withTimeout` another −22% (0009). All patches combined: Node small requests −36% to −43%, Bun −9% to −24%; Promises 81 → 51 | 0002, 0009 |
| P1       | SSE and WebSocket pass every message through `awaitWithSignal`                                                                           | Throughput roughly doubles (Node −50%, Bun −52%/−49%)                                                                                                                                                       | 0006, 0007 |
| P1       | The outbound body rebuilds the encode plan on every call                                                                                 | 50-item order POST, single item: Node −28%, Bun −41%; combined allocation 534 → 241 KiB                                                                                                                     | 0004       |
| P1       | `client.execute` statically imports every transport layer                                                                                | An HTTP-only application bundle drops from 80.1 KB to 50.2 KB (−37%, gzip 24.6 KB → 15.4 KB)                                                                                                                | 0008       |
| P2       | Under V8, objects created with `Object.create(null)` are dictionary-mode objects                                                         | V8: decoded-object resident memory 246 → 62 B/object, reads −24%; JSC: decode +3% to +8%. Needs a decision                                                                                                  | 0010       |
| P2/P3    | The endpoint base URL is parsed twice per request; parse tags use `defineProperty`                                                       | Node −6%; heavy-tag input −6%                                                                                                                                                                               | 0003, 0005 |

After all 10 patches are merged:

- core tests grew from 1485 to 1492, all passing, and coverage stays at 100%. Of the 7 new tests, 4 were first run against the unpatched code to confirm they lock in existing behavior.
- Whole-repo `bun run verify` passed, including lint, fmt, release, tests for the four packages (including Chromium and Firefox), build, and packed consumer.

## 1. Method and Environment

- **Environment**: Apple M1 Max, 32 GiB memory, macOS. Node v26.10.0 (V8 14.6); Bun 1.4.2 (JSC).
- **Scenarios**: Walk the full `client.execute` path, with a mock fetch handle returning `Response` directly so the network is excluded. A separate `raw-fetch-json` scenario (mock handle + `res.json()`) is the lower bound of a "handwritten client". What is measured here is therefore **the client's own CPU and memory overhead**; real latency is dominated by the network, and this overhead matters for SSR or server-side throughput, mobile CPU usage, and streaming message throughput. Scenario definitions are in `bench/scenarios.mjs`.
- **Timing**: Primarily same-process alternating A/B measurement (`bench.sh pair`): 12 rounds of 200 ms each for the two builds, alternating which runs first, reporting the median and p25-p75 of the B/A ratio. Single-process before/after measurement noise is ±10% to 20% and is only a reference.
- **Allocation**: `node --expose-gc`, young generation set to 512 MiB so GC does not fire inside the measurement window, reading the delta of `heapUsed`.
- **Resident set and leaks**: The same long-lived signal sends tens of thousands of requests in a row; after each round, run GC 6 times (giving FinalizationRegistry a chance to clean up) and see whether the heap grows linearly.
- **Call-chain counts**: Hook `async_hooks` to count Promises, and wrap calls such as `AbortSignal.any`, `add/removeEventListener`, `Promise.race`, and `new URL/Request/Headers`, counting per operation.
- **Hotspots**: Node `--cpu-prof`, sampling interval 50µs, mapping bundle line numbers back to source files with `bench/analyze.py`; Bun uses `--cpu-prof-md`.
- **Size**: `bun build --minify --target=browser`, comparing three entries: full, HTTP-only, and struct-only.

Raw data is in `results/`; the mapping from change numbers to patches is in `results/legend.txt`.

## 2. Baseline Profile

### 2.1 Framework overhead

| Scenario                                       | Node                    | Bun     |
| ---------------------------------------------- | ----------------------- | ------- |
| `raw-fetch-json` (lower bound)                 | 2.5 µs                  | 0.52 µs |
| `get-small` (GET, path params, 5-field output) | 31.6 µs                 | 33.7 µs |
| `post-json` (8-field JSON body)                | 42.0 µs                 | 50.3 µs |
| `sse-2000-events`                              | 6.1 ms (3.1 µs/event)   | 5.2 ms  |
| `ws-2000-messages`                             | 3.8 ms (1.9 µs/message) | 3.3 ms  |

On Node, the simplest GET spends about 12x the lower bound on the framework.

### 2.2 CPU hotspots (Node, `get-small`)

- `node:abort_controller` accounts for 14.3% to 15.5%, `node:event_target` 6.0% to 6.9%, `SafeWeakRef` (primordials) 3.9% to 4.1%, `abort_listener` 1.2%. **Across two samples, 25% to 28% of CPU is spent on the AbortSignal machinery** (`results/profile-node-get-small-baseline.txt`). `refreshCompositeSignal`, `followCompositeSignal`, and `SafeWeakRef` all rank in the top ten by self time; they come from strong-reference registration when attaching and detaching listeners on the composite signal produced by `AbortSignal.any`.
- In the library's own code, inclusive time for `executeHttpCommand` is 36.5%, `fetchHandler` 26.5%, `createFetchRequest` (undici `Request`) 20.1%, `awaitWithSignal` 9.0%, `mergeAbortSignals` 8.9%, `resolveRequestUrl` 7.4%.

**Bun (`get-small`)**: native `read` self time is **39.3%**, from the reader loop in `parseFetchResponse`. The rest is `addEventListener` at 4.6%, plus `Request` and `URL` construction.

### 2.3 Per-request call chain

One `get-small` request (full data in `results/primitives-per-op.txt`):

| Count                                      | Baseline                  | After all patches |
| ------------------------------------------ | ------------------------- | ----------------- |
| Promise                                    | 81                        | 51                |
| `Promise.race` (`awaitWithSignal`)         | 5                         | 2                 |
| `AbortSignal.any`                          | 1 (2 when timeout is set) | 0                 |
| `addEventListener` / `removeEventListener` | 8 / 7 (**unbalanced**)    | 5 / 5             |
| `throwIfAborted`                           | 15                        | 11                |
| `new URL`                                  | 3                         | 2                 |

Sources of the 5 baseline `awaitWithSignal` calls:

1. The outer race on the interceptor chain (`http/http.ts:351`)
2. `fetchWithSignal`
3. The body read loop, once per chunk; a small body is 2 (`http/transport/fetch.ts:278`)
4. Declared-body decode (`http/http.ts:479`)

Of these, `fetchWithSignal` and the chunk race are attached to the composite signal `transportAbort` (`http/http.ts:309`); on Node, every attach and detach of a listener does strong-reference registration.

### 2.4 Memory

- **Allocation per operation** (Node, `results/alloc.txt`): `get-small` 42.2 KiB, `post-json` 60.3 KiB, `post-order-50` 534 KiB, `get-list-1000` 1207 KiB.
- **Leaks**: see P0.

### 2.5 Size

An HTTP-only application's bundle is 97% of the full bundle (80.1 KB versus 82.6 KB). SSE- and WebSocket-specific modules account for 30.3 KB (37.8%), because `client/client.ts:7-18` statically imports three executors.

## 3. Findings and Proposals

Each item is formatted as: evidence → root cause → proposal → measurement → risk. The measurement is a paired A/B of "this item only", taking the median, with p25-p75 in brackets.

### P0 · deadline listener leak (0001)

**Evidence**: `bench.sh leak`, heap growth after 6 GCs per round.

| Scenario (20k / 60k requests)         | Node baseline        | Node all patches           | Bun baseline        | Bun all patches  |
| ------------------------------------- | -------------------- | -------------------------- | ------------------- | ---------------- |
| HTTP `{ timeout }`                    | +28.9 / **+97.3 MB** | −1.4 / −1.4 MB             | +6.9 / **+20.6 MB** | ≈0 / ≈0          |
| HTTP `{ signal }` (long-lived signal) | +22.8 / +66.5 MB     | +1.2 / +2.3 MB             | +3.6 / +10.5 MB     | +0.13 / +0.14 MB |
| HTTP `{ signal, timeout }`            | +36.1 / +107.6 MB    | +0.5 / +4.1 MB             | +6.9 / +20.6 MB     | ≈0 / ≈0          |
| SSE `{ signal }` (5k / 15k streams)   | +5.6 / +17.0 MB      | +0.2 / −3.5 MB (GC jitter) | +0.95 / +2.65 MB    | +0.08 / +0.10 MB |

Under the baseline, Node leaks about 1.1 to 1.8 KB per request, Bun about 0.17 to 0.34 KB; SSE about 1.1 KB per stream (Node). All grow linearly with request count, and GC cannot reclaim them. Raw data is in `results/leak.txt`. With only 0001 applied, Node's three HTTP rows at 20k requests are +1.9, +2.1, and +0.6 MB respectively.

**Root cause**: `http/http.ts:247`, `sse/sse.ts:261`, and `web_socket/web_socket.ts:307` all run `requestSignal.addEventListener('abort', deadline.release, { once: true })`, and never remove it.

- When no timeout is set, this is a no-op listener, but it is still attached.
- Per the DOM spec, **a composite signal with an abort listener cannot be collected while its source signals are still alive**. As long as the caller holds a long-lived signal, each request's composite signal and its closures stay pinned, and this holds on any spec-compliant runtime.
- Node's implementation (`lib/internal/abort_controller.js`) registers composite signals that have listeners in the module-level `gcPersistentSignals` set, and removes them only when all of their source signals have been collected. The `deadline.release` closure itself references the deadline's controller, which is one of the source signals. That forms a cycle rooted at the global set: even with only `timeout` set, and the composite made entirely of the request's own signals, it is never collected. And a client-level `withTimeout` is exactly the most common production configuration. Bun's internal mechanism differs, but measurement shows the same leak (see the table above).

**Proposal**: Fix it at the shared boundary. `armTransportDeadline` gains `releaseOnAbort(signal)`: attach the listener only when a timer was actually armed, and `release()` removes it itself. All three transports switch to calling `deadline.releaseOnAbort(...)`. The change is in `internal/abort.ts`, about +13 lines.

**Tests**: `abort.spec.ts` adds 3 tests: no listener is attached when there is no deadline, the listener is removed on release, and release runs when the signal aborts.

**Residual risk**: Node's `AbortSignal.any` itself leaves weak-reference records on long-lived source signals. In a pure reproduction each composite signal is about 17 B; after all patches, the residual for HTTP reusing a long-lived signal is about 40 to 70 B/request (Node); under Bun, 60k requests total ≤0.14 MB. Eliminating it completely requires switching the caller signal to manual forwarding with explicit removal (see N7).

### P1 · HTTP signal pipeline (0002, 0009)

**Root cause and proposal**:

1. **Transport signal composed redundantly** (`http/http.ts:309`). In `mergeAbortSignals(transportController.signal, [requestSignal, nextRequest.abort])`, `nextRequest.abort` is usually `requestSignal`, so every request constructs a composite signal that contains a duplicate source. Listeners for the fetch read and the body read are then attached to it. But `transportController` already follows `requestSignal` through `abortTransport`, and a composite is needed only when an interceptor replaces the signal.

   Proposal: reuse `transportController.signal` directly in that case. Measured: Node **−22.7%** [−29.7, −20.1], Bun −3.2%.

2. **Body read races once per chunk** (`http/transport/fetch.ts:278`). Change it so the whole loop attaches a single abort listener, and on trigger calls `reader.cancel(reason)`. Per the Streams spec, cancel makes a pending `read()` return immediately with `done: true`, and the loop then throws abort. The existing test contract of "on abort, cancel the source, release the lock, and do not wait for cancel to finish" is fully preserved. Measured: Node −4.3% [−5.5, −4.1], Bun −4.2%.

3. **Synchronous decode is also wrapped in a race** (`http/http.ts:479`). Only Blob body reads are asynchronous and uncancellable; other bodies are already parsed values in the default transport.

   Proposal: race only for Blob; other paths `throwIfAborted` first, then decode synchronously. A cancellation check already existed after decode. Measured: Node −1.6%. Bun's decode-failure path **−42%**; the suspected reason is that a shallower async stack lowers the cost of capturing an Error stack. This has not been verified in isolation.

4. **A never-aborting signal is still composed when there is only a deadline** (`http/http.ts:246`). `controller` never aborts (`http/http.ts:235`), so composing it with the deadline is pointless.

   Proposal: when there is only a deadline, use the deadline's own signal as `requestSignal`. A caller-supplied signal still goes through composition, to avoid leaving listeners on the caller's object. Measured: `get-small-timeout` Node **−22.3%** [−33.7, −20.2], Bun −2.6%. This item is in 0009.

**Risk**: one observable difference. Previously the composite signal from `AbortSignal.any` was marked aborted before the source signal's listeners ran; now the transport signal aborts only inside the `abortTransport` listener. Both complete synchronously with the same reason. The full test suite (including browser, deadline-boundary, and interceptor-lifecycle regression tests) all passed.

**New test**: `fetch.response.spec.ts` adds one case covering the abort path when cancel is rejected, and it was verified to pass on the baseline.

### P1 · SSE per-event path (0006)

**Evidence**: In the baseline Node profile, `refreshCompositeSignal` is 9.2%, inclusive time of `awaitWithSignal` is about 20%, per-event `TextDecoder.decode` is 12.4%, and per-event undici header validation is about 3%.

**Root cause**:

- `sse/transport/event_stream.ts:360`: every event runs `awaitWithSignal(transformMessage)` once, and it is attached to the composite signal `attemptAbort`.
- `sse/sse.ts:337`: `transformMessage` is wrapped in two layers of async.
- `event_stream.ts:348`: every `id:` received runs `headers.set('last-event-id')` once, but this header is only needed on the next reconnect.
- `sse/transport/parser.ts:143`: every line `await`s `onLine`; the message parser at `parser.ts:179` is an async function, so every line produces a Promise.
- `parser.ts:207`: every line decides the field type by decoding the field name.

**Proposal**:

- When transform returns a synchronous value, enqueue it directly; race only when it returns a Promise.
- `transformStreamMessage` returns synchronously when the event is valid; only invalid events wait for `onInvalidEvent`.
- Mark `Last-Event-ID` dirty and write the header when the next connection starts.
- The line parser awaits only when the callback actually returns a Promise.
- Compare field names by bytes. To stay consistent with the previous `TextDecoder` behavior, skip one leading BOM.

**Measured**: Node **−55.0%**, Bun **−52.5%**.

**New tests** (all verified to pass on the baseline):

- Field names match by bytes; BOM; lookalike field names are ignored
- After an empty `id:`, reconnect drops `Last-Event-ID`

**Risk**: the timing of the `onInvalidEvent` callback changed: it used to always be one microtask late, and now it runs synchronously with message handling. The callback is still fire-and-forget, and existing tests all pass.

### P1 · WebSocket receive path (0007)

**Root cause**: `web_socket/web_socket.ts:736` runs `awaitWithSignal(transformWebSocketMessage)` once per message, and that transform function is itself async.

**Proposal**: Add a synchronous `decodeWebSocketMessage`: text and byte frames decode synchronously; only Blob frames return a Promise, and only Blob is raced. The previously exported `transformWebSocketMessage` is kept (changed to wrap one async layer), so its unit tests do not need changes.

**Message order**: guaranteed by the existing serial message pump (`rawMessages` queue, `await handleMessage` one by one). Related regression tests continue to pass ("preserve physical message arrival order when Blob decodes finish out of order").

**Measured**: Node −49.9%, Bun −49.6%.

### P1 · Outbound encode plan (0004)

**Evidence**: In the profile of `post-order-50` (a 50-item array body), `encodeObjectNode` and `writeWireGroups` dominate. Every call on an object node allocates `Set` ×2, a `Map`, an `order` array, and `WireGroup` objects, and calls `guideTag` once per field.

**Root cause**: `encodeObjectNode` at `internal/outbound_request.ts:383` is a general path designed for multiple members (intersection, record, passthrough), while the most common case is a single object struct.

**Proposal**: A single object struct takes a fast path. Its wire keys are already unique (guaranteed by `assertUniqueWireKeys`), so each field is one ordinary write. The field-key set and the wire-key set are cached in a `WeakMap` keyed by the struct's already-cached field table. This path is equivalent to the general path item by item (analysis is in the patch); multiple members still take the original general path.

**Measured**:

| Scenario        | Node       | Bun        |
| --------------- | ---------- | ---------- |
| `post-order-50` | **−27.6%** | **−40.6%** |
| `post-json`     | −7.8%      | −6.8%      |

After merging the other patches, allocation for `post-order-50` drops from 534 to 241 KiB.

**New test**: `union-equivalence.spec.ts` adds one case for extra keys, `undefined`, and wire-alias conflicts on a multi-member object. After the fast-path split, these branches, previously covered by single-object tests, are no longer covered and need this test. Verified to pass on the baseline.

### P1 · Transports can be tree-shaken (0008)

**Root cause**: `client/client.ts:7-18` statically imports `executeHttpCommand`, `executeEventStreamCommand`, and `executeWebSocketCommand`.

**Proposal**: A command carries its own executor via `Symbol.for('defjs.command.execute')`, written by `defineRequest`, `defineEventStream`, and `defineWebSocket` when the command is created. `client.execute` still validates the three command types first, then calls the matching executor. The public API and type signatures are unchanged.

**Measured**:

| Entry     | Baseline               | After the patch                               |
| --------- | ---------------------- | --------------------------------------------- |
| HTTP only | 80,113 B (gzip 24,621) | **50,189 B (gzip 15,445)**                    |
| Full      | 82,570 B               | 84,161 B (+1.9%, the total of all 10 patches) |

**Risk**: the command object gains one symbol-keyed property. No test in the project structurally compares commands with `toEqual`, and the React and Vue plugins depend only on the `Client` type.

### P2 · Fast null-prototype objects (0010, needs a decision)

**Evidence**:

- In V8, objects created with `Object.create(null)` are dictionary mode (`%HasFastProperties === false`). Changing to `{}` then `Object.setPrototypeOf(o, null)` keeps fast properties, the prototype is still `null`, and a `__proto__` key is still an ordinary own data property.

| Engine            | Field reads after decode | decode itself | Resident memory/object | `struct-decode-1000` allocation |
| ----------------- | ------------------------ | ------------- | ---------------------- | ------------------------------- |
| V8 (Node, Chrome) | **−23.8%**               | −1.8%         | **246 → 62 B**         | 975 → 639 KiB                   |
| JSC (Bun, Safari) | +3.1%                    | +7.5%         | 74 → 75 B (unchanged)  | —                               |

**Proposal**: Object nodes whose struct defines keys switch to `nullObject()`, covering parse, intersection merge, and encode output. Records keep `Object.create(null)`, because keys are arbitrary, dictionary mode fits better, and it avoids hidden-class explosion. The safety contract (output prototype is `null`) is unchanged, and `parse.security.spec.ts` passes.

In JSC microbenchmarks, field reads on `setPrototypeOf` objects fluctuate by 5 to 17 ns between runs (`results/null-prototype-objects.txt`), so the JSC side uses end-to-end paired results: +3.1% for this item alone, +4.2% after all patches.

**Decision point**: this trades 3% to 8% slower decode under JSC for resident memory down to about a quarter and 24% faster reads under V8. Recommended for a user base aimed at browsers and Node. It is last in the series and can be skipped outright without affecting the other patches.

### P2/P3 · Remaining small items

- **0003 endpoint base URL cache**: `internal/url.ts:187` runs `new URL(base)` plus three setters per request, plus one `new URL(path, base)`. Change to a single-entry cache keyed by the endpoint string; `new URL(path, base)` only reads the base, so it can be shared. Also skip `url.search = ''` when the query string is empty. Measured: Node −6.4% [−8.9, −6.1], Bun not significant.
- **0005 tag by ordinary assignment**: during parse, tagging a newly created null-proto node uses `obj[STRUCT] = tag` instead of `Object.defineProperty`. The property attributes produced are identical (enumerable, writable, configurable). `attachPassthroughGuides` still uses `defineStructTag`, because it may act on the caller's own object. Measured: heavily tagged `post-order-50` is −6.1% on Node, Bun not significant.

## 4. Not Implemented

These items have supporting evidence, but they need a contract-level decision, or the gain does not justify the change.

| ID  | Finding                                                                         | Evidence                                                                                                                                                                                                             | Recommendation                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1  | Reading the body with a reader loop is slow under Bun                           | `read` self time 39%; on real loopback HTTP, the reader loop is 7 to 12 µs slower than `res.text()` (small body) or 98 to 104 µs (70 KB); Node's difference is within noise (`results/body-read-and-primitives.txt`) | When there is no `downloadProgress`, read the whole body once with `response.arrayBuffer()` to remove this overhead. But that would violate the test contract "on abort, cancel the source and release the lock" (`fetch.response.spec.ts`, stalled-body case), because a custom handle that ignores the signal can no longer cancel the body. **Needs a contract decision**; if a Bun server is an important target, only the native `fetch` Response can be allowed through |
| N2  | struct parse cost is about equal to `JSON.parse`                                | In `get-list-1000`, struct parse is 41.9% and `JSON.parse` is 40.3%; every field allocates a `success()` result object, and `parseChildValue` has path push/pop plus try/finally                                     | Switch to a sentinel return value plus a failure slot. The parse portion is expected to be 20% to 30% faster, but it requires rewriting `parse.ts` (529 lines) and the primitive `decode` hooks. Suitable as a standalone project, with the bench as the gate                                                                                                                                                                                                                 |
| N3  | SSE line scanning is a byte-by-byte JS loop                                     | After 0006, `createLineParser` is 19% of SSE CPU                                                                                                                                                                     | Use `Uint8Array#indexOf` for a native search, expected about 10%. P3                                                                                                                                                                                                                                                                                                                                                                                                          |
| N4  | `fetch(request)` constructs another Request                                     | The spec requires fetch to run `new Request(input)` internally, about 3 µs each time on Node                                                                                                                         | Avoiding it means passing `(url, init)` to `FetchHandle`, which changes the arguments a custom handle receives. Not recommended                                                                                                                                                                                                                                                                                                                                               |
| N5  | Both fault and StructError are Errors and capture a stack                       | Two Errors are created on decode failure                                                                                                                                                                             | This is a design tradeoff (debuggability); keep it                                                                                                                                                                                                                                                                                                                                                                                                                            |
| N6  | Headers are copied twice (once in `createFetchRequestInit`, once inside undici) | About 0.3 µs each time                                                                                                                                                                                               | The gain is too small; skip                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| N7  | Residue of Node `AbortSignal.any` on long-lived source signals                  | About 17 B per composite signal in a pure reproduction                                                                                                                                                               | Worth changing to manual forwarding plus explicit removal only when "the same caller signal is reused millions of times" is a real usage                                                                                                                                                                                                                                                                                                                                      |
| N8  | SSE still has nested composite signals                                          | `[requestSignal, req.abort]` at `sse/sse.ts:333` contains a duplicate source, and `event_stream.ts:247` composes another layer                                                                                       | After 0001 there is no longer a leak, and the per-event cost was already moved by 0006; what remains is once-per-stream overhead. P3                                                                                                                                                                                                                                                                                                                                          |

## 5. Code Volume and Duplication

These are not performance problems. They are size and maintenance cost, listed for later cleanup. None of them are in the patch scope.

| Item                                   | Location                                                                                                                                                                         | Notes                                                                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Two nearly identical `fetchWithSignal` | `http/transport/fetch.ts:190`, `sse/transport/event_stream.ts:539`                                                                                                               | Can be merged into `internal/`                                                                                                  |
| Three "bytes → text/JSON" read logics  | `http/http.ts:493` `bytesToText`, `web_socket/codec.ts:27`, `event_stream.ts:617` `readHandshakeBody` (plus `parseBytesBody` in `utils.ts`)                                      | There are also 7 places that `new TextDecoder()` on every call, while `http/transport/utils.ts:3` already has a shared instance |
| Two media-type parsers                 | `http/transport/utils.ts:32` `isJsonMediaType` (validates essence only); `event_stream.ts:674` `parseMediaTypeEssence` (about 105 lines, a full parameter-syntax implementation) | Strictness differs; merging requires unifying the semantics first                                                               |
| Duplicate type guards                  | `internal/outbound_request.ts:726-744` and `http/transport/body.ts:89-95`, `fetch_init.ts:6`                                                                                     | Can be shared                                                                                                                   |
| A `controller` that never aborts       | `http/http.ts:235`                                                                                                                                                               | After 0009 it is used only when there is no signal source at all                                                                |

## 6. Summary: Baseline vs All Patches

Same-process paired measurement, median plus p25-p75 (raw data in `results/pair-baseline-vs-all-patches.txt`).

| Scenario                          | Node                                     | Bun                               |
| --------------------------------- | ---------------------------------------- | --------------------------------- |
| `ping-no-decl`                    | 18.9 → 10.8 µs **−42.1%**                | 7.0 → 5.2 µs −23.8%               |
| `get-small`                       | 31.6 → 19.9 µs **−37.1%** [−38.5, −34.4] | 33.7 → 27.2 µs −19.7%             |
| `get-small-timeout`               | 37.5 → 21.8 µs **−42.6%**                | 45.0 → 36.7 µs −15.7%             |
| `get-small-2-interceptors`        | 33.4 → 20.3 µs −39.1%                    | 54.8 → 49.3 µs −8.8%              |
| `get-query` (decode failure path) | 41.8 → 27.8 µs −33.9%                    | 210.7 → 52.6 µs **−75.3%**        |
| `post-json`                       | 42.0 → 25.8 µs −38.2%                    | 50.3 → 39.9 µs −20.3%             |
| `post-order-50`                   | 163 → 95 µs −41.3%                       | 158 → 91 µs −41.2%                |
| `error-404-declared`              | 36.0 → 23.1 µs −35.7%                    | 47.4 → 38.4 µs −16.0%             |
| `get-list-1000`                   | 810 → 772 µs −3.6%                       | +6.9% [−7.7, +8.6] (within noise) |
| `struct-decode-1000+read`         | 579 → 445 µs −24.1%                      | +4.2%                             |
| `sse-2000-events`                 | 6.12 → 3.01 ms **−50.1%**                | 5.17 → 2.46 ms −52.1%             |
| `ws-2000-messages`                | 3.77 → 1.99 ms **−46.5%**                | 3.32 → 1.70 ms −48.5%             |

Allocation per operation (Node, KiB, `results/alloc.txt`):

| Scenario             | Baseline | After all patches |
| -------------------- | -------- | ----------------- |
| `get-small`          | 42.2     | 30.9              |
| `get-small-timeout`  | 44.3     | 31.5              |
| `post-json`          | 60.3     | 39.7              |
| `error-404-declared` | 42.1     | 31.1              |
| `post-order-50`      | 534      | 241               |
| `get-list-1000`      | 1207     | 858               |

## 7. How to Apply and Reproduce

Patches must be applied in order. Each patch passed the gates on its own on top of the previous one: core tests including browsers, 100% coverage, typecheck, lint, fmt.

```sh
cp -R packages/core/src "${TMPDIR:-/tmp}/core-src-before"   # keep a baseline copy for comparison
git apply docs/perf/2026-10-01/patches/*.patch             # apply all; drop 0010 from the list if you do not want it
bun run verify
```

- **Leak fix only**: apply 0001 alone; it applies directly to the current code. Applied alone, HTTP leaks for 20k requests on Node drop from +22.8/36.1/28.9 MB (`signal`, `signal+timeout`, `timeout`) to +2.1/0.6/1.9 MB; the remainder is removed by 0002 and 0009.
- **Skip 0010**: just drop it; the first 9 patches do not depend on it.
- **Dependencies**: the other patches edit the same set of files and are not guaranteed to apply alone out of order.

Reproduce the measurements (run from the repo root; needs node ≥ 26 and bun ≥ 1.4):

```sh
B=docs/perf/2026-10-01/bench/bench.sh
$B pair "${TMPDIR:-/tmp}/core-src-before" packages/core/src          # baseline vs current, paired A/B
$B pair "${TMPDIR:-/tmp}/core-src-before" packages/core/src get-small sse-2000-events
$B run packages/core/src get-small post-json                        # single-run timing plus allocation
$B count packages/core/src get-small                                # platform primitive counts per request
$B leak packages/core/src                                           # resident test of a shared signal
$B profile packages/core/src get-small                              # CPU profile summary
```

## 8. Limitations

- All timings were measured on the same machine. Real network latency hides these differences; these numbers measure client CPU and memory.
- (First round) Browsers only got functional tests, not benchmarks. This was filled in during the second round; the conclusions were revised, see Section 9.
- For GC-heavy scenarios such as `get-list-1000`, paired-measurement spread is about ±5%. Conclusions marked "within noise" in the report all come from this kind of scenario.
- 0006 changed when `onInvalidEvent` is called (from one microtask late to synchronous). The current public contract does not constrain this, but if a downstream depends on that timing, it needs attention.

## 9. Second Round: Implementation, Real-Browser Verification, and Corrections

### 9.1 What was done

How it was executed: the lead split the tasks, dispatched them, and accepted them independently. Implementation was handed to external agents (after the copilot quota was exhausted and the cursor bill was blocked, switched to codex gpt-6-astra xhigh). Each agent worked in its own clone. The lead integrated in order, ran the gates after every integration, and remeasured performance itself, without adopting the agents' self-reported numbers directly.

| Item                                                               | Result                                                                                                             | Basis                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| patch 0001-0010                                                    | Applied                                                                                                            | A full workspace backup from before the changes is at `refs/backup/perf-before-2026-10-01`                                                                                                                                                |
| 0006/0007 test hardening                                           | 66 new tests, each reverse-checked (it really fails when the code is broken)                                       | Found two regressions in 0006: after a synchronous abort, transform returning a rejected Promise produces an unhandled rejection; a value returned after a synchronous abort is still delivered. **Both are fixed**, and tests were added |
| N1 default handle reads the body in one piece                      | Implemented, effective only for the library's default handle (identified by function identity)                     | A shared suite of 44 cases run once each on Bun, Chromium, and Firefox, plus a differential test against a real server                                                                                                                    |
| N2 struct parse protocol rewrite                                   | Implemented                                                                                                        | 66 characterization tests (65 also pass on the old parser); all 57 mutants killed                                                                                                                                                         |
| N3 native `indexOf` line scan                                      | **Not adopted**                                                                                                    | Implemented and measured in 6 paired runs: Node 4% to 10% slower, Bun 3% to 6% faster, which does not meet "keep only if faster"                                                                                                          |
| N4 default handle no longer constructs `Request` a second time     | Implemented                                                                                                        | Same suite as N1. Side effect: fixed an old Firefox issue (the old code cancelled the upload stream via `request.body`, but Firefox's `Request.body` is `undefined`, so it never cancelled)                                               |
| N5 fault stays an Error                                            | Kept                                                                                                               | Design tradeoff; stack information is needed for debugging                                                                                                                                                                                |
| N6 copy-on-write Headers                                           | Kept                                                                                                               | Would change the object identity of `init.headers`, an observable behavior change                                                                                                                                                         |
| N7 drop `AbortSignal.any`, switch to explicit forwarding + release | Implemented                                                                                                        | 12 lifecycle tests checking add/remove balance of listeners on the caller signal                                                                                                                                                          |
| N8 dedupe SSE composite signals                                    | Implemented                                                                                                        | Same as above                                                                                                                                                                                                                             |
| D1-D4 dedupe                                                       | Implemented: shared `internal/fetch.ts`, `bytes.ts`, `media_type.ts`, `media_type_parameters.ts`, `type_guards.ts` | The first version pulled SSE-specific parameter-syntax checks into the HTTP path, HTTP-only package +973 B (the problem stated in the task brief); after rework, parameter checks became a standalone module referenced only by SSE       |
| D5 http.ts base controller                                         | Kept                                                                                                               | When a request has neither a caller signal nor a timeout, it is that request's own signal, not dead code                                                                                                                                  |
| Real-browser bench                                                 | Added `bench/browser/run.mjs` (`pair` and `memory`, based on Playwright)                                           | Control-group ratios on identical source are around ±1%                                                                                                                                                                                   |

Gates: core tests grew from 1492 to **1774**, coverage 100%; whole-repo `bun run verify` passed (EXIT=0, including the docs site build and packed consumer). Production code changed 30 files, tests changed 17 files (+2913 lines).

### 9.2 Final comparison: original code vs all changes

Same-process paired measurement, taking the median. Raw data is in `results/round2/`.

| Scenario                              | Node                    | Bun        | Chromium             | Firefox    | WebKit               |
| ------------------------------------- | ----------------------- | ---------- | -------------------- | ---------- | -------------------- |
| `ping-no-decl`                        | −38.3%                  | −21.7%     | −17.7%               | +0.5%      | −23.7%               |
| `get-small`                           | **−37.0%**              | −18.2%     | −6.9%                | −21.6%     | −17.8%               |
| `get-small-timeout`                   | **−42.4%**              | −12.7%     | −11.4%               | −19.3%     | +1.0% (within noise) |
| `get-small-2-interceptors`            | −37.6%                  | −21.7%     | −4.3%                | −21.0%     | −23.9%               |
| `get-query` (decode failure path)     | −35.1%                  | **−81.2%** | −16.0%               | −21.5%     | −21.7%               |
| `post-json`                           | −37.7%                  | −17.4%     | −10.1%               | −21.9%     | −21.0%               |
| `post-order-50`                       | −43.5%                  | −51.9%     | −33.6%               | −19.2%     | −43.2%               |
| `error-404-declared`                  | −35.7%                  | −13.7%     | −11.1%               | −22.6%     | −26.6%               |
| `get-list-1000`                       | −6.0%                   | −32.7%     | −26.8%               | −7.7%      | −30.2%               |
| `struct-decode-1000`                  | −7.9%                   | **−50.2%** | +1.1%                | −10.4%     | −45.5%               |
| `struct-decode-1000+read`             | −27.6%                  | −48.1%     | −34.4%               | −15.6%     | −43.1%               |
| `sse-2000-events`                     | −57.4%                  | −57.3%     | −60.2%               | **−90.4%** | −59.7%               |
| `ws-2000-messages`                    | −47% to −82% (two runs) | −53.2%     | −55.3%               | −59.6%     | −59.0%               |
| `net-get-small` (real loopback)       | −12.3%                  | −25.6%     | −3.1%                | 0.0%       | +0.9%                |
| `net-get-list` (real loopback, 85 KB) | **+4.6%**               | −30.4%     | +2.5% (within noise) | −3.3%      | −9.0%                |

Resident memory (60k requests / 15k SSE streams, multiple GCs after each round):

| Scenario                       | Node original → final                                                     | Bun original → final | Chromium (CDP) original → final |
| ------------------------------ | ------------------------------------------------------------------------- | -------------------- | ------------------------------- |
| HTTP `{ timeout }`             | +94.4 MB → +23 KB                                                         | +20.6 MB → +28 KB    | **+77.8 MB** → +1.2 MB          |
| HTTP `{ signal }`              | +69.5 MB → +1.3 MB (plateaus and falls back at 120k and 200k, not a leak) | +10.5 MB → +0.17 MB  | +46.1 MB → +0.8 MB              |
| HTTP `{ signal, timeout }`     | +107.6 MB → −1.4 MB                                                       | +20.6 MB → +32 KB    | +81.2 MB → +0.3 MB              |
| SSE `{ signal }`               | +17.0 MB → +0.35 MB                                                       | +2.7 MB → +0.11 MB   | +11.6 MB → +1.3 MB              |
| Decoded-object resident / each | 246 → 62 B                                                                | 74 → 75 B            | 144 → 52 B                      |

Chromium's 0.3 to 1.3 MB after the fix is inside the control group's noise band (±1.4 MB).

Bundle size (`bun build --minify --target=browser`, bytes):

| Entry       | Original             | Final                            |
| ----------- | -------------------- | -------------------------------- |
| HTTP only   | 80,113 (gzip 24,614) | **50,873 (gzip 15,809), −36.5%** |
| Full        | 82,570 (gzip 25,264) | 84,630 (gzip 26,349), +2.5%      |
| Struct only | 17,647               | 17,794, +0.8%                    |

Per request (`get-small`): Promises 81 → 55, `Promise.race` 5 → 2, `AbortSignal.any` 1 → 0, listener add/remove from 8/7 (unbalanced) to 5/5, `new URL` 3 → 2.

### 9.3 Corrections to earlier sections

1. **The P0 leak is not Node-specific.** The earlier text's claim that "a long-lived signal also leaks in browsers" was an inference; measured on Chromium, **timeout alone** leaks +77.8 MB over 60k requests, a wider scope than inferred. The root-cause description of P0 in Section 3 still holds: a listener that is never removed keeps the composite signal permanently referenced.
2. **V2 (0010) gains in browsers differ from Node.** Measured alone, Chromium decode +5.2%, Firefox decode +11.2%; "read after decode" is only 2.6% faster on Chromium, far from Node's 24%. The memory gain holds on Chromium (144 → 52 B). After merging N2, decode on all three browsers is flat or faster, so V2 is kept.
3. **N1 has a small cost on Node for large bodies** (`net-get-list` +4.6%; task A's self-test was +0.4% to +3.2%). Small bodies on Node are −12%; on Bun both large and small bodies are −26% to −30%; in browsers network time dominates and it is essentially flat.
4. The timing change of 0006's `onInvalidEvent` is now locked by tests (handled synchronously; an async callback blocks later events); both 0006 regressions are fixed.

### 9.4 Reproduction

```sh
cp -R packages/core/src "${TMPDIR:-/tmp}/core-src-before"   # or use git archive refs/backup/perf-before-2026-10-01 to extract the original code
docs/perf/2026-10-01/bench/bench.sh pair <before-src> packages/core/src [scenario...]
docs/perf/2026-10-01/bench/bench.sh pair <before-src> packages/core/src net-get-small net-get-list
node docs/perf/2026-10-01/bench/browser/run.mjs pair <before-src> packages/core/src [--browsers chromium,firefox,webkit] [scenario...]
node docs/perf/2026-10-01/bench/browser/run.mjs memory <before-src> packages/core/src
docs/perf/2026-10-01/bench/bench.sh leak packages/core/src
```

The WebKit column uses the WebKit build 2359 that ships with Playwright 1.63 (WebKit 26.6); raw data is in `results/round2/pair-webkit-2359.txt`. Earlier WebKit data in `pair-browsers.txt` comes from build 2336, and the two results agree. Machine load during measurement was 6 to 10 (other tasks running in parallel); scenarios such as `get-list-1000` have a wide p25-p75 in browsers.
