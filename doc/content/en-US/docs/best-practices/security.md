---
title: "Security"
description: "Keep credentials at the application boundary, validate URLs, enable XSRF where needed, and redact telemetry."
---

## Keep secrets out of the SDK and the browser [#secrets]

An SDK definition contains no endpoint, token, or credential. The application places credentials on a client that runs where they are allowed to be spent: a server process, a worker, or a trusted test. Do not put a provider secret in a browser bundle, a public build variable, or a client shipped to the browser.

```ts
const client = createClient(
  withEndpoint("https://api.example.com"),
  withInterceptors(serverAuth),
);
```

## Use an interceptor for authentication [#auth]

Attach a token in an interceptor that runs at the application boundary. `builder` must stay a pure placement function; it may not read a token store or mutate a header used by another call.

## Configure XSRF on the client [#xsrf]

When the service uses a cookie-to-header token, configure `withXsrf` on the application client. `withCredentials` only selects Fetch's cookie mode; it does not create or verify a token. The server must still issue and validate the token.

## Validate what the application controls [#urls]

Defjs rejects illegal request paths, directory escapes, backslashes, `?`, `#`, and control characters before a transport runs. It does not know which hosts your application trusts. Keep the endpoint list explicit, validate user-supplied values before they reach `builder`, and do not build a base URL from untrusted input.

## Redact before logging or tracing [#redaction]

URLs, query strings, headers, and bodies can contain secrets or personal data. The OpenTelemetry plugin does not capture bodies or full headers by default; keep it that way. Redact in `startSpanHook` or in the application's exporter, and do not copy raw request values into custom telemetry.

## Treat abort as local [#abort]

Cancellation stops local work. It does not prove that a service stopped work it already accepted, and it does not roll back a server-side effect. For a non-idempotent operation, pair abortion with the service's own cancellation contract.
