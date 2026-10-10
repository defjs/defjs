---
title: React
description: ثبّت المزوّد، اقرأ العميل، اجلب مستخدمًا، وأجهض عندما يُعاد تشغيل التأثير.
---

# React

اربط عميل `@defjs/core` موجودًا في شجرة React. تحصل على Context و`useClient()`. الحزمة **لا** تنشئ عميلًا، ولا تضيف cache، ولا تعيد محاولة الأوامر، ولا تتخلص من موارد النقل. المكوّن أو التأثير أو مكتبة البيانات التي تبدأ العمل تملكه.

## الإعداد الأساسي

ثبّت `@defjs/core` و`@defjs/react` وReact 18+. ESM؛ Node.js 22+ عند التشغيل في Node:

`bun add @defjs/core @defjs/react react`

وفّر العميل، ثم اجلب مستخدمًا وأجهض عند التغيير:

```tsx twoslash
import { createClient, withEndpoint } from '@defjs/core'
import { ClientProvider } from '@defjs/react'
import type { ReactNode } from 'react'

const client = createClient(withEndpoint('https://api.example.com'))

export function ApiProvider({ children }: { children: ReactNode }) {
  return <ClientProvider client={client}>{children}</ClientProvider>
}
```

```tsx twoslash
import { defineRequest, struct } from '@defjs/core'
import { useClient } from '@defjs/react'
import { useEffect, useState } from 'react'

const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({
    path: struct.object({ id: struct.number() }),
  }),
  builder: (input) => ({ path: input.path }),
  output: struct.object({ name: struct.string() }),
})

export function UserName({ id }: { id: number }) {
  const client = useClient()
  const [name, setName] = useState<string>()

  useEffect(() => {
    const controller = new AbortController()

    void client.execute(getUser({ path: { id } }), { signal: controller.signal }).then(([error, user]) => {
      if (controller.signal.aborted) return
      setName(error ? undefined : user.name)
    })

    return () => controller.abort()
  }, [client, id])

  return <span>{name ?? 'Loading...'}</span>
}
```

`ClientProvider` مزوّد Context عادي. خاصية `client` مختلفة تغيّر ما يراه الأحفاد — بلا استنساخ أو استبدال أو تخلّص. المزوّدون المتداخلون ينشئون حدودًا صريحة.

React قد يضبط وينظّف تأثيرًا أكثر من مرة في التطوير. فحص الإشارة يمنع وعدًا قديمًا من الكتابة في التصيير الحالي. خطأ الـ tuple ما زال بيانات.

## اقرأ بـ `useClient`

`useClient()` يُرجع أقرب `Client`. استدعه أثناء التصيير (مكوّن أو خطاف مخصص). يرمي عندما لا يوجد مزوّد:

```tsx twoslash
import { defineRequest, struct } from '@defjs/core'
import { useClient } from '@defjs/react'

const health = defineRequest({
  method: 'GET',
  path: '/health',
  output: struct.object({ ok: struct.boolean() }),
})

export function HealthCheck() {
  const client = useClient()

  const check = async () => {
    const [error, result] = await client.execute(health())
    if (error) {
      console.error(error.code)
      return
    }
    console.log(result.ok)
  }

  return (
    <button type="button" onClick={() => void check()}>
      Check service
    </button>
  )
}
```

الخطاف يوفّر العميل فقط. لا يبدأ عملًا، ولا يشترك في نقل، ولا يحوّل الـ tuple الذي يضع الخطأ أولاً إلى استثناء.

## امتلك عمل الاستعلام

مكتبة استعلام يمكنها امتلاك التخزين المؤقت وإعادة المحاولة وقمع النتائج القديمة والإلغاء. أعطها الإشارة التي توفّرها. لصفحات القوائم، لفّ `client.execute(...)` بـ TanStack Query (أو ما يشبهها) — `@defjs/react` يبقى حقن اعتماد فقط و**لا** يُشحن مع `useRequest`.

