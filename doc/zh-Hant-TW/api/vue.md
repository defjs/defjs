---
title: '@defjs/vue'
description: Vue plugin、injection key，以及 injectClient。
---

# Vue {#page}

把既有的 `@defjs/core` client 提供給 Vue app。這個套件不會建立、快取或 dispose client。

見 [Vue 指南](/plugins/vue)。

## createClientPlugin() {#createClientPlugin}

```ts
function createClientPlugin(client: Client): Plugin
```

- **client** — `createClient` 給的實例。
- **回傳** 給 `app.use(...)` 用的 Vue plugin。

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

讀最近的 `HTTP_CLIENT` provider。

- **回傳** 注入的 client。
- **拋出** 沒裝 plugin 時。

## HTTP_CLIENT {#HTTP_CLIENT}

```ts
const HTTP_CLIENT: InjectionKey<Client>
```

Vue injection key。優先用 `injectClient()`，別直接 `inject(HTTP_CLIENT)`。子樹覆蓋：`provide(HTTP_CLIENT, childClient)`。
