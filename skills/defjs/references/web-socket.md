# WebSocket sessions (`defineWebSocket`)

Contents: [Define and run a session](#define-and-run-a-session) · [Messages (`incoming` and `outgoing`)](#messages-incoming-and-outgoing) · [Subprotocols and builder rules](#subprotocols-and-builder-rules) · [Heartbeat and retries](#heartbeat-and-retries) · [Session ownership and disposal](#session-ownership-and-disposal)

## Define and run a session

`defineWebSocket` takes one `incoming` struct and an optional `outgoing` struct, with no incoming queue limit: every message waits until `session.receive` reads it.

```ts
import {
  createClient,
  defineWebSocket,
  struct,
  withEndpoint,
} from "@defjs/core";

const IncomingFrame = struct.discriminatedUnion("type", [
  struct.object({
    type: struct.literal("tick"),
    symbol: struct.string(),
    price: struct.number(),
  }),
  struct.object({
    type: struct.literal("subscribed"),
    symbol: struct.string(),
  }),
]);

const OutgoingFrame = struct.discriminatedUnion("type", [
  struct.object({
    type: struct.literal("subscribe"),
    symbol: struct.string(),
  }),
  struct.object({
    type: struct.literal("unsubscribe"),
    symbol: struct.string(),
  }),
]);

export const quoteFeed = defineWebSocket({
  operation: "quotes.stream",
  path: "/quotes/:market",
  protocols: ["quotes.v1"],
  input: struct.object({ market: struct.string() }),
  builder: (input) => ({ path: input }),
  incoming: IncomingFrame,
  outgoing: OutgoingFrame,
});

const client = createClient(withEndpoint("https://quotes.example.com"));

async function main() {
  const [error, session, startupConnection] = await quoteFeed(client, {
    market: "nasdaq",
  });
  if (error) {
    console.error(error.code, startupConnection?.generation);
    return;
  }
  await using ownedSession = session;
  const unsubscribeError = ownedSession.onRuntimeError((cause) =>
    console.error("runtime error", cause),
  );
  try {
    ownedSession.send({ type: "subscribe", symbol: "ACME" });
    for await (const message of ownedSession.receive) {
      if (message.type === "tick") {
        console.log(message.symbol, message.price);
        break;
      }
    }
  } finally {
    unsubscribeError();
  }
}

void main();
```

## Messages (`incoming` and `outgoing`)

- **One struct per direction:** model multiple message types with `struct.discriminatedUnion("type", [...])`. There is no message-map object and no automatic envelope wrapper.
- **Inbound frames:** text, `ArrayBuffer`, TypedArray, and `Blob` frames are decoded as UTF-8, `JSON.parse`d, and validated against `incoming`. Frames that fail JSON parsing or struct validation are reported to `session.onRuntimeError(listener)` and not enqueued; the session stays open.
- **Outbound frames (`session.send`):** validates and serializes **synchronously** (validation and alias encoding, then `JSON.stringify`). `session.send` throws synchronously if the payload fails `outgoing`, contains values JSON cannot represent (`NaN`, `±Infinity`, functions, symbols, `Map`, `Set`), or the session is not writable. It sends immediately only in `open` and queues only in `reconnecting`; every other state throws, and `reconnecting` also throws when the outgoing queue is disabled or full.

## Subprotocols and builder rules

- A WebSocket `builder` may return **`{ path?, query? }` only** (`headers` and `body` are forbidden because browser WebSockets do not support custom handshake headers).
- Subprotocol precedence: `client({ protocols })` overrides `withWebSocketProtocols(...)`, which overrides `protocols` on `defineWebSocket`.
- The chosen `protocols` array is snapshotted when the session starts and reused across automatic reconnections. To pass a short-lived auth token in a subprotocol, obtain the token before calling the operation and pass ``client({ protocols: [`auth.${token}`, "quotes.v1"] })``.

## Heartbeat and retries

Both are opt-in via client helpers (`withWebSocketHeartbeat`, `withRetry`) or per-call `RequestOptions` (`client({ heartbeat, retry })`). The retry policy is the one `withRetry` shared with HTTP and SSE:

```ts
import {
  createClient,
  defineWebSocket,
  struct,
  withEndpoint,
  withRetry,
} from "@defjs/core";

const client = createClient(
  withEndpoint("https://quotes.example.com"),
  withRetry({
    maxRetries: 3,
    delayMs: 500,
    factor: 2,
    maxDelayMs: 10_000,
    jitter: 0.2,
    shouldRetry(context) {
      if (context.transport !== "websocket") return context.retryable;
      // Every close that session.close() did not request is retryable by default; refuse a policy violation.
      return context.code !== 1008;
    },
  }),
);

const quotes = defineWebSocket({
  path: "/quotes",
  incoming: struct.object({
    type: struct.literal("pong"),
    ok: struct.boolean(),
  }),
  outgoing: struct.object({ type: struct.literal("ping") }),
});

async function runWithHeartbeat() {
  const [error, session] = await quotes(
    client({
      heartbeat: {
        intervalMs: 30_000,
        timeoutMs: 10_000,
        message: () => ({ type: "ping" as const }),
        isAck: (msg) =>
          typeof msg === "object" &&
          msg !== null &&
          "type" in msg &&
          msg.type === "pong",
      },
    }),
  );
  if (error) return;
  await using ownedSession = session;
  console.log(ownedSession.state);
}

void runWithHeartbeat();
```

Defjs defines no heartbeat format: `message` and `isAck` are yours, `message` is required, and `timeoutMs` is allowed only together with `isAck` (types only, no runtime check). The payload is sent through the `outgoing` struct as JSON text, and an acknowledgement must decode through `incoming` before `isAck` sees it. An unanswered heartbeat closes the socket and enters the retry flow like any close that `session.close()` did not request; without a retry policy the session ends with an `error` (`Error("WebSocket heartbeat timeout")`). A heartbeat that cannot be sent ends the session and is not retried.

A server can complete a clean close handshake with application-error code `1011`, so `wasClean: true` does not mean the application succeeded; decide on `context.code`. Every close that `session.close()` did not request is retried by default, a connection that never opened included, and `shouldRetry` can overrule that. A constructor that throws is not retried and `shouldRetry` is not asked. Successful opens reset the retry count (default 3 per outage). `attemptTimeoutMs` (a field of the retry options) bounds construction to `open`; the policy keeps its default of 3 retries, so write `withRetry({ maxRetries: 0, attemptTimeoutMs })` for a handshake-only deadline. With multiple endpoints, a retry can re-pick; it does not restore application subscriptions or delivery acknowledgments.

The input, builder output, and selected protocols are captured once for the logical session. Each attempt resolves its URL before `beforeConnect`; a retry can replace the base endpoint, not the captured path/query. `beforeConnect` runs per attempt but does not rebuild a query ticket or subprotocol token after a closure variable changes. Start a new operation with refreshed values when those credentials expire. See [load balancing](load-balancing.md) for endpoint and retry boundaries.

## Session ownership and disposal

- Use `await using ownedSession = session;` or call `session.close(1000, "done")` and `await session.closed` in `finally`.
- `session.receive` is single-consumer; requesting a second iterator throws `TypeError`.
- When a session ends as `error`, messages already queued are still delivered and `session.receive` rejects with `closed.cause` after the last one; a close from the peer also delivers them before `receive` ends, while a caller stopping the session (`signal` abort, `session.close()`, disposal) discards unread messages and `receive` ends at once. An expired `AbortSignal.timeout(ms)` is a timeout, not a stop: it ends the session as an error after the queued messages.
- An open connection dropped without a close frame (code `1006`) always settles `closed` as `kind: "error"` with `cause` `Error("WebSocket connection error")`, on every runtime.
