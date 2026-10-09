---
title: Defjs
description: 带类型的 HTTP、SSE、WebSocket 命令：显式 Client，错误优先的结果。
---

# Defjs

先定义端点，再打出 opaque command，最后 `execute`。HTTP、SSE、WebSocket 都是同一套路。

```ts get-health.ts
import { createClient, defineRequest, struct, withEndpoint } from '@defjs/core'

const client = createClient(withEndpoint('https://api.example.com'))
const getHealth = defineRequest({
  method: 'GET',
  path: '/health',
  output: struct.object({ ok: struct.boolean() }),
})

const [error, result, response] = await client.execute(getHealth())
if (!error) console.log(result.ok, response.status)
```

Defjs 不会帮你缓存结果、自动重试，也不会在你忘了关流时替你收尾。取消和清理都归你管。

## 选传输

| 你要做的事              | 从这里看                          | 成功时拿到什么                            |
| ----------------------- | --------------------------------- | ----------------------------------------- |
| 请求 + 按状态区分的响应 | [HTTP](./core/http.md)            | 解码后的数据 + `HttpResponse`             |
| 长连接的服务端事件流    | [SSE](./core/sse.md)              | 一条 stream + 启动时的 `open` 快照        |
| 双向会话                | [WebSocket](./core/web-socket.md) | 一个 session + 启动时的 `connection` 快照 |

刚上手？先走一遍[快速开始](./guide/getting-started.md)，再抄一道[配方](./recipes/get-declared-404.md)。想知道「为什么这样设计」？跑通之后再看[设计决策](./guide/design-decisions.md)。

## 选包

| 包                            | 什么时候用                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------- |
| `@defjs/core`                 | `createClient`（HTTP + SSE + WebSocket）                                         |
| `@defjs/react`                | `ClientProvider` / `useClient` — 见 [React](./plugins/react.md)                  |
| `@defjs/vue`                  | Plugin + `injectClient` — 见 [Vue](./plugins/vue.md)                             |
| `@defjs/opentelemetry-server` | 出站 span/metrics — 见 [OpenTelemetry Server](./plugins/opentelemetry-server.md) |

## 结果长什么样

三种传输都返回错误优先的三项 tuple。位置对齐，含义不一样：

- HTTP → `[error, data, response]`
- SSE → `[error, stream, open]`
- WebSocket → `[error, session, connection]`

启动失败时第二项是 `undefined`。第三项只有传输先产出了响应或快照才会有。细节见[错误](./core/errors.md)。

## 所有权一句话

HTTP 过期了就 abort。SSE 要 `close` 再 `await stream.closed`。WebSocket 要 `close` 再 `await session.closed`。服务端如果 options 会抓住 cookie、鉴权或租户，把 Client 建在请求边界里。打日志前先把 URL、headers、body 脱敏。

## 相关配方

- [声明了 404 的 GET](./recipes/get-declared-404.md)
- [POST JSON](./recipes/post-json.md)
- [取消一次 HTTP](./recipes/cancel-http.md)
- [消费 SSE 流](./recipes/consume-sse.md)
- [打开 WebSocket 会话](./recipes/websocket-session.md)
- [用本地 Fetch handle 做测试](./recipes/test-with-handle.md)
