# Load balancing & failover [#load-balancing--failover]

When an application configures multiple base URLs by calling `withEndpoint(...urls)`, Defjs can distribute requests across replicas, eject hosts that keep failing for a while, skip hosts that your own health function rejects, and optionally retry a failed call on another endpoint. Defjs does not decide what healthy means: only a function that you supply can mark an endpoint unhealthy.

## 1. Choose a load balancer strategy [#1-choose-a-load-balancer-strategy]

| Strategy                                                                 | Best for                                                                   | Default health filtering                |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------- | --------------------------------------- |
| [`pickFirstBalancer(options?)`](/api/core/pickfirstbalancer) _(Default)_ | Browser apps with an ordered primary + backup region list                  | Off (opt-in via `outlierDetection: {}`) |
| [`roundRobinBalancer(options?)`](/api/core/roundrobinbalancer)           | Server-to-server calls across equal replicas (supports optional `weights`) | Off (opt-in via `outlierDetection: {}`) |
| [`p2cBalancer(options?)`](/api/core/p2cbalancer)                         | Server calls where replica latency or in-flight load varies                | Off (opt-in via `outlierDetection: {}`) |

<Tabs items={["Primary / backup (Pick-first)", "Server peers (Round-robin & P2C)", "Custom balancer"]}>
<Tab>

```typescript
import { createClient, defineRequest, struct, withEndpoint } from "@defjs/core";

const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), status: struct.string() }),
});

const client = createClient(
  withEndpoint("https://api-us.example.com", "https://api-eu.example.com"),
);

async function main() {
  const [error, order] = await getOrder(client, { id: 1 });
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(order.status);
}

void main();
```

</Tab>
<Tab>

```typescript
const client = createClient(
  withEndpoint(...endpoints),
  withBalancer(
    roundRobinBalancer({
      outlierDetection: {
        consecutiveFailures: 5,
        minPenaltyMs: 1000,
        maxPenaltyMs: 60000,
        jitterRatio: 0.5,
      },
    }),
  ),
);

const plain = roundRobinBalancer();
const latencyAware = p2cBalancer({ choiceCount: 2, decayMs: 10000 });
// A custom strategy can use exactly the same filter.
const wrapped = outlierDetection(plain, { consecutiveFailures: 3 });
```

</Tab>
<Tab>

```typescript
import {
  createClient,
  defineRequest,
  ERR_NO_CANDIDATE,
  struct,
  withEndpoint,
  withBalancer,
} from "@defjs/core";
import type { Balancer } from "@defjs/core";

const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), status: struct.string() }),
});

const fixed: Balancer = {
  pick({ endpoints }) {
    const endpoint = endpoints[0];
    if (endpoint === undefined) return [ERR_NO_CANDIDATE, undefined];
    return [
      null,
      {
        endpoint,
        start() {
          console.log("Attempt started", endpoint);
        },
        end(info) {
          console.log("Peer responded", endpoint, info.code);
        },
        done(info) {
          console.log("Attempt finished", endpoint, info.attempted);
        },
      },
    ];
  },
};

const client = createClient(
  withEndpoint("https://api-us.example.com", "https://api-eu.example.com"),
  withBalancer(fixed),
);

async function main() {
  const [error, order] = await getOrder(client, { id: 1 });
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(order.status);
}

void main();
```

</Tab>
</Tabs>

### How `pickFirstBalancer` and `p2cBalancer` work [#how-pickfirstbalancer-and-p2cbalancer-work]

