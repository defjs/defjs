---
title: '快速开始：一次 HTTP 请求'
description: 定义 GET /users/:id，对着本地 Fetch handle 跑一遍，再换成真实 API。
---

# 快速开始：一次 HTTP 请求

你会定义 `GET /users/:id`，用显式 Client 去 `execute`，并把 `200` 和声明过的 `404` 都解出来。本地 handler 保证第一次能离线跑；换成真实服务时，command 不用改。

## Step 1 — 安装

`@defjs/core` 是 ESM，要 Node.js 22+、Bun 或 Deno。Node 直接跑 `.ts`，package.json 里写上 `"type": "module"`。浏览器里照样需要 bundler 和 Fetch。

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

## Step 2 — 定义请求

建 `src/get-user.ts`。Input struct 是调用方的值。`builder` 把这个值放到请求上。这里整个 input 就是 path 对象，所以没有 alias 的标量字段会填上 `:id`。

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

`output` 是 2xx body。`error` 是其余每个状态。各一个 struct。这些 body 形状不同时，用 `struct.or(...)` 或判别联合。

`defineRequest(...)` 返回 endpoint。调用 `getUser(...)` 打出 opaque command，再交给 `client.execute(...)`。上面的 `builder` 是摆放 input 的函数，它不是 endpoint。

## Step 3 — 本地执行

接一个 Client 本地 Fetch handle，不用联网也能跑。Defjs 照样会校验输入、拼 `Request`、按状态分派、解析 body。

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

跑起来：

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

试试找不到的用户——把 path id 改成 `8` 再跑：

```txt
User not found
```

成功时：`error` 是 `null`，`user` 是 `200` Struct 输出，`response` 是 `HttpResponse`。声明过的 `404`：`error.code` 是 `'HTTP_STATUS'`，`error.status` 是 `404`，`error.data` 类型是 `NotFound`。失败时第二项是 `undefined`。

## Step 4 — 指向真实 API

服务实现了 `GET /v1/users/:id` 且 body 对得上时，去掉 `withHTTPHandle(...)`，换成真实 base URL。

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

同一个 command，换不同 Client。

## 结果对不上时

- 坏输入 → `REQ_INPUT_INVALID`；冲突的取消 options → `REQ_OPTIONS_INVALID`；`build` 失败 → `REQ_BUILD_FAILED`
- 任何非 2xx → `HTTP_STATUS`；声明过 `error` 时 `err.data` 带类型
- 媒体类型不对 → `RES_MEDIA_TYPE_INVALID`，在读 body 之前就报
- 声明过的 body 解不出来 → `RES_DECODE_FAILED` 或 `RES_STRUCT_MISMATCH`
- Fetch 失败 / 取消 / 超时 → `NET_UNREACHABLE` / `NET_ABORTED` / `NET_TIMEOUT`

`timeout` 必须是 `1..2_147_483_647` 的正 safe integer。合法取消形状：`{ timeout }`、`{ abort }`，或 `{ signal, timeout }` / `{ signal, abort }`。`{ abort, timeout }` 一起传是非法的。取消只说明调用方看到了什么——不代表服务端写入已经提交。

## 接下来的配方

- [声明了 404 的 GET](../recipes/get-declared-404.md)
- [POST JSON](../recipes/post-json.md)
- [取消一次 HTTP](../recipes/cancel-http.md)
- [消费 SSE 流](../recipes/consume-sse.md)
- [打开 WebSocket 会话](../recipes/websocket-session.md)
- [用本地 Fetch handle 做测试](../recipes/test-with-handle.md)
