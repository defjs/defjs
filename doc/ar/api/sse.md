---
title: SSE
description: defineEventStream، وخيارات التنفيذ، ومقبض التدفق.
---

# SSE

أعلن تدفق أحداث، نفّذه، كرّر الأحداث، ثم أغلق.

## defineEventStream() {#defineEventStream}

```ts
function defineEventStream(definition: EventStreamDefinition): EventStreamEndpoint
```

- **definition** — `path`، خريطة `events`، و`method` اختياري (الافتراضي `'GET'`)، و`input` و`builder` و`error` اختيارية، وحدود المخزن/الطابور.
- **يُرجع** نقطة نهاية. استدعِها بالمدخل لتحصل على `EventStreamCommand`.

```ts twoslash
import { defineEventStream, struct } from '@defjs/core'

const ticks = defineEventStream({
  maxBufferSize: 64 * 1024,
  maxQueueSize: 100,
  path: '/ticks',
  events: { message: struct.object({ text: struct.string() }) },
})
```

## executeEventStreamCommand() {#executeEventStreamCommand}

```ts
function executeEventStreamCommand(
  clientConfig: ClientConfig,
  command: EventStreamCommand,
  options?: EventStreamExecuteOptions,
): Promise<StreamAwaitResult>
```

مدخل منخفض المستوى لـ `client.execute`. فضّل العميل في شيفرة التطبيق.

- **يُرجع** `[null, stream, open]` أو `[error, undefined, open?]`. عند إعلان `error` يكون الخطأ `Fault` لذلك الـ struct؛ وإلا فهو `Fault<undefined>`.

## خيارات التنفيذ

## EventStreamExecuteOptions {#EventStreamExecuteOptions}

```ts
type EventStreamExecuteOptions = {
  abort?: AbortSignal
  timeout?: number
  signal?: AbortSignal
}
```

نفس قواعد إلغاء HTTP: `abort` أو `timeout`، لا كلاهما.

## EventStreamHandle {#EventStreamHandle}

```ts
interface EventStreamHandle<TEvent> extends AsyncIterable<TEvent>, AsyncDisposable {
  readonly open: EventStreamOpenInfo
  readonly closed: Promise<EventStreamCloseInfo>
  close(reason?: unknown): void
  [Symbol.asyncDispose](): PromiseLike<void>
}
```

`open` هي لقطة البدء؛ بعد إعادة الاتصال يمكن أن تتغيّر — اقرأ أيضًا `stream.open`. فضّل `await using stream = handle` لتنظيف النطاق المملوك. المتخلّص يوقف قراءة Defjs وعمل إعادة الاتصال وينتظر تحرير قفل القارئ؛ ولا يعد بأن وعد `ReadableStream.cancel()` العالق الذي يتحكم به المزوّد سينتهي. يبقى `close()` / `closed` اليدويان متاحين.

```ts
async function consume(handle: EventStreamHandle<unknown>): Promise<void> {
  await using stream = handle
  for await (const event of stream) console.log(event)
}
```

التطبيقات الهيكلية لـ `EventStreamHandle` يجب أن تنفّذ الآن `[Symbol.asyncDispose]()` وتُرجع مسار التخلّص المملوك نفسه. هذا تغيير كاسر وقت الترجمة للمعالجات المخصصة؛ والكود الذي يستقبل فقط مقابض تعيدها Defjs بلا متطلب استدعاء وقت تشغيل جديد.

### EventStreamOpenInfo {#EventStreamOpenInfo}

```ts
interface EventStreamOpenInfo {
  response: HttpResponse<unknown>
  url: string
}
```

### EventStreamCloseInfo {#EventStreamCloseInfo}

```ts
type EventStreamCloseInfo =
  | { kind: 'eof'; reason?: string; cause?: unknown }
  | { kind: 'aborted'; reason?: string; cause?: unknown }
  | { kind: 'error'; code: EventStreamFaultCode; reason?: string; cause?: unknown }
```

`EventStreamFaultCode`: `'CAP_BUFFER_EXCEEDED' | 'CAP_QUEUE_OVERFLOW' | 'EXT_HOOK_FAILED' | 'EXT_OBSERVER_FAILED' | 'NET_TIMEOUT' | 'NET_UNREACHABLE' | 'RES_DECODE_FAILED' | 'RES_MEDIA_TYPE_INVALID'`.

## خريطة الأحداث

## EventStructs {#EventStructs}

```ts
type EventStructs = { [eventName: string]: AnyStruct }
```

struct حدث من نوع `string` يُبقي نص `data` الخام. كل نوع آخر هو نص JSON: `JSON.parse`، ثم الـ struct. لذلك يحتاج `struct.literal` العاري نص JSON، لا رمزًا بلا اقتباس. أجسام `error` في المصافحة تستخدم قاعدة النوع نفسها كـ HTTP: `string` نص، و`blob` / `file` blobs، و`arrayBuffer` بايتات، وكل ما عدا ذلك JSON.

إعادة الاتصال تعيش على العميل (`withSSEReconnect`). `jitter` في SSE **عامل ضربي بين 0 و1**، مثل WebSocket.

انظر [دليل SSE](/core/sse) و[استهلاك تدفق SSE](/recipes/consume-sse).

## EventStreamDefinition {#EventStreamDefinition}

`path` و`events`، و`method` / `input` / `builder` / `error` اختيارية، وحدود المخزن والطابور. شكل الطلب يطابق HTTP، بما في ذلك `body`. `GET` و`HEAD` لا يمكنهما إرجاع جسم.

## EventStreamEndpoint {#EventStreamEndpoint}

يعيده `defineEventStream`. استدعه بالمدخل لتحصل على `EventStreamCommand`.

## EventStreamRequestShape {#EventStreamRequestShape}

نفس حقول `HttpRequestShape` لطريقة التدفق ومساره.

## EventStreamCommand {#EventStreamCommand}

أمر SSE معتم. مرّره إلى `client.execute`.

## StreamAwaitResult {#StreamAwaitResult}

`[null, stream, open]` أو `[error, undefined, open?]`.

## EventStreamData {#EventStreamData}

حمولة الحدث المحللة المستنتجة من خريطة `EventStructs`.
