---
title: Vue
description: プラグインを入れ、クライアントを provide し、ユーザーを取得し、リアクティブ変更時に abort します。
---

# Vue

既存の `@defjs/core` クライアントを Vue に繋ぎます。得られるのはプラグイン、injection key、`injectClient()` です。このパッケージはクライアントを**作らず**、結果をキャッシュせず、コマンドをリトライせず、unmount でトランスポートリソースも閉じません。

## Basic Setup

`@defjs/core`、`@defjs/vue`、Vue 3+ を入れます。ESM。Node で動かすときは Node.js 22+ です。

`bun add @defjs/core @defjs/vue vue`

クライアントを作り、プラグインを入れ、変更時 abort で取得します。

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

`createClientPlugin(client)` は渡したオブジェクトそのものを提供します。クローンも破棄フックもありません。core の options とインターセプターは、クライアントを作るときに設定してください。

`onCleanup` は watcher の再実行前と停止時に走ります。非同期作業を始める前に登録してください。エラーファーストのタプルはアプリケーションデータのままです。

## 注入と上書き

`injectClient()` は最も近い `HTTP_CLIENT` プロバイダを読み、なければ throw します。サブツリーは Vue の `provide(HTTP_CLIENT, childClient)` で上書きできます。

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

最も近いプロバイダが勝ちます。子孫は `childClient` を受け取り、サブツリー外の兄弟はアプリレベルのクライアントのままです。

## watcher の外で HTTP 作業を所有する

composable やコンポーネントが watcher の外で始めた作業には、`AbortController` + `onScopeDispose` を使います。起動と進行中の作業を abort し、リアクティブ状態を代入する前に signal を確認してください。プラグインや注入スコープは、誰がコマンドを所有するかを推論しません。一覧ページでは `execute` を Vue Query（または類似のもの）で包んでください — `@defjs/vue` は DI だけのままで、`useRequest` は**出しません**。

スコープがクライアントを所有するとき、ブラウザー全体で再利用するならリクエスト非依存に保ってください。ヘッダー・cookie・ユーザー・テナント・資格情報を掴むなら、関連するアプリ/SSR のリクエスト境界で作り、そこで provide してください。

## リアルタイムスコープを片付ける

スコープが接続途中で消えても、ストリームやセッションは閉じます。起動を abort し、遅く届いたハンドルを閉じ、単一イテレータを消費し、終端 promise を await します。

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

WebSocket も同じ順序です — 準備を abort、遅いセッションを close、`session.receive` を消費、`onStateChange` / `onRuntimeError` を購読解除、close、`session.closed` を await。クリーンアップは冪等に保ってください。破棄とイテレータ完了は同時に起き得ます。

## SSR スコープ

`createClientPlugin(client)` は 1 つの Vue アプリに 1 インスタンスを提供します。ブラウザーでは、エンドポイント・インターセプター・掴んだ状態を共有してよいとき共有します。SSR 中は、ヘッダー・cookie・ユーザー・テナント・資格情報が違うとき、リクエストごとに別のクライアントを作って入れます。

アプリ unmount、プラグイン削除、コンポーネントスコープ破棄は、HTTP を abort せず、SSE/WebSocket を閉じず、リスナーを購読解除せず、core クライアントも破棄しません。作業を始めた所有者が終わらせる必要があります。

## Reference

`@defjs/vue` からの公開エクスポート:

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

- `HTTP_CLIENT` — ネイティブ `provide` / `inject` 用の `InjectionKey<Client>`
- `createClientPlugin(client)` — そのクライアントを provide する Vue `Plugin`
- `injectClient()` — 最も近い `Client`、または throw

クライアントと options は `@defjs/core` で作ります。[Client](../core/client.md)、[Commands](../core/commands.md)、[Interceptors](../core/interceptors.md)、[SSE](../core/sse.md)、[WebSocket](../core/web-socket.md) を見てください。

## 関連レシピ

- [宣言済み 404 付きの GET](../recipes/get-declared-404.md)
- [HTTP 呼び出しをキャンセルする](../recipes/cancel-http.md)
- [SSE ストリームを消費する](../recipes/consume-sse.md)
- [WebSocket セッションを開く](../recipes/websocket-session.md)
