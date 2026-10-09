---
title: Vue
description: Install the plugin, provide a client, fetch a user, and abort on reactive change.
---

# Vue

Wire an existing `@defjs/core` client into Vue. You get a plugin, an injection key, and `injectClient()`. The package does **not** create clients, cache results, retry commands, or close transport resources on unmount.

## Basic Setup

Install `@defjs/core`, `@defjs/vue`, and Vue 3+. ESM; Node.js 22+ when running in Node:

`bun add @defjs/core @defjs/vue vue`

Create the client, install the plugin, then fetch with abort-on-change:

```typescript twoslash
// @filename: App.vue.d.ts
import type { DefineComponent } from 'vue'
declare const App: DefineComponent
export default App

// @filename: main.ts
// ---cut---
import { createClient, withEndpoint } from '@defjs/core'
import { createClientPlugin } from '@defjs/vue'
import { createApp } from 'vue'
import App from './App.vue'

const client = createClient(withEndpoint('https://api.example.com'))
const app = createApp(App)

app.use(createClientPlugin(client))
app.mount('#app')
```

```vue twoslash
<script setup lang="ts">
import { defineRequest, struct } from '@defjs/core'
import { injectClient } from '@defjs/vue'
import { ref, watch } from 'vue'

const props = defineProps<{ id: number }>()
const client = injectClient()
const name = ref('Loading...')

const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({
    path: struct.object({ id: struct.number() }),
  }),
  output: struct.object({ name: struct.string() }),
})

watch(
  () => props.id,
  (id, _previousId, onCleanup) => {
    const controller = new AbortController()
    onCleanup(() => controller.abort())

    void client.execute(getUser({ path: { id } }), { signal: controller.signal }).then(([error, user]) => {
      if (controller.signal.aborted) return
      name.value = error ? 'Unable to load user.' : user.name
    })
  },
  { immediate: true },
)
</script>

<template>
  <span>{{ name }}</span>
</template>
```

`createClientPlugin(client)` provides the exact object you pass. No clone, no disposal hook. Configure core options and interceptors when you create the client.

`onCleanup` runs before the watcher re-runs and when it stops. Register it before starting async work. The error-first tuple stays application data.

## Inject and override

`injectClient()` reads the nearest `HTTP_CLIENT` provider and throws when none exists. Override a subtree with Vue’s `provide(HTTP_CLIENT, childClient)`:

```vue twoslash
<script setup lang="ts">
import { createClient, withEndpoint } from '@defjs/core'
import { HTTP_CLIENT, injectClient } from '@defjs/vue'
import { defineComponent, h, provide } from 'vue'

const childClient = createClient(withEndpoint('https://tenant.example.com'))
const Child = defineComponent({
  setup() {
    const client = injectClient()
    return () => h('span', client === childClient ? 'Child client is provided' : 'Unexpected client')
  },
})

provide(HTTP_CLIENT, childClient)
</script>

<template>
  <Child />
</template>
```

Nearest provider wins. Descendants get `childClient`; siblings outside the subtree keep the app-level client.

## Own HTTP work outside a watcher

For work started by a composable or component outside a watcher, use `AbortController` + `onScopeDispose`. Abort startup and active work; check the signal before assigning reactive state. A plugin or injection scope does not infer who owns a command. For list pages, wrap `execute` with Vue Query (or similar) — `@defjs/vue` stays DI only and does **not** ship `useRequest`.

When a scope owns a client, keep it request-independent for browser-wide reuse. If it captures headers, cookies, users, tenants, or credentials, create it in the relevant app/SSR request boundary and provide that instance there.

## Clean up realtime scope

Close a stream or session even when the scope disappears mid-connect. Abort startup, close a late-arriving handle, consume the single iterator, await the terminal promise:

```vue twoslash
<script setup lang="ts">
import { defineEventStream, struct, type EventStreamHandle } from '@defjs/core'
import { injectClient } from '@defjs/vue'
import { onScopeDispose, ref } from 'vue'

const client = injectClient()
const messages = ref<string[]>([])
const notifications = defineEventStream({
  maxBufferSize: 64 * 1024,
  maxQueueSize: 100,
  path: '/notifications',
  events: { message: struct.string() },
})

const controller = new AbortController()
let disposed = false
let stream: EventStreamHandle<unknown> | undefined

const stop = () => {
  disposed = true
  controller.abort()
  stream?.close('scope-disposed')
}
onScopeDispose(stop)

void (async () => {
  const [error, nextStream] = await client.execute(notifications(), { signal: controller.signal })
  if (error) return

  stream = nextStream
  if (disposed) {
    nextStream.close('scope-disposed')
    await nextStream.closed
    return
  }

  try {
    for await (const event of nextStream) {
      messages.value.push(event.data)
    }
  } finally {
    nextStream.close('scope-finished')
    await nextStream.closed
  }
})()
</script>

<template>
  <ul>
    <li v-for="message in messages" :key="message">{{ message }}</li>
  </ul>
</template>
```

WebSocket: same sequence — abort prep, close a late session, consume `session.receive`, unsubscribe `onStateChange` / `onRuntimeError`, close, await `session.closed`. Keep cleanup idempotent; disposal and iterator completion can meet.

## SSR scope

`createClientPlugin(client)` provides one instance to one Vue app. In the browser, share it when endpoint, interceptors, and captured state are safe to share. During SSR, create and install a separate client per request when headers, cookies, users, tenants, or credentials differ.

App unmount, plugin removal, and component scope disposal do **not** abort HTTP, close SSE/WebSocket, unsubscribe listeners, or dispose the core client. The owner that starts the work must finish it.

## Reference

Public exports from `@defjs/vue`:

```typescript twoslash
import { HTTP_CLIENT, createClientPlugin, injectClient } from '@defjs/vue'

type VueApi = {
  HTTP_CLIENT: typeof HTTP_CLIENT
  createClientPlugin: typeof createClientPlugin
  injectClient: typeof injectClient
}

const api: VueApi = { HTTP_CLIENT, createClientPlugin, injectClient }
void api
```

- `HTTP_CLIENT` — `InjectionKey<Client>` for native `provide` / `inject`
- `createClientPlugin(client)` — Vue `Plugin` that provides that client
- `injectClient()` — nearest `Client`, or throws

Create clients and options in `@defjs/core`. See [Client](../core/client.md), [Commands](../core/commands.md), [Interceptors](../core/interceptors.md), [SSE](../core/sse.md), and [WebSocket](../core/web-socket.md).

## Related recipes

- [GET with a declared 404](../recipes/get-declared-404.md)
- [Cancel an HTTP call](../recipes/cancel-http.md)
- [Consume an SSE stream](../recipes/consume-sse.md)
- [Open a WebSocket session](../recipes/websocket-session.md)
