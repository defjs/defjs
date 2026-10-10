---
title: Commands
description: Define endpoints，build opaque commands，map inputs，再 infer transport results。
---

# Commands

一個 definition → endpoint → opaque command → `client.execute`。HTTP、SSE、WebSocket 同一條 pipeline。

## Basic Setup

```typescript twoslash
import { createClient, defineRequest, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const health = defineRequest({ method: 'GET', path: '/health' })
const [error, data, response] = await client.execute(health())
if (!error) console.log(data, response.status)
```

## 揀 definition

| Definition               | Contract                                                      | Successful value                         |
| ------------------------ | ------------------------------------------------------------- | ---------------------------------------- |
| `defineRequest(...)`     | Method、relative path、可選 input、可選 `output` / `error`    | Decoded data + response                  |
| `defineEventStream(...)` | Path、buffer/queue limits、event-name → Struct map            | `EventStreamHandle` + open snapshot      |
| `defineWebSocket(...)`   | Path、一個 incoming struct、可選 outgoing struct、queue limit | `WebSocketSession` + connection snapshot |

冇 `input` → endpoint 唔收 argument，而 `builder` 可以係 `() => request`。有 `input` → 傳 struct value。Optional field 可以 omit；required field 唔可以。

Keep commands opaque。唔好挖 tags 或者 symbols。

## Values 去邊

Struct 決定一個 value 點 encode。`builder` 決定佢去邊。`builder` 係 **parsed** input 嘅 synchronous pure function。佢喺 execute 時先 run。Throw 會變成 tuple 上面嘅 `REQ_BUILD_FAILED`——call endpoint 本身唔會 throw。

只要聲明咗 `input`，就必須明確提供 `builder`，即使 input 已經係 request shape 都一樣。只有冇 `input` 嘅定義先可以省略 `builder`。

將 typed value 交過去。Alias、`Date` → ISO、`bigint` → string 之後會喺用到嗰個 struct 嘅每個地方生效：request placement、response decoding、SSE events 同 WebSocket frames。

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

Body 係 JSON `{"display_name":"…","email":"…"}`。手寫 key 係逃生口：`body: { name: input.user.displayName }` 會送 `name`，因為 parent object 係 anonymous，alias 唔會套用。

## 形狀唔同嘅時候

Path placeholders、literals 同 branches 用 `builder`。佢收到嘅係真實 value，所以 `if`、`??`、templates 同 `switch` 都用得。

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

`query: input.query` 會送 `page_size`。`headers: { 'x-api-version': '2' }` 係 literal。Auth 同 tracing 仍然屬於 interceptors：builder run 完之後，佢哋先見到 native request。

## `output` 同 `error` 嘅形狀

`output` 係 2xx body 嘅單一 Struct；`error` 係其餘一切嘅單一 Struct。`ok` 係唯一分流點，而且只有一邊會解碼。唔寫一邊就意味住嗰個 body 根本唔會被讀：fault 帶住 status，`data` 保持 `undefined`。

## Related recipes

- [GET with a declared 404](../recipes/get-declared-404.md)
- [POST JSON](../recipes/post-json.md)
