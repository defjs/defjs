---
title: Vue
description: Installe le plugin, fournis un client, fetch un user, et abort au changement réactif.
---

# Vue

Branche un client `@defjs/core` existant dans Vue. Tu obtiens un plugin, une clé d’injection et `injectClient()`. Le package ne crée **pas** de clients, ne met pas les résultats en cache, ne relance pas les commandes et ne ferme pas les ressources de transport au unmount.

## Basic Setup

Installe `@defjs/core`, `@defjs/vue` et Vue 3+. ESM ; Node.js 22+ quand tu tournes dans Node :

`bun add @defjs/core @defjs/vue vue`

Crée le client, installe le plugin, puis fetch avec abort-au-changement :

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

`createClientPlugin(client)` fournit l’objet exact que tu passes. Pas de clone, pas de hook de disposal. Configure les options core et les intercepteurs quand tu crées le client.

`onCleanup` tourne avant que le watcher re-run et quand il s’arrête. Enregistre-le avant de démarrer le travail async. Le tuple erreur en premier reste de la data applicative.

## Injecter et overrider

`injectClient()` lit le provider `HTTP_CLIENT` le plus proche et throw quand aucun n’existe. Override un sous-arbre avec le `provide(HTTP_CLIENT, childClient)` de Vue :

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

Le provider le plus proche gagne. Les descendants obtiennent `childClient` ; les siblings hors du sous-arbre gardent le client app-level.

## Posséder le travail HTTP hors d’un watcher

Pour le travail démarré par un composable ou un composant hors d’un watcher, utilise `AbortController` + `onScopeDispose`. Abort le démarrage et le travail actif ; check le signal avant d’assigner l’état réactif. Un plugin ou une portée d’injection n’infère pas qui possède une commande.

Quand une portée possède un client, garde-le indépendant de la requête pour une réutilisation browser-wide. S’il capture headers, cookies, utilisateurs, tenants ou credentials, crée-le dans la frontière de requête app/SSR pertinente et fournis cette instance là.

## Nettoyer la portée realtime

Ferme un flux ou une session même quand la portée disparaît mid-connect. Abort le démarrage, ferme un handle arrivé tard, consomme l’unique itérateur, attends la promesse terminale :

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

WebSocket : même séquence — abort la prep, ferme une session tardive, consomme `session.receive`, désabonne `onStateChange` / `onRuntimeError`, ferme, attends `session.closed`. Garde le cleanup idempotent ; disposal et complétion d’itérateur peuvent se rencontrer.

## Portée SSR

`createClientPlugin(client)` fournit une instance à une app Vue. Dans le navigateur, partage-la quand endpoint, intercepteurs et état capturé sont sûrs à partager. Pendant le SSR, crée et installe un client séparé par requête quand headers, cookies, utilisateurs, tenants ou credentials diffèrent.

Unmount de l’app, retrait du plugin et disposal de portée de composant n’aborte **pas** HTTP, ne ferme pas SSE/WebSocket, ne désabonne pas les écouteurs et ne dispose pas le client core. Le propriétaire qui démarre le travail doit le finir.

## Référence

Exports publics depuis `@defjs/vue` :

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

- `HTTP_CLIENT` — `InjectionKey<Client>` pour `provide` / `inject` natifs
- `createClientPlugin(client)` — `Plugin` Vue qui fournit ce client
- `injectClient()` — `Client` le plus proche, ou throw

Crée clients et options dans `@defjs/core`. Voir [Client](../core/client.md), [Commandes](../core/commands.md), [Intercepteurs](../core/interceptors.md), [SSE](../core/sse.md) et [WebSocket](../core/web-socket.md).

## Recettes liées

- [GET avec un 404 déclaré](../recipes/get-declared-404.md)
- [Annuler un appel HTTP](../recipes/cancel-http.md)
- [Consommer un flux SSE](../recipes/consume-sse.md)
- [Ouvrir une session WebSocket](../recipes/websocket-session.md)