```tsx twoslash
import { defineRequest, struct } from '@defjs/core'
import { useCallback } from 'react'
import { useClient } from '@defjs/react'

const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({
    path: struct.object({ id: struct.number() }),
  }),
  builder: (input) => ({ path: input.path }),
  output: struct.object({ name: struct.string() }),
})

export function useUserQueryFn(id: number) {
  const client = useClient()

  return useCallback(
    async ({ signal }: { signal: AbortSignal }) => {
      const [error, user] = await client.execute(getUser({ path: { id } }), { signal })
      if (error) throw error
      return user
    },
    [client, id],
  )
}
```

لا تلف نفس الأمر في تأثير ثانٍ — مالكان يجعلان الإلغاء ومعالجة النتائج القديمة غامضين.

## امتلك العمل الفوري

معالجات SSE وWebSocket تعيش أطول من `client.execute(...)`. سجّل التنظيف قبل انتظار البدء، أغلق معالجًا يصل بعد التخلص، استهلك مكرّره الواحد، انتظر وعده النهائي:

```tsx twoslash
import { defineWebSocket, struct } from '@defjs/core'
import { useClient } from '@defjs/react'
import { useEffect } from 'react'

const notifications = defineWebSocket({
  maxIncomingQueueSize: 100,
  path: '/notifications',
  incoming: struct.object({ text: struct.string() }),
})

export function Notifications() {
  const client = useClient()

  useEffect(() => {
    const controller = new AbortController()
    let disposed = false
    let closeActive: (() => void) | undefined

    void (async () => {
      const [error, session] = await client.execute(notifications(), { signal: controller.signal })
      if (error) return

      let closed = false
      const close = () => {
        if (closed) return
        closed = true
        session.close(1000, 'effect-disposed')
      }
      closeActive = close

      if (disposed) {
        close()
        await session.closed
        return
      }

      try {
        for await (const message of session.receive) {
          console.info(message.text)
        }
      } finally {
        close()
        await session.closed
      }
    })()

    return () => {
      disposed = true
      controller.abort()
      closeActive?.()
    }
  }, [client])

  return null
}
```

نفس القاعدة لـ `EventStreamHandle`: أغلق في `finally`، انتظر `stream.closed`. مستهلكو WebSocket يجب أيضًا أن يلغوا اشتراك مستمعي الحالة/أخطاء وقت التشغيل ويستمروا في قراءة `session.receive` — طابور محدود غير مقروء يمكن أن يفيض.

## SSR ونطاق العميل

مدخل الحزمة حد Client Component. تطبيق متصفح يمكنه مشاركة عميل على مستوى الوحدة عندما تكون نقطة النهاية والمعترضات والحالة الملتقطة آمنة للمتصفح ومستقلة عن الطلب. لـ SSR، أنشئ عميلًا منفصلًا داخل كل حدود طلب عندما تختلف الرؤوس أو ملفات تعريف الارتباط أو المستخدمون أو المستأجرون أو بيانات الاعتماد.

إلغاء تركيب المزوّد **لا** يجهض HTTP، ولا يغلق SSE/WebSocket، ولا يلغي اشتراك المستمعين، ولا يستدعي `dispose`. `@defjs/react` بلا واجهة دورة حياة كهذه. الكود الذي يبدأ كل عملية يجب أن ينهيها أو يلغيها.

## المرجع

الصادرات العامة من `@defjs/react`:

- `ClientProvider` — يقبل `ClientProviderProps`، يوفّر العميل المُمرَّر
- `useClient` — أقرب عميل، أو يرمي
- `ClientProviderProps` — `{ client: Client; children?: ReactNode }`

أنشئ العملاء والخيارات في `@defjs/core`. انظر [العميل](../core/client.md) و[الأخطاء](../core/errors.md) و[SSE](../core/sse.md) و[WebSocket](../core/web-socket.md).

## وصفات ذات صلة

- [GET مع 404 معلَن](../recipes/get-declared-404.md)
- [إلغاء استدعاء HTTP](../recipes/cancel-http.md)
- [استهلاك تدفق SSE](../recipes/consume-sse.md)
- [فتح جلسة WebSocket](../recipes/websocket-session.md)
