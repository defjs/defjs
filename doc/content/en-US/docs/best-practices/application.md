---
title: "Application integration"
description: "Create the client at the application boundary and keep credentials, policies, and framework wiring out of the SDK."
---

## Create the client once at the boundary [#client-boundary]

Create the client where the application reads its configuration: a server entry point, a module that owns the deployment, or a test setup. Pass that client to the code that calls operations.

```ts
const client = createClient(
  withEndpoint("https://api.example.com"),
  withInterceptors(auth),
);
```

Avoid a module-level client inside an SDK, a component body, or a request handler. A client created per render or per request loses shared configuration and makes tests depend on ambient state.

## Put cross-cutting policy in interceptors [#interceptors]

Authentication, tracing, header defaults, and reviewed retry policy belong in an interceptor. `builder` places the current input; it does not know about credentials or the application's telemetry.

```ts
const auth = createHttpInterceptor(async (request, next) => {
  const response = await next(request);
  return response;
});
```

## Use client options for one call [#per-call]

`client(options)` returns a client value for one call. The value is not callable. Use it for a signal, progress callbacks, or a WebSocket hook that applies only to that call; keep the base client for everything else.

```ts
const [error, order] = await getOrder(
  client({ signal: AbortSignal.timeout(5_000) }),
  { id: 1 },
);
```

## Let framework plugins pass the client [#plugins]

`@defjs/react` and `@defjs/vue` pass an application client through the framework tree. They do not create, cache, retry, or dispose one. Provide the client the application already owns, and inject the same value where it is needed.

```tsx
<ClientProvider client={client}>
  <Orders />
</ClientProvider>
```

## Keep the endpoint out of the SDK [#endpoint]

The same definition can run against production, staging, a local fixture, or a test transport. Select the endpoint in the application; do not encode a deployment host in the SDK package.
