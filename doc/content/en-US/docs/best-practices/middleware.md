---
title: "Middleware"
description: "Compose interceptors as small, ordered policies that stay at the application boundary."
---

## One concern per interceptor [#one-concern]

Give each interceptor one job: attach authentication, add a trace header, record timing, or short-circuit an approved case. A middleware that authenticates, rewrites the body, retries, and logs is hard to test and hard to reason about.

Prefer:

```ts
const auth = createHttpInterceptor(async (request, next) => {
  const response = await next(request);
  return response;
});
```

Avoid a single interceptor that changes several unrelated parts of the request.

## Order is policy [#order]

Interceptors run in registration order. The first registered interceptor is the outermost: it sees the request first and the response last. Put policy that must wrap the whole attempt outermost; put policy that must be closest to the transport innermost.

```ts
const client = createClient(
  withEndpoint("https://api.example.com"),
  withInterceptors(trace, auth),
);
```

`trace` wraps `auth`; `auth` runs before the transport.

## Short-circuit deliberately [#short-circuit]

An interceptor may return a response with `makeResponse` without calling `next`. Use it for an approved cache, a maintenance response, or a local test. The response still has to satisfy the operation's declared output; do not turn a failure into a success.

## Do not rewrite the contract [#contract]

Middleware may adjust headers, trace context, or the request URL within the library's validation rules. It must not change the declared input or output meaning. Authentication and tracing belong here, not in `builder`.

## Keep it stateless [#stateless]

Do not store per-request data on a shared client or module. Pass a value through the request, the client configuration, or a closure created for that client. A middleware that mutates shared state leaks across concurrent calls.

## Handle failures at the boundary [#failures]

A middleware throw is a failure; return a response only when the middleware intentionally handled the request. Do not catch a fault just to log it and continue with `undefined`. Use the application's telemetry hook or interceptor for logging, and keep the definition free of both.
