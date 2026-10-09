---
title: WebSocket
description: Стартуй типизированную JSON-сессию, принимай и шли envelopes, потом close и await closed.
---

# WebSocket

Старт → приём → отправка → отпусти через `await using`. Unsubscribe и disposal на тебе. Ручные `close()` / `closed` остаются; клиенты, провайдеры и interceptors сессии сами не закрывают.

## Базовая настройка

```typescript twoslash
import { createClient, defineWebSocket, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://chat.example.com'))
const room = defineWebSocket({
  maxIncomingQueueSize: 100,
  path: '/chat',
  incoming: struct.object({ type: struct.literal('message'), text: struct.string() }),
  outgoing: struct.object({ type: struct.literal('send'), text: struct.string() }),
})

const [error, session, startupConnection] = await client.execute(room())
if (error) {
  console.error(error.code, startupConnection?.generation)
} else {
  await using ownedSession = session
  const unsubscribe = ownedSession.onRuntimeError((cause) => console.error('runtime', cause))
  try {
    ownedSession.send({ type: 'send', text: 'Hello' })
    // wire: {"type":"send","text":"Hello"}
    for await (const message of ownedSession.receive) {
      console.log(message.type, message.text)
      break
    }
  } finally {
    unsubscribe()
  }
}
```

## Один struct на направление

`incoming` — один struct для каждого текстового кадра. `outgoing` — один struct для `session.send(...)`. Несколько видов моделируй через `struct.discriminatedUnion`. Алиас на этих полях — wire-имя в обе стороны. Отдельного type envelope и normalizer нет.

```json
{ "type": "message", "text": "Hello" }
```

Входящие кадры text, `ArrayBuffer`, typed-array и `Blob` читаются как UTF-8, парсятся как JSON, потом проверяются против `incoming`. Битый JSON и провалы struct идут в `session.onRuntimeError` и в очередь не кладутся. Сессия остаётся. Кадры, которые не text, не байты и не `Blob`, игнорируются. `withWebSocketOnInvalidEvent` нет.

`session.send(...)` валидирует и сериализует синхронно: encode struct, потом `JSON.stringify`. Шлёт сразу, когда open, ставит в очередь во время `reconnecting`, если исходящая очередь включена, и бросает `InvalidStateError`, когда писать нельзя. Также бросает, когда нет outgoing struct, payload не проходит struct, исходящая очередь выключена или полна, или нативный send падает. Статический список `protocols` на определении — контракт эндпоинта (например `graphql-transport-ws`). Опции execute и `withWebSocketProtocols` всё ещё могут его перекрыть; токен в subprotocol принадлежит `beforeConnect` или interceptor, не builder. Builder может вернуть только `path` и `query`.

`receive` — один consumer. Второй iterator отвергается.

## Снимки state

| Член                       | Смысл                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| `state`                    | `idle`, `connecting`, `open`, `reconnecting`, `closing`, `closed`, `aborted` или `error`          |
| `connection`               | Последнее физическое соединение: `generation`, URL, согласованный protocol, extensions когда есть |
| `bufferedAmount`           | Нативный счётчик неотправленных байт, или `0`, если физического сокета нет                        |
| `receive`                  | Async iterable проверенных входящих сообщений на одного consumer                                  |
| `onStateChange(listener)`  | Подписка на переходы логического state; возвращает unsubscribe                                    |
| `onRuntimeError(listener)` | Подписка на runtime-ошибки не со старта; возвращает unsubscribe                                   |
| `closed`                   | Promise логического терминального исхода close                                                    |

`open` = физический сокет открыт. `reconnecting` включает подготовку + задержку до замены. `connection.generation` растёт на каждый физический сокет, дошедший до `open`. Кортежный `startupConnection` остаётся первым успешным снимком; `session.connection` двигается дальше.

Провал старта → `[error, undefined, connection?]`. Провал конструктора до open может быть без connection; timeout/close во время старта всё ещё может дать снимок. После возврата сессии runtime-ошибки идут через observers, `receive` и `closed` — не через второй кортеж execute.

