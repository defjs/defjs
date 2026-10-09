---
title: Vue
description: 装插件、provide Client、拉用户，并在响应式变化时 abort。
---

# Vue

把已有的 `@defjs/core` Client 接到 Vue。你拿到 plugin、injection key 和 `injectClient()`。这个包**不会**创建 Client、缓存结果、重试 command，也不会在卸载时关传输资源。

## 基本用法

装 `@defjs/core`、`@defjs/vue`，以及 Vue 3+。ESM；在 Node 里跑要 Node.js 22+：

`bun add @defjs/core @defjs/vue vue`

创建 Client，装插件，再按变化 abort 去拉：

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

`createClientPlugin(client)` provide 的就是你传进去的那个对象。不 clone，也没有释放钩子。Core options 和 interceptor 在创建 Client 时配好。

`onCleanup` 在 watcher 重跑前和停掉时执行。先注册它再开异步活。错误优先 tuple 仍是应用数据。

## Inject 与覆盖

`injectClient()` 读最近的 `HTTP_CLIENT` provider，没有就抛。用 Vue 的 `provide(HTTP_CLIENT, childClient)` 覆盖子树：

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

最近的 provider 赢。后代拿到 `childClient`；子树外的兄弟仍用应用级 Client。

## Watcher 外自己管 HTTP

Composable 或组件在 watcher 外启动的工作时，用 `AbortController` + `onScopeDispose`。Abort 启动和进行中的活；写响应式状态前先看 signal。Plugin 或 injection 作用域不会推断谁拥有 command。

作用域拥有 Client 时，浏览器级复用要保持请求无关。若抓住了 headers、cookie、用户、租户或凭证，就在对应应用/SSR 请求边界创建，并在那里 provide。

## 清掉 realtime 作用域

哪怕作用域在连接中途消失，也要关流或 session。Abort 启动、关晚到的 handle、消费唯一 iterator、await 终止 promise：

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

WebSocket：同一套——abort 准备、关晚到的 session、消费 `session.receive`、退订 `onStateChange` / `onRuntimeError`、close、await `session.closed`。清理保持幂等；释放和 iterator 结束可能撞上。

## SSR 作用域

`createClientPlugin(client)` 给一个 Vue app provide 一个实例。浏览器里，endpoint、interceptor、抓住的状态可共享时再共享。SSR 时若 headers、cookie、用户、租户、凭证不同，每个请求创建并安装单独 Client。

App 卸载、插件移除、组件作用域释放**不会** abort HTTP、关 SSE/WebSocket、退订监听，也不会释放 core Client。启动工作的所有者必须收尾。

## 参考

`@defjs/vue` 的公开导出：

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

- `HTTP_CLIENT` — 给原生 `provide` / `inject` 用的 `InjectionKey<Client>`
- `createClientPlugin(client)` — provide 该 Client 的 Vue `Plugin`
- `injectClient()` — 最近的 `Client`，没有就抛

Client 和 options 在 `@defjs/core` 里创建。见 [Client](../core/client.md)、[Commands](../core/commands.md)、[Interceptors](../core/interceptors.md)、[SSE](../core/sse.md)、[WebSocket](../core/web-socket.md)。

## 相关配方

- [声明了 404 的 GET](../recipes/get-declared-404.md)
- [取消一次 HTTP](../recipes/cancel-http.md)
- [消费 SSE 流](../recipes/consume-sse.md)
- [打开 WebSocket 会话](../recipes/websocket-session.md)
