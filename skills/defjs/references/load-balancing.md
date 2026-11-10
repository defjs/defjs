# Multiple endpoints, balancing, and retry

## Endpoint selection

Configure replicas of one service with `withEndpoint(...urls)`. URLs are deduplicated in first-seen order; a later option replaces the list. Different services still need separate clients.

```ts
import {
  createClient,
  pickFirstBalancer,
  withBalancer,
  withEndpoint,
  withRetry,
} from "@defjs/core";

export const client = createClient(
  withEndpoint("https://primary.example.com", "https://backup.example.com"),
  withBalancer(pickFirstBalancer()),
  withRetry({ on: ["connect-failure", "gateway-error"] }),
);
```

The client above is configuration, not an operation call. Pass it to an SDK operation and check the error-first tuple before using a result.

| Strategy                            | Defaults and intended use                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pickFirstBalancer(options?)`       | Default client strategy. Sticky ordered primary/backup; advances after attributed `NET_UNREACHABLE` or `NET_UNAVAILABLE`, not a timeout; an HTTP retry never moves the sticky endpoint. Order follows `PickInfo.members`. Health filtering and `shuffle` are off. Optional positive `failbackMs` permits one primary probe only after the interval has elapsed and an alternate has been selected since leaving the primary. A probe is decided when the peer response begins (`end`; `done` if it never reached `end`), so a long-lived stream does not block failback. A failed probe restarts the interval and requires a fresh alternate selection. |
| `roundRobinBalancer(options?)`      | Counter starts at a random `uint32`, then selects cyclically. Every pick, including an HTTP retry's or a stream reconnect's, advances it; with `outlierDetection: false` and serial calls, a persistently failing endpoint gets more than 1/n of first attempts, all of them with two endpoints and retries on (concurrent calls break this). Optional `weights: ReadonlyMap<string, number>` uses smooth weighted round-robin; weights must be finite and positive; missing weights are 1. Health filtering is on.                                                                                                                                     |
| `p2cBalancer(options?)`             | Samples two distinct candidates, choosing lower PeakEwma RTT × (pending + 1). Defaults: `load: "peakEwma"`, `choiceCount: 2`, `defaultRttMs: 30`, `decayMs: 10000`. `load: "pending"` compares in-flight counts, reserved at `pick` and released at `end` (or `done` if no response began). Load history keeps at least 256 endpoints and at least the current member count. Health filtering is on.                                                                                                                                                                                                                                                    |
| `outlierDetection(child, options?)` | Wraps a strategy. Defaults: `consecutiveFailures: 5`, `minPenaltyMs: 1000`, `maxPenaltyMs: 60000`, `jitterRatio: 0.5`. Every coded outcome is a failure (`NET_UNREACHABLE`, `NET_UNAVAILABLE`, `NET_SERVER_ERROR`, `NET_TIMEOUT`, `NET_BODY_INCOMPLETE`); an attempted outcome without a code resets the streak, while unattributed attempts and discarded samples leave it unchanged. A probe that times out re-ejects. History keeps at least 256 endpoints and at least the current member count. Failed probes double the penalty; one successful probe restores traffic. All-unhealthy falls back to the current candidate list.                   |

Use `outlierDetection: false` to disable built-in health filtering; `pickFirstBalancer({ outlierDetection: {} })` enables it. Optional synchronous `isHealthy(endpoint)` reads an application-owned cached health result; it is not an async health-check runner. Optional `isFailure(info)` changes passive classification. Share a balancer instance only when its endpoint-health/load state should be shared.

## HTTP retries: separate from balancing

No `withRetry` means one HTTP attempt and no retry budget. `withRetry()`, `withRetry(undefined)`, and `withRetry({})` enable the defaults below. A later option replaces the whole policy; `{ maxAttempts: 1 }` disables retries.

| Option                                      | Default / boundary                                                                                                                                                                                                                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxAttempts`                               | 2 total outer attempts, including the original; safe integer ≥ 1. Each attempt excludes endpoints already selected by this call, so one configured endpoint is never replayed.                                                                                                           |
| `on`                                        | `["connect-failure"]`. Add `"gateway-error"` for 502/503/504 or `"attempt-timeout"` for per-attempt timeouts. Local pre-Fetch failures do not qualify as connection failures.                                                                                                            |
| `methods`                                   | `["GET", "HEAD", "OPTIONS", "TRACE"]`, case-insensitive. Every method actually sent after interceptor rewrites must qualify; `[]` disables retries. POST/PUT/DELETE are not enabled by default.                                                                                          |
| `attemptTimeoutMs`                          | Unset. Positive finite milliseconds ≤ 2147483647, timing each Fetch from invocation until its response body is read; interceptor work around the send and struct decoding are not timed and never count against the endpoint. The caller's `signal` covers all attempts and waits.       |
| `delayMs`, `factor`, `jitter`, `maxDelayMs` | 25 ms, 2, 0.2, 250 ms. Multiplicative ±jitter, capped after jitter and rounding; zero delay skips waiting. Delays must be finite and nonnegative; factor finite and positive; jitter in [0, 1]. `maxDelayMs` also accepts positive Infinity, with the platform timer cap still applying. |
| `budget`                                    | `{ percentCanRetry: 0.2, minRetriesPerSecond: 10, ttlMs: 10000 }`. 20% of original traffic plus reserve; credits expire in ten slices of `ttlMs / 10`. `false` removes the cap. Ratio range [0, 1000], reserve a nonnegative safe integer, TTL [1000, 60000] ms.                         |

