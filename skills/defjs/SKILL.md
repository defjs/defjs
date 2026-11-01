---
name: defjs
description: "Use when authoring, consuming, debugging, or testing Defjs SDKs and clients with @defjs/core, @defjs/react, @defjs/vue, or @defjs/opentelemetry-server."
---

# Defjs

## Check the project and version

Inspect the consuming project and its installed `@defjs/core` version, package-root types, and README. These notes were verified against Core `0.6.0`. If the version is different or unknown, verify the relevant API against that version before applying these notes; report what could not be verified. Follow the consuming project's conventions and tests. Change dependencies only when the user requests or authorizes it.

## Define and execute

- Import `defineRequest`, `struct`, `createClient`, and `withEndpoint` from `@defjs/core` for a typed HTTP request. A definition specifies a method, relative `path`, input and response Structs, and any declared error Struct.
- A declared `input` requires an explicit synchronous pure `builder`. It places parsed input in `{ path?, query?, headers?, body? }`; placement is never inferred. For `/users/:id`, an input of `struct.object({ id: struct.number() })` can use `builder: (input) => ({ path: input })`.
- Keep the SDK definition independent of the client. Calling an operation runs it: `getUser(client, input)`, `health(client)`, or `getUser(client(options), input)`. `client(options)` returns a new client and does not perform I/O. There is no global client; put authentication in an application interceptor, not in `builder`.
- Check the error-first tuple and return from the surrounding function when `error` is present before using the success value. Request, response, and transport faults stay on that tuple; later stream and session operations have their own error paths.
- Struct instances have no `.parse()` method. Use the package's structural declarations and consult its public types for parsing or encoding details.

## Streams and sessions

`defineEventStream` requires a path, event Struct map, and positive buffer and queue limits. After a successful startup tuple, the caller owns the stream: handle iterator failures, close it, and await `closed`. `withSSEReconnect` is opt-in; do not replay a non-idempotent POST without an explicit application policy and server-side safety contract.

`defineWebSocket` uses incoming and optional outgoing Structs and an incoming queue limit. The caller owns the session: handle runtime errors and `send` failures, close it, and await `closed`.

## References and verification

The English Markdown pages below describe the documentation site's current version, which may differ from the installed package. Use version-matched material when available:

- [Quick start](https://defjs.lyz.cloud/llms.mdx/docs/start/content.md)
- [Client](https://defjs.lyz.cloud/llms.mdx/docs/client/content.md)
- [HTTP](https://defjs.lyz.cloud/llms.mdx/docs/http/content.md)
- [SSE](https://defjs.lyz.cloud/llms.mdx/docs/sse/content.md)
- [WebSocket](https://defjs.lyz.cloud/llms.mdx/docs/web-socket/content.md)
- [React](https://defjs.lyz.cloud/llms.mdx/docs/integrations/react/content.md), [Vue](https://defjs.lyz.cloud/llms.mdx/docs/integrations/vue/content.md), and [OpenTelemetry server](https://defjs.lyz.cloud/llms.mdx/docs/integrations/opentelemetry-server/content.md)

Run the relevant typecheck and behavior tests available in the consuming project. Skill activation depends on the agent; installation alone does not guarantee it will be loaded.
