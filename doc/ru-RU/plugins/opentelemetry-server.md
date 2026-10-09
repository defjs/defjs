---
title: OpenTelemetry server
description: Включи исходящую инструментировку транспортов Defjs своим Tracer и необязательным Meter.
---

# OpenTelemetry server

Включай исходящую инструментировку, когда создаёшь клиент. `@defjs/opentelemetry-server` дописывает interceptors HTTP, SSE и WebSocket. Это **не** inbound server instrumentation, и OpenTelemetry SDK он **не** инициализирует.

## Базовая настройка

SDK инициализируй в другом месте. Передай его API-объекты:

```typescript twoslash
import { createClient, defineRequest, withEndpoint } from '@defjs/core'
import { withOpenTelemetryServer } from '@defjs/opentelemetry-server'
import { metrics, trace } from '@opentelemetry/api'

const tracer = trace.getTracer('orders-service')
const meter = metrics.getMeter('orders-service')
const readOrders = defineRequest({
  method: 'GET',
  operation: 'orders.read',
  path: '/orders',
})

const client = createClient(withEndpoint('https://api.example.com'), withOpenTelemetryServer({ tracer, meter }))

const [error] = await client.execute(readOrders())
if (error) console.error(error.code)
```

`tracer` обязателен. `meter` опционален — опусти его, чтобы выключить пакетные metrics. Нет `propagator` → адаптер собирает композитный propagator W3C Trace Context + W3C Baggage. Глобальный конфиг SDK он за тебя не читает и не инициализирует.

`withOpenTelemetryServer(options)` возвращает core `ClientOption`. Клади его в `createClient`, чтобы на каждый включённый транспорт дописался один interceptor. HTTP, SSE и WebSocket включены по умолчанию; `{ enabled: false }` выключает один транспорт.

Адаптер может создать телеметрию транспорта, даже когда запрос падает на слое транспорта. Уедет ли что-нибудь наружу, зависит от твоего SDK и exporter’ов.

## Scope

SDK init, провайдеры, exporter’ы, процессоры, context, sampling, redaction, flush и shutdown — на тебе. Этот пакет потребляет `Tracer`, необязательный `Meter` и необязательный `TextMapPropagator`, которые ты передал. Redactor и политики sensitive keys в нём нет.

Нет кеша, ретраев, span на уровне сообщений или политики исхода прикладной команды. Задуман для серверного Node.js. Опубликованный пакет хочет Node.js 22+, peers `@defjs/core`, `@opentelemetry/api` 1.x, `@opentelemetry/core` 2.x.

Публичное API: `withOpenTelemetryServer` плюс `OpenTelemetryServerOptions`, `OpenTelemetryServerHttpOptions`, `OpenTelemetryServerSSEOptions`, `OpenTelemetryServerWebSocketOptions`.

## Опции и hooks

Hooks сидят рядом с транспортом, который меняют. Синхронный `startSpanHook(request)` бежит до создания span и возвращает начальные `Attributes`; атрибуты приложения применяются последними, так что могут перекрыть встроенные значения. `requestHook` и `responseHook` получают уже созданный span и могут вернуть `void` или promise. Провал hook записывает `defjs.otel.hook.error` и **не** останавливает операцию клиента; упавший start hook откатывается к встроенным начальным атрибутам.

```typescript twoslash
import { createClient, createResolvedRequestUrl, withEndpoint } from '@defjs/core'
import { withOpenTelemetryServer } from '@defjs/opentelemetry-server'
import { trace } from '@opentelemetry/api'

const tracer = trace.getTracer('orders-service')
const client = createClient(
  withEndpoint('https://api.example.com'),
  withOpenTelemetryServer({
    tracer,
    http: {
      startSpanHook(request) {
        const attributes = { 'app.operation': request.operation ?? 'unclassified' }
        if (!request.baseEndpoint) return attributes
        const url = createResolvedRequestUrl(request.baseEndpoint, request.endpoint)
        if (request.queryString) url.search = request.queryString
        url.searchParams.delete('access_token')
        return { ...attributes, 'url.full': url.href }
      },
      requestHook(span, request) {
        span.setAttribute('app.request.started', true)
      },
      responseHook(span, response) {
        span.setAttribute('app.status', response.status)
      },
    },
    sse: { enabled: false },
    webSocket: { enabled: false },
  }),
)

void client
```

