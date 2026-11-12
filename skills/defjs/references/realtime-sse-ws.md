# Realtime Operations: Server-Sent Events (`defineEventStream`) and WebSockets (`defineWebSocket`)

Contents: [SSE definition and lifecycle ownership](#1-sse-definition-and-lifecycle-ownership) · [SSE startup deadline vs stream lifetime](#2-sse-startup-deadline-vs-stream-lifetime) · [SSE decoding, buffers, retries, and invalid events](#3-sse-decoding-buffers-retries-and-invalid-events) · [WebSocket definition and session ownership](#4-websocket-definition-and-session-ownership) · [WebSocket `builder`, subprotocols, and `session.send` rules](#5-websocket-builder-subprotocols-and-sessionsend-rules) · [WebSocket heartbeats and reconnects](#6-websocket-heartbeats-and-reconnects) · [SSE and WebSocket interceptors](#7-sse-and-websocket-interceptors)

For full English guide pages on the official site (no locale prefix), fetch `https://defjs.lyz.cloud/llms.mdx/docs/sse/content.md` and `https://defjs.lyz.cloud/llms.mdx/docs/web-socket/content.md`.

---

## 1. SSE definition and lifecycle ownership

`defineEventStream` declares a typed Server-Sent Events operation with `path` and an `events` map.

- Calling the operation resolves to `[null, stream, startupOpen]` or `[Fault<TError>, undefined, startupOpen | undefined]`.
- **Mandatory ownership**: Once `stream` is returned, the caller owns it. Always bind it with `await using ownedStream = stream;` or close it and `await stream.closed` inside `finally`.
- Only one async iterator may consume `stream`. Breaking out of `for await (const event of ownedStream)` triggers iterator return and closes the stream automatically.

### Best practice: define and consume an SSE stream with `await using`

```ts
import {
  createClient,
  defineEventStream,
  struct,
  withEndpoint,
} from "@defjs/core";

export const followDeployLog = defineEventStream({
  method: "GET",
  operation: "deployments.followLog",
  path: "/deployments/:id/log",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  error: struct.object({ message: struct.string() }),
  events: {
    line: struct.object({ text: struct.string() }),
    done: struct.object({ status: struct.enum(["succeeded", "failed"]) }),
  },
});

const client = createClient(withEndpoint("https://api.example.com"));

async function main() {
  const [error, stream, startupOpen] = await followDeployLog(client, { id: 7 });
  if (error) {
    console.error(error.code, startupOpen?.response.status);
    return;
  }
  await using ownedStream = stream;
  for await (const event of ownedStream) {
    if (event.event === "line") {
      console.log(event.data.text);
    } else {
      console.log("Finished:", event.data.status);
      break;
    }
  }
}

void main();
```

---

## 2. SSE startup deadline vs stream lifetime

`client({ signal })` governs the **entire** stream lifetime—if that signal aborts after the stream opens, the active stream is aborted too.

- To bound **only** the initial connection handshake without retries, pass `client({ retry: { maxRetries: 0, attemptTimeoutMs: 5_000 } })`.
- Or clear your startup timer as soon as `followDeployLog(...)` resolves.

### Best practice: handshake-only deadline with long-lived stream consumption

```ts
import {
  createClient,
  defineEventStream,
  struct,
  withEndpoint,
} from "@defjs/core";

const client = createClient(withEndpoint("https://api.example.com"));

const deployEvents = defineEventStream({
  operation: "deployments.events",
  path: "/deployments/events",
  events: { line: struct.string() },
});

export async function consumeWithHandshakeDeadline(
  handshakeMs: number,
  lifecycleSignal: AbortSignal,
) {
  const [error, stream] = await deployEvents(
    client({
      signal: lifecycleSignal,
      retry: { maxRetries: 0, attemptTimeoutMs: handshakeMs },
    }),
  );
  if (error) return;

  await using ownedStream = stream;
  for await (const event of ownedStream) {
    console.log(event.data);
  }
}
```

---

## 3. SSE decoding, buffers, retries, and invalid events

- **Event matching and decoding**: Each key in `events` matches the SSE `event:` field (an omitted `event:` field defaults to `"message"`). If no named entry matches, `events.default` is used if declared; otherwise the frame is dropped as `"missing-struct"`. `struct.string()` delivers raw text; any other struct runs `JSON.parse` then validates against the struct.
- **Buffer and queue limits**: `maxBufferSize` (default `64 * 1024` bytes) bounds one frame before its blank line; exceeding it fails the stream with `CAP_BUFFER_EXCEEDED`. Up to 1,024 decoded events are buffered in memory before backpressure pauses reading.
- **Stop vs failure drainage**: When a stream ends due to an error or `AbortSignal.timeout(ms)`, already-queued events are delivered before the iterator rejects. When the caller stops the stream (`stream.close()`, disposal, or manual `AbortController` abort), unread queued events are discarded immediately.
- **Retries and `Last-Event-ID`**: Enable reconnects with `withRetry(...)`. Clean server EOF ends the stream normally and does not retry. `502`/`503`/`504` handshakes and network read failures retry by default (`maxRetries` resets on each successful open). SSE commits `id:` at the terminating blank line and sends it as `Last-Event-ID` on reconnect.
- **Node.js 300s idle timeout**: Node.js `fetch` (undici) terminates idle response bodies after 300s (`UND_ERR_BODY_TIMEOUT` → `NET_UNREACHABLE`). Have the server send `: keepalive\n\n` comments every 30–60s.
- **Observing invalid events**: Undeclared or struct-invalid SSE events do not kill the stream; observe them with `withSSEOnInvalidEvent`:

```ts
import { createClient, withEndpoint, withSSEOnInvalidEvent } from "@defjs/core";

export const sseClient = createClient(
  withEndpoint("https://api.example.com"),
  withSSEOnInvalidEvent(({ reason, message, cause }) => {
    console.warn("Dropped SSE event", reason, message.event, cause);
  }),
);
```

---

## 4. WebSocket definition and session ownership

`defineWebSocket` declares a full-duplex WebSocket operation with one `incoming` struct and an optional `outgoing` struct.

- Model multiple message types in each direction with `struct.discriminatedUnion("type", [...])`—there is no message-map object or automatic envelope wrapper.
- Always own the returned session with `await using ownedSession = session;` (or `try ... finally { session.close(1000, "done"); await session.closed; }`) and subscribe to `session.onRuntimeError(listener)` to observe inbound frames that fail JSON parsing or `incoming` validation.

### Best practice: typed WebSocket session with `discriminatedUnion`, `onRuntimeError`, and `await using`

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
  const unsubscribeError = ownedSession.onRuntimeError((cause) => {
    console.error("Invalid inbound frame", cause);
  });
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

---

## 5. WebSocket `builder`, subprotocols, and `session.send` rules

- **`builder` returns `{ path?, query? }` only**: Browser WebSockets do not support custom handshake headers. Pass credentials via cookies, short-lived query tickets, or subprotocols (`client({ protocols: [\`auth.${token}\`, "quotes.v1"] })`).
- **Subprotocol precedence**: `client({ protocols })` overrides `withWebSocketProtocols(...)`, which overrides `protocols` on `defineWebSocket`.
- **Session snapshot across reconnects**: `input`, `builder` output (`path` and `query`), and `protocols` are captured once when the logical session starts. On reconnect, the balancer may pick a new base endpoint, but captured `query` tickets and `protocols` are reused; start a new operation call when short-lived handshake credentials expire.
- **Synchronous `session.send(data)`**: Validates against `outgoing`, applies wire `.alias()` keys, and calls `JSON.stringify` synchronously. `session.send` **throws synchronously** if validation fails, if the payload is not JSON-serializable (`NaN`, `±Infinity`), or if the session is not writable (`send` sends immediately in `"open"` and queues only in `"reconnecting"` when the outgoing queue is enabled and has room).
- **Single-consumer `session.receive`**: Requesting a second iterator from `session.receive` throws `TypeError`.

---

## 6. WebSocket heartbeats and reconnects

Configure heartbeats with `withWebSocketHeartbeat(policy)` or per-call `client({ heartbeat })`, and reconnects with `withRetry(policy)` or `client({ retry })`:

- **Heartbeat contract**: `message` is required and `timeoutMs` is allowed only together with `isAck`. Outbound heartbeats are validated through `outgoing`; inbound acks must pass `incoming` before `isAck(msg)` inspects them. An unanswered heartbeat closes the socket, reports `NET_UNREACHABLE` to the balancer, and enters the `withRetry` flow.
- **Check `context.code`, not `wasClean`**: A server can complete a clean close handshake with error code `1011` (`wasClean: true`). Inside `shouldRetry(context)`, branch on `context.code` (for example `return context.code !== 1008`).
- **Re-subscribing after reconnect**: Automatic reconnection restores the transport socket, not application-level subscriptions. Track `session.connection.generation` or use `beforeConnect` / state transitions to re-send subscription frames when needed.

### Best practice: WebSocket heartbeat paired with `withRetry`

```ts
import {
  createClient,
  defineWebSocket,
  struct,
  withEndpoint,
  withRetry,
} from "@defjs/core";

const PingPongSocket = defineWebSocket({
  operation: "quotes.heartbeat",
  path: "/quotes",
  incoming: struct.discriminatedUnion("type", [
    struct.object({ type: struct.literal("pong") }),
    struct.object({ type: struct.literal("price"), value: struct.number() }),
  ]),
  outgoing: struct.object({ type: struct.literal("ping") }),
});

const client = createClient(
  withEndpoint("https://quotes.example.com"),
  withRetry({
    maxRetries: 3,
    delayMs: 500,
    shouldRetry(context) {
      if (context.transport !== "websocket") return context.retryable;
      return context.code !== 1008;
    },
  }),
);

export async function runWithHeartbeat() {
  const [error, session] = await PingPongSocket(
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
  for await (const frame of ownedSession.receive) {
    if (frame.type === "price") console.log(frame.value);
  }
}
```

---

## 7. SSE and WebSocket interceptors

- Use `createSSEInterceptor((request, next) => ...)` and `createWebSocketInterceptor((request, next) => ...)` with `withInterceptors(...)` to log, trace, or wrap stream/session handles.
- Never loop `next()` inside an SSE or WebSocket interceptor to implement reconnects—doing so bypasses endpoint attribution and balancer re-picking (and a WebSocket interceptor's `next()` may be called only once). Always use `withRetry` for reconnects.
- Any custom wrapper returned from an SSE or WebSocket interceptor must implement `[Symbol.asyncDispose]()` and forward to the underlying `close` and `closed` lifecycle.
