---
title: العميل
description: أنشئ عميلًا صريحًا، ركّب الخيارات، نفّذ الأوامر، وامتلك التنظيف.
---

# العميل

`Client` يحمل إعداد نقطة النهاية + النقل ويوزّع أوامر HTTP وSSE وWebSocket. لا يخزّن، ولا يعيد المحاولة تلقائيًا، ولا يرعى التدفقات المفتوحة.

## الإعداد الأساسي

```typescript twoslash
import { createClient, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
```

`createClient(...)` يُرجع تحميلات زائدة لكل نوع أمر.

## ركّب الخيارات

الخيارات تُطبَّق من اليسار إلى اليمين. المُعيِّنات تستبدل؛ `withInterceptors(...items)` يُلحق.

```typescript twoslash
import { createClient, createHttpInterceptor, withCredentials, withEndpoint, withInterceptors } from '@defjs/core'

const audit = createHttpInterceptor(async (request, next) => {
  const started = performance.now()
  const response = await next(request)
  console.info(request.operation ?? request.method, response.status, Math.round(performance.now() - started))
  return response
})

const client = createClient(withEndpoint('https://api.example.com'), withInterceptors(audit), withCredentials(true))
void client
```

المعترضات المختلطة تُصفّى حسب وسيلة النقل عند التنفيذ؛ الترتيب النسبي بين النوع المختار يبقى.

## نفّذ حسب وسيلة النقل

- HTTP → `[error, data, response]`
- SSE → `[error, stream, open]` (`open` لقطة البدء؛ `stream.open` يمكن أن يتغيّر بعد إعادة الاتصال)
- WebSocket → `[error, session, connection]`

تنفيذ WebSocket يمكن أن يتجاوز `beforeConnect` و`heartbeat` و`protocols` و`reconnect`. يجب أن يكون `timeout` عددًا صحيحًا آمنًا موجبًا في `1..2_147_483_647`.

أنت تملك التنظيف: أجهض HTTP، أغلق SSE + `await stream.closed`، أغلق WebSocket + `await session.closed`.

## احقن نقل اختبار

```typescript twoslash
import { createClient, defineRequest, struct, withEndpoint, withHTTPHandle } from '@defjs/core'

const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
})

const handle: typeof fetch = async () => Response.json({ id: 7, name: 'Ada' })
const client = createClient(withEndpoint('https://fixture.invalid'), withHTTPHandle(handle))
const [error, user] = await client.execute(getUser({ id: 7 }))
if (!error) console.log(user.name)
```

## النطاق على الخادم مقابل المتصفح

على الخادم، أنشئ العميل داخل حدود الطلب عندما تلتقط الخيارات أو إغلاقات المعترض المصادقة أو ملفات تعريف الارتباط أو المستخدمين أو المستأجرين. هوية العميل ليست حد أمان بذاتها.

## المرجع

| المساعد                                                                                                       | الأثر                                                      |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `withEndpoint(url)`                                                                                           | نقطة نهاية أساس مطلقة لكل وسائل النقل                      |
| `withHeaders(HeadersInit)`                                                                                    | رؤوس افتراضية ثابتة لـ HTTP/SSE؛ رؤوس الأمر تتجاوزها       |
| `withTimeout(ms)`                                                                                             | مهلة `execute` الافتراضية لـ HTTP فقط (SSE/WS يتجاهلانها)  |
| `withHTTPHandle(fetch)`                                                                                       | استبدل Fetch لـ HTTP                                       |
| `withSSEHandle(fetch)`                                                                                        | استبدل Fetch لـ SSE                                        |
| `withWebSocketHandle(WebSocket)`                                                                              | استبدل مُنشئ WebSocket                                     |
| `withInterceptors(...items)`                                                                                  | ألحق معترضات مختلطة                                        |
| `withQuerySerializer(fn)`                                                                                     | رمّز كائن استعلام مُسمّى أصلًا إلى سلسلة استعلام           |
| `withCredentials(boolean)`                                                                                    | Fetch `credentials: 'include'` لـ HTTP/SSE عندما يكون true |
| `withXSRF(options?)`                                                                                          | ملف تعريف ارتباط XSRF لـ HTTP → رأس                        |
| `withSSEReconnect` / `withSSEOnInvalidEvent`                                                                  | مفاتيح SSE                                                 |
| `withWebSocketReconnect` / `withWebSocketHeartbeat` / `withWebSocketProtocols` / `withWebSocketBeforeConnect` | مفاتيح WebSocket                                           |

## وصفات ذات صلة

- [الاختبار بـ Fetch محلي](../recipes/test-with-handle.md)
- [إلغاء استدعاء HTTP](../recipes/cancel-http.md)
