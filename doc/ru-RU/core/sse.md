---
title: Server-Sent Events
description: Читай типизированный SSE-стрим, закрой его и дождись терминального closed.
---

# Server-Sent Events

Открой стрим, итерируй, потом отпусти принадлежащий handle через `await using`. Ручные `close()` и `closed` остаются; клиенты и плагины не dispose’ят возвращённый стрим за тебя.

## Базовая настройка

```typescript twoslash
import { createClient, defineEventStream, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const notifications = defineEventStream({
  maxBufferSize: 64 * 1024,
  maxQueueSize: 100,
  path: '/notifications',
  events: {
    message: struct.object({ text: struct.string() }),
  },
})

const [error, stream] = await client.execute(notifications())
if (error) {
  console.error(error.code)
} else {
  await using ownedStream = stream
  for await (const event of ownedStream) {
    if (event.event === 'message') console.log(event.data.text)
  }
}
```

## Опиши стрим

`defineEventStream(...)` нуждается в `events`, положительном safe-integer `maxBufferSize`, положительном safe-integer `maxQueueSize` и относительном `path`. Method по умолчанию `GET`.

Форма запроса совпадает с HTTP: `builder`, возвращающий `path`, `query`, `headers` и `body`. `GET` / `HEAD` не могут вернуть тело. Объявленный struct `error` типизирует fault старта и декодирует non-2xx тело handshake по kind struct (`string` — текст, `blob` / `file` — blob, `arrayBuffer` — байты, иначе JSON). Defjs шлёт `Accept: text/event-stream`, если ты ещё не поставил `Accept`. При объявленном `input` всегда нужен явный `builder`, даже если входные данные уже имеют форму запроса. Опустить `builder` можно только в определениях без `input`.

Один логический стрим может охватить несколько физических Fetch-попыток **когда** ты opt-in’ишься в reconnect. Без `withSSEReconnect` преходящие сбои сети и чтения стрима заканчивают логический стрим. При успешном open ты всё равно получаешь один handle и один async iterator.

## Открой и посмотри

`client.execute(...)` резолвится только после того, как прошли проверки status, content-type и тела:

```typescript twoslash
import { createClient, defineEventStream, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const notifications = defineEventStream({
  maxBufferSize: 64 * 1024,
  maxQueueSize: 100,
  path: '/notifications',
  events: { message: struct.string() },
})

const [error, stream, startupOpen] = await client.execute(notifications())
if (error) {
  console.error(error.code, startupOpen?.response.status)
} else {
  console.log(stream.open.response.status, startupOpen.response.status, stream.open.url)
  stream.close('example-finished')
  await stream.closed
}
```

Ответ должен быть успешным, essence media type — `text/event-stream`, и у него должно быть тело. Non-2xx на старте → `HTTP_STATUS`. Если объявлен `error`, этот fault несёт декодированное тело handshake; плохой media type — `RES_MEDIA_TYPE_INVALID`, а тело, которое нельзя прочитать как объявленный kind, — `RES_DECODE_FAILED`. Снимок ответа всё ещё может сидеть в третьем слоте кортежа, когда валидация падает уже после прихода ответа.

`startupOpen` — начальный снимок. `stream.open` живой и меняется на поздних физических open. Держи значение кортежа, когда важен первый ответ.

```typescript twoslash
import type { EventStreamHandle, EventStreamOpenInfo, Fault } from '@defjs/core'

type StreamResult<T> =
  | [error: null, stream: EventStreamHandle<T>, open: EventStreamOpenInfo]
  | [error: Fault, stream: undefined, open: EventStreamOpenInfo | undefined]

const result: StreamResult<string> | undefined = undefined
void result
```

## Декодируй события

Имя события на проводе → `events[eventName]`; иначе `events.default`. Нет подходящего Struct → событие не доставляется. Нет поля SSE `event` → логическое имя `message`.

SSE `data` начинается как текст. Struct `string` оставляет этот текст. Любой другой kind — JSON: распарси текст, потом декодируй struct. `struct.object`, `struct.number`, `struct.boolean`, `struct.any` и `struct.unknown` — это JSON, не обрезанный текст. Голый токен вроде `ping` не удовлетворяет `struct.literal('ping')`; data должен быть JSON. Сервер, который шлёт JSON-строку `"abc"`, всё же удовлетворяет `struct.string()`: доставленное значение — этот сырой текст, включая кавычки, и оно не декодируется из JSON в `abc`.

Испущенное значение: `event`, декодированный `data`, необязательный непустой `id`. С `default` неизвестные имена событий — `string` в выведенном union.

## Наблюдай invalid events

Невалидные и необъявленные события отбрасываются, не ставятся в очередь. `withSSEOnInvalidEvent(...)` может наблюдать сырые ID, имя, текстовые data, плюс `missing-struct` или `validation-failed` и необязательный cause.

```ts
import { createClient, withEndpoint, withSSEOnInvalidEvent } from '@defjs/core'

const client = createClient(
  withEndpoint('https://api.example.com'),
  withSSEOnInvalidEvent(({ reason, message, cause, signal }) => {
    if (signal.aborted) return
    console.info('Dropped SSE event', {
      reason,
      event: message.event,
      hasCause: cause !== undefined,
    })
  }),
)
```

Observer бежит на границе transform. Его провал изолирован, если не абортирован signal активной попытки. Держи его коротким; не считай сырые данные события доверенными.

