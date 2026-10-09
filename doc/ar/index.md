---
title: Defjs
description: أوامر HTTP وSSE وWebSocket مُنوَّعة الأنواع مع عميل صريح ونتائج تضع الخطأ أولاً.
---

# Defjs

عرّف نقطة نهاية، وابنِ أمرًا معتمًا، ثم نفّذه. نفس الشكل لـ HTTP وSSE وWebSocket.

```ts get-health.ts
import { createClient, defineRequest, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const getHealth = defineRequest({
  method: 'GET',
  path: '/health',
  output: struct.object({ ok: struct.boolean() }),
})

const [error, result, response] = await client.execute(getHealth())
if (!error) console.log(result.ok, response.status)
```

Defjs لا تخزّن النتائج، ولا تعيد المحاولة نيابةً عنك، ولا تغلق التدفقات إن نسيت. أنت تملك الإلغاء والتنظيف.

## اختر وسيلة النقل

| ما تحتاجه                    | ابدأ من                           | النتيجة عند النجاح                       |
| ---------------------------- | --------------------------------- | ---------------------------------------- |
| طلب + استجابة حسب الحالة     | [HTTP](./core/http.md)            | بيانات مفكوكة + `HttpResponse`           |
| تغذية أحداث خادم طويلة العمر | [SSE](./core/sse.md)              | تدفق واحد + لقطة `open` عند البدء        |
| جلسة ثنائية الاتجاه           | [WebSocket](./core/web-socket.md) | جلسة واحدة + لقطة `connection` عند البدء |

جديد هنا؟ نفّذ [البدء](./guide/getting-started.md)، ثم خذ [وصفة](./recipes/get-declared-404.md). تريد «لماذا»؟ اقرأ [قرارات التصميم](./guide/design-decisions.md) بعد أن تشغّل شيئًا.

## اختر الحزمة

| الحزمة                        | متى                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------ |
| `@defjs/core`                 | `createClient` (HTTP + SSE + WebSocket)                                              |
| `@defjs/react`                | `ClientProvider` / `useClient` — انظر [React](./plugins/react.md)                    |
| `@defjs/vue`                  | Plugin + `injectClient` — انظر [Vue](./plugins/vue.md)                               |
| `@defjs/opentelemetry-server` | spans/metrics صادرة — انظر [OpenTelemetry Server](./plugins/opentelemetry-server.md) |

## أشكال النتيجة

وسائل النقل الثلاث تُرجع tuple من ثلاثة عناصر يضع الخطأ أولاً. المواضع متطابقة؛ المعاني ليست كذلك:

- HTTP → `[error, data, response]`
- SSE → `[error, stream, open]`
- WebSocket → `[error, session, connection]`

عند فشل البدء يكون العنصر الثاني `undefined`. العنصر الثالث يوجد فقط إذا أنتجت وسيلة النقل استجابة أو لقطة أولاً. انظر [الأخطاء](./core/errors.md).

## الملكية بجملة واحدة

أجهض HTTP عندما يصبح قديماً. أغلق SSE و`await stream.closed`. أغلق WebSocket و`await session.closed`. على الخادم، أنشئ العميل داخل حدود الطلب عندما تلتقط الخيارات ملفات تعريف الارتباط أو المصادقة أو بيانات المستأجر. احجب عناوين URL والرؤوس والأجسام قبل تسجيلها.

## وصفات ذات صلة

- [GET مع 404 معلَن](./recipes/get-declared-404.md)
- [POST JSON](./recipes/post-json.md)
- [إلغاء استدعاء HTTP](./recipes/cancel-http.md)
- [استهلاك تدفق SSE](./recipes/consume-sse.md)
- [فتح جلسة WebSocket](./recipes/websocket-session.md)
- [الاختبار بـ Fetch محلي](./recipes/test-with-handle.md)