Each retry re-picks, rebuilds, and reruns the complete interceptor chain, including auth. The retry budget belongs to the client configuration: derived `client({ signal })` values share it; separately created clients do not, even if their balancer is shared. Balancer state (sticky endpoint, ejections, load) also belongs to the client: create the client once and derive per-call values to keep both the balancer state and the retry budget; sharing one balancer through `withBalancer` keeps the balancer state only, and a client created per request starts both fresh. An exhausted budget returns the current failure without another wait or attempt. If a retry round cannot use any endpoint (the pick fails or the next URL does not resolve), the call returns the previous attempt's fault, not `REQ_BUILD_FAILED`; interceptor work after the send and decoding are not timed by `attemptTimeoutMs`, and a caller deadline that expires there is not reported to the balancer as `NET_TIMEOUT`. Invalid options return `REQ_OPTIONS_INVALID` when HTTP executes.

- `ReadableStream` bodies are never replayed. Explicit browser offline state (`navigator.onLine === false`) suppresses endpoint attribution and connection-failure retry; it does not prove Fetch was never invoked.
- Core does not read `Retry-After`. That header is an application interceptor policy. An interceptor's `next()` loop stays on its current endpoint and does not rerun the builder or outer auth. It can multiply physical sends beyond `maxAttempts` (three primary sends plus one backup send with two outer attempts).
- A JSON POST auth-refresh replay is still two HTTP deliveries. Require auth rejection before business handling and a stable idempotency key with server-side deduplication, or return the 401. Cross-region write retries need shared, atomic server-side deduplication; a header alone is not exactly-once execution.

## SSE and WebSocket reconnect

`withRetry` is HTTP-only. Use `withSSEReconnect` and `withWebSocketReconnect` for streams/sessions. Both are opt-in; `attempts` defaults to 3 per outage, not per session. Every successful open resets its attempt/backoff budget, so `attempts: 1` can produce many connections in a long session. A managed reconnect re-picks from the configured endpoints; unlike HTTP retry, it may revisit an endpoint. `connectTimeoutMs` (a field of the same options object) bounds each handshake; because the object applies `attempts: 3`, setting it alone also enables reconnect, so add `attempts: 0` for a handshake-only deadline.

