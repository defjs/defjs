---
title: '@defjs/vue'
description: Vue plugin、injection key，同 injectClient。
---

# Vue {#page}

將現有 `@defjs/core` client 提供俾 Vue app。呢個 package 唔會 create、cache 或者 dispose client。

見 [Vue guide](/plugins/vue)。

## createClientPlugin() {#createClientPlugin}

```ts
function createClientPlugin(client: Client): Plugin
```

- **client** — `createClient` 俾嘅 instance。
- **Returns** 畀 `app.use(...)` 用嘅 Vue plugin。

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

讀最近嘅 `HTTP_CLIENT` provider。

- **Returns** 注入嘅 client。
- **Throws** 未裝 plugin 嗰陣。

## HTTP_CLIENT {#HTTP_CLIENT}

```ts
const HTTP_CLIENT: InjectionKey<Client>
```

Vue injection key。Prefer `injectClient()`，唔好 `inject(HTTP_CLIENT)`。子樹覆蓋用 `provide(HTTP_CLIENT, childClient)`。
