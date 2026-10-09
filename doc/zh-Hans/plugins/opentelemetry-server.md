---
title: OpenTelemetry server
description: 用你自己的 Tracer 和可选 Meter，打开出站 Defjs 传输埋点。
---

# OpenTelemetry server

创建 Client 时打开出站埋点。`@defjs/opentelemetry-server` 追加 HTTP、SSE、WebSocket interceptor。它**不是**入站服务端埋点，也**不会**初始化 OpenTelemetry SDK。

## 基本用法

SDK 在别处初始化。把 API 对象传进来：

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

`tracer` 必填。`meter` 可选——不传就关掉包指标。没有 `propagator` → adapter 建一个组合的 W3C Trace Context + W3C Baggage propagator。它不会替你读或初始化全局 SDK 配置。

`withOpenTelemetryServer(options)` 返回 core `ClientOption`。在 `createClient` 时应用，这样每个启用的传输追加一个 interceptor。HTTP、SSE、WebSocket 默认开启；`{ enabled: false }` 关掉一种传输。

Adapter 即使在传输层请求失败时也能创建传输 telemetry。导出与否取决于你的 SDK 和 exporters。

## 范围

SDK 初始化、providers、exporters、processors、context、采样、脱敏、flush、shutdown 归你。这个包消费你传入的 `Tracer`、可选 `Meter`、可选 `TextMapPropagator`。它不提供内建 redactor 或敏感 key 政策。

没有缓存、重试、消息级 span，也没有应用 command 结果政策。面向服务端 Node.js。发布包要 Node.js 22+，peers `@defjs/core`、`@opentelemetry/api` 1.x、`@opentelemetry/core` 2.x。

公开 API：`withOpenTelemetryServer`，以及 `OpenTelemetryServerOptions`、`OpenTelemetryServerHttpOptions`、`OpenTelemetryServerSSEOptions`、`OpenTelemetryServerWebSocketOptions`。

## Options 与 hooks

Hooks 挨着它们改动的传输。同步 `startSpanHook(request)` 在创建 span 前运行并返回初始 `Attributes`；应用属性最后应用，因此可以覆盖内建值。`requestHook` 与 `responseHook` 接收已经创建的 span，可返回 `void` 或 promise。Hook 失败会记录 `defjs.otel.hook.error`，**不会**停掉 Client 操作；start hook 失败时退回内建初始属性。

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

Hook 签名：

- 三种传输：`startSpanHook(request): Attributes`（同步，在创建 span 前）
- HTTP：`requestHook(span, request)` 和 `responseHook(span, response, request)`
- SSE：`requestHook(span, request)` 和 `responseHook(span, stream, request)`
- WebSocket：`requestHook(span, request)` 和 `responseHook(span, session, request)`

空的传输对象会启用该传输。旧的布尔传输开关和旧的顶层 hooks 会被拒绝——用传输 option 对象和传输作用域 hooks。

## 操作身份与传播

Command 有稳定身份时，在 `defineRequest`、`defineEventStream` 或 `defineWebSocket` 上设静态 `operation`。Adapter 把它用在 span 名和 `defjs.operation`。从不从解析后的 path、标识符、租户或 query 推导身份：

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

Span 名变成 `GET orders.read`、`SSE orders.watch`、`WebSocket orders.connect`。没有 `operation` 时回退是 method / `SSE` / `WebSocket`，并省略 `defjs.operation`。

HTTP 和 SSE 把传播字段注入请求 headers。已有 `Headers` 实例会复用并改；否则新建 `Headers`。WebSocket query 传播是**可选开启**的（浏览器不能加任意握手 headers）：

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

开了 `queryPropagation`，propagator 字段会追加到连接 query。先审 URL 日志、代理可见性、访问日志、baggage、保留。`requireParentSpan: true` 在没有活动 parent 时跳过 span 创建、传播、hooks、metrics，然后原样调 `next`。

## HTTP、SSE、WebSocket 语义

Adapter 量的是传输寿命，不是 command 解释的每一阶段。