## Reconnect

**Изменение поведения:** SSE reconnect — opt-in. Без `withSSEReconnect(...)` сбои сети и чтения стрима **не** ретраятся (как `attempts: 0`). Передай `withSSEReconnect({ attempts: 3 })` (или другой проверенный бюджет), чтобы ретраить эти сбои. Обычный EOF не ретраится. Валидация status/content-type, лимиты парсера, провалы transform сообщения, переполнение очереди и обычный EOF остаются терминальными для логического стрима.

```ts
import { createClient, withEndpoint, withSSEReconnect } from '@defjs/core'

const client = createClient(
  withEndpoint('https://api.example.com'),
  withSSEReconnect({
    attempts: 3,
    delayMs: 1_000,
    factor: 2,
    maxDelayMs: 30_000,
    jitter: 0.5,
    shouldReconnect({ attempt, open }) {
      return attempt <= 3 && (open?.response.status ?? 0) !== 401
    },
  }),
)
```

`attempts` считает ретраи после начальной попытки; по умолчанию `3`, когда объект reconnect задан. `attempts: 0` отключает ретрай. Без `withSSEReconnect` ретрая тоже нет. `delayMs` — начальный интервал; `factor` его растит; `maxDelayMs` ограничивает базу. SSE `jitter` — **мультипликативный коэффициент 0–1**, как у WebSocket. Поле стрима `retry:` обновляет текущий интервал. Колбэк политики, вернувший false / бросивший / reject’нувший, заканчивает логический стрим.

Последний распарсенный event ID становится `Last-Event-ID` на следующей попытке. Следующая попытка заново шлёт тот же Fetch-запрос, включая method и body. Знай семантику replay сервера, прежде чем включать reconnect.

## Лимиты buffer и queue

Оба должны быть положительными safe integers. Переполнение фатально — старые события молча не выбрасываются.

| Лимит           | Что защищает                                                   | Терминальный код      |
| --------------- | -------------------------------------------------------------- | --------------------- |
| `maxBufferSize` | Неполная/слишком большая SSE-строка/событие при парсинге       | `CAP_BUFFER_EXCEEDED` |
| `maxQueueSize`  | События производятся быстрее, чем читает единственный consumer | `CAP_QUEUE_OVERFLOW`  |

Фатальный стрим ещё чистит буферизованные события, отменяет активное тело, reject’ит iterator и резолвит `stream.closed` с `kind: 'error'`.

## Close и dispose

`EventStreamHandle`: один живой снимок открытия, один терминальный promise, один `close`, один async iterator и один стандартный async disposer.

```typescript twoslash
import type { EventStreamCloseInfo, EventStreamHandle, EventStreamOpenInfo } from '@defjs/core'

interface StreamApi<T> extends AsyncIterable<T>, AsyncDisposable {
  readonly open: EventStreamOpenInfo
  readonly closed: Promise<EventStreamCloseInfo>
  close(reason?: unknown): void
  [Symbol.asyncDispose](): PromiseLike<void>
}

const handle = null as unknown as EventStreamHandle<string>
const api: StreamApi<string> = handle
void api
```

Терминальные коды: `eof`, `aborted` или `error`. Результат `error` ещё несёт `EventStreamFaultCode`: `CAP_BUFFER_EXCEEDED`, `CAP_QUEUE_OVERFLOW`, `EXT_HOOK_FAILED`, `EXT_OBSERVER_FAILED`, `NET_TIMEOUT`, `NET_UNREACHABLE`, `RES_DECODE_FAILED` или `RES_MEDIA_TYPE_INVALID`.

`close(reason)` абортит активную попытку, закрывает очередь, оседает как `aborted`. `break` / `return` / throw цикла вызывает iterator return и закрывает с `iterator-return`. Код, который выполняет команду, владеет закрытием.

`await using` зовёт тот же принадлежащий close path и ждёт, пока чтение/reconnect Defjs остановится и отпустят активный reader lock. Он намеренно ограничен вокруг promise `ReadableStream.cancel()` под контролем провайдера, который никогда не оседает, так что не гарантирует, что такой promise провайдера завершился. Явные `stream.close(reason)` плюс `await stream.closed` всё ещё годны, когда нужен reason или терминальный результат.

Кастомные структурные реализации `EventStreamHandle` теперь должны предоставить `[Symbol.asyncDispose](): PromiseLike<void>` и связать его с тем же lifecycle. Для реализаторов это compile-time breaking change; потребители, которые только получают handle Defjs, в рантайме ничего нового звать не должны.

Проверенный репозиторием и поддерживаемый минимум lib-контракта — `ES2022`, `ESNext.Disposable`, `DOM` и `DOM.Iterable`, репозиторий закреплён на TypeScript 7. Эти четыре записи проверяются вместе как одна база; это не утверждение, что каждое объявление независимо форсит каждую запись, и непроверенные старые компиляторы не обещаны. Обычный HTTP-клиент не `AsyncDisposable`; каждым запросом управляй через его timeout или `AbortSignal`.

Держи credentials, данные событий, event ID, cause и URL стримов подальше от обычных логов. `withCredentials(true)` влияет на Fetch cookies для SSE; auth WebSocket он не настраивает.

## Связанные рецепты

- [Читать SSE-стрим](../recipes/consume-sse.md)
- [Отменить HTTP-вызов](../recipes/cancel-http.md)