- **`pickFirstBalancer`**: Stays on the first URL and advances on `NET_UNREACHABLE` or `NET_UNAVAILABLE` (HTTP 502, 503, or 504). Order and the sticky endpoint follow the client's whole endpoint list (`members`). A retry picks again from every endpoint, so it follows the same rule: after a refused connection or a 502, 503, or 504 it reaches the next endpoint, and after a timeout, which does not advance pick-first, it tries the same endpoint again. Configure `failbackMs: 30_000` to return to the first endpoint by time alone: once the sticky endpoint has been away from the first for that long, the next pick whose candidates include the first endpoint selects it and makes it sticky again. Nothing judges whether the first endpoint has recovered. If it fails again, the advance rule above moves away from it and the time starts anew. Choose a `failbackMs` that is longer than the time between picks, such as an SSE or WebSocket reconnect delay; otherwise every pick returns to the first endpoint.
- **`roundRobinBalancer` without weights**: A counter starts at a random `uint32`, and every `pick` advances it, including the pick made for a retry or a stream reconnect. Without `outlierDetection`, and with calls that run one after another, an endpoint that fails persistently therefore receives more than 1/n of the first attempts. With exactly two endpoints and retries enabled it receives all of them, so every call needs one retry. Concurrent calls interleave their picks and break this pattern. With `outlierDetection: {}` the failing endpoint is ejected for a while.
- **`roundRobinBalancer` weights**: A missing weight is `1`; configured weights are positive finite numbers. Smooth weighted round-robin preserves proportional selection (for example, `3:1` gives three selections per four for the heavier peer). Extreme magnitudes are scaled to avoid overflow; ratios below floating-point precision may round to zero. Selection and stale-current cleanup take O(member count + candidate count) work per pick.
- **`p2cBalancer` (Power of Two Choices)**: Samples two distinct candidates without replacement and picks the one with the lower score: `PeakEwma RTT × (pending + 1)` (or in-flight `pending` count when `load: "pending"`). Defaults (`defaultRttMs: 30`, `decayMs: 10000`) follow Linkerd/tower conventions. Pending is reserved the moment `pick` selects the endpoint, so a burst of calls in the same tick spreads across endpoints, and it is released when the peer response begins (HTTP response headers, SSE handshake, WebSocket open), or when the attempt completes if no response began. For SSE and WebSocket this means p2c balances handshakes, not the number of open connections.

Balancer state (the sticky endpoint, ejections, and p2c load) and the retry budget belong to the client. Create the client once per application and derive per-call clients with `client(options)`: derived clients keep both the balancer state and the retry budget. Passing one balancer value to several clients with `withBalancer` shares the balancer state only; each client keeps its own retry budget. Creating a fresh `createClient` for every request starts both from scratch.

## 2. Retries [#retries]

Three separate decisions govern a retry: **whether to try again** (`withRetry`), **where to send it** (the runtime asks the balancer to pick again from every endpoint), and **how long to wait** (backoff). One `withRetry(options)` covers HTTP, SSE, and WebSocket and is stored in `config.retry`; a request option `retry` replaces it for one call. The three transports share the options, the decision order, and the backoff calculation, and differ only in which failures they retry by default. The balancer knows nothing about retry policy; a custom balancer needs no special cooperation.

Retries are **off by default**. Omitting `withRetry` means one attempt per call, with no backoff, and for HTTP no retry budget created or credited. Selection on later calls is unchanged: `pickFirstBalancer` can still advance after a failed call. `withRetry()` is equivalent to `withRetry({})`: up to `maxRetries: 3` retries after the first attempt, a `1000` ms delay that doubles per retry up to `30000` ms, and ±20% jitter.

