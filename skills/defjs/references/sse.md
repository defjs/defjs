# Server-Sent Events (`defineEventStream`)

Contents: [Define and consume](#define-and-consume) · [Buffer, queue, and event decoding](#buffer-queue-and-event-decoding) · [Stream ownership and disposal](#stream-ownership-and-disposal) · [Startup deadline vs stream lifetime](#startup-deadline-vs-stream-lifetime) · [Reconnect and invalid events](#reconnect-and-invalid-events)

## Define and consume

`defineEventStream` declares a typed SSE endpoint with `path` and an `events` map.

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

## Buffer, queue, and event decoding

- `maxBufferSize` (default `64 * 1024` bytes) and `maxQueueSize` (default `1024` events) are optional positive safe-integer limits. Exceeding them terminates the stream with `CAP_BUFFER_EXCEEDED` or `CAP_QUEUE_OVERFLOW`.
- Each key in `events` matches the SSE `event:` field (defaulting to `"message"` on the wire when `event:` is omitted by the server).
- Decoding follows the event struct kind: `struct.string()` delivers the raw text payload; any other struct runs `JSON.parse` first and then validates against the struct.
- Handshake errors (non-2xx responses) decode against `error` if declared. Note: if a declared handshake error body fails reading, JSON parsing, or struct validation, SSE reports `RES_DECODE_FAILED` (with `StructError` as `cause` on struct mismatch).
- `startupOpen` (3rd tuple element) is the initial handshake snapshot; `stream.open` updates live across reconnections.

## Stream ownership and disposal

After `[null, stream]` resolves, the caller owns the stream:

1. Prefer `await using ownedStream = stream;`, which closes the stream and awaits teardown when leaving the block.
2. Or use `try { ... } finally { stream.close("consumer-finished"); await stream.closed; }`.
3. Only one async iterator may consume `stream`. Breaking out of `for await (const event of stream)` also triggers iterator return and closes the stream.

## Startup deadline vs stream lifetime

`client({ signal })` applies to the **entire** stream lifetime—if the signal aborts after the stream opens, the active stream is aborted too. To enforce a timeout on the initial connection handshake only, clear the timer as soon as `followDeployLog(...)` resolves:

```ts
import {
  createClient,
  defineEventStream,
  struct,
  withEndpoint,
} from "@defjs/core";

const client = createClient(withEndpoint("https://api.example.com"));
const deployEvents = defineEventStream({
  path: "/deployments/events",
  events: { line: struct.string() },
});

export async function connectWithStartupDeadline(ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("startup deadline", "TimeoutError"));
  }, ms);

  const [error, stream] = await deployEvents(
    client({ signal: controller.signal }),
  );
  clearTimeout(timer);
  if (error) return;

  await using ownedStream = stream;
  for await (const event of ownedStream) {
    console.log(event.data);
  }
}
```

## Reconnect and invalid events

- **Reconnect is opt-in on the client** via `withSSEReconnect({ attempts, delayMs, factor, maxDelayMs, jitter, shouldReconnect })`. Note: `client({ reconnect })` in `RequestOptions` is for WebSocket only and is ignored by SSE.
- Do not replay a non-idempotent `POST` SSE stream unless `shouldReconnect` verifies a server resumption contract (for example `lastEventId !== ""`).
- An event first uses its same-name own entry in `events`, then the own `events.default` entry. Only when neither exists is it dropped as `missing-struct`; payload validation failures are also dropped without killing the stream. Observe them with `withSSEOnInvalidEvent(({ reason, message, cause, signal }) => ...)`.
