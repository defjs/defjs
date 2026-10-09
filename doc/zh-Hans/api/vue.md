---
title: '@defjs/vue'
description: 装插件、injection key、injectClient。
---

# Vue {#page}

把已有的 `@defjs/core` Client 接到 Vue。这个包**不会**创建 Client、缓存结果，也不会在卸载时关传输。

见 [Vue 指南](/plugins/vue)。

## createClientPlugin() {#createClientPlugin}

```ts
function createClientPlugin(client: Client): Plugin
```

- **client** — `createClient` 给的实例。
- **返回** 给 `app.use(...)` 用的 Vue plugin。

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

读最近的 `HTTP_CLIENT` provider。

- **返回** 注入的 Client。
- **抛出** 没装 plugin 时。

## HTTP_CLIENT {#HTTP_CLIENT}

```ts
const HTTP_CLIENT: InjectionKey<Client>
```

Vue injection key。优先用 `injectClient()`，别直接 `inject(HTTP_CLIENT)`。子树覆盖：`provide(HTTP_CLIENT, childClient)`。
