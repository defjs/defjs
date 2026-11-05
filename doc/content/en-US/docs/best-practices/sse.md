---
title: "SSE"
description: "Own the event-stream handle, read to completion, bound the buffer, and decide reconnect policy explicitly."
---

## Own the handle [#ownership]

An event stream belongs to the caller that opened it. Close it when the work is done, and use `await using` when the surrounding scope owns it, so the handle is disposed on every exit path.

```ts
const [error, stream] = await deployEvents(client);
if (error) return;
await using ownedStream = stream;
for await (const event of ownedStream) {
  if (event.event === "line") console.log(event.data.text);
}
```

## Read to completion or EOF [#read-to-end]

One event is not a complete response. Keep reading until the stream ends, the caller aborts, or a reconnect policy takes over. Handle a read failure as a transport failure, not as a clean end.

## Bound the buffer and queue [#bounds]

Set `maxBufferSize` and `maxQueueSize` from the message size and the consumer's speed. A bound turns a slow consumer into a fault instead of unbounded memory growth. Test the overflow path with the same limits production uses.

## Decide reconnect policy explicitly [#reconnect]

SSE reconnect is off until the application enables it. A non-idempotent method such as POST is not replayed unless the policy allows it. A failed attempt may already have started work on the server; read the reconnect rules in [SSE event streams](/docs/sse) before enabling a policy.

## Close, do not leak [#close]

`close()` starts teardown; `closed` reports the terminal state. Wait for `closed` when the next step depends on the transport being released. An abort ends local work; it is not proof that the service stopped work it already accepted.
