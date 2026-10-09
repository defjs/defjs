---
title: '@defjs/vue'
description: Vue-Plugin, Injection-Key und injectClient.
---

# Vue {#page}

Stelle einen bestehenden `@defjs/core`-Client einer Vue-App bereit. Dieses Paket erzeugt, cached oder disposed den Client nicht.

Siehe den [Vue-Guide](/plugins/vue).

## createClientPlugin() {#createClientPlugin}

```ts
function createClientPlugin(client: Client): Plugin
```

- **client** — Instanz von `createClient`.
- **Returns** ein Vue-Plugin für `app.use(...)`.

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

Liest den nächsten `HTTP_CLIENT`-Provider.

- **Returns** den injizierten Client.
- **Throws** wenn das Plugin nicht installiert wurde.

## HTTP_CLIENT {#HTTP_CLIENT}

```ts
const HTTP_CLIENT: InjectionKey<Client>
```

Vue-Injection-Key. Nimm lieber `injectClient()` statt `inject(HTTP_CLIENT)`. Überschreibe einen Subtree mit `provide(HTTP_CLIENT, childClient)`.
