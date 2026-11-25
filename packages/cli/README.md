# `@defjs/cli`

Development-time CLI and OpenAPI code generator for Defjs.

Generates stateless ESM `@defjs/core` `struct`, `defineRequest`, and `defineEventStream` definitions from Swagger 2.0 and OpenAPI 3.0 / 3.1 / 3.2 documents via `@scalar/openapi-parser`. Ships as a single-file ESM CLI bundle with zero runtime dependencies and a built-in 2-space TypeScript AST printer, emitting a shared `util` module only when operations use non-default query, path, or header parameter serializers. Calling a generated operation still requires an application-owned client: `createClient(withEndpoint(...))`.

## Installation

```bash
npm install -D @defjs/cli
npm install @defjs/core
```

## Quick Start

Running `defjs` without arguments prints help.

```bash
npx defjs
npx defjs openapi generate --input ./openapi/orders.yaml --output ./src/api/orders
```

Or configure one or more targets in `defjs.config.ts` (supports native `import` of local JSON/TS OpenAPI documents on Node >= 22.18 and Bun):

```ts
import { defineConfig } from "@defjs/cli";
import ordersSpec from "./openapi/orders.json" with { type: "json" };

export default defineConfig({
  openapi: [
    {
      input: ordersSpec,
      output: {
        dir: "./src/api/orders",
        format: "ts",
      },
      mode: "sync",
      errorStrategy: "none",
      mixed2xxStrategy: "omit",
    },
  ],
});
```

Then run in scripts or CI:

```json
{
  "scripts": {
    "api:generate": "defjs openapi generate",
    "api:check": "defjs openapi generate --check"
  }
}
```

## Output Formats & Options

- `format`: `"ts"` (default), `"tsx"`, `"js"` (emits `.js` + `.d.ts`), `"mjs"` (emits `.mjs` + `.d.mts`)
- `mode`: `"sync"` (default; updates managed files and cleans stale generated files) or `"scaffold"` (writes missing files once and skips existing files)
- `errorStrategy`: `"none"` (default; safe against proxy HTML 502/504 responses) or `"union"` (synthesizes `error` struct from documented non-2xx JSON responses)
- `mixed2xxStrategy`: `"omit"` (default; skips `output` with a diagnostic warning when body-bearing and empty 2xx responses are mixed) or `"split"` (emits both `<op>` and `<op>NoContent`)

## Defjs Architecture Guardrails

- Generates stateless ESM functions and `struct` definitions only—no service classes, no `createClient`, and no hidden global client.
- Always emits explicit `builder` functions (with `.alias()` preserved on direct `body: input.body`, standard `query: input.query`, and top-level parameter names; nested object properties inside custom parameter serializers or `application/json`-encoded parameters serialize using their generated camelCase property names).
- Authentication and security headers belong in application interceptors, never generated `builder`s.
- OpenAPI validation constraints (`minLength`, `pattern`, `minimum`, etc.) are preserved in TSDoc comments rather than runtime validation DSL.
