---
title: "Examples"
description: Build and publish a reusable SDK, then configure authentication, calls, and realtime work in consuming applications.
---

Start with [Build and publish an SDK](/recipes/publish-http-sdk) for the end-to-end journey from an exported SDK definition to an npm package consumed by an application. Each recipe below pairs one operation contract with the application policy around it, using multi-file code tabs to show how the SDK definition and application execution modules fit together.

## HTTP

- [Send JSON](/recipes/post-json) — map logical camelCase fields to wire `snake_case` keys and decode a typed `201` response.
- [Handle a declared 404](/recipes/get-declared-404) — branch on a typed `200` output vs. a declared `404` `HTTP_STATUS` error body.
- [Cancellation and timeouts](/recipes/cancel-http) — combine a caller `AbortController` with `AbortSignal.timeout(...)` and distinguish `NET_ABORTED` from `NET_TIMEOUT`.
- [ETag conditional requests](/recipes/etag-revalidate) — send `If-None-Match`, handle `304 Not Modified` as an `HTTP_STATUS` fault, and keep the cache `Map` in application code.
- [GraphQL requests](/recipes/graphql-http-envelope) — send a GraphQL query over HTTP `POST` and unwrap `errors[]` vs. `.nullish()` `data` in an application helper.

## Authentication

- [Refresh a token after 401](/recipes/refresh-bearer-once) — attach a `Bearer` token, deduplicate concurrent refreshes, and replay once inside a single HTTP interceptor.

## Realtime

- [Consume SSE events](/recipes/consume-sse) — open a typed Server-Sent Events stream, iterate once, and guarantee `stream.close()` + `await stream.closed` in `finally`.
- [Manage WebSocket sessions](/recipes/websocket-session) — exchange typed incoming/outgoing JSON frames, subscribe to `onRuntimeError`, and close cleanly.

## SDK testing and publishing [#testing-and-packaging]

- [Local HTTP tests](/recipes/test-with-handle) — test URL building, interceptors, and Struct decoding in-memory with `withHTTPHandle(...)`.
- [Build and publish an SDK](/recipes/publish-http-sdk) — package and publish a zero-client SDK with `tsdown` and consume it from an application.
