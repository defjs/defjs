---
title: Vue
description: 플러그인을 설치하고, 클라이언트를 제공하고, 사용자를 fetch하며, 반응형 변경 시 abort 해요.
---

# Vue

기존 `@defjs/core` 클라이언트를 Vue에 연결해요. 플러그인, injection key, `injectClient()`를 받아요. 패키지는 클라이언트를 **만들지 않고**, 결과를 캐시하지 않으며, 명령을 재시도하지 않고, unmount 때 전송 리소스를 닫지도 않아요.

## Basic Setup

`@defjs/core`, `@defjs/vue`, Vue 3+를 설치하세요. ESM이고, Node에서 돌릴 때는 Node.js 22+예요.

`bun add @defjs/core @defjs/vue vue`

클라이언트를 만들고 플러그인을 설치한 뒤, 변경 시 abort로 fetch 해요.

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

`createClientPlugin(client)`는 넘긴 객체를 그대로 제공해요. 복제나 dispose 훅은 없어요. core 옵션과 인터셉터는 클라이언트를 만들 때 설정하세요.

`onCleanup`은 watcher가 다시 돌거나 멈출 때 전에 실행돼요. 비동기 작업을 시작하기 전에 등록하세요. error-first 튜플은 애플리케이션 data로 남아요.

## inject와 덮어쓰기

`injectClient()`는 가장 가까운 `HTTP_CLIENT` provider를 읽고, 없으면 throw해요. 하위 트리는 Vue의 `provide(HTTP_CLIENT, childClient)`로 덮어써요.

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

가장 가까운 provider가 이겨요. 자손은 `childClient`를 받고, 하위 트리 밖 형제들은 앱 수준 클라이언트를 유지해요.

## watcher 밖에서 HTTP 작업 소유하기

watcher 밖에서 composable이나 컴포넌트가 시작한 작업은 `AbortController` + `onScopeDispose`를 쓰세요. 시작과 활성 작업을 abort하고, 반응형 상태를 할당하기 전에 signal을 확인하세요. 플러그인이나 injection 범위는 명령 소유자를 추론하지 않아요. 목록 페이지에서는 `execute`를 Vue Query(또는 비슷한 것)로 감싸세요. `@defjs/vue`는 DI만 하고 `useRequest`를 제공하지 **않아요**.

범위가 클라이언트를 소유하면 브라우저 전역 재사용을 위해 요청에 독립적으로 두세요. 헤더, 쿠키, 사용자, 테넌트, 자격 증명을 담으면 관련 앱/SSR 요청 경계에서 만들고 그 인스턴스를 거기서 제공하세요.

## 실시간 범위 정리하기

범위가 연결 중간에 사라져도 스트림이나 세션을 닫으세요. 시작을 abort하고, 늦게 도착한 핸들을 닫고, 단일 iterator를 소비하고, 종료 프로미스를 await 하세요.

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

WebSocket도 같은 순서예요 — 준비를 abort하고, 늦은 세션을 닫고, `session.receive`를 소비하고, `onStateChange` / `onRuntimeError`를 구독 해제하고, 닫고, `session.closed`를 await 하세요. 정리는 멱등하게 두세요. dispose와 iterator 완료가 만날 수 있어요.

## SSR 범위

`createClientPlugin(client)`는 Vue 앱 하나에 인스턴스 하나를 제공해요. 브라우저에서는 엔드포인트, 인터셉터, 담은 상태를 공유해도 안전할 때 공유하세요. SSR에서는 헤더, 쿠키, 사용자, 테넌트, 자격 증명이 다르면 요청마다 별도 클라이언트를 만들고 설치하세요.

앱 unmount, 플러그인 제거, 컴포넌트 범위 dispose는 HTTP를 abort하거나, SSE/WebSocket을 닫거나, 리스너를 구독 해제하거나, core 클라이언트를 dispose하지 **않아요**. 작업을 시작한 소유자가 끝내야 해요.

## Reference

`@defjs/vue`의 공개 export:

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

- `HTTP_CLIENT` — 네이티브 `provide` / `inject`용 `InjectionKey<Client>`
- `createClientPlugin(client)` — 그 클라이언트를 제공하는 Vue `Plugin`
- `injectClient()` — 가장 가까운 `Client`, 없으면 throw

클라이언트와 옵션은 `@defjs/core`에서 만들어요. [클라이언트](../core/client.md), [명령](../core/commands.md), [인터셉터](../core/interceptors.md), [SSE](../core/sse.md), [WebSocket](../core/web-socket.md)을 보세요.

## 관련 레시피

- [선언된 404가 있는 GET](../recipes/get-declared-404.md)
- [HTTP 호출 취소하기](../recipes/cancel-http.md)
- [SSE 스트림 소비하기](../recipes/consume-sse.md)
- [WebSocket 세션 열기](../recipes/websocket-session.md)
