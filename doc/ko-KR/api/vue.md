---
title: '@defjs/vue'
description: 플러그인, injection key, injectClient예요.
---

# Vue {#page}

기존 `@defjs/core` 클라이언트를 Vue 앱에 제공해요. 이 패키지는 클라이언트를 만들거나, 캐시하거나, dispose하지 않아요.

[Vue 가이드](/plugins/vue)를 보세요.

## createClientPlugin() {#createClientPlugin}

```ts
function createClientPlugin(client: Client): Plugin
```

- **client** — `createClient`가 준 인스턴스예요.
- **반환** `app.use(...)`용 Vue 플러그인이에요.

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

가장 가까운 `HTTP_CLIENT` provider를 읽어요.

- **반환** 주입된 클라이언트예요.
- **던짐** 플러그인을 안 넣었을 때예요.

## HTTP_CLIENT {#HTTP_CLIENT}

```ts
const HTTP_CLIENT: InjectionKey<Client>
```

Vue injection key예요. `inject(HTTP_CLIENT)`보다 `injectClient()`를 쓰세요. 하위 트리는 `provide(HTTP_CLIENT, childClient)`로 덮어요.
