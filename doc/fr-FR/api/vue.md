---
title: '@defjs/vue'
description: Plugin Vue, clé d’injection et injectClient.
---

# Vue {#page}

Fournis un client `@defjs/core` existant à une app Vue. Ce paquet ne crée pas, ne met pas en cache et ne dispose pas le client.

Voir le [guide Vue](/plugins/vue).

## createClientPlugin() {#createClientPlugin}

```ts
function createClientPlugin(client: Client): Plugin
```

- **client** — Instance venue de `createClient`.
- **Renvoie** un plugin Vue pour `app.use(...)`.

```ts
import { createClient, withEndpoint } from '@defjs/core'
import { createClientPlugin } from '@defjs/vue'
import { createApp } from 'vue'

const client = createClient(withEndpoint('https://api.example.com'))
const app = createApp(App)
app.use(createClientPlugin(client))
```

## injectClient() {#injectClient}

```ts
function injectClient(): Client
```

Lit le provider `HTTP_CLIENT` le plus proche.

- **Renvoie** le client injecté.
- **Lève** si le plugin n’est pas installé.

## HTTP_CLIENT {#HTTP_CLIENT}

```ts
const HTTP_CLIENT: InjectionKey<Client>
```

Clé d’injection Vue. Préfère `injectClient()` à `inject(HTTP_CLIENT)`. Pour un sous-arbre : `provide(HTTP_CLIENT, childClient)`.