- SSE: clean server EOF ends the stream; it does not reconnect. Read failures may reconnect. A 502/503/504 handshake (initial or reconnect) is retried like a refused connection under the same rules (method, `shouldReconnect`, `attempts`, `ReadableStream` body); other non-2xx handshakes are fatal. Exhausted retries and fatal reconnect handshakes end with `HTTP_STATUS`; a later operation can pick the backup. SSE commits `id:` only at the terminating blank line (including ID-only frames); a partial frame does not advance the cursor. Reconnect sends the committed ID as `Last-Event-ID`; an empty ID clears it. The server must implement resumption/deduplication. After a reconnect handshake ends the stream, read the live `stream.open.response.status`; the iterator/`closed` fault is `HTTP_STATUS`.
- WebSocket: `wasClean` describes the close handshake, not application success. A server 1011 can have `wasClean: true`; select retryable codes explicitly, e.g. 1006/1011/1012/1013. Reconnection restores transport, not application subscriptions or acknowledgments. A heartbeat acknowledgement timeout reports `NET_UNREACHABLE` to the balancer (a heartbeat that cannot be sent is local and neutral). For an opened socket the balancer sees the close code only, whatever `wasClean` reports: 1006 or 1015 (no close frame) is `NET_UNREACHABLE`, 1012 or 1013 is `NET_UNAVAILABLE`, other codes are not failures.
- WebSocket input, builder output, and selected subprotocols are captured once for the session. The URL is resolved before each `beforeConnect` call; reconnect can replace the selected base endpoint, not the captured path/query. `beforeConnect` runs per attempt but cannot refresh a captured query token or subprotocol by changing a closure variable. Obtain new credentials and call the operation again when those values must change.
- Keep owning the logical handle/session through reconnects. Handle runtime errors, close it, and await `closed` (or use `await using`).

## Custom balancer contract and faults

Implement synchronous `Balancer.pick(info)` returning `[error, undefined]` or `[null, result]`. `info` contains the candidate `endpoints` and optional static `operation`, not a transport discriminator. Never mutate the candidates, invent an endpoint, return a promise, or throw for ordinary no-candidate outcomes.

```ts
import { ERR_NO_CANDIDATE, type Balancer } from "@defjs/core";

export const first: Balancer = {
  pick({ endpoints }) {
    const endpoint = endpoints[0];
    if (endpoint === undefined) return [ERR_NO_CANDIDATE, undefined];
    return [null, { endpoint }];
  },
};
```

The selected string must belong to that pick's candidate list; foreign selections become `REQ_BUILD_FAILED` before I/O, and their `done` runs with `{ attempted: false }`. `PickInfo.endpoints` is one pick's candidates (shrinking on retries or wrapper filtering); `PickInfo.members` is the client's whole list, the same for every attempt, which stateful balancers key on. `ERR_NO_CANDIDATE` is a cause sentinel, not a fault code: inspect `fault.code === "REQ_BUILD_FAILED"` and `isNoCandidateCause(fault.cause)` (also works across Core copies).

Optional callbacks follow `pick → start → end → done`: `start()` runs immediately before transport; `end(info)` runs when the peer response begins or a pre-response transport failure occurs; `done(info)` runs once on completion, including pre-transport exits after a valid pick. A later body failure can differ from the earlier `end` sample. All callbacks must be synchronous and are called without a receiver (`this` is `undefined`; use closures or bound functions). Core contains a synchronous throw and reports it with `reportError` where the runtime defines it (not Node.js), and an unhandled report can end a Bun or Deno process that has no error handler; it ignores rejected thenables. Custom code should still not throw. `attempted: false` is not a health sample (local build/short-circuit/cancellation/explicit close/offline attribution/network error on a streamed request body). Neutral `DoneInfo.code` values are not the operation's public tuple fault codes; custom strategies may also read raw `status`.

## Observability limits

Current `@defjs/opentelemetry-server` HTTP spans observe individual attempts. They are siblings under an active application parent; core creates no logical-call parent or attempt number/retry reason/budget attributes. SSE/WS use one logical-session span across reconnects, retaining initial endpoint URL/metric attributes; active metrics count logical sessions, not physical sockets. There are no dedicated endpoint ejection/recovery or retry-budget events. Add application-level outcome accounting rather than inferring those decisions from span counts.
