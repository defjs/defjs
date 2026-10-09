---
title: Команды
description: Опиши эндпоинты, собери непрозрачные команды, разложи input и выведи результаты транспорта.
---

# Команды

Одно определение → эндпоинт → непрозрачная команда → `client.execute`. Один pipeline для HTTP, SSE и WebSocket.

## Базовая настройка

```typescript twoslash
import { createClient, defineRequest, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const health = defineRequest({ method: 'GET', path: '/health' })
const [error, data, response] = await client.execute(health())
if (!error) console.log(data, response.status)
```

## Выбери определение

| Определение              | Контракт                                                                        | Успешное значение                      |
| ------------------------ | ------------------------------------------------------------------------------- | -------------------------------------- |
| `defineRequest(...)`     | Method, относительный path, опциональный input, опциональные `output` / `error` | Декодированные данные + response       |
| `defineEventStream(...)` | Path, лимиты buffer/queue, карта имя события → Struct                           | `EventStreamHandle` + снимок open      |
| `defineWebSocket(...)`   | Path, один incoming struct, опциональный outgoing struct, лимит очереди         | `WebSocketSession` + снимок connection |

Нет `input` → эндпоинт не принимает аргумент, а `builder` может быть `() => request`. С `input` → передай значение struct. Опциональное поле можно опустить; обязательное — нельзя.

Держи команды непрозрачными. Не копайся в tags или symbols.

## Куда ложатся значения

Struct решает, как значение кодируется. `builder` решает, куда оно ложится. `builder` — синхронная чистая функция от **распарсенного** input. Она бежит в момент execute. Throw становится `REQ_BUILD_FAILED` в кортеже — сам вызов эндпоинта не бросает.

Опусти `builder`, когда input struct уже `{ path?, query?, headers?, body? }`. Это identity `(input) => input`. Если распарсенный input не присваивается этой форме, TypeScript требует `builder`.

Проводи типизированное значение насквозь. Алиас, `Date` → ISO и `bigint` → string применяются везде, где используется этот struct: раскладка запроса, декодирование ответа, события SSE и кадры WebSocket.

```typescript twoslash
import { defineRequest, struct } from '@defjs/core'

const User = struct.object({
  displayName: struct.string().alias('display_name'),
  email: struct.string(),
})

const createUser = defineRequest({
  method: 'POST',
  path: '/users',
  input: struct.object({ user: User }),
  builder: (input) => ({ body: input.user }),
  output: struct.object({ id: struct.number(), displayName: struct.string().alias('display_name') }),
})
void createUser
```

Тело — JSON `{"display_name":"…","email":"…"}`. Ключ, написанный руками, — запасной выход: `body: { name: input.user.displayName }` шлёт `name`, потому что родительский объект анонимный и алиас не применяется.

## Когда формы расходятся

`builder` — для placeholder’ов path, литералов и веток. Он получает настоящее значение, так что работают `if`, `??`, шаблоны и `switch`.

```typescript twoslash
import { defineRequest, struct } from '@defjs/core'

const search = defineRequest({
  method: 'GET',
  path: '/orgs/:org_id/users',
  input: struct.object({
    orgId: struct.number(),
    query: struct.object({
      keyword: struct.string(),
      pageSize: struct.number().alias('page_size'),
    }),
  }),
  builder: (input) => ({
    path: { org_id: input.orgId },
    query: input.query,
    headers: { 'x-api-version': '2' },
  }),
  output: struct.object({ items: struct.array(struct.string()) }),
})
void search
```

`query: input.query` шлёт `page_size`. `headers: { 'x-api-version': '2' }` — литерал. Auth и tracing всё ещё живут в interceptors: они видят нативный request после того, как отработал builder.

## Формы `output` и `error`

`output` — один Struct для тела 2xx; `error` — один Struct для всего остального. `ok` — единственная развилка, и декодирует всегда одна сторона. Пропустить сторону значит, что это тело не прочитают: fault несёт status, а `data` остаётся `undefined`.

## Связанные рецепты

- [GET с объявленным 404](../recipes/get-declared-404.md)
- [POST JSON](../recipes/post-json.md)
