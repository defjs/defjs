# @defjs/vue

Thin Vue 3 adapter for `@defjs/core`. It provides an existing Defjs client through Vue injection.

Supports Vue 3+.

## Install

```sh
bun add @defjs/core @defjs/vue vue
```

The package is ESM and requires `@defjs/core` as a peer in the `^0.4.0` range. Its tarball retains this `README.md` and the repository `LICENSE`; repository-wide guides and examples remain outside the package.

## What this package does

`createClientPlugin(client)` creates a Vue plugin that provides the exact `Client` instance supplied by the application. `injectClient()` reads the nearest provided instance. `HTTP_CLIENT` remains public for native subtree overrides.

Client creation and configuration stay in `@defjs/core`. The adapter does not create, cache, replace, dispose, abort, or close anything on behalf of the application, and it does not add transport behavior, state management, retries, or a Nuxt module.

## Quick Start

Create and own the client at the application entry point:

```ts
// main.ts
import { createClient, withEndpoint } from '@defjs/core'
import { createClientPlugin } from '@defjs/vue'
import { createApp } from 'vue'
import App from './App.vue'

const client = createClient(withEndpoint('https://api.example.com'))
const app = createApp(App)

app.use(createClientPlugin(client))
app.mount('#app')
```

Use the injected client inside a component or composable and own cleanup where the work starts:

```vue
<script setup lang="ts">
import { ref, watch } from 'vue'
import { injectClient } from '@defjs/vue'
import { getUser } from './api'

const props = defineProps<{ id: number }>()
const client = injectClient()
const name = ref('')

watch(
  () => props.id,
  (id, _previousId, onCleanup) => {
    const abort = new AbortController()
    onCleanup(() => abort.abort())

    void client.execute(getUser({ path: { id } }), { signal: abort.signal }).then(([error, user]) => {
      if (!abort.signal.aborted) name.value = error ? error.message : user.name
    })
  },
  { immediate: true },
)
</script>

<template>
  <div>{{ name }}</div>
</template>
```

Configure interceptors in core before installing the plugin:

```ts
import { createClient, createHttpInterceptor, withEndpoint, withInterceptors } from '@defjs/core'
import { createClientPlugin } from '@defjs/vue'

const auth = createHttpInterceptor((request, next) => {
  const headers = new Headers(request.headers)
  headers.set('Authorization', `Bearer ${getAccessToken()}`)
  return next({ ...request, headers })
})

const client = createClient(withEndpoint('https://api.example.com'), withInterceptors(auth))
app.use(createClientPlugin(client))
```

For a subtree override, use Vue's native provider with the public key:

```ts
import { createClient, withEndpoint } from '@defjs/core'
import { HTTP_CLIENT } from '@defjs/vue'
import { provide } from 'vue'

provide(HTTP_CLIENT, createClient(withEndpoint('https://preview.example.com')))
```

Descendants receive that exact client; siblings outside the subtree continue to receive the app-level client.

## API

### `createClientPlugin(client: Client): Plugin`

Creates a Vue plugin that provides the supplied client instance.

### `injectClient(): Client`

Returns the client from the nearest Vue provider. Call it in a valid Vue injection context, such as synchronous `setup()` or a synchronous `app.runWithContext()` callback (Vue 3.3+). Compiler-restored contexts after top-level `await` in `<script setup>` are also valid.

Throws if there is no active injection context or no client was provided. Provide a client with `app.use(createClientPlugin(client))` or an ancestor's `provide(HTTP_CLIENT, client)`; installing the plugin alone does not make calls outside an injection context valid.

### `HTTP_CLIENT: InjectionKey<Client>`

Public injection key for native subtree providers.

## Notes

- Create request-specific clients at the application boundary for SSR data that contains credentials, cookies, or tenant state.
- The owner that creates a client also owns all requests, SSE streams, and WebSocket sessions started through it. App unmount does not clean them up automatically.
- Import `createClient`, `withEndpoint`, `withInterceptors`, and all other client options from `@defjs/core`.

## License

MIT License.