- **HTTP** — span 在 HTTP interceptor 里开始，拿到 Defjs `HttpResponse` 就结束。媒体类型检查、表示读取和 Struct 解码都在之后，所以后续的 `RES_*` fault 改不了已结束的传输 span。又因为 span 活在链内，传输层的 reject 会按 OTel 惯例记成异常类，而不是执行阶段随后判定的 fault code。
- **SSE** — span 开到 `stream.closed` settle。记 `sse.connected`，再记 `sse.closed` / `sse.aborted` / `sse.error`。一条逻辑流（含重连）→ 一个 span。没有按事件的 span。
- **WebSocket** — span 开到 `session.closed` settle。事件：`websocket.connected`、`websocket.closed`、`websocket.error`。重连的物理 socket 仍属逻辑会话。没有按消息的 span。

要最终 command 结果而不只是传输？用应用 span 包住 `client.execute(...)`：

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

外层 span 是你的。插件仍报告更底层的传输 span——两件不同的事。

## 参考

传了 `meter` 时：

| Metric                                       | 含义                                            |
| -------------------------------------------- | ----------------------------------------------- |
| `http.client.request.duration`               | HTTP 请求耗时（秒）                             |
| `defjs.client.sse.connect.duration`          | 到 SSE handle 返回为止                          |
| `defjs.client.sse.connection.duration`       | Handle 返回 → 终端关闭                          |
| `defjs.client.sse.active_streams`            | 仍有待 settle `closed` 的逻辑 SSE handle        |
| `defjs.client.websocket.connect.duration`    | 到 WebSocket session 返回为止                   |
| `defjs.client.websocket.connection.duration` | Session 返回 → 终端关闭                         |
| `defjs.client.websocket.active_connections`  | 仍有待 settle `closed` 的逻辑 WebSocket session |

活跃 SSE/WebSocket 仪器计的是逻辑资源（含重连空隙），不是物理 socket 或单次 HTTP 尝试。

HTTP span 记 method、解析后的 `url.full`、可用时的 server address/port，以及收到时的响应状态。默认 `url.full` 把 `request.endpoint` 相对可选 `request.baseEndpoint` 解析，不会追加独立的 `request.queryString`。这是构造边界，不是脱敏。需要完整或脱敏后的应用自有 URL 时，请用 `startSpanHook` 构造。状态 `400+` → span status `ERROR`，状态字符串作 `error.type`。状态 `100..399` 不设 span status。状态零的传输结果没有响应状态；取消不设 status；超时/其他传输失败用 `NET_TIMEOUT` 或 `NET_UNREACHABLE`。Metrics 用稳定维度：method、静态 operation、server address/port、响应状态、低基数错误类型。

SSE/WebSocket 连接 metrics 记连接时间、逻辑连接时长、活跃资源数、`defjs.result`、operation、server address/port、低基数失败类型。默认没有请求/响应 body、消息 payload、队列长度或按消息 span。

把 `url.full` 和 `recordException(...)` 当可能敏感。Defjs 不会替你脱敏。操作名和 hook 属性保持白名单；在 `startSpanHook` 或 SDK processors/exporters 里脱敏。没审隐私、基数、保留、脱敏前，别把原始 URL、query、headers、baggage、payload 拷进自定义 telemetry。

WebSocket query 传播可能把 trace context 和 baggage 暴露给浏览器、代理、访问日志、telemetry。它不是凭证通道。`withCredentials(true)` 是 HTTP/SSE 的 Fetch credentials——不是 WebSocket 鉴权。

Adapter 不 init/shut down SDK，也不释放 core Client 或传输 handle。你 flush telemetry，并关掉 HTTP/SSE/WebSocket 工作。见 [Interceptors](../core/interceptors.md)、[SSE](../core/sse.md)、[WebSocket](../core/web-socket.md)。

## 相关配方

- [用本地 Fetch handle 做测试](../recipes/test-with-handle.md)
- [消费 SSE 流](../recipes/consume-sse.md)
- [打开 WebSocket 会话](../recipes/websocket-session.md)