```typescript twoslash
import type { Fault, WebSocketConnectionInfo, WebSocketSession } from '@defjs/core'

type SocketResult<TIncoming, TOutgoing> =
  | [error: null, session: WebSocketSession<TIncoming, TOutgoing>, connection: WebSocketConnectionInfo]
  | [error: Fault, session: undefined, connection: WebSocketConnectionInfo | undefined]

const result: SocketResult<unknown, never> | undefined = undefined
void result
```

## Reconnect

Reconnect — opt-in. Нет объекта `reconnect` → физический close заканчивает логическую сессию. Когда настроен, дефолты: `attempts: 3`, `delayMs: 1000`, `factor: 2`, `maxDelayMs: 30000`, `jitter: 0`. `attempts` считает ретраи после начальной попытки; `attempts: 0` отключает. Предикат по умолчанию принимает любой исход close.

```ts
import { createClient, defineWebSocket, struct, withEndpoint, withWebSocketReconnect } from '@defjs/core'

const client = createClient(
  withEndpoint('https://chat.example.com'),
  withWebSocketReconnect({
    attempts: 3,
    delayMs: 500,
    factor: 2,
    maxDelayMs: 10_000,
    jitter: 0.2,
    shouldReconnect({ attempt, code, wasClean }) {
      return attempt <= 3 && (wasClean !== true || code === 1006)
    },
  }),
)
const room = defineWebSocket({
  maxIncomingQueueSize: 100,
  path: '/chat',
  incoming: struct.object({ type: struct.literal('ready'), ok: struct.boolean() }),
})
const [error, session] = await client.execute(room())
if (!error) {
  console.log(session.state)
  session.close(1000, 'done')
}
```

`shouldReconnect` получает следующую попытку ретрая, cause close, code, reason и `wasClean`. Ручной `session.close(...)` в предикат не входит. Бросок подготовки/политики заканчивает логическую сессию с ошибкой.

Jitter backoff WebSocket **мультипликативный** (`jitter: 0.2` → задержка между `0.8x` и `1.2x`). SSE `jitter` — мультипликативный коэффициент 0–1, как у WebSocket. Значения delay/factor/jitter/attempt валидируются до конструктора; задержки таймера не могут превысить `2_147_483_647` мс.

`beforeConnect({ attempt, signal })` бежит до начального конструктора и каждого reconnect. Протащи его signal в refresh токена, чтобы cancel остановил и подготовку, и connect.

## Heartbeat

Opt-in на execute или на scope клиента. Интервал шлёт `message()` через outgoing struct. Необязательный `isAck(message)` узнаёт ack — это сообщение снимает timeout и **не** доставляется в `receive`.

```ts
import { createClient, defineWebSocket, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://chat.example.com'))
const room = defineWebSocket({
  maxIncomingQueueSize: 100,
  path: '/chat',
  incoming: struct.discriminatedUnion('type', [struct.object({ type: struct.literal('pong'), ok: struct.boolean() })]),
  outgoing: struct.object({ type: struct.literal('ping') }),
})

const [error, session] = await client.execute(room(), {
  heartbeat: {
    intervalMs: 30_000,
    timeoutMs: 10_000,
    message: () => ({ type: 'ping' }),
    isAck: (message) => message.type === 'pong',
  },
})
if (!error) {
  console.log(session.state)
  session.close(1000, 'done')
}
```

`intervalMs` и `timeoutMs` должны быть положительными конечными таймерами ≤ `2_147_483_647`. Сообщение heartbeat должно быть валидно для outgoing struct. Сериализация, нативный send, классификация ack и провалы timeout фатальны для логической сессии — обычными reconnect они не становятся.

## Очереди

