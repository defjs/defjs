<p align="center">
  <a href="https://defjs.lyz.cloud" target="_blank" rel="noopener noreferrer">
    <img width="200" src="logo.jpg" alt="Defjs logo">
  </a>
</p>
<br/>
<p align="center">
  <a href="https://npmjs.com/package/@defjs/core"><img src="https://img.shields.io/npm/v/%40defjs%2Fcore?color=%23000&style=flat-square" alt="npm package"></a>
  <a href="https://npmjs.com/package/@defjs/core"><img src="https://img.shields.io/npm/dm/%40defjs%2Fcore?color=%23000&style=flat-square" alt="monthly downloads"></a>
  <a href="https://github.com/defjs/defjs/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/defjs/defjs/ci.yml?branch=main&color=%23000&style=flat-square" alt="build status"></a>
  <a href="https://github.com/defjs/defjs/blob/main/LICENSE"><img src="https://img.shields.io/github/license/defjs/defjs?color=%23000&style=flat-square" alt="license"></a>
</p>
<br/>

**TypeScript SDK & Resilient Client Kit.**

Define reusable TypeScript APIs for HTTP, SSE, and WebSocket (`struct`, `defineRequest`, `defineEventStream`, `defineWebSocket`), and give every application a resilient client with explicit placement, error-first tuples, P2C load balancing, outlier detection, `429`/`Retry-After` retries, built-in interceptors, structured concurrency (`@defjs/core/concurrent`), cross-boundary `MessagePort` / MV3 WebExtension proxies (`@defjs/core/port` and `@defjs/core/port/webext`), and OpenAPI code generation (`@defjs/cli`).

For complete guides, examples, architecture comparisons, and the API reference, visit **[defjs.lyz.cloud](https://defjs.lyz.cloud)**.

## Quick start

```bash
bun add @defjs/core
```

Best practice: keep the definition independent of the client. Calling an operation runs it. Check `err` right after the call and return from inside that block, before using the success value.

```ts
import { createClient, defineRequest, struct, withEndpoint } from "@defjs/core";

const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), status: struct.string() }),
});

const client = createClient(withEndpoint("https://api.example.com"));

async function main() {
  const [err, order] = await getOrder(client, { id: 1 });
  if (err) {
    console.error(err.code);
    return;
  }
  console.log(order.status);
}

void main();
```

## Packages

| Package                                                                  | Role                                                                                                                                                                                               |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@defjs/core`](packages/core/README.md)                                 | Zero-dependency SDK definitions, `struct`, client, retries, load balancing, built-in interceptors, `@defjs/core/concurrent`, `@defjs/core/xsrf`, `@defjs/core/port`, and `@defjs/core/port/webext` |
| [`@defjs/cli`](packages/cli/README.md)                                   | Development-time CLI (`defjs openapi generate`) turning Swagger 2.0 / OpenAPI 3.0–3.2 specs into stateless ESM definitions                                                                         |
| [`@defjs/react`](packages/react/README.md)                               | `ClientProvider` and `useClient` context injection for React 18+                                                                                                                                   |
| [`@defjs/vue`](packages/vue/README.md)                                   | `createClientPlugin`, `HTTP_CLIENT`, and `injectClient` for Vue 3+                                                                                                                                 |
| [`@defjs/opentelemetry-server`](packages/opentelemetry-server/README.md) | Server-side outbound spans, metrics, and logs for Defjs clients                                                                                                                                    |

## Benchmarks

Reproducible benchmarks against `zod`, `valibot`, `arktype`, `fetch`, `ky`, `ofetch`, `axios`, `openapi-fetch`, and `@orpc/client` live in [`bench/`](bench/README.md). See the latest run results in [`bench/REPORT.md`](bench/REPORT.md).

## License

[MIT](LICENSE)
