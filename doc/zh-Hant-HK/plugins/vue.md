---
title: Vue
description: Install plugin，provide client，fetch 一個 user，reactive change 時 abort。
---

# Vue

將現有 `@defjs/core` client wire 入 Vue。你拎到 plugin、injection key 同 `injectClient()`。Package **唔會** create clients、cache results、retry commands，或者喺 unmount 時 close transport resources。

## Basic Setup

Install `@defjs/core`、`@defjs/vue` 同 Vue 3+。ESM；喺 Node run 時要 Node.js 22+：

`bun add @defjs/core @defjs/vue vue`

Create client，install plugin，之後用 abort-on-change fetch：

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

`createClientPlugin(client)` provide 你傳入嘅 exact object。冇 clone，冇 disposal hook。Create client 時 configure core options 同 interceptors。

`onCleanup` 喺 watcher 再 run 之前，同佢停嗰陣 run。開始 async work 之前先 register。Error-first tuple 仍然係 application data。

## Inject 同 override

`injectClient()` 讀最近嘅 `HTTP_CLIENT` provider；冇就 throw。用 Vue 嘅 `provide(HTTP_CLIENT, childClient)` override 一個 subtree：

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

Nearest provider 贏。Descendants 拎 `childClient`；subtree 外嘅 siblings 繼續用 app-level client。

## 喺 watcher 之外 own HTTP work

Composable 或者 component 喺 watcher 外開始嘅 work，用 `AbortController` + `onScopeDispose`。Abort startup 同 active work；assign reactive state 之前 check signal。Plugin 或者 injection scope 唔會推邊個 own 住 command。List pages 用 Vue Query（或者類似嘅）包住 `execute`——`@defjs/vue` 只做 DI，**唔會** ship `useRequest`。

當 scope own 住 client 時，browser-wide reuse 要 keep 佢 request-independent。如果佢 capture headers、cookies、users、tenants 或者 credentials，就喺相關 app/SSR request boundary create，同喺嗰度 provide。

## Clean up realtime scope

即使 scope 喺 mid-connect 消失，都要 close stream 或者 session。Abort startup，close 遲到嘅 handle，consume 唯一個 iterator，await terminal promise：

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

WebSocket：同一套次序 — abort prep，close 遲到嘅 session，consume `session.receive`，unsubscribe `onStateChange` / `onRuntimeError`，close，await `session.closed`。Keep cleanup idempotent；disposal 同 iterator completion 可以撞埋一齊。

## SSR scope

`createClientPlugin(client)` 為一個 Vue app provide 一個 instance。Browser 上，當 endpoint、interceptors 同 captured state 可以 share 就 share。SSR 期間，當 headers、cookies、users、tenants 或者 credentials 唔同時，每個 request create 同 install 分開嘅 client。

App unmount、plugin removal 同 component scope disposal **唔會** abort HTTP、close SSE/WebSocket、unsubscribe listeners，或者 dispose core client。開始工作嘅 owner 一定要 finish 佢。

## Reference

`@defjs/vue` 嘅 public exports：

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

- `HTTP_CLIENT` — 畀 native `provide` / `inject` 用嘅 `InjectionKey<Client>`
- `createClientPlugin(client)` — provide 嗰個 client 嘅 Vue `Plugin`
- `injectClient()` — 最近嘅 `Client`，或者 throw

Clients 同 options 喺 `@defjs/core` create。睇 [Client](../core/client.md)、[Commands](../core/commands.md)、[Interceptors](../core/interceptors.md)、[SSE](../core/sse.md) 同 [WebSocket](../core/web-socket.md)。

## Related recipes

- [GET with a declared 404](../recipes/get-declared-404.md)
- [Cancel an HTTP call](../recipes/cancel-http.md)
- [Consume an SSE stream](../recipes/consume-sse.md)
- [Open a WebSocket session](../recipes/websocket-session.md)
