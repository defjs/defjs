---
title: "Performance"
description: "Stream large bodies, bound queues, choose failover deliberately, and measure before changing policy."
---

## Stream large bodies [#streaming]

Send a `ReadableStream` for a body that should not be buffered, and read a large response as a stream when the consumer can process chunks. A JSON body must be fully materialized before it is sent; a large upload does not have to be.

`onUploadProgress` and `onDownloadProgress` observe the bytes that cross the Fetch boundary. They are not a promise that the server has accepted or processed the body. Use them for user feedback, not for flow control.

## Bound what can grow [#bounds]

Set `maxIncomingQueueSize` for WebSocket sessions and `maxBufferSize` / `maxQueueSize` for SSE. A bound is part of the application's backpressure policy: it decides whether a slow consumer fails fast or applies pressure to the producer. Test the overflow path with the same limits production uses.

## Choose failover deliberately [#failover]

`withEndpointFailover` retries a failed attempt only under the policy you configure. Keep the attempt budget and the retry budget small, and do not use failover to repeat a non-idempotent request that the service cannot replay. A health check or a penalty should reflect the transport you actually use.

## Measure before tuning [#measure]

Measure the operation, the transport, and the consumer separately. A timeout that is too short looks like a network failure; a queue that is too small turns a burst into a fault. Use the existing telemetry hooks and a fixture that reproduces the load before changing a buffer, a timeout, or a retry count.