Сигнатуры hook:

- Все три транспорта: `startSpanHook(request): Attributes` (синхронно, до создания span)
- HTTP: `requestHook(span, request)` и `responseHook(span, response, request)`
- SSE: `requestHook(span, request)` и `responseHook(span, stream, request)`
- WebSocket: `requestHook(span, request)` и `responseHook(span, session, request)`

Пустой объект транспорта включает этот транспорт. Старые булевы переключатели транспорта и старые top-level hooks отвергаются — используй объекты опций транспорта и hooks в его scope.

## Идентичность операции и propagation

Поставь статический `operation` на `defineRequest`, `defineEventStream` или `defineWebSocket`, когда у команды стабильная идентичность. Адаптер использует его в именах span и как `defjs.operation`. Идентичность он никогда не выводит из резолвнутого path, идентификатора, tenant или query-строки:

```typescript twoslash
import { defineEventStream, defineRequest, defineWebSocket, struct } from '@defjs/core'

const readOrders = defineRequest({
  method: 'GET',
  operation: 'orders.read',
  path: '/orders',
})
const orderEvents = defineEventStream({
  maxBufferSize: 64 * 1024,
  maxQueueSize: 100,
  operation: 'orders.watch',
  path: '/orders/events',
  events: { update: struct.object({ id: struct.number() }) },
})
const orderSocket = defineWebSocket({
  maxIncomingQueueSize: 100,
  operation: 'orders.connect',
  path: '/orders/socket',
  incoming: struct.object({ id: struct.number() }),
})

void readOrders
void orderEvents
void orderSocket
```

Имена span становятся `GET orders.read`, `SSE orders.watch`, `WebSocket orders.connect`. Без `operation` fallback — method / `SSE` / `WebSocket`, а `defjs.operation` опускается.

HTTP и SSE инжектят propagated-поля в заголовки запроса. Существующие экземпляры `Headers` переиспользуются и мутируются; иначе создаётся новый `Headers`. Query propagation WebSocket — **opt-in** (браузеры не могут добавить произвольные handshake-заголовки):

```ts
import { createClient, withEndpoint } from '@defjs/core'
import { withOpenTelemetryServer } from '@defjs/opentelemetry-server'
import { trace } from '@opentelemetry/api'

const tracer = trace.getTracer('orders-service')
const client = createClient(
  withEndpoint('https://api.example.com'),
  withOpenTelemetryServer({
    tracer,
    webSocket: { queryPropagation: true },
  }),
)
```

С `queryPropagation` поля propagator дописываются к query-строке соединения. Сначала проверь логирование URL, видимость прокси, access logs, baggage и retention. `requireParentSpan: true` пропускает создание span, propagation, hooks и metrics, когда нет активного родителя, потом зовёт `next` без изменений.

## Семантика HTTP, SSE и WebSocket

Адаптер меряет времена жизни транспорта, а не каждый этап интерпретации команды.

- **HTTP** — span начинается в HTTP interceptor и кончается, когда тот получает Defjs `HttpResponse`. Проверка media type, чтение representation и decode Struct — всё после. Поздний fault `RES_*` не может обновить уже конченный span транспорта. Поскольку span живёт внутри цепочки, rejection транспорта записывается классом исключения по соглашению OTel, а не кодом fault, который execution назначит позже.
- **SSE** — span остаётся открытым, пока не осядет `stream.closed`. Пишет `sse.connected`, потом `sse.closed` / `sse.aborted` / `sse.error`. Один логический стрим (включая reconnect) → один span. Span на событие нет.
- **WebSocket** — span остаётся открытым, пока не осядет `session.closed`. События: `websocket.connected`, `websocket.closed`, `websocket.error`. Переподключающиеся физические сокеты остаются частью логической сессии. Span на сообщение нет.

Нужен итоговый исход команды, а не только транспорт? Оберни `client.execute(...)` в span приложения:

