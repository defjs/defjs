# Build and publish an SDK [#publish-an-http-sdk-without-hiding-execute]

A Defjs SDK exports pure operation definitions and Struct schemas as an npm package while leaving `createClient(...)`, endpoints, credentials, and interceptors in the consuming application.

---

## 1. Define the SDK package [#1-define-the-sdk-package]

Keep your operation definitions, barrel exports, `package.json`, and `tsconfig.json` in a dedicated package directory with `@defjs/core` declared as a `peerDependency`:

<Tabs items={["src/orders.ts", "src/index.ts", "package.json", "tsconfig.json"]}>
  <Tab>
```ts title="src/orders.ts"
import { defineRequest, struct } from "@defjs/core";

export const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: { id: input.id } }),
  output: struct.object({ id: struct.number(), status: struct.string() }),
  error: struct.object({ message: struct.string() }),
});

```

  </Tab>
  <Tab>
```ts title="src/index.ts"
export { getOrder } from "./orders.ts";
```

  </Tab>
  <Tab>
```json
{
  "name": "@company/orders-sdk",
  "version": "0.1.0",
  "type": "module",
  "sideEffects": false,
  "files": ["dist"],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsdown --platform neutral"
  },
  "peerDependencies": {
    "@defjs/core": "^0.7.0"
  },
  "devDependencies": {
    "@defjs/core": "^0.7.0",
    "tsdown": "^0.23.3",
    "typescript": "^7.0.2"
  }
}
```
  </Tab>
  <Tab>
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "ESNext.Disposable", "DOM", "DOM.Iterable"],
    "strict": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts"]
}
```
  </Tab>
</Tabs>

- `@defjs/core` stays an external runtime `peerDependency` shared with the consuming application.
- `"sideEffects": false` lets bundlers tree-shake unused operations when an application imports only a subset of them.

---

## 2. Build and verify the tarball [#2-build-and-verify-the-tarball]

Bundle `dist/index.js` and `dist/index.d.ts` with `tsdown`, then inspect the package contents before publishing:

```sh
bun install
bun run build
bun pm pack --dry-run
bun pm pack
```

Verify that `dist/index.js` and `dist/index.d.ts` are included in the tarball.

---

## 3. Consume the SDK in an application [#3-consume-the-sdk-in-an-application]

Install your SDK alongside `@defjs/core`:

```sh
bun add @company/orders-sdk @defjs/core@^0.7.0
```

The application creates its own `Client` and passes it into the imported operation:

```ts title="app.ts"
import {
  createClient,
  withEndpoint,
  withHTTPHandle,
  type FetchHandle,
} from "@defjs/core";
import { getOrder } from "./src/orders.ts";

const handle: FetchHandle = () =>
  Promise.resolve(Response.json({ id: 7, status: "paid" }, { status: 200 }));

const client = createClient(
  withEndpoint("https://api.example.test"),
  withHTTPHandle(handle),
);
async function main() {
  const [error, order] = await getOrder(client, { id: 7 });
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(order.status);
}

void main();
```

```txt
paid
```

In production code, replace the relative import `./src/orders.ts` with `@company/orders-sdk` and remove `withHTTPHandle(...)` to use the platform `fetch`.

---

## 4. Test and publish [#4-test-and-publish]

Exercise your exported definitions with [in-memory handle tests](/recipes/test-with-handle) covering request mapping, `output` decoding, declared `HTTP_STATUS` faults, and cancellation. Once verified, publish the package:

```sh
bun publish --access public
```

See [HTTP operations](/docs/http), [Client](/docs/client), [Testing](/docs/testing), and [Core architecture](/docs/design-decisions).
