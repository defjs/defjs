---
title: "WebSocket"
description: "Own the session, read the receive queue, bound both queues, and handle runtime errors and reconnects."
---

## Own the session [#ownership]

A WebSocket session belongs to the caller that opened it. Close it when the work is done, and use `await using` when the surrounding scope owns it, so the session is disposed on every exit path.

```ts
const [error, session] = await quotes(client);
if (error) return;
await using ownedSession = session;
ownedSession.send({ type: "subscribe", symbol: "ACME" });
```

## Read until the session closes [#read-to-end]

Read `session.receive` until the session closes or the caller stops. Do not assume the first message is the last. Register `onRuntimeError` when the application must observe a transport failure that happens after the session opened.

## Bound both queues [#bounds]

Set `maxIncomingQueueSize` for messages waiting for the consumer and `maxOutgoingQueueSize` for messages queued while reconnecting. A bound turns a slow consumer or a long reconnect into a fault instead of unbounded memory growth. Test the overflow path with the same limits production uses.

## Make reconnect and heartbeat deliberate [#reconnect]

Reconnect and heartbeat are client options. A reconnect creates a new connection attempt; queued outgoing messages follow the queue policy. A heartbeat that receives no acknowledgement is a failure the application must classify, not a reason to keep sending forever.

## Close, do not leak [#close]

`close()` starts teardown; `closed` reports the terminal state. A send after the session is no longer writable throws; check the state or handle the throw. Wait for `closed` when the next step depends on the transport being released.
