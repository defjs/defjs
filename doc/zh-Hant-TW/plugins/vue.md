---
title: Vue
description: 安裝 plugin、提供 client、抓使用者，並在響應式變更時 abort。
---

# Vue

把既有的 `@defjs/core` client 接進 Vue。你拿到 plugin、injection key，以及 `injectClient()`。這個套件**不會**建立 clients、快取結果、重試 commands，或在 unmount 時關閉傳輸資源。

## Basic Setup

安裝 `@defjs/core`、`@defjs/vue`，以及 Vue 3+。ESM；在 Node 跑時需要 Node.js 22+：

`bun add @defjs/core @defjs/vue vue`

建立 client、安裝 plugin，然後用變更時 abort 的方式抓資料：

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
  builder: (input) => ({ path: input.path }),
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

`createClientPlugin(client)` 提供你傳入的那個物件。不 clone，也沒有 disposal hook。在建立 client 時設定 core options 與 interceptors。

`onCleanup` 在 watcher 重跑前與停止時執行。在啟動 async 工作前先註冊。Error-first tuple 仍是應用資料。

## Inject 與覆寫

`injectClient()` 讀最近的 `HTTP_CLIENT` provider；沒有時會 throw。用 Vue 的 `provide(HTTP_CLIENT, childClient)` 覆寫子樹：

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

最近的 provider 勝出。後代拿到 `childClient`；子樹外的兄弟仍用 app 層級 client。

## 在 watcher 外擁有 HTTP 工作

由 composable 或元件在 watcher 外啟動的工作，用 `AbortController` + `onScopeDispose`。Abort 啟動與進行中的工作；在賦值響應式狀態前檢查 signal。Plugin 或 injection scope 不會推斷誰擁有 command。列表頁請把 `execute` 包進 Vue Query（或類似方案）——`@defjs/vue` 只做 DI，**不會**附帶 `useRequest`。

當某個 scope 擁有 client 時，若要瀏覽器全域重用，保持它與請求無關。若它捕捉 headers、cookies、users、tenants 或 credentials，請在對應的 app／SSR 請求邊界建立，並在那裡 provide 該實例。

## 清掉 realtime scope

即使 scope 在連線中途消失，也要關閉 stream 或 session。Abort 啟動、關閉晚到的 handle、消費單一 iterator、await 終端 promise：

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

WebSocket：同一序列 — abort prep、關閉晚到的 session、消費 `session.receive`、unsubscribe `onStateChange`／`onRuntimeError`、close、await `session.closed`。Cleanup 保持冪等；disposal 與 iterator 完成可能碰上。

## SSR 範圍

`createClientPlugin(client)` 把一個實例提供給一個 Vue app。瀏覽器中，若 endpoint、interceptors、捕捉狀態可安全共用就共用。SSR 時，若 headers、cookies、users、tenants 或 credentials 不同，每個請求建立並安裝分開的 client。

App unmount、plugin 移除、元件 scope disposal **不會** abort HTTP、關閉 SSE／WebSocket、unsubscribe listeners，或 dispose core client。啟動工作的擁有者必須把它做完。

## Reference

`@defjs/vue` 的公開 exports：

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

- `HTTP_CLIENT` — 給原生 `provide`／`inject` 的 `InjectionKey<Client>`
- `createClientPlugin(client)` — 提供該 client 的 Vue `Plugin`
- `injectClient()` — 最近的 `Client`，或 throw

在 `@defjs/core` 建立 clients 與 options。見 [Client](../core/client.md)、[Commands](../core/commands.md)、[Interceptors](../core/interceptors.md)、[SSE](../core/sse.md)、[WebSocket](../core/web-socket.md)。

## 相關 recipes

- [已宣告 404 的 GET](../recipes/get-declared-404.md)
- [取消 HTTP 呼叫](../recipes/cancel-http.md)
- [消費 SSE 串流](../recipes/consume-sse.md)
- [開啟 WebSocket session](../recipes/websocket-session.md)
