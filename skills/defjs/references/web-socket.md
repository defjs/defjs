# WebSocket sessions (`defineWebSocket`)

Contents: [Define and run a session](#define-and-run-a-session) · [Messages (`incoming` and `outgoing`)](#messages-incoming-and-outgoing) · [Subprotocols and builder rules](#subprotocols-and-builder-rules) · [Heartbeat and reconnect](#heartbeat-and-reconnect) · [Session ownership and disposal](#session-ownership-and-disposal)

## Define and run a session

`defineWebSocket` takes one `incoming` struct and an optional `outgoing` struct, plus a required positive `maxIncomingQueueSize`.

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
  maxIncomingQueueSize: 100,
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

## Heartbeat and reconnect

Both are opt-in via client helpers (`withWebSocketHeartbeat`, `withWebSocketReconnect`) or per-call `RequestOptions` (`client({ heartbeat, reconnect })`):

```ts
import {
  createClient,
  defineWebSocket,
  struct,
  withEndpoint,
  withWebSocketReconnect,
} from "@defjs/core";

const client = createClient(
  withEndpoint("https://quotes.example.com"),
  withWebSocketReconnect({
    attempts: 3,
    delayMs: 500,
    factor: 2,
    maxDelayMs: 10_000,
    jitter: 0.2,
    shouldReconnect({ attempt, code }) {
      return (
        attempt <= 3 &&
        (code === 1006 || code === 1011 || code === 1012 || code === 1013)
      );
    },
  }),
);

const quotes = defineWebSocket({
  maxIncomingQueueSize: 100,
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

A server can complete a clean close handshake with application-error code `1011`, so `wasClean: true` does not mean the application succeeded. Successful opens reset the reconnect budget (default 3 per outage). `connectTimeoutMs` (a field of the reconnect options) bounds construction to `open`; because that object applies `attempts: 3`, setting it alone also enables reconnect, so add `attempts: 0` for a handshake-only deadline. With multiple endpoints, reconnect can re-pick; it does not restore application subscriptions or delivery acknowledgments.

The input, builder output, and selected protocols are captured once for the logical session. Each attempt resolves its URL before `beforeConnect`; reconnect can replace the base endpoint, not the captured path/query. `beforeConnect` runs per attempt but does not rebuild a query ticket or subprotocol token after a closure variable changes. Start a new operation with refreshed values when those credentials expire. See [load balancing](load-balancing.md) for endpoint and retry boundaries.

## Session ownership and disposal

- Use `await using ownedSession = session;` or call `session.close(1000, "done")` and `await session.closed` in `finally`.
- `session.receive` is single-consumer; requesting a second iterator throws `TypeError`.
- When the transport fails, messages already received are delivered first, then `receive` rejects with `closed.cause`; queue overflow, heartbeat timeout and cancellation discard unread messages.
- An open connection dropped without a close frame (code `1006`) always settles `closed` as `kind: "error"` with `cause` `Error("WebSocket connection error")`, on every runtime.
