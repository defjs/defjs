---
title: Vue
description: Plugin installieren, Client providen, User fetchen und bei reaktivem Change aborten.
---

# Vue

Verdrahte einen bestehenden `@defjs/core`-Client in Vue. Du bekommst ein Plugin, einen Injection-Key und `injectClient()`. Das Paket erzeugt **keine** Clients, cached keine Results, retried keine Commands und schließt Transport-Resources bei Unmount nicht.

## Basic Setup

Installiere `@defjs/core`, `@defjs/vue` und Vue 3+. ESM; Node.js 22+, wenn du in Node läufst:

`bun add @defjs/core @defjs/vue vue`

Erzeuge den Client, installiere das Plugin, dann fetche mit Abort-on-Change:

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

`createClientPlugin(client)` provides genau das Object, das du übergibst. Kein Clone, kein Disposal-Hook. Configure Core-Options und Interceptors, wenn du den Client erzeugst.

`onCleanup` läuft, bevor der Watcher neu läuft und wenn er stoppt. Registriere es, bevor Async-Arbeit startet. Das Error-first-Tupel bleibt Application-Data.

## Inject und Override

`injectClient()` liest den nächsten `HTTP_CLIENT`-Provider und throwt, wenn keiner existiert. Override einen Subtree mit Vues `provide(HTTP_CLIENT, childClient)`:

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

Nächster Provider gewinnt. Descendants bekommen `childClient`; Siblings außerhalb des Subtrees behalten den App-Level-Client.

## HTTP-Arbeit außerhalb eines Watchers besitzen

Für Arbeit, die ein Composable oder eine Komponente außerhalb eines Watchers startet, nutze `AbortController` + `onScopeDispose`. Abort Startup und aktive Arbeit; check das Signal, bevor du reaktiven State assignst. Ein Plugin oder Injection-Scope inferiert nicht, wer einen Command besitzt. Für List-Pages wrappe `execute` mit Vue Query (oder ähnlich) — `@defjs/vue` bleibt nur DI und liefert **kein** `useRequest`.

Wenn ein Scope einen Client besitzt, halte ihn request-independent für browser-weite Reuse. Wenn er Headers, Cookies, User, Tenants oder Credentials erfasst, erzeuge ihn in der relevanten App-/SSR-Request-Grenze und provide diese Instanz dort.

## Realtime-Scope cleanupen

Schließe einen Stream oder eine Session auch, wenn der Scope mid-connect verschwindet. Abort Startup, schließe ein late-arriving Handle, konsumiere den einzelnen Iterator, await das Terminal-Promise:

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

WebSocket: dieselbe Sequenz — Prep aborten, late Session schließen, `session.receive` konsumieren, `onStateChange` / `onRuntimeError` unsubscriben, schließen, `session.closed` awaiten. Halte Cleanup idempotent; Disposal und Iterator-Completion können zusammentreffen.

## SSR-Scope

`createClientPlugin(client)` provides eine Instanz an eine Vue-App. Im Browser teile sie, wenn Endpoint, Interceptors und captured State safe zu teilen sind. Während SSR erzeuge und installiere einen separaten Client pro Request, wenn Headers, Cookies, User, Tenants oder Credentials differieren.

App-Unmount, Plugin-Removal und Component-Scope-Disposal aborten HTTP **nicht**, schließen SSE/WebSocket nicht, unsubscribed keine Listener und disposen den Core-Client nicht. Der Owner, der die Arbeit startet, muss sie finishen.

## Reference

Öffentliche Exports aus `@defjs/vue`:

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

- `HTTP_CLIENT` — `InjectionKey<Client>` für natives `provide` / `inject`
- `createClientPlugin(client)` — Vue-`Plugin`, das diesen Client provides
- `injectClient()` — nächster `Client`, oder throwt

Erzeuge Clients und Options in `@defjs/core`. Siehe [Client](../core/client.md), [Commands](../core/commands.md), [Interceptors](../core/interceptors.md), [SSE](../core/sse.md) und [WebSocket](../core/web-socket.md).

## Verwandte Rezepte

- [GET mit deklariertem 404](../recipes/get-declared-404.md)
- [HTTP-Aufruf abbrechen](../recipes/cancel-http.md)
- [SSE-Stream konsumieren](../recipes/consume-sse.md)
- [WebSocket-Session öffnen](../recipes/websocket-session.md)
