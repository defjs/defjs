---
title: SSE
description: defineEventStream, опции execute и stream handle.
---

# SSE

Объяви event stream, выполни, итерируй события, потом закрой.

## defineEventStream() {#defineEventStream}

```ts
function defineEventStream(definition: EventStreamDefinition): EventStreamEndpoint
```

- **definition** — `path`, карта `events`, необязательный `method` (по умолчанию `'GET'`), необязательные `input` и `error`, лимиты buffer/queue. При объявленном `input` всегда нужен явный `builder`, даже если входные данные уже имеют форму запроса. Опустить `builder` можно только в определениях без `input`.
- **Возвращает** эндпоинт. Вызови с input — получишь `EventStreamCommand`.

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

Низкоуровневый вход для `client.execute`. В прикладном коде бери клиент.

- **Возвращает** `[null, stream, open]` или `[error, undefined, open?]`. Если объявлен `error`, fault — это `Fault` этого struct; иначе `Fault<undefined>`.

## Опции execute

## EventStreamExecuteOptions {#EventStreamExecuteOptions}

```ts
type EventStreamExecuteOptions = {
  abort?: AbortSignal
  timeout?: number
  signal?: AbortSignal
}
```

Те же правила отмены, что у HTTP: `abort` или `timeout`, не оба.

## EventStreamHandle {#EventStreamHandle}

```ts
interface EventStreamHandle<TEvent> extends AsyncIterable<TEvent>, AsyncDisposable {
  readonly open: EventStreamOpenInfo
  readonly closed: Promise<EventStreamCloseInfo>
  close(reason?: unknown): void
  [Symbol.asyncDispose](): PromiseLike<void>
}
```

`open` — снимок старта; после reconnect он может меняться — читай ещё и `stream.open`. Для cleanup принадлежащего scope предпочитай `await using stream = handle`. Disposer останавливает чтение Defjs и работу reconnect и ждёт, пока отпустят reader lock; он не обещает, что promise `ReadableStream.cancel()`, застрявший под контролем провайдера, завершится. Ручные `close()` / `closed` остаются.

```ts
async function consume(handle: EventStreamHandle<unknown>): Promise<void> {
  await using stream = handle
  for await (const event of stream) console.log(event)
}
```

Структурные реализации `EventStreamHandle` теперь должны реализовать `[Symbol.asyncDispose]()` и вернуть тот же принадлежащий teardown path. Для кастомных handle это compile-time breaking change; код, который только получает handle от Defjs, нового runtime-вызова не требует.

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

## Карта событий

## EventStructs {#EventStructs}

```ts
type EventStructs = { [eventName: string]: AnyStruct }
```

Event struct `string` оставляет сырой текст `data`. Любой другой kind — это JSON-текст: `JSON.parse`, потом struct. Голый `struct.literal` поэтому ждёт JSON-текст, а не незакавыченный токен. Тела handshake `error` следуют тому же правилу kind, что HTTP: `string` — текст, `blob` / `file` — blob, `arrayBuffer` — байты, всё остальное — JSON.

Reconnect живёт на клиенте (`withSSEReconnect`). SSE `jitter` — **мультипликативный коэффициент 0–1**, как у WebSocket.

См. [гайд SSE](/core/sse) и [Читать SSE-стрим](/recipes/consume-sse).

## EventStreamDefinition {#EventStreamDefinition}

`path`, `events`, необязательные `method` / `input` / `error`, лимиты buffer и queue. Форма запроса совпадает с HTTP, включая `body`. `GET` и `HEAD` не могут вернуть тело. При объявленном `input` всегда нужен явный `builder`, даже если входные данные уже имеют форму запроса. Опустить `builder` можно только в определениях без `input`.

## EventStreamEndpoint {#EventStreamEndpoint}

То, что возвращает `defineEventStream`. Вызови с input — получишь `EventStreamCommand`.

## EventStreamRequestShape {#EventStreamRequestShape}

Те же поля, что у `HttpRequestShape`, для method и path стрима.

## EventStreamCommand {#EventStreamCommand}

Непрозрачная SSE-команда. Отдай в `client.execute`.

## StreamAwaitResult {#StreamAwaitResult}

`[null, stream, open]` или `[error, undefined, open?]`.

## EventStreamData {#EventStreamData}

Распарсенный payload события, выведенный из карты `EventStructs`.
