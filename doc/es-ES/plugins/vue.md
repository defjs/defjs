---
title: Vue
description: Instala el plugin, proporciona un cliente, carga un usuario y aborta ante un cambio reactivo.
---

# Vue

Conecta un cliente `@defjs/core` existente a Vue. Obtienes un plugin, una injection key y `injectClient()`. El paquete **no** crea clientes, no cachea resultados, no reintenta comandos ni cierra recursos de transporte en el unmount.

## Basic Setup

Instala `@defjs/core`, `@defjs/vue` y Vue 3+. ESM; Node.js 22+ cuando corres en Node:

`bun add @defjs/core @defjs/vue vue`

Crea el cliente, instala el plugin y luego carga con abort-on-change:

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

`createClientPlugin(client)` proporciona exactamente el objeto que pasas. Sin clone, sin hook de disposición. Configura opciones core e interceptores cuando creas el cliente.

`onCleanup` corre antes de que el watcher se reejecute y cuando se detiene. Regístralo antes de arrancar trabajo async. La tupla error-first se queda como data de la aplicación.

## Inyectar y sobrescribir

`injectClient()` lee el provider `HTTP_CLIENT` más cercano y lanza cuando no hay ninguno. Sobrescribe un subárbol con el `provide(HTTP_CLIENT, childClient)` de Vue:

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

Gana el provider más cercano. Los descendientes obtienen `childClient`; los hermanos fuera del subárbol conservan el cliente a nivel de app.

## Ser dueño del trabajo HTTP fuera de un watcher

Para trabajo arrancado por un composable o componente fuera de un watcher, usa `AbortController` + `onScopeDispose`. Aborta el arranque y el trabajo activo; comprueba el signal antes de asignar estado reactivo. Un plugin o un ámbito de inyección no infiere quién es dueño de un comando.

Cuando un ámbito es dueño de un cliente, mantenlo independiente de la solicitud para reutilizarlo en todo el navegador. Si captura cabeceras, cookies, usuarios, tenants o credenciales, créalo en el límite de solicitud de la app/SSR relevante y proporciona esa instancia allí.

## Limpiar el ámbito realtime

Cierra un stream o sesión aunque el ámbito desaparezca a mitad del connect. Aborta el arranque, cierra un handle que llega tarde, consume el único iterador, espera la promesa terminal:

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

WebSocket: misma secuencia — aborta la prep, cierra una sesión tardía, consume `session.receive`, haz unsubscribe de `onStateChange` / `onRuntimeError`, cierra, await `session.closed`. Mantén la limpieza idempotente; la disposición y la finalización del iterador pueden coincidir.

## Ámbito SSR

`createClientPlugin(client)` proporciona una instancia a una app Vue. En el navegador, compártela cuando endpoint, interceptores y estado capturado sean seguros de compartir. Durante SSR, crea e instala un cliente separado por solicitud cuando cabeceras, cookies, usuarios, tenants o credenciales difieren.

El unmount de la app, la eliminación del plugin y la disposición del ámbito del componente **no** abortan HTTP, no cierran SSE/WebSocket, no hacen unsubscribe de listeners ni disponen el cliente core. El dueño que arranca el trabajo debe terminarlo.

## Reference

Exports públicos de `@defjs/vue`:

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

- `HTTP_CLIENT` — `InjectionKey<Client>` para `provide` / `inject` nativos
- `createClientPlugin(client)` — `Plugin` de Vue que proporciona ese cliente
- `injectClient()` — `Client` más cercano, o lanza

Crea clientes y opciones en `@defjs/core`. Ver [Cliente](../core/client.md), [Comandos](../core/commands.md), [Interceptores](../core/interceptors.md), [SSE](../core/sse.md) y [WebSocket](../core/web-socket.md).

## Recetas relacionadas

- [GET con un 404 declarado](../recipes/get-declared-404.md)
- [Cancelar una llamada HTTP](../recipes/cancel-http.md)
- [Consumir un stream SSE](../recipes/consume-sse.md)
