---
title: Vue
description: ثبّت الإضافة، وفّر عميلًا، اجلب مستخدمًا، وأجهض عند التغيير التفاعلي.
---

# Vue

اربط عميل `@defjs/core` موجودًا في Vue. تحصل على إضافة ومفتاح حقن و`injectClient()`. الحزمة **لا** تنشئ عملاء، ولا تخزّن نتائج، ولا تعيد محاولة الأوامر، ولا تغلق موارد النقل عند إلغاء التركيب.

## الإعداد الأساسي

ثبّت `@defjs/core` و`@defjs/vue` وVue 3+. ESM؛ Node.js 22+ عند التشغيل في Node:

`bun add @defjs/core @defjs/vue vue`

أنشئ العميل، ثبّت الإضافة، ثم اجلب مع الإلغاء عند التغيير:

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

`createClientPlugin(client)` يوفّر الكائن الذي تمرّره بالضبط. بلا استنساخ، بلا خطاف تخلّص. اضبط خيارات النواة والمعترضات عندما تنشئ العميل.

`onCleanup` يعمل قبل إعادة تشغيل المراقب وعندما يتوقف. سجّله قبل بدء العمل غير المتزامن. الـ tuple الذي يضع الخطأ أولاً يبقى بيانات تطبيق.

## احقن وتجاوز

`injectClient()` يقرأ أقرب مزوّد `HTTP_CLIENT` ويرمي عندما لا يوجد. تجاوز شجرة فرعية بـ `provide(HTTP_CLIENT, childClient)` في Vue:

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

أقرب مزوّد يفوز. الأحفاد يحصلون على `childClient`؛ الأشقاء خارج الشجرة الفرعية يحتفظون بعميل مستوى التطبيق.

## امتلك عمل HTTP خارج مراقب

للعمل الذي يبدأه composable أو مكوّن خارج مراقب، استخدم `AbortController` + `onScopeDispose`. أجهض البدء والعمل النشط؛ افحص الإشارة قبل تعيين الحالة التفاعلية. إضافة أو نطاق حقن لا يستنتج من يملك أمرًا. لصفحات القوائم، لفّ `execute` بـ Vue Query (أو ما يشبهها) — `@defjs/vue` يبقى حقن اعتماد فقط و**لا** يُشحن مع `useRequest`.

عندما يملك نطاق عميلًا، أبقِه مستقلًا عن الطلب لإعادة الاستخدام على مستوى المتصفح. إذا التقط رؤوسًا أو ملفات تعريف ارتباط أو مستخدمين أو مستأجرين أو بيانات اعتماد، أنشئه في حدود طلب التطبيق/SSR ذات الصلة ووفّر ذلك المثيل هناك.

## نظّف نطاق الوقت الفعلي

أغلق تدفقًا أو جلسة حتى عندما يختفي النطاق أثناء الاتصال. أجهض البدء، أغلق معالجًا يصل متأخرًا، استهلك المكرّر الواحد، انتظر الوعد النهائي:

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

WebSocket: نفس التسلسل — أجهض التحضير، أغلق جلسة متأخرة، استهلك `session.receive`، ألغِ اشتراك `onStateChange` / `onRuntimeError`، أغلق، انتظر `session.closed`. أبقِ التنظيف عديم الأثر؛ التخلص واكتمال المكرّر يمكن أن يلتقيا.

## نطاق SSR

`createClientPlugin(client)` يوفّر مثيلًا واحدًا لتطبيق Vue واحد. في المتصفح، شاركه عندما تكون نقطة النهاية والمعترضات والحالة الملتقطة آمنة للمشاركة. أثناء SSR، أنشئ وثبّت عميلًا منفصلًا لكل طلب عندما تختلف الرؤوس أو ملفات تعريف الارتباط أو المستخدمون أو المستأجرون أو بيانات الاعتماد.

إلغاء تركيب التطبيق وإزالة الإضافة وتخلص نطاق المكوّن **لا** تجهض HTTP، ولا تغلق SSE/WebSocket، ولا تلغي اشتراك المستمعين، ولا تتخلص من عميل النواة. المالك الذي يبدأ العمل يجب أن ينهيه.

## المرجع

الصادرات العامة من `@defjs/vue`:

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

- `HTTP_CLIENT` — `InjectionKey<Client>` لـ `provide` / `inject` الأصليين
- `createClientPlugin(client)` — `Plugin` Vue يوفّر ذلك العميل
- `injectClient()` — أقرب `Client`، أو يرمي

أنشئ العملاء والخيارات في `@defjs/core`. انظر [العميل](../core/client.md) و[الأوامر](../core/commands.md) و[المعترضات](../core/interceptors.md) و[SSE](../core/sse.md) و[WebSocket](../core/web-socket.md).

## وصفات ذات صلة

- [GET مع 404 معلَن](../recipes/get-declared-404.md)
- [إلغاء استدعاء HTTP](../recipes/cancel-http.md)
- [استهلاك تدفق SSE](../recipes/consume-sse.md)
- [فتح جلسة WebSocket](../recipes/websocket-session.md)
