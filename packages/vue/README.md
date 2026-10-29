# @defjs/vue

Thin Vue 3 plugin for `@defjs/core`. It provides an existing Defjs client through Vue injection.

Keep reusable SDK definitions in their own package or module. A Vue application configures the client, provides it through this plugin, and executes imported definitions. The SDK does not need a Vue dependency or an application-owned client.

This plugin is optional: import a fixed application-owned client, pass a `Client` explicitly, use Vue injection for tree-level defaults and overrides, or choose your own organization. SDK definitions do not require this plugin. Share an instance only when its captured configuration and state are safe to share; request-specific identity or credentials belong to the appropriate request boundary.

Supports Vue 3+.

## Install

```sh
bun add @defjs/core @defjs/vue vue
```

The package is ESM and requires `@defjs/core` as a peer in the `^0.4.0` range. Its tarball retains this `README.md` and the repository `LICENSE`; repository-wide guides and examples remain outside the package.

## What this package does

`createClientPlugin(client)` creates a Vue plugin that provides the exact `Client` instance supplied by the application. `injectClient()` reads the nearest provided instance. `HTTP_CLIENT` remains public for native subtree overrides.

Client creation and configuration stay in `@defjs/core`. The plugin does not create, cache, replace, dispose, abort, or close anything on behalf of the application, and it does not add transport behavior, state management, retries, or a Nuxt module.

## Quick Start

Create and own the client at the application entry point:

```ts
// main.ts
import { createClient, withEndpoint } from "@defjs/core";
import { createClientPlugin } from "@defjs/vue";
import { createApp } from "vue";
import App from "./App.vue";

const client = createClient(withEndpoint("https://api.example.com"));
const app = createApp(App);

app.use(createClientPlugin(client));
app.mount("#app");
```

Import `getUser` from your SDK or a local `api.ts` module that exports a `defineRequest(...)` endpoint. Use the injected client inside a component or composable and own cleanup where the work starts. Best practice: name the command, pass that name to `execute`, and return before reading the user when `error` is set. Abort still belongs to the watcher:

```vue
<script setup lang="ts">
import { ref, watch } from "vue";
import { injectClient } from "@defjs/vue";
import { getUser } from "./api";

const props = defineProps<{ id: number }>();
const client = injectClient();
const name = ref("");

watch(
  () => props.id,
  (id, _previousId, onCleanup) => {
    const abort = new AbortController();
    onCleanup(() => abort.abort());

    const command = getUser({ id });
    void client
      .execute(command, { signal: abort.signal })
      .then(([error, user]) => {
        if (abort.signal.aborted) return;
        if (error) {
          name.value = error.message;
          return;
        }
        name.value = user.name;
      });
  },
  { immediate: true },
);
</script>

<template>
  <div>{{ name }}</div>
</template>
```

Configure interceptors in core before installing the plugin:

```ts
import {
  createClient,
  createHttpInterceptor,
  withEndpoint,
  withInterceptors,
} from "@defjs/core";
import { createClientPlugin } from "@defjs/vue";

const auth = createHttpInterceptor((request, next) => {
  const headers = new Headers(request.headers);
  headers.set("Authorization", `Bearer ${getAccessToken()}`);
  return next({ ...request, headers });
});

const client = createClient(
  withEndpoint("https://api.example.com"),
  withInterceptors(auth),
);
app.use(createClientPlugin(client));
```

For a subtree override, use Vue's native provider with the public key:

```ts
import { createClient, withEndpoint } from "@defjs/core";
import { HTTP_CLIENT } from "@defjs/vue";
import { provide } from "vue";

provide(HTTP_CLIENT, createClient(withEndpoint("https://preview.example.com")));
```

Descendants receive that exact client; siblings outside the subtree continue to receive the app-level client. The providing component itself still reads from its ancestors.

## API

### `createClientPlugin(client: Client): Plugin`

Creates a Vue plugin that provides the supplied client instance.

### `injectClient(): Client`

```ts
function injectClient(key?: InjectionKey<Client>): Client;
```

Returns the nearest client provided for `key`; omitted or `undefined` uses `HTTP_CLIENT`. For a custom `InjectionKey<Client>`, use `app.provide(key, client)` or an ancestor's `provide(key, client)`. Both sides must share the same `Symbol` object: matching descriptions do not make keys equal. `createClientPlugin(client)` still takes only the client and provides `HTTP_CLIENT`.

Call in a valid Vue injection context, such as synchronous `setup()` or `app.runWithContext()` (Vue 3.3+). The latter is synchronous app-level context only: no component subtree overrides and no context across ordinary `await`. Compiler-restored contexts after top-level `await` in `<script setup>` remain valid.

Throws an `Error` without an active injection context or a client for the selected key; a missing custom key never falls back to `HTTP_CLIENT`. Installing the plugin alone does not establish an injection context.

An application function that only retrieves a client may use `explicitClient ?? injectClient()`: only the fallback branch needs injection context. Other lifecycle APIs in that composable retain their own context requirements. Read the client before async work and reuse the object.

### `HTTP_CLIENT: InjectionKey<Client>`

Public injection key for native subtree providers.

## Notes

- Create request-specific clients at the application boundary for SSR data that contains credentials, cookies, or tenant state.
- The owner that creates a client also owns all requests, SSE streams, and WebSocket sessions started through it. App unmount does not clean them up automatically.
- Import `createClient`, `withEndpoint`, `withInterceptors`, and all other client options from `@defjs/core`.

## License

MIT License.
