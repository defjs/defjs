---
title: '@defjs/vue'
description: إضافة Vue ومفتاح الحقن وinjectClient.
---

# Vue {#page}

وفّر عميل `@defjs/core` موجودًا لتطبيق Vue. هذه الحزمة لا تنشئ العميل ولا تخزّنه ولا تتخلّص منه.

انظر [دليل Vue](/plugins/vue).

## createClientPlugin() {#createClientPlugin}

```ts
function createClientPlugin(client: Client): Plugin
```

- **client** — نسخة من `createClient`.
- **يعيد** إضافة Vue لـ `app.use(...)`.

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

يقرأ أقرب موفر `HTTP_CLIENT`.

- **يعيد** العميل المحقون.
- **يرمي** إذا لم تُثبَّت الإضافة.

## HTTP_CLIENT {#HTTP_CLIENT}

```ts
const HTTP_CLIENT: InjectionKey<Client>
```

مفتاح حقن Vue. فضّل `injectClient()` على `inject(HTTP_CLIENT)`. لفرع فرعي: `provide(HTTP_CLIENT, childClient)`.
