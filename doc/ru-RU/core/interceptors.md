---
title: Interceptors
description: Сложи политику HTTP, SSE и WebSocket на границе транспорта в порядке луковицы.
---

# Interceptors

Добавь auth-заголовки, short-circuit окна обслуживания или ретрай безопасных чтений — не трогая валидацию команды. У каждого транспорта своя цепочка. На входе `HttpRequest`; возвращаешь результат этого транспорта (`HttpResponse`, handle event-stream или сессию WebSocket). Валидация input бежит до цепочки; диспатч по status и декодированные результаты — после.

## Базовая настройка

```typescript twoslash
import { createClient, createHttpInterceptor, withEndpoint, withInterceptors } from '@defjs/core'

const audit = createHttpInterceptor(async (request, next) => {
  const started = performance.now()
  const response = await next(request)
  console.info(request.operation ?? request.method, response.status, Math.round(performance.now() - started))
  return response
})

const client = createClient(withEndpoint('https://api.example.com'), withInterceptors(audit))
void client
```

## Порядок луковицы

`withInterceptors(...items)` принимает смешанные interceptors. Клиент фильтрует по `kind` выбранного транспорта и сохраняет относительный порядок регистрации. Каждый interceptor может бежать до и после `next`:

| Фабрика                      | Запрос        | Результат `next`                      |
| ---------------------------- | ------------- | ------------------------------------- |
| `createHttpInterceptor`      | `HttpRequest` | `Promise<HttpResponse<unknown>>`      |
| `createSSEInterceptor`       | `HttpRequest` | `Promise<EventStreamHandle<unknown>>` |
| `createWebSocketInterceptor` | `HttpRequest` | `Promise<WebSocketSessionLike>`       |

```typescript twoslash
import { createHttpInterceptor } from '@defjs/core'

const order: string[] = []
const first = createHttpInterceptor(async (request, next) => {
  order.push('first:before')
  const response = await next(request)
  order.push('first:after')
  return response
})

const second = createHttpInterceptor(async (request, next) => {
  order.push('second:before')
  const response = await next(request)
  order.push('second:after')
  return response
})

// Request: first:before → second:before → transport
// Return: second:after → first:after
void [first, second, order]
```

Несколько вызовов `withInterceptors(...)` дописывают. Клади широкое наблюдение снаружи более узкой мутации/ретрая, когда внешний слой должен увидеть итоговый результат.

## Клонируй и добавь request headers

Считай входящий `HttpRequest` принадлежащим цепочке. Клонируй `Headers`, прежде чем менять; в `next` передай новый request:

```typescript twoslash
import { createHttpInterceptor } from '@defjs/core'

function readAccessToken(): string | undefined {
  return undefined
}

const bearer = createHttpInterceptor((request, next) => {
  const token = readAccessToken()
  if (!token) return next(request)

  const headers = new Headers(request.headers)
  headers.set('Authorization', `Bearer ${token}`)
  return next({ ...request, headers })
})
```

Тот же паттерн для SSE. Браузерный WebSocket не может добавить произвольные handshake-заголовки — смена `request.headers` браузерный сокет не аутентифицирует. Используй protocol, политику URL/query или handshake, который поддерживает сервер.

Когда заменяешь HTTP body, замени `body` на скопированном request. Fetch игнорирует протухшие метаданные content-type, когда значение тела изменилось. Не переиспользуй уже потреблённое тело `ReadableStream`.

## Short-circuit запроса

`next` можно пропустить, но вернуть надо ожидаемый тип результата. Для HTTP `makeResponse(...)` собирает совместимую обёртку:

```typescript twoslash
import { createHttpInterceptor, makeResponse } from '@defjs/core'

function isMaintenanceWindow(): boolean {
  return false
}

const maintenanceGate = createHttpInterceptor(async (_request, next) => {
  if (isMaintenanceWindow()) {
    return makeResponse({
      status: 503,
      statusText: 'Service Unavailable',
      headers: new Headers({ 'content-type': 'application/json' }),
      body: { message: 'Temporarily unavailable' },
    })
  }

  return next(_request)
})
```

Слой команды всё равно диспатчит по status. Объяви один struct `error` для стороны не-2xx, когда вызывающим нужен типизированный `error.data`. Short-circuit SSE или WebSocket нуждается в полном совместимом handle/session (promise закрытия, живой state, владение и `[Symbol.asyncDispose]`). Частичные объекты — не валидная политика. Структурные реализации `EventStreamHandle` и `WebSocketSessionLike` теперь нуждаются в этом стандартном disposer на этапе компиляции; потребители, которые только получают handle Defjs, нового runtime-вызова не требуют.

## Ретрай безопасных reads

Ретраи меняют поведение. Держи политику узкой — этот пример ретраит воспроизводимые `GET` / `HEAD` / `OPTIONS` для статусов `0`, `429`, `502`, `503`, `504`, ограничивает `Retry-After` 30 с и останавливается после двух ретраев или на abort:

```typescript twoslash
import { createHttpInterceptor, type HttpRequest, type HttpResponse } from '@defjs/core'

const retryableMethods = new Set(['GET', 'HEAD', 'OPTIONS'])
const retryableStatuses = new Set([0, 429, 502, 503, 504])

function isReplayable(request: HttpRequest): boolean {
  return typeof ReadableStream === 'undefined' || !(request.body instanceof ReadableStream)
}

function retryAfterMs(response: HttpResponse<unknown>): number {
  const value = response.headers.get('retry-after')
  if (!value) return 250

  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 30_000)

  const date = Date.parse(value)
  return Number.isNaN(date) ? 250 : Math.min(Math.max(0, date - Date.now()), 30_000)
}

function waitForRetryAfter(response: HttpResponse<unknown>, signal?: AbortSignal): Promise<void> {
  const delay = retryAfterMs(response)
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }

    const timer = setTimeout(done, delay)
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(signal?.reason)
    }

    function done() {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }

    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
  })
}

const retrySafeReads = createHttpInterceptor(async (request, next) => {
  if (!retryableMethods.has(request.method.toUpperCase()) || !isReplayable(request)) return next(request)

  for (let attempt = 0; ; attempt += 1) {
    const response = await next(request)
    if (!retryableStatuses.has(response.status) || attempt >= 2) return response
    await waitForRetryAfter(response, request.abort)
  }
})
```