This follows the Go ecosystem: [gRPC places `retryPolicy` in service configuration](https://grpc.io/docs/guides/retry/), alongside load-balancing configuration, while [go-kit `lb.Retry(max, timeout, balancer)`](https://pkg.go.dev/github.com/go-kit/kit/sd/lb#Retry) explicitly wraps a balancer. Neither applies an application retry policy by default. gRPC's retry policy requires backoff settings and uses ±0.2 jitter. Retry counts that exclude the first attempt (`maxRetries`) match ky, got, undici, and Go's `go-retryablehttp`; gRPC's `maxAttempts` counts the original. gRPC can perform transparent retries for low-level races; Defjs does not emulate those.

```typescript
import {
  createClient,
  defineRequest,
  pickFirstBalancer,
  struct,
  withEndpoint,
  withBalancer,
  withRetry,
} from "@defjs/core";

const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), status: struct.string() }),
});
const client = createClient(
  withEndpoint("https://api-us.example.com", "https://api-eu.example.com"),
  withBalancer(pickFirstBalancer({ failbackMs: 30_000 })),
  withRetry({
    maxRetries: 2,
    attemptTimeoutMs: 2_000,
    delayMs: 500,
    maxDelayMs: 5_000,
    // The default retries a connection failure, a 502, 503, or 504, and a timeout.
    // This policy also retries a 429 and leaves every other decision to the default.
    shouldRetry: (context) =>
      context.retryable ||
      (context.transport === "http" && context.status === 429),
    budget: {
      percentCanRetry: 0.2,
      minRetriesPerSecond: 10,
      ttlMs: 10_000,
    },
  }),
);
async function main() {
  const [error, order] = await getOrder(
    client({ signal: AbortSignal.timeout(5_000) }),
    { id: 1 },
  );
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(order.status);
}
void main();
```

After each failed attempt the flow is the same on every transport, in this order:

1. A caller abort, a manual `close()`, a fatal error, and a `ReadableStream` request body end the call. `shouldRetry` is not called.
2. When `maxRetries` retries have been made, the call ends. `shouldRetry` is not called.
3. `shouldRetry(context)` decides; without it, `context.retryable` does. The function may be async and receives a [`RetryContext`](/api/core/retrycontext-type) narrowed by `transport`. Return `context.retryable` to keep the default and add your own rule on top.
4. HTTP only: the budget pays for the retry, or the call ends.
5. The call waits for the backoff delay, then the balancer picks again.

- **Retry count (`maxRetries`)**: Retries after the first attempt, default `3`; `0` never retries. A call with `maxRetries: 0` and `attemptTimeoutMs` only limits each attempt's time. For SSE and WebSocket the count restarts when a connection is established again (a successful handshake or `open`), so it bounds each outage, not the session. A server that accepts and immediately drops every connection therefore keeps being retried; stop it with `shouldRetry`. There is no configured upper bound. This counts outer attempts, not physical sends inside an application interceptor: an interceptor that loops over `next()` can send several times to the same endpoint. For example, three interceptor sends to a failing primary plus one outer retry to a healthy backup produce four network requests with `maxRetries: 1`; the builder and the interceptor chain's outer authentication layer run twice, not four times.
- **Which failures retry by default**: HTTP retries a method in `methods` when the attempt got no response (`NET_UNREACHABLE`), got `502`, `503`, or `504` (`NET_UNAVAILABLE`), or ran out of `attemptTimeoutMs`. SSE retries a method in `methods` after a handshake network failure, a `502`/`503`/`504` handshake, an attempt timeout, or a network error on an open stream; a normal end of the stream ends the call. WebSocket retries every close that `session.close()` did not request, including a connection that never opened and an unanswered heartbeat, but not a constructor that throws. A status such as `429` or `500` is not retried by default; `shouldRetry` receives it with `retryable: false` and `status`, and can return `true`. `methods` defaults to `GET`, `HEAD`, `OPTIONS`, `TRACE`, `PUT`, and `DELETE`, compared case-insensitively; HTTP requires every method an attempt sent, after interceptor rewrites, to be in it. A POST is retried only when you add it to `methods` or return `true` from `shouldRetry`, and that needs application-level idempotency across replicas. An eligible HTTP retry rebuilds the request and reruns the entire interceptor chain from its outermost layer. SSE reuses the built request and only swaps the URL, and WebSocket re-runs `beforeConnect`.
- **Backoff (`delayMs`, `factor`, `jitter`, `maxDelayMs`)**: Before retry n, wait for `delayMs × factor^(n−1)` with multiplicative jitter, capped after jitter and rounding. Defaults are `1000`, `2`, `0.2`, and `30000`. `delayMs: 0` skips waiting; `maxDelayMs: Infinity` removes the cap. The platform timer cap still applies. For SSE a digits-only server `retry:` field replaces `delayMs` for later attempts. Core does not read `Retry-After`. Handling that header, including any delay cap, is an [application interceptor policy](/docs/interceptors), not part of this backoff.
- **Single endpoint**: A retry picks from every endpoint, including the one that just failed, so a single endpoint is tried again after the backoff delay. The retry budget and `maxRetries` bound the storm.
- **Per-attempt vs. whole-call timeout**: `attemptTimeoutMs` bounds one attempt. HTTP times each Fetch sent to the selected endpoint, from invocation until its response body has been read; SSE stops at the response headers and WebSocket at `open`. Interceptor work around an HTTP send (for example a token refresh after a `401`) and struct decoding are not timed and never count against the endpoint; a caller deadline that expires during interceptor work after the send settled is not reported to the balancer as `NET_TIMEOUT`, the endpoint's own outcome is. The caller's `client({ signal: AbortSignal.timeout(ms) })` covers every attempt **and backoff wait**. Cancellation during a wait returns the caller's cancellation fault without another pick. Options are not validated at runtime.
- **No usable endpoint on retry**: When a retry round cannot use any endpoint (the balancer's pick fails, or the next endpoint's URL does not resolve), the HTTP call returns the previous attempt's fault (for example `NET_UNREACHABLE`) instead of `REQ_BUILD_FAILED`.
- **Finagle / Linkerd retry budget (`budget`)**: HTTP only. Each client configuration owns a budget, shared only by derived clients using that same configuration, not by clients sharing a balancer. Defaults are `percentCanRetry: 0.2`, `minRetriesPerSecond: 10`, and `ttlMs: 10000`: 20% of original traffic plus the reserve. Credits and debits expire lazily in ten TTL/10 slices. A retry withdraws before waiting; an exhausted budget neither waits nor retries. Set `budget: false` to remove the cap. SSE and WebSocket have no budget: sharing HTTP's would let a burst of HTTP retries block a reconnect.
- **Browser offline hint**: When `navigator.onLine === false`, connection failures report `{ attempted: false }` and do not advance balancers or trigger HTTP retries.

A later `withRetry` replaces the policy. `withRetry()` and `withRetry(undefined)` behave like `withRetry({})`. To turn retries off after enabling them, pass `withRetry({ maxRetries: 0 })`.

### Migrating from `withSSEReconnect` and `withWebSocketReconnect` [#migrating-from-withssereconnect-and-withwebsocketreconnect]

`withSSEReconnect` and `withWebSocketReconnect` are gone, with no alias. `withRetry` covers SSE and WebSocket, and the request option `reconnect` is now `retry`.

- `attempts: N` becomes `maxRetries: N`.
- `shouldReconnect` becomes `shouldRetry`. Its context gains `transport` and `retryable`, and it is called only while retries remain. Like `shouldReconnect`, it replaces the default rule, the method rule included, so a function that returns `true` still retries a `POST` stream.
- Defaults changed: SSE `factor` goes from `1` to `2` and SSE `maxDelayMs` from unlimited to `30000`; `jitter` goes from `0` to `0.2` on both transports.
- SSE handshakes: in 0.6 every non-2xx handshake ended the stream without asking `shouldReconnect`. Now a `502`, `503`, or `504` handshake is retried like a refused connection, and any other non-2xx handshake reaches `shouldRetry` with `retryable: false`.
- Fault codes: a reconnect handshake that ends an SSE stream with a non-2xx status now reports `HTTP_STATUS` in `closed.code`; 0.6 reported `RES_DECODE_FAILED`, which `EventStreamFaultCode` no longer has. A `shouldRetry` that throws ends the call with `EXT_HOOK_FAILED` and the thrown value as `cause` on every transport; a throwing `shouldReconnect` ended an SSE stream with `NET_UNREACHABLE`.
- WebSocket heartbeat: in 0.6 an unanswered heartbeat ended the session with an error and never reached `shouldReconnect`. It is now an interruption like any other: `shouldRetry` receives it with `retryable: true`, a `cause`, and no close `code`, and can return `false` to end the session with that error as before.
- `withRetry` also retries HTTP. To keep HTTP calls to one attempt, return `false` for `context.transport === "http"`.

```ts
// Before
createClient(
  withEndpoint(url),
  withSSEReconnect({ attempts: 3, delayMs: 1000 }),
  withWebSocketReconnect({
    attempts: 3,
    shouldReconnect: ({ code }) => code !== 1008,
  }),
);
// After
createClient(
  withEndpoint(url),
  withRetry({
    maxRetries: 3,
    shouldRetry: (context) => {
      if (context.transport === "http") return false;
      if (context.transport === "websocket" && context.code === 1008)
        return false;
      return context.retryable;
    },
  }),
);
```

### Browser deployment boundaries [#browser-deployment-boundaries]

- A browser CORS failure reaches Fetch as a connection failure and is reported as `NET_UNREACHABLE`, indistinguishable from a down host. It can advance endpoint selection and trigger an opted-in safe-method retry; successful retry can therefore hide a primary region's CORS misconfiguration.
- A POST can be processed by the server even when its response lacks the required CORS headers. The application then receives `NET_UNREACHABLE` without knowing whether the write succeeded. POST is not replayed by default; explicitly enabling write retries requires application-level idempotency across replicas.
- A WebSocket upgrade that the server rejects (for example with `401`) is indistinguishable in browsers from an unreachable endpoint and is reported as `NET_UNREACHABLE`, so expired credentials can eject endpoints.
- Cookies are scoped to a host, not a port: two endpoints on `localhost` with different ports can share a cookie, while `localhost` and `127.0.0.1` do not. Multi-origin endpoint sets need a deliberate cookie/token and CORS credentials policy; `withCredentials(true)` does not change cookie scope.
- The explicit offline hint (`navigator.onLine === false`) suppresses endpoint attribution and connection-failure retries. It is only a browser hint, not a reliable reachability check.

## 3. Failure ejection and your own health function (`outlierDetection`) [#3-failure-ejection-and-your-own-health-function-outlierdetection]

Defjs has no built-in notion of a healthy endpoint. [`outlierDetection`](/api/core/outlierdetection) does two optional things, and every built-in balancer accepts it through its `outlierDetection` option (`pickFirstBalancer`, `roundRobinBalancer` and `p2cBalancer` leave it off unless you pass an object, `{}` for the defaults). It counts classified failures and ejects an endpoint for a while, and it skips an endpoint that your `isHealthy` function rejects:

<Tabs items={["Timed ejection", "Your own health function"]}>
<Tab>

```typescript
const timedEjection = roundRobinBalancer({
  outlierDetection: {
    minPenaltyMs: 1000,
    maxPenaltyMs: 60000,
    jitterRatio: 0.5,
  },
});
```

</Tab>
<Tab>

```typescript
async function probe(endpoint: string, signal: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(new URL("/healthz", endpoint), {
      signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]),
    });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
}

async function callWithHealthChecks() {
  const healthy = new Map<string, boolean>();
  const controller = new AbortController();
  let checking = false;
  async function check() {
    if (checking) return;
    checking = true;
    for (const endpoint of endpoints) {
      healthy.set(endpoint, await probe(endpoint, controller.signal));
    }
    checking = false;
  }
  const activeClient = createClient(
    withEndpoint(...endpoints),
    withBalancer(
      roundRobinBalancer({
        outlierDetection: {
          consecutiveFailures: 0,
          isHealthy: (endpoint) => healthy.get(endpoint) ?? true,
        },
      }),
    ),
  );
  // The application owns the check lifecycle, not the client or balancer.
  const timer = setInterval(() => void check(), 5000);
  try {
    await check();
    const [error] = await getStatus(activeClient);
    if (error) {
      console.error(error.code);
      return;
    }
    console.log("Service responded");
  } finally {
    clearInterval(timer);
    controller.abort();
  }
}
```

</Tab>
</Tabs>

1. **Counting failures**: The default `isFailure` rule counts every coded outcome as a failure: `NET_UNREACHABLE`, `NET_UNAVAILABLE`, `NET_SERVER_ERROR`, `NET_TIMEOUT`, and `NET_BODY_INCOMPLETE`. It only decides which outcomes count toward ejection; it is not a judgement of health, and you can replace it by passing `isFailure`. An attempted outcome without a code resets the streak; unattributed attempts leave it unchanged. After `consecutiveFailures` (default `5`) counted outcomes in a row, the endpoint is ejected. Set `consecutiveFailures: 0` to turn counting off.
2. **Ejection by time**: The endpoint is ejected for `min(minPenaltyMs × level, maxPenaltyMs)` (`1000ms` to `60000ms`) plus up to `50%` uniform positive jitter; base plus jitter never exceeds `maxPenaltyMs`. `level` is the ejection multiplier of gRPC outlier detection (gRFC A50): every ejection adds one, a success never clears it, and every `10` seconds without an ejection remove one, counted from the moment the ejection ends. When the time is up the endpoint is selectable again. Nothing probes it or decides that it has recovered; if it still fails, `consecutiveFailures` more counted outcomes eject it again for a longer time, so an endpoint that accepts a connection and then drops it is ejected for 1s, 2s, 3s, and so on up to `maxPenaltyMs`, as long as its failures return faster than one level decays. The outcome of an attempt that began before an ejection, or while the endpoint was ejected, is ignored even if it arrives after the endpoint is selectable again, so late results do not eject it anew. The end of an ejection is evaluated against the clock on the next pick; no timer runs.
3. **`isHealthy`**: The only health judgement. It is synchronous and runs on every pick for each endpoint that is not currently ejected (an ejected endpoint is not asked), so keep it a cheap read of state that your application maintains, as in the second tab. An endpoint for which it returns `false` is not selected. Returning `true` does not end an ejection: an endpoint is selectable only when it is not ejected and `isHealthy` does not reject it. A throw is not caught by Defjs: the pick fails with `REQ_BUILD_FAILED`, and the thrown value is the `cause`.
4. **Bounded history**: Health history retains at least 256 endpoints, and at least the current member count, across derived clients. Least-recently-used clean or expired entries are evicted first, then partial failure sequences. An unexpired ejection is evicted only when all retained entries are ejected, then the oldest entry is removed. Merely omitting an endpoint from one call does not reset its penalty. P2C load history likewise keeps at least 256 entries and at least the current member count, so lists over 256 endpoints keep every estimate, evicting idle entries before busy ones; a forgotten endpoint restarts at `defaultRttMs`. Pick-first's shuffle keys keep at least 256 entries, and at least the current members, in an LRU cache, so a forgotten endpoint receives a new key when it returns. Weighted round-robin keeps current values for the client's members: an endpoint left out of one pick (a health-filtered pick) keeps its value, as nginx skips a peer that is down, and values are dropped only for endpoints that left the members; its copied weight configuration is fixed at construction. Durations use the platform's monotonic Performance clock when available, with `Date.now()` only as a fallback.
5. **Panic-mode fail-open**: If `isHealthy` rejects every endpoint that is not ejected, the balancer ignores `isHealthy` and picks among the non-ejected endpoints. Only when every configured endpoint is ejected does it fail open to the client's full candidate list rather than dropping all traffic locally.

## 4. Transport accounting lifecycle (`pick` → `start` → `end` → `done`) [#4-transport-accounting-lifecycle-pick--start--end--done]

Custom balancers must select one of the exact strings in `info.endpoints`; this preserves health filtering.

Custom balancers implement synchronous `pick(info)` and optional `start()`, `end(info)`, and `done(info)` callbacks. The runtime calls these callbacks without a receiver, so `this` is `undefined`; keep state in closures, arrow functions, or bound functions. A synchronous throw does not change the attempt; it is reported with `reportError` where the runtime defines it, and an unhandled report can end a Bun or Deno process that has no error handler. Node.js does not define `reportError`, so the throw stays contained there. `PickInfo` contains the candidate `endpoints` for one pick (the list shrinks when a wrapper filters), `members` (the client's whole endpoint list, the same for every attempt; stateful balancers key order and state on it), and the optional definition `operation`; it has no transport discriminator. The transport translates its facts into neutral `DoneInfo.code` outcomes. Built-in balancers never read `status`; this raw response information is retained only for custom balancers. `start` runs before the attempt, `end` when the peer response begins or a pre-response failure occurs, and `done` at completion. A later body failure can therefore change the final code without changing the earlier `end` sample:

| Physical transport outcome                                                   | Final `done(info)` sample                                  |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------- |
| HTTP/SSE response status 502, 503, or 504                                    | `{ attempted: true, code: "NET_UNAVAILABLE", status }`     |
| HTTP/SSE other response status at least 500                                  | `{ attempted: true, code: "NET_SERVER_ERROR", status }`    |
| HTTP/SSE response status 2xx, 3xx, or 4xx (including 429)                    | `{ attempted: true, status }`                              |
| HTTP response body truncates mid-stream                                      | `{ attempted: true, code: "NET_BODY_INCOMPLETE", status }` |
| SSE handshake succeeds, then stream `reader.read()` rejects                  | `{ attempted: true, code: "NET_UNREACHABLE" }`             |
| SSE normal EOF, a 2xx handshake that is not an event stream, or buffer limit | `{ attempted: true, status }`                              |
| Opened WebSocket closes with code `1006` or `1015` (no close frame arrived)  | `{ attempted: true, code: "NET_UNREACHABLE" }`             |
| Opened WebSocket closes with code `1012` or `1013`                           | `{ attempted: true, code: "NET_UNAVAILABLE" }`             |
| WebSocket heartbeat acknowledgement times out                                | `{ attempted: true, code: "NET_UNREACHABLE" }`             |
| Opened WebSocket closes with any other code, whatever `wasClean` reports     | `{ attempted: true }`                                      |
| Caller cancellation or manual stream/socket close                            | `{ attempted: false }`                                     |
| `fetch` rejects a streamed HTTP request body with a network error            | `{ attempted: false }`                                     |
| Caller deadline expires after attempt started                                | `{ attempted: true, code: "NET_TIMEOUT" }`                 |

A streamed HTTP request body is a caller-supplied `ReadableStream`. `fetch` rejects it with the same network error whether the connection is refused or HTTP/1.1, a redirect cannot replay the stream, a CORS preflight fails, or the source stream throws, so that error does not reliably show the endpoint is down. The call still fails with `NET_UNREACHABLE`, but the balancer receives `{ attempted: false }`, as it does for a throwing progress callback (`EXT_OBSERVER_FAILED`). The cost is that streamed uploads alone cannot detect a down endpoint: they do not switch `pickFirst` away from it and do not count toward `outlierDetection`, and a rejected streamed upload is never retried: a `ReadableStream` body ends the retry flow before `shouldRetry` is asked. Handshake decoding failures retain the neutral outcome derived from the handshake status (for example, `NET_UNAVAILABLE` with status `503`). An incomplete HTTP body instead retains `NET_BODY_INCOMPLETE` and its raw status, even for a gateway response; like any coded outcome, it counts as a failure for default outlier detection. A heartbeat that cannot be sent (a throwing `message()` or a serialization failure) is local and neutral.

## Related reading [#related-reading]

- [Client configuration](/docs/client)
- [SSE retries](/docs/sse#reconnect)
- [WebSocket retries](/docs/web-socket)
