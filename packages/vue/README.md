# @defjs/vue

Thin Vue 3 plugin for `@defjs/core`: it provides an application-owned client through Vue injection. It adds no transport behavior, state management, retries, or Nuxt module, and never creates, replaces, or disposes a client.

Keeping SDK definitions in their own package means the SDK needs no Vue dependency. Requires Vue 3 or later.

## Install

```sh
bun add @defjs/core @defjs/vue vue
```

The package is ESM and requires `@defjs/core` as a peer in the `^0.4.0` range.

## Quick start

```ts
// main.ts — application entry point
import { createClient, withEndpoint } from "@defjs/core";
import { createClientPlugin } from "@defjs/vue";
import { createApp } from "vue";
import App from "./App.vue";

const client = createClient(withEndpoint("https://api.example.com"));
const app = createApp(App);

app.use(createClientPlugin(client));
app.mount("#app");
```

Read the client with `injectClient()` and own cleanup in the watcher:

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

## API

### `createClientPlugin(client): Plugin`

Creates a Vue plugin that provides the supplied client as `HTTP_CLIENT`.

### `injectClient(key?): Client`

Returns the nearest client for `key`, defaulting to `HTTP_CLIENT`. Call it in a valid injection context: synchronous `setup()` or `app.runWithContext()` (Vue 3.3+). Throws without an active context or a client for the key; a missing custom key never falls back to `HTTP_CLIENT`.

### `HTTP_CLIENT`

Public `InjectionKey<Client>` for native subtree overrides:

```ts
provide(HTTP_CLIENT, createClient(withEndpoint("https://preview.example.com")));
```

Descendants receive that client; siblings outside the subtree keep the app-level one.

Interceptors and every other client option belong to `@defjs/core` and are configured before the plugin is installed:

```ts
const client = createClient(
  withEndpoint("https://api.example.com"),
  withInterceptors(auth),
);
app.use(createClientPlugin(client));
```

## Notes

- Create request-specific clients (SSR data with credentials, cookies, or tenant state) at the application boundary.
- The owner that creates a client also owns its requests, SSE streams, and WebSocket sessions. App unmount does not clean them up.
- Import `createClient`, `withEndpoint`, `withInterceptors`, and other client options from `@defjs/core`.

## Documentation

- [Vue API](https://defjs.lyz.cloud/api/vue) · [Vue guide](https://defjs.lyz.cloud/docs/integrations/vue)

## License

MIT.
