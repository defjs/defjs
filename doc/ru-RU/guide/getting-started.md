---
title: 'Начало работы: один HTTP-запрос'
description: Опиши GET /users/:id, прогони через локальный Fetch handle, потом укажи на реальный API.
---

# Начало работы: один HTTP-запрос

Ты опишешь `GET /users/:id`, выполнишь через явный клиент и декодируешь и `200`, и объявленный `404`. Локальный handler держит первый прогон офлайн; команда не меняется, когда подставишь настоящий сервис.

## Шаг 1 — Установка

`@defjs/core` — ESM и хочет Node.js 22+, Bun или Deno. Node запускает `.ts` напрямую — в package.json нужен `"type": "module"`. В браузере по-прежнему нужны бандлер и Fetch.

::: tabs
== bun

```sh
bun add @defjs/core
```

== npm

```sh
npm install @defjs/core
```

== pnpm

```sh
pnpm add @defjs/core
```

== yarn

```sh
yarn add @defjs/core
```

== deno

```sh
deno add npm:@defjs/core
```

:::

## Шаг 2 — Опиши запрос

Создай `src/get-user.ts`. Input struct — значение вызывающего. `builder` кладёт это значение на запрос. Здесь весь input — объект path, так что скалярные поля без алиаса заполняют `:id`.

```ts get-user.ts
import { defineRequest, struct } from '@defjs/core'

const User = struct.object({
  id: struct.number(),
  name: struct.string(),
})

const NotFound = struct.object({
  message: struct.string(),
})

const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: User,
  error: NotFound,
})

const command = getUser({ id: 7 })
void command
```

`output` — тело 2xx. `error` — любой другой status. По одному struct. Когда эти тела различаются, используй `struct.or(...)` или размеченное объединение.

`defineRequest(...)` возвращает эндпоинт. Вызов `getUser(...)` собирает непрозрачную команду, которую отдашь в `client.execute(...)`. `builder` выше — функция, которая раскладывает input; это не эндпоинт.

## Шаг 3 — Выполни локально

Подключи Fetch handle локально для клиента, чтобы прогнать без сети. Defjs всё равно валидирует input, собирает `Request`, диспатчит по status и парсит тело.

```ts get-user.ts
import { createClient, defineRequest, struct, withEndpoint, withHTTPHandle } from '@defjs/core'

const User = struct.object({
  id: struct.number(),
  name: struct.string(),
})

const NotFound = struct.object({
  message: struct.string(),
})

const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: User,
  error: NotFound,
})

const handle: typeof fetch = async (input, init) => {
  const request = new Request(input, init)
  const id = new URL(request.url).pathname.split('/').at(-1)

  if (id === '7') {
    return Response.json({ id: 7, name: 'Ada' }, { status: 200 })
  }

  return Response.json({ message: 'User not found' }, { status: 404 })
}

const client = createClient(withEndpoint('https://api.example.test'), withHTTPHandle(handle))

const [error, user, response] = await client.execute(getUser({ id: 7 }), {
  timeout: 5_000,
})

if (error) {
  if (error.code === 'HTTP_STATUS' && error.status === 404) {
    console.log(error.data.message)
  } else {
    console.error(error.code)
  }
} else {
  console.log(`Loaded ${user.name} from ${response.status}`)
}
```

Запусти:

::: tabs
== bun

```sh
bun src/get-user.ts
```

== npm

```sh
node src/get-user.ts
```

== pnpm

```sh
node src/get-user.ts
```

== yarn

```sh
node src/get-user.ts
```

== deno

```sh
deno run src/get-user.ts
```

:::

```txt
Loaded Ada from 200
```

Попробуй отсутствующего пользователя — смени path id на `8` и запусти снова:

```txt
User not found
```

При успехе: `error` — `null`, `user` — output Struct для `200`, `response` — `HttpResponse`. При объявленном `404`: `error.code` — `'HTTP_STATUS'`, `error.status` — `404`, а `error.data` типизирован как `NotFound`. Второй элемент кортежа при провале — `undefined`.

## Шаг 4 — Укажи на реальный API

Убери `withHTTPHandle(...)` и поставь настоящий base URL, когда сервис реализует `GET /v1/users/:id` с этими телами.

```ts
import { createClient, withEndpoint, withHTTPHandle } from '@defjs/core'

const localHandle: typeof fetch = async (input, init) => {
  const request = new Request(input, init)
  const id = new URL(request.url).pathname.split('/').at(-1)

  if (id === '7') {
    return Response.json({ id: 7, name: 'Ada' }, { status: 200 })
  }

  return Response.json({ message: 'User not found' }, { status: 404 })
}

const localClient = createClient(withEndpoint('https://fixture.invalid'), withHTTPHandle(localHandle))
const realClient = createClient(withEndpoint('https://api.example.com/v1'))
void localClient
void realClient
```

Та же команда. Другой клиент.

## Когда результат другой

- Плохой input → `REQ_INPUT_INVALID`; конфликтующие опции отмены → `REQ_OPTIONS_INVALID`; упавший `build` → `REQ_BUILD_FAILED`
- Любой non-2xx → `HTTP_STATUS`, с типизированным `err.data`, если `error` был объявлен
- Неверный media type → `RES_MEDIA_TYPE_INVALID`, сообщается до чтения тела
- Объявленное тело, которое не декодируется → `RES_DECODE_FAILED` или `RES_STRUCT_MISMATCH`
- Сбой Fetch / отмена / timeout → `NET_UNREACHABLE` / `NET_ABORTED` / `NET_TIMEOUT`

`timeout` — положительное safe integer в `1..2_147_483_647`. Валидные формы отмены: `{ timeout }`, `{ abort }` или `{ signal, timeout }` / `{ signal, abort }`. `{ abort, timeout }` вместе невалидно. Отмена говорит, что увидел вызывающий, — не то, закоммитилась ли серверная запись.

## Дальше по рецептам

- [GET с объявленным 404](../recipes/get-declared-404.md)
- [POST JSON](../recipes/post-json.md)
- [Отменить HTTP-вызов](../recipes/cancel-http.md)
- [Читать SSE-стрим](../recipes/consume-sse.md)
- [Открыть WebSocket-сессию](../recipes/websocket-session.md)
- [Тест с локальным Fetch handle](../recipes/test-with-handle.md)
