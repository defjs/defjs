# Server-Sent Events (`defineEventStream`)

Contents: [Define and consume](#define-and-consume) · [Buffer, queue, and event decoding](#buffer-queue-and-event-decoding) · [Stream ownership and disposal](#stream-ownership-and-disposal) · [Startup deadline vs stream lifetime](#startup-deadline-vs-stream-lifetime) · [Reconnect and invalid events](#reconnect-and-invalid-events)

## Define and consume

`defineEventStream` declares a typed SSE operation with `path` and an `events` map.

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

- `maxBufferSize` (default `64 * 1024` bytes) and `maxQueueSize` (default `1024` events) are optional positive safe-integer limits. Exceeding `maxBufferSize` terminates the stream with `CAP_BUFFER_EXCEEDED`; a full `maxQueueSize` pauses reading the response until the consumer takes an event, and no event is dropped for lack of room. A stream that ends with an error or timeout still delivers the events already queued before the iterator rejects.
- Each key in `events` matches the SSE `event:` field; an event whose frame omits `event:` is named `message`.
- Decoding follows the event struct kind: `struct.string()` delivers the raw text payload; any other struct runs `JSON.parse` first and then validates against the struct.
- Handshake errors (non-2xx responses) decode against `error` if declared. A non-2xx handshake is `HTTP_STATUS` for interceptors, `shouldReconnect` and a reconnect's `closed`; a declared `error` makes the client read the handshake body to its end, unless the status has no content (`304`) or a JSON declaration meets a non-JSON media type, so the server should end every non-2xx handshake response. A body that never ends keeps the call pending until `signal` aborts or the platform cuts the connection, and `connectTimeoutMs` does not bound that read. Without `error` the body is cancelled unread. If a declared handshake error body fails the JSON media-type check, reading, JSON parsing, or struct validation, the startup result is the decode fault, as for HTTP (`RES_MEDIA_TYPE_INVALID`, `RES_DECODE_FAILED`, or `RES_STRUCT_MISMATCH`), with the status in its metadata and the reason (a `StructError` for a struct mismatch) in `error.cause`; the `HTTP_STATUS` that interceptors see carries the same `cause`. A handshake error response without content (for example `304`) is held to the same media-type check first, then reads as zero bytes, like HTTP: string, `ArrayBuffer`, and `Blob` declarations get an empty value, while a JSON declaration with a JSON media type fails to parse them (`RES_DECODE_FAILED`).
- `startupOpen` (3rd tuple element) is the initial handshake snapshot; `stream.open` updates live across reconnections.

## Stream ownership and disposal

After the success tuple resolves, the caller owns the stream:

1. Prefer `await using ownedStream = stream;`, which closes the stream and awaits teardown when leaving the block.
2. Or use `try { ... } finally { stream.close("consumer-finished"); await stream.closed; }`.
3. Only one async iterator may consume `stream`. Breaking out of `for await (const event of stream)` also triggers iterator return and closes the stream.
4. `stream.close()` and disposal discard events nobody has read yet, as `EventSource.close()` does; read what you need before closing.

## Startup deadline vs stream lifetime

`client({ signal })` applies to the **entire** stream lifetime—if the signal aborts after the stream opens, the active stream is aborted too. To enforce a timeout on the initial connection handshake only, either use `withSSEReconnect({ attempts: 0, connectTimeoutMs })` (`connectTimeoutMs` without `attempts: 0` also enables reconnect with 3 attempts), or clear your own timer as soon as `followDeployLog(...)` resolves:

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

- **Reconnect is opt-in on the client** via `withSSEReconnect({ attempts, connectTimeoutMs, delayMs, factor, maxDelayMs, jitter, shouldReconnect })`. The `reconnect` field of `RequestOptions` (`client({ reconnect })`) is for WebSocket only and is ignored by SSE.
- `attempts` defaults to 3 per outage; successful handshakes reset the budget and backoff. Clean EOF ends normally and does not reconnect; body read failures may reconnect. Except for the 502/503/504 gateway retry below, a non-2xx handshake is fatal and bypasses `shouldReconnect`, though a later operation can pick another endpoint. `connectTimeoutMs` bounds each handshake and exists only inside this options object, so setting it alone also enables reconnect with 3 attempts; pair it with `attempts: 0` for a handshake-only deadline.
- On managed reconnect, the balancer re-picks. `id:` commits at the terminating blank line, even for an ID-only frame; a partial frame never commits it. Reconnect sends the committed cursor as `Last-Event-ID` (an empty ID clears it). An event without its own `id:` carries the latest committed id, also after a reconnect. The server must support resumption. A 502/503/504 handshake (initial or reconnect) is retried like a refused connection under the same reconnect rules (a deliberate deviation from the HTML Standard, where `EventSource` fails the connection and never retries); other non-2xx handshakes are fatal. Exhausted retries and fatal reconnect handshakes end with `HTTP_STATUS`; inspect live `stream.open.response.status` for the status.
- Node.js's built-in `fetch` (undici) cuts a response body after 300 seconds without bytes. The iterator rejects with a `TypeError: terminated` whose `cause.code` is `UND_ERR_BODY_TIMEOUT`, and `stream.closed` reports `NET_UNREACHABLE` (it also counts against the endpoint in the balancer). Have the server send a `: keepalive` comment line well under 300 seconds; Defjs has no client-side idle-timeout setting.
- For multiple endpoints and the separate HTTP retry layer, read [load balancing](load-balancing.md).
- Do not replay a non-idempotent `POST` SSE stream unless `shouldReconnect` verifies a server resumption contract (for example `lastEventId !== ""`).
- An event uses the `events` entry matching its name; if there is none, it uses `events.default`. Only when neither exists is it dropped as `missing-struct`. Payload validation failures are also dropped without killing the stream. Observe both with `withSSEOnInvalidEvent(({ reason, message, cause, signal }) => ...)`.