| Настройка              | Обязательное значение                                         | Поведение                                                                                                               |
| ---------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `maxIncomingQueueSize` | Положительный safe integer                                    | Ограничивает распарсенные сообщения, ждущие `receive`, и сырые кадры, ждущие transform. Переполнение → `state: 'error'` |
| `maxOutgoingQueueSize` | Необязательный неотрицательный safe integer; по умолчанию `0` | FIFO только пока `state === 'reconnecting'`. Полная/выключенная → `send(...)` бросает                                   |

Поставленные в очередь исходящие кадры сбрасываются до того, как заменяющий сокет публикует `open`. Кадры, уже отправленные на предыдущем сокете, сами не переигрываются. Очереди reconnect — для сообщений, которые ты шлёшь пока идёт reconnect, а не для восстановления состояния приложения.

Переполнение входящих чистит pending-последовательность, роняет `receive`, останавливает сессию, резолвит `session.closed` с `kind: 'error'`. Держи consumer достаточно быстрым или подними границу по измеренному размеру/памяти.

## Protocols и authentication

`protocols` определения, клиентский `withWebSocketProtocols(...)` и execute `protocols` задают список subprotocol конструктора. Приоритет: execution → client → definition. Первый определённый список копируется на логическую сессию и переиспользуется на reconnect.

Конструкторы браузерного WebSocket не принимают произвольные handshake-заголовки, и builder не может вернуть `headers` или `body`. Defjs конвертирует `http:` → `ws:` и `https:` → `wss:`, кодирует placeholder’ы path один раз и использует те же правила query, что HTTP: скаляры и повторённые ключи по умолчанию, `withQuerySerializer` для вложенных объектов, и serializer не зовётся, когда query нет.

`withCredentials(true)` — Fetch credentials для HTTP/SSE, не auth WebSocket. Используй проверенную политику cookie/session, subprotocol или short-lived connection ticket. Не клади общие credentials или долгоживущие секреты в query-строку.

## Closure и ownership

`session.close(code?, reason?)` просит терминальное закрытие и останавливает heartbeat. Code должен быть `1000` или `3000..4999`; reason ≤ 123 байт UTF-8. Невалидные аргументы close бросают до смены state. Используй вместе с `await session.closed`, когда нужен ручной close reason или логический терминальный результат.

```typescript twoslash
import type { WebSocketSession } from '@defjs/core'

async function observeSession(session: WebSocketSession<unknown, never>): Promise<void> {
  await using ownedSession = session
  console.log(ownedSession.state)
}

void observeSession
```

`session.closed` — логический терминальный снимок: `'closed'`, `'aborted'` или `'error'`, с необязательными нативными `code` / `reason` / `wasClean` и `cause` для aborted/error. Наблюдаемые поля нативного close побеждают запрошенный владельцем fallback.

Стандартный async disposer просит best-effort нативный close, потом ждёт teardown lifecycle, message-pump, таймеров, listener’ов, очереди и ссылки на сокет, которыми владеет Defjs. Если close-событие не наблюдалось в течение одной секунды, teardown форсируется, и disposer может reject’нуть `DOMException` с именем `TimeoutError`; это не доказывает, что физическое TCP-соединение закрылось. Повторные вызовы disposer делят тот же teardown. Кастомные структурные реализации session теперь должны предоставить тот же контракт `[Symbol.asyncDispose](): PromiseLike<void>`.

## Граница GraphQL

Defjs даёт один incoming struct, один outgoing struct и lifecycle логической сессии. Протокол приложения WebSocket он **не** реализует. Возможности GraphQL-over-WebSocket — connection init, operation ID, `next`/`error`/`complete`, disposal, replay подписки — вне контракта core.

Бери протокольный клиент вроде `graphql-ws`, когда сервер требует этот протокол, или моделируй кадры через `defineWebSocket(...)`. Статический subprotocol вроде `graphql-transport-ws` клади в `protocols`. Один struct семантику GraphQL не согласует.

## Связанные рецепты

- [Открыть WebSocket-сессию](../recipes/websocket-session.md)
- [Читать SSE-стрим](../recipes/consume-sse.md)
