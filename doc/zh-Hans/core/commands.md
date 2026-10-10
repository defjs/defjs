---
title: Commands
description: 定义端点，打出 opaque command，映射输入，推断传输结果。
---

# Commands

一份 definition → endpoint → opaque command → `client.execute`。HTTP、SSE、WebSocket 同一条管线。

## 基本用法

```typescript twoslash
import { createClient, defineRequest, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const health = defineRequest({ method: 'GET', path: '/health' })
const [error, data, response] = await client.execute(health())
if (!error) console.log(data, response.status)
```

## 选哪种 definition

| Definition               | 契约                                                       | 成功值                               |
| ------------------------ | ---------------------------------------------------------- | ------------------------------------ |
| `defineRequest(...)`     | Method、相对 path、可选 input、可选 `output` / `error`     | 解码数据 + 响应                      |
| `defineEventStream(...)` | Path、buffer/queue 上限、事件名 → Struct 映射              | `EventStreamHandle` + open 快照      |
| `defineWebSocket(...)`   | Path、一个 incoming struct、可选 outgoing struct、队列上限 | `WebSocketSession` + connection 快照 |

没有 `input` → endpoint 不收参，`builder` 可以是 `() => request`。有 `input` → 传 struct 值。可选字段可以省；必填字段不能省。

保持 command 不透明。别去扒标签或 symbol。

## 值放哪

Struct 决定值怎么编码。`builder` 决定它放哪。`builder` 是**已 parse** input 的同步纯函数。它在 execute 时跑。抛错会变成 tuple 上的 `REQ_BUILD_FAILED`——调用 endpoint 本身不抛。

只要声明了 `input`，就必须显式提供 `builder`，即使输入已经是请求形状也一样。只有没有 `input` 的定义可以省略 `builder`。

把带类型的值交过去。Alias、`Date` → ISO、`bigint` → string 会作用在这个 struct 用到的每一处：请求摆放、响应解码、SSE 事件、WebSocket frame。

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

Body 是 JSON `{"display_name":"…","email":"…"}`。手写的 key 是逃生口：`body: { name: input.user.displayName }` 发出去的是 `name`，因为外层对象是匿名的，alias 不生效。

## 形状对不上时

path 占位符、字面量、分支，用 `builder`。它收到的是真值，所以 `if`、`??`、模板字符串、`switch` 都能用。

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

`query: input.query` 发出 `page_size`。`headers: { 'x-api-version': '2' }` 是字面量。鉴权和追踪仍归 interceptor：builder 跑完之后，它们看到的是原生请求。

## `output` 和 `error` 的形状

`output` 是 2xx body 的单一 Struct；`error` 是其余一切的单一 Struct。`ok` 是唯一分流点，且只有一边会解码。省略一边意味着那个 body 根本不会被读：fault 带着状态，`data` 保持 `undefined`。

## 相关配方

- [声明了 404 的 GET](../recipes/get-declared-404.md)
- [POST JSON](../recipes/post-json.md)
