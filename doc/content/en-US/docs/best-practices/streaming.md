---
title: "Streaming and realtime"
description: "Own the stream handle, bound the queues, and decide reconnect and replay policy in the application."
---

## Own the handle [#ownership]

An event stream or WebSocket session belongs to the caller that opened it. Close it when the work is done, and use `await using` when the surrounding scope owns it, so the handle is disposed on every exit path.

```ts
const [error, stream] = await deployEvents(client);
if (error) return;
await using ownedStream = stream;
for await (const event of ownedStream) {
  if (event.event === "line") console.log(event.data.text);
}
```

## Read until completion or EOF [#read-to-end]

One event is not a complete response. For SSE, keep reading until the stream ends, the caller aborts, or a reconnect policy takes over. For WebSocket, read the receive queue until the session closes or the caller stops.

## Bound buffers and queues [#bounds]

Set `maxIncomingQueueSize` for WebSocket sessions and `maxBufferSize` / `maxQueueSize` for SSE. A bound turns a slow consumer into a fault instead of unbounded memory growth. Choose the bound from the message size and the consumer's speed, then test the overflow path.

## Decide reconnect and replay explicitly [#reconnect]

SSE reconnect is off until the application enables it. A POST or another non-idempotent method is not replayed unless the policy allows it. A failed streaming attempt may already have started work on the server; read the reconnect rules in [SSE event streams](/docs/sse) and the replay rules in [HTTP requests](/docs/http) before enabling a policy.

## Close, do not leak [#close]

`close()` starts teardown; `closed` reports the terminal state. Wait for `closed` when the next step depends on the transport being released. An abort ends local work; it is not proof that the service stopped work it already accepted.