Брошенные ошибки interceptor/Fetch этот цикл не ретраит — провал транспорта reject’ит, а не производит status, по которому цикл мог бы совпасть. Ретрай `POST` / `PUT` / `PATCH` / `DELETE` нуждается в воспроизводимых байтах, поддержке сервера, контракте идемпотентности и проверенной политике status. Ретрай на тебе — Core не экспортирует `retryAfter()`.

Interceptor, который бросает (или reject’ит) вне этого примера, возвращается вызывающему как `EXT_INTERCEPTOR_FAILED`, с брошенным значением на `cause` — см. [Ошибки](./errors.md). Бросить `ERR_ABORTED` или `ERR_TIMEOUT` — это способ, которым interceptor выражает отмену.

`next(request)` может reject’нуть. Провал транспорта — это fault, не response со status 0, так что interceptor, который хочет его наблюдать, берёт `try` / `catch` вокруг `next`. Defjs всё равно атрибутирует верно: rejection, пришедший от транспорта, остаётся fault `NET_*`, а не вешается на твой interceptor.

## Оберни WebSocket-сессии

WebSocket interceptor может позвать `next` не больше одного раза. Если оборачиваешь сессию, делегируй живые геттеры и члены lifecycle явно:

```typescript twoslash
import { createWebSocketInterceptor } from '@defjs/core'

const preserveSession = createWebSocketInterceptor(async (request, next) => {
  const session = await next(request)

  return {
    get bufferedAmount() {
      return session.bufferedAmount
    },
    get connection() {
      return session.connection
    },
    get state() {
      return session.state
    },
    closed: session.closed,
    receive: session.receive,
    close(code?: number, reason?: string) {
      session.close(code, reason)
    },
    [Symbol.asyncDispose]() {
      return session[Symbol.asyncDispose]()
    },
    onRuntimeError(listener) {
      return session.onRuntimeError(listener)
    },
    onStateChange(listener) {
      return session.onStateChange(listener)
    },
    send(message: unknown) {
      session.send(message)
    },
  }
})
```

Spread сессии снимает `state` / `connection` / `bufferedAmount` один раз. Сохраняй `closed`, `receive`, `close`, точную делегацию `[Symbol.asyncDispose]()` и cleanup listener’ов, если ты нарочно не меняешь владение. Обёртка должна вернуть promise teardown внутренней сессии, а не посторонний resolved promise. Если цепочка создала сессию, которую не отдали, Core её оседает и закрывает; если успешный interceptor вернул другую сессию, Core выбрасывает созданную.

## Справка

Фабрики возвращают тегированные значения транспорта:

- `createHttpInterceptor(fn)` → `{ fn }`
- `createSSEInterceptor(fn)` → `{ kind: 'sse', fn }`
- `createWebSocketInterceptor(fn)` → `{ kind: 'web-socket', fn }`
- `basicAuthHttpInterceptor(provider, options?)` — Basic credentials на HTTP
- `basicAuthSSEInterceptor(provider, options?)` — Basic credentials на SSE

`HttpRequest` может включать `endpoint`, `baseEndpoint`, `method`, `headers`, `body`, `queryParams`, `queryString`, `abort`, `timeout` и статический `operation`. Это значение интеграции транспорта, не распарсенный input вызывающего. `queryParams` — это `new URLSearchParams(queryString)` после сериализации. Настроенный query serializer не зовут, когда builder не произвёл query, а builder’овский `URLSearchParams` берётся как есть. Валидацию команды, валидацию output и маппинг доменных ошибок держи в своих слоях.

Observers SSE/WebSocket — хуки lifecycle, не control flow. Отписывай listener’ы WebSocket, когда владелец заканчивает. Провалы observer следуют контракту транспорта; сам interceptor может бросить или reject’нуть.

Логируй проверенный allowlist: статический `operation`, method, status, длительность, стабильный код ошибки. По умолчанию не логируй резолвнутые URL, query-строки, auth-заголовки, тела, сырые cause, SSE event ID или payload WebSocket.

Basic credentials — это base64, не шифрование. Используй TLS, на сервере держи провайдеры credentials в scope запроса, никогда не логируй сгенерированный заголовок. Encoder по умолчанию — `globalThis.btoa`; передай `BasicAuthInterceptorOptions.encode`, когда у рантайма нет `btoa` или нужен проверенный encoder.

Interceptor может проводить политику транспорта. Это не валидация input, не авторизация и не владение ресурсом. Код, который стартует долгоживущую работу, всё ещё использует `await using` или вручную закрывает и ждёт терминальный promise. Обычный HTTP остаётся в scope запроса и управляется его timeout / `AbortSignal`; `Client` не `AsyncDisposable`.

## Связанные рецепты

- [Обнови Bearer-токен один раз на 401](../recipes/refresh-bearer-once.md)
- [Опубликуй HTTP SDK, не пряча execute](../recipes/publish-http-sdk.md)
- [Тест с локальным Fetch handle](../recipes/test-with-handle.md)
- [Отменить HTTP-вызов](../recipes/cancel-http.md)
