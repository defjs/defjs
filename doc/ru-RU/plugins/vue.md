---
title: Vue
description: Поставь плагин, отдай клиент, запроси пользователя и abort на реактивной смене.
---

# Vue

Подключи существующий `@defjs/core` client к Vue. Получаешь плагин, injection key и `injectClient()`. Пакет **не** создаёт клиентов, не кеширует результаты, не ретраит команды и не закрывает ресурсы транспорта на unmount.

## Базовая настройка

Поставь `@defjs/core`, `@defjs/vue` и Vue 3+. ESM; Node.js 22+, если гоняешь в Node:

`bun add @defjs/core @defjs/vue vue`

Создай клиент, поставь плагин, потом fetch с abort-on-change:

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

`createClientPlugin(client)` отдаёт ровно тот объект, который ты передал. Без clone, без хука disposal. Опции core и interceptors настраивай, когда создаёшь клиент.

`onCleanup` бежит до повторного запуска watcher и когда он останавливается. Зарегистрируй его до старта async-работы. Error-first кортеж остаётся данными приложения.

## Inject и override

`injectClient()` читает ближайший провайдер `HTTP_CLIENT` и бросает, если его нет. Поддерево переопредели через Vue `provide(HTTP_CLIENT, childClient)`:

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

Побеждает ближайший провайдер. Потомки получают `childClient`; сиблинги вне поддерева держат клиент уровня приложения.

## Владей HTTP-работой вне watcher

Для работы, которую стартует composable или компонент вне watcher, используй `AbortController` + `onScopeDispose`. Abort старта и активной работы; проверь signal, прежде чем писать в реактивное состояние. Плагин или injection scope не выводит, кто владеет командой. Для страниц-списков оберни `execute` в Vue Query (или похожее) — `@defjs/vue` остаётся только DI и `useRequest` **не** везёт.

Когда scope владеет клиентом, держи его независимым от запроса для переиспользования на весь браузер. Если он захватывает заголовки, cookies, пользователей, tenants или credentials, создай его на релевантной границе запроса app/SSR и отдай этот экземпляр там.

## Чисти realtime scope

Закрой стрим или сессию, даже если scope исчез посреди connect. Abort старта, закрой поздно приехавший handle, потреби единственный iterator, дождись терминального promise:

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

WebSocket: та же последовательность — abort подготовки, закрой позднюю сессию, потреби `session.receive`, отпиши `onStateChange` / `onRuntimeError`, close, await `session.closed`. Держи cleanup идемпотентным; disposal и завершение iterator могут встретиться.

## Scope SSR

`createClientPlugin(client)` отдаёт один экземпляр одному Vue-приложению. В браузере дели его, когда эндпоинт, interceptors и захваченное состояние безопасно делить. Во время SSR создавай и ставь отдельный клиент на запрос, когда различаются заголовки, cookies, пользователи, tenants или credentials.

Unmount приложения, снятие плагина и disposal scope компонента **не** abort’ят HTTP, не закрывают SSE/WebSocket, не отписывают listener’ы и не dispose’ят core client. Владелец, который стартовал работу, должен её закончить.

## Справка

Публичные экспорты `@defjs/vue`:

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

- `HTTP_CLIENT` — `InjectionKey<Client>` для нативных `provide` / `inject`
- `createClientPlugin(client)` — Vue `Plugin`, который отдаёт этот клиент
- `injectClient()` — ближайший `Client`, или бросает

Клиентов и опции создавай в `@defjs/core`. См. [Клиент](../core/client.md), [Команды](../core/commands.md), [Interceptors](../core/interceptors.md), [SSE](../core/sse.md) и [WebSocket](../core/web-socket.md).

## Связанные рецепты

- [GET с объявленным 404](../recipes/get-declared-404.md)
- [Отменить HTTP-вызов](../recipes/cancel-http.md)
- [Читать SSE-стрим](../recipes/consume-sse.md)
- [Открыть WebSocket-сессию](../recipes/websocket-session.md)