```typescript twoslash
import { createClient, defineRequest, withEndpoint } from '@defjs/core'
import { withOpenTelemetryServer } from '@defjs/opentelemetry-server'
import { SpanStatusCode, trace } from '@opentelemetry/api'

const tracer = trace.getTracer('orders-service')
const client = createClient(withEndpoint('https://api.example.com'), withOpenTelemetryServer({ tracer }))
const readOrders = defineRequest({ method: 'GET', operation: 'orders.read', path: '/orders' })

const outcome = await tracer.startActiveSpan('orders.command', async (span) => {
  try {
    const outcome = await client.execute(readOrders())
    const [error] = outcome
    if (error) {
      span.setAttribute('error.type', error.code)
      span.setStatus({ code: SpanStatusCode.ERROR })
    }
    return outcome
  } finally {
    span.end()
  }
})

void outcome
```

Внешний span — твой. Плагин всё ещё сообщает нижний span транспорта — это два разных вопроса.

## Справка

Когда передан `meter`:

| Метрика                                      | Смысл                                           |
| -------------------------------------------- | ----------------------------------------------- |
| `http.client.request.duration`               | Длительность HTTP-запроса (секунды)             |
| `defjs.client.sse.connect.duration`          | Время до возврата SSE handle                    |
| `defjs.client.sse.connection.duration`       | Возврат handle → терминальный close             |
| `defjs.client.sse.active_streams`            | Логические SSE handle с висящим `closed`        |
| `defjs.client.websocket.connect.duration`    | Время до возврата WebSocket session             |
| `defjs.client.websocket.connection.duration` | Возврат session → терминальный close            |
| `defjs.client.websocket.active_connections`  | Логические WebSocket session с висящим `closed` |

Активные инструменты SSE/WebSocket считают логические ресурсы (включая щели reconnect), не физические сокеты и не отдельные HTTP-попытки.

HTTP span пишут method, резолвнутый `url.full`, адрес/порт сервера когда есть, и status ответа когда получен. `url.full` по умолчанию резолвит `request.endpoint` относительно необязательного `request.baseEndpoint`; отдельный `request.queryString` он не дописывает. Это граница сборки, не санитизация. Используй `startSpanHook`, чтобы собрать полный или отредактированный URL, которым владеет приложение, когда нужно. Status `400+` → status span `ERROR` со строкой status как `error.type`. Status `100..399` оставляет status span незаданным. Исход транспорта со status ноль не имеет status ответа; cancel оставляет status незаданным; timeout и прочие сбои транспорта используют `NET_TIMEOUT` или `NET_UNREACHABLE`. Metrics используют стабильные измерения: method, статический operation, адрес/порт сервера, status ответа, тип ошибки низкой кардинальности.

Метрики соединения SSE/WebSocket пишут время connect, длительность логического соединения, число активных ресурсов, `defjs.result`, operation, адрес/порт сервера и типы провала низкой кардинальности. По умолчанию нет тел запроса/ответа, payload сообщений, длин очередей или span на сообщение.

Считай `url.full` и `recordException(...)` потенциально чувствительными. Defjs их за тебя не редактирует. Держи имена операций и атрибуты hook в allowlist; редактируй в `startSpanHook` или в процессорах/exporter’ах SDK. Не копируй сырые URL, query-строки, заголовки, baggage или payload в свою телеметрию, не проверив приватность, кардинальность, retention и redaction.

Query propagation WebSocket может раскрыть trace context и baggage браузерам, прокси, access logs и телеметрии. Это не канал credentials. `withCredentials(true)` — Fetch credentials для HTTP/SSE, не auth WebSocket.

Адаптер не init/shutdown’ит SDK и не dispose’ит core client или handle транспорта. Телеметрию flush’ишь ты, и ты закрываешь работу HTTP/SSE/WebSocket. См. [Interceptors](../core/interceptors.md), [SSE](../core/sse.md) и [WebSocket](../core/web-socket.md).

## Связанные рецепты

- [Тест с локальным Fetch handle](../recipes/test-with-handle.md)
- [Читать SSE-стрим](../recipes/consume-sse.md)
- [Открыть WebSocket-сессию](../recipes/websocket-session.md)
