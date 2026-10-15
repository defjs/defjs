# Defjs 错误、OpenTelemetry 与异步释放实施计划

> **供执行代理使用：** 必须按任务使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`。使用复选框（`- [ ]`）逐项记录执行状态。

**目标：** 改善 `RequestError` 的日志表现，增加同步的 Span 创建前属性钩子，并让 SSE/WebSocket handle 支持显式异步资源管理，同时保持现有请求、`close()` 与 `closed` 语义不变。

**架构：** 保留 `client.execute()` 的统一错误 tuple 和现有 transport 状态机。错误工厂改用原生 `Error` cause；OpenTelemetry 在每个 transport 创建 Span 前调用独立的 `startSpanHook`；只有长生命周期的 SSE/WebSocket handle 暴露 `Symbol.asyncDispose`。释放逻辑复用现有关闭入口并缓存一个幂等 teardown Promise，不增加资源管理器、基类、默认脱敏策略或 HTTP Client disposer。

**技术栈：** TypeScript 7、Bun 1.4.0、Vitest 4、标准 `ErrorOptions`、标准 `AsyncDisposable`、OpenTelemetry API 1.x。

**设计契约：** `docs/superpowers/plans/2026-08-29-defjs-error-otel-disposal.md#已确认设计契约`

## 全局约束

- 保留所有无关改动和主人已有的工作区改动，只修改本计划列出的文件。
- 不改变 `client.execute()` 的错误分类或 tuple 形状。
- 不把 `StructError.format()`、`flatten()`、`prettify()` 复制到 `DefinitionError`；调用者先把 `error.cause` 窄化为 `StructError`，再使用这些方法。
- 不增加自定义错误类或自定义 `toString()`；日志字符串使用原生 `Error.prototype.toString`。
- 不内置 redactor、敏感参数清单或按 key/value 改写 URL。保留现有 `url.full` 数据边界：它只由 `endpoint`/`baseEndpoint` 解析，不自动拼接 `req.queryString`；应用可通过 `startSpanHook` 明确提供自己的完整或脱敏 URL。
- `startSpanHook` 必须同步执行，使采样器和同步 SpanProcessor 在 Span 创建时就能看到最终初始属性。
- 不给 HTTP Client 或普通 HTTP 结果增加 `AsyncDisposable`；HTTP 生命周期继续由请求完成、`AbortSignal` 和 timeout 管理。
- 不增加资源管理器、handle 基类、全局 Client disposer、`closeAndWait()`、公开关闭宽限配置、新依赖或新错误类。
- 不改变 `close()` 或 `closed` 的现有语义。`close()` 只请求逻辑关闭；`closed` 仍表示现有逻辑终态；只有 `[Symbol.asyncDispose]()` 等待 Defjs 自己拥有的 teardown。
- `[Symbol.asyncDispose]()` 本身不能同步抛错；第一次调用必须先缓存 Promise，再在 microtask 中执行关闭副作用，后续调用严格返回同一个 Promise。
- WebSocket 的 `finish()` 继续是 queue、listener、controller 与状态的唯一终态所有者；disposer 不重复终结这些资源。
- 不声称 WebSocket disposer 可以证明物理 TCP 已关闭。它只保证 best-effort native `close()` 之后，在有界时间内完成 Defjs 所有的清理。
- 手工编辑使用 `apply_patch`。不提交、不推送、不发布、不创建 PR。

## 已确认设计契约

### RequestError

1. 请求校验、transport、响应校验、未声明状态码和 interceptor 失败时，`client.execute()` 继续返回 `[RequestError, undefined]`。
2. `HttpStatusError`、`TransportError` 和 `DefinitionError` 继续采用结构化 `Error` interface/intersection，不增加公开类层级。
3. 工厂创建的错误具有稳定名称：`HttpStatusError`、`TransportError`、`DefinitionError`。
4. `kind`、`code`、`status`、`response` 和 `data` 继续是可枚举自有属性，供结构化日志使用。
5. 稳定错误名是不可枚举的自有属性；不能因为改善 `String(error)` 而给 JSON 增加 `name`。
6. `cause` 只通过 `new Error(message, { cause })` 设置，保持不可枚举，并供支持 cause chain 的 logger 使用。
7. `String(error)` 使用原生 `<name>: <message>`。Struct 的展示能力仍保留在窄化后的 `StructError` cause 上。

### OpenTelemetry

1. 每个 transport option 增加同一个可选同步钩子：

   ```ts
   startSpanHook?: (request: HttpRequest) => Attributes
   ```

2. Defjs 先生成内置属性，最后展开应用属性。因此应用可以在 Span 创建前覆盖 `url.full` 或其他初始属性。
3. HTTP 的 `server.address` 与 `server.port` 移入 `startSpan` 的初始属性，不再在 Span 创建后设置。
4. `requestHook` 和 `responseHook` 保持现有的 Span 创建后语义以及异步 fire-and-observe 行为。
5. `startSpanHook` 抛错不能阻断请求：Defjs 使用内置属性创建 Span，再通过现有 hook error event/exception 路径记录失败。
6. `startSpanHook` 分别配置在 `http`、`sse` 和 `webSocket` 下，不能跨 transport 泄漏。
7. 默认 `url.full` 继续只解析 `req.endpoint` 和可选 `req.baseEndpoint`：endpoint 字面量自带的 query 会保留，独立的 `req.queryString` 不会自动追加。这是既有字段构造边界，不是按敏感参数做脱敏。

这一区分借鉴 OpenTelemetry HTTP 与 Undici instrumentation：start-span hook 在 `startSpan` 前提供属性，request/response hook 操作已经创建的 Span。

- OpenTelemetry HTTP 参考：<https://github.com/open-telemetry/opentelemetry-js/blob/main/experimental/packages/opentelemetry-instrumentation-http/src/types.ts>
- OpenTelemetry Undici 参考：<https://github.com/open-telemetry/opentelemetry-js-contrib/blob/main/packages/instrumentation-undici/src/types.ts>

### AsyncDisposable

1. `EventStreamHandle<T>` 与 `WebSocketSession<TIncoming, TOutgoing>` 扩展 `AsyncDisposable`。
2. `WebSocketSessionLike` 同样要求 `[Symbol.asyncDispose](): PromiseLike<void>`，让 interceptor 和结构化测试替身遵守公开 session 契约。
3. 重复调用 disposer 时返回同一个缓存 Promise，并且只发起一次关闭请求。
4. SSE disposer 等待 `closed` 和现有 `start()` lifecycle task。它保证 Defjs 的读取/重连循环停止且 reader lock 已释放，但不会无界等待 provider 卡住的 `ReadableStream.cancel()` Promise。
5. WebSocket disposer 等待连接 lifecycle 和所有 Defjs message-pump task，停止 heartbeat、reconnect、close timer，移除监听器，终止队列并清空 current socket 引用。
6. 正常 WebSocket 释放等待 native `close` event。如果一秒内没有收到该 event，Defjs 强制完成逻辑清理，并以标准 `DOMException`（`name === 'TimeoutError'`）拒绝 disposer。
7. native `close()` 抛错时，Defjs 仍完成 fallback 清理并等待自有任务，最后以原始抛出值拒绝 disposer。原始 close 错误优先于之后的 timeout。

这遵循 Node HTTP/FileHandle 等实现的最小模式：disposer 复用现有关闭入口，并等待真实 teardown Promise；不会另建一套并行生命周期。

- Node HTTP `server[Symbol.asyncDispose]()`：<https://nodejs.org/api/http.html#serversymbolasyncdispose>
- Node FileHandle `filehandle[Symbol.asyncDispose]()`：<https://nodejs.org/api/fs.html#filehandlesymbolasyncdispose>

## 文件职责

| 关注点            | 生产文件                                                                                     | 主要测试                                                                               | 对外文档                                                        |
| ----------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 原生 RequestError | `packages/core/src/error/factory.ts`                                                         | `packages/core/src/error/factory.spec.ts`、`packages/core/src/http/http.error.spec.ts` | `doc/api/errors.md`、`doc/core/errors.md` 及全部启用 locale     |
| SSE 释放          | `packages/core/src/sse/transport/event_stream.ts`                                            | `event_stream.advanced.spec.ts`、`sse.spec.ts`、`sse.type.test.ts`                     | `doc/api/sse.md`、`doc/core/sse.md` 及全部启用 locale           |
| WebSocket 释放    | `packages/core/src/web_socket/web_socket.ts`、`packages/core/src/interceptor/interceptor.ts` | WebSocket server/real/type 测试                                                        | `doc/api/web-socket.md`、`doc/core/web-socket.md` 及全部 locale |
| Span 初始属性     | OpenTelemetry option、trace 和三个 interceptor                                               | option、trace 和三个 interceptor 测试                                                  | OpenTelemetry README、API/plugin 文档及全部启用 locale          |

---

### Task 0：建立执行基线

**文件：** 只读检查仓库状态、测试输出和类型诊断。

计划编写时基线（2026-08-29，仅供对照，执行时仍须重跑）：Core 与 OpenTelemetry package 的 `tsc --noEmit` 均为退出码 `0`；任务 6 的定向测试分别为 `370/370` 和 `116/116`。两组 Vitest 都输出已有的 Vite native config warning，但未影响退出码。

- [ ] 运行 `git status --short`，保存执行前已有的 tracked/untracked 路径；不 clean、stash 或 revert。
- [ ] 运行 `bun --version`，确认使用仓库固定的 Bun `1.4.0` 工具链。
- [ ] 在添加 RED 测试前分别运行 package 级 TypeScript 门禁，记录退出码和全部已有诊断：

  ```sh
  (cd packages/core && bunx tsc --project tsconfig.json --noEmit)
  (cd packages/opentelemetry-server && bunx tsc --project tsconfig.json --noEmit)
  ```

- [ ] 在添加 RED 测试前运行两个受影响 package 的完整测试：

  ```sh
  (cd packages/core && bun run test)
  (cd packages/opentelemetry-server && bun run test)
  ```

- [ ] 如果 dirty baseline 已经失败，保留精确失败清单。后续每个 RED 必须出现新增且与本特性直接相关的失败；每个 GREEN 只证明该新增失败消失，不能把无关基线失败宣称为已修复。

### Task 1：原生 RequestError 日志与 cause chain

**文件：**

- 修改：`packages/core/src/error/factory.ts`
- 修改：`packages/core/src/error/factory.spec.ts`
- 修改：`packages/core/src/http/http.error.spec.ts`

**接口：**

- 保持：`createTransportError(cause): TransportError`
- 保持：现有 `createDefinitionError(...)` overload 和返回类型
- 保持：`createHttpStatusError(...)`
- 新行为：原生 `String(error)` 输出稳定错误名
- 新行为：原生不可枚举 `cause`，Defjs metadata 保持可枚举

- [ ] 为每个错误族添加 RED factory 测试，断言准确的 `name`、`String(error)`、`instanceof Error`、property descriptor 和 JSON 行为：

  ```ts
  expect(error.name).toBe('DefinitionError')
  expect(String(error)).toBe(`DefinitionError: ${cause.message}`)
  expect(error.cause).toBe(cause)
  expect(Object.getOwnPropertyDescriptor(error, 'name')).toEqual({
    configurable: true,
    enumerable: false,
    value: 'DefinitionError',
    writable: true,
  })
  expect(Object.prototype.propertyIsEnumerable.call(error, 'cause')).toBe(false)
  expect(Object.prototype.propertyIsEnumerable.call(error, 'code')).toBe(true)
  expect(JSON.parse(JSON.stringify(error))).not.toHaveProperty('cause')
  expect(JSON.parse(JSON.stringify(error))).not.toHaveProperty('name')
  ```

- [ ] 覆盖 `ABORTED`、`TIMEOUT`、`NETWORK_ERROR`、全部 definition code 和 `HTTP_STATUS`；加入非 `Error` cause，锁定当前 message 转换规则。对包含全部可选 metadata 的样本，精确断言序列化顶层 key：Transport 为 `code/kind`，Definition 为 `code/kind/response`，undeclared status 为 `code/kind/response/status`，HTTP status 为 `code/data/kind/response/status`。
- [ ] 在现有 HTTP 响应校验测试中增加集成断言：tuple 第一项是 `DefinitionError`；`cause` 是同一个 `StructError`；窄化后的 cause 仍可调用 `format()`、`flatten()`、`prettify()`。
- [ ] 运行定向测试：

  ```sh
  (cd packages/core && bunx vitest run --config vitest.config.server.ts src/error/factory.spec.ts src/http/http.error.spec.ts)
  ```

  预期 RED：当前 factory error 使用默认 `Error` 名称，且 `cause` 可枚举。

- [ ] 把每个 `Object.assign(new Error(...), { cause, ...metadata })` 改成原生构造与直接 metadata 赋值。只有存在 cause 的错误使用 constructor option：

  ```ts
  const error = new Error(message, { cause }) as DefinitionError
  Object.defineProperty(error, 'name', {
    configurable: true,
    enumerable: false,
    value: 'DefinitionError',
    writable: true,
  })
  error.code = code
  error.kind = 'definition'
  error.response = response
  return error
  ```

- [ ] Transport error 使用同一模式；`HttpStatusError` 没有 cause，使用 `new Error(message)`。保持现有 message、code、overload 和 metadata 枚举性。
- [ ] 重跑定向 Vitest，确认 descriptor、字符串、JSON 与 Struct cause 断言全部通过。
- [ ] 运行 `(cd packages/core && bunx tsc --project tsconfig.json --noEmit)`，确认结构化 cast 保持现有公开错误类型，退出码为 `0`。

### Task 2：同步的 OpenTelemetry Span 初始属性

**文件：**

- 修改：`packages/opentelemetry-server/src/option.ts`
- 修改：`packages/opentelemetry-server/src/option.type.test.ts`
- 修改：`packages/opentelemetry-server/src/option.spec.ts`
- 修改：`packages/opentelemetry-server/src/telemetry/trace.ts`
- 修改：`packages/opentelemetry-server/src/telemetry/trace.spec.ts`
- 修改：`packages/opentelemetry-server/src/interceptor/http.ts`
- 修改：`packages/opentelemetry-server/src/interceptor/http.spec.ts`
- 修改：`packages/opentelemetry-server/src/interceptor/sse.ts`
- 修改：`packages/opentelemetry-server/src/interceptor/sse.spec.ts`
- 修改：`packages/opentelemetry-server/src/interceptor/web_socket.ts`
- 修改：`packages/opentelemetry-server/src/interceptor/web_socket.spec.ts`

**接口：**

- `OpenTelemetryServerTransportOptions<TResponse>` 增加：

  ```ts
  startSpanHook?: (request: HttpRequest) => Attributes
  ```

- 三个内部 interceptor option interface 增加同一字段。
- `createHttpSpan`、`createSSESpan`、`createWebSocketSpan` 增加最后一个可选 `Attributes` 参数。
- 增加一个内部同步 hook resolver，不从 package public API 导出。

- [ ] 添加 RED type test：hook 参数必须是 `HttpRequest`，返回值必须是 `Attributes`，且只存在于 `http`、`sse`、`webSocket` 三个 transport option。
- [ ] 添加异步 callback 的编译期拒绝：

  ```ts
  withOpenTelemetryServer({
    tracer,
    http: {
      // @ts-expect-error startSpanHook 必须同步返回 Attributes
      startSpanHook: async () => ({ 'app.tenant': 'a' }),
    },
  })
  ```

- [ ] 运行 `(cd packages/opentelemetry-server && bunx tsc --project tsconfig.json --noEmit)`。预期 RED：`startSpanHook` 尚不存在，因此出现新增且精确的 option type 诊断。
- [ ] 扩展 option wiring 测试：每个 transport 只收到自己的 hook reference；省略 hook 时保持 `undefined`。
- [ ] 直接读取 `vi.mocked(tracer.startSpan).mock.calls` 中的初始属性；不能从之后会被修改的 mock Span `attributes` bag 反推，也不新增 tracer helper。
- [ ] 为三个 transport 添加 RED interceptor 测试：自定义属性直接出现在 `startSpan` options；`url.full` 可在创建前覆盖；省略 hook 时保留当前 URL。
- [ ] HTTP RED 测试让 hook 同时覆盖 `url.full`、`server.address`、`server.port`，并在原始 `startSpan` attributes 中断言应用值最终胜出，防止 merge order 写反。
- [ ] 增加三个 URL 边界测试：endpoint 字面量自带 query 时原样保留；只有 `req.queryString` 时默认 `url.full` 继续省略它；应用可在 `startSpanHook` 中读取 request 并显式覆盖包含 queryString 的 `url.full`。测试名称和文档不能把既有省略行为称为脱敏。
- [ ] 三个 transport 都添加 hook 失败测试：同步 `throw` 后仍调用 `next`、保留内置初始属性，并在 Span 创建后记录 `defjs.otel.hook.error`，其中 `hook.name === 'startSpanHook'`；另加 `throw undefined` 用例，锁定显式 discriminator。
- [ ] 运行定向测试：

  ```sh
  (cd packages/opentelemetry-server && bunx vitest run --config vitest.config.server.ts src/option.spec.ts src/telemetry/trace.spec.ts src/interceptor/http.spec.ts src/interceptor/sse.spec.ts src/interceptor/web_socket.spec.ts)
  ```

  预期 RED：option 与初始属性契约尚不存在；HTTP server 属性仍在 `startSpan` 之后设置。

- [ ] 在 `option.ts` 以 type import 引入 `Attributes`，把 `startSpanHook` 加入共享 transport option，并在 `withOpenTelemetryServer` 中按 transport 分别透传；不增加全局 hook option。
- [ ] 在 `telemetry/trace.ts` 增加最小内部 resolver：

  ```ts
  type StartSpanHookResult = { ok: true; attributes?: Attributes } | { ok: false; error: unknown }

  export function resolveStartSpanHook(hook: ((request: HttpRequest) => Attributes) | undefined, request: HttpRequest): StartSpanHookResult
  ```

  它只返回属性或抛出值，不创建 Span、不等待 Promise、不修改 request。

- [ ] 三个 Span creator 在创建时只合并一次属性；内置属性在前，应用属性在后：

  ```ts
  attributes: {
    ...builtInAttributes,
    ...startAttributes,
  }
  ```

- [ ] HTTP interceptor 先构造额外初始属性：`server.address`/`server.port` 在前，成功的 hook 属性在后；把结果传给 `createHttpSpan`，删除创建后的 `setAttribute`。Span helper 自身仍先放入 method、URL、operation 内置属性。
- [ ] 每个 interceptor 都在创建 Span 前立即解析 hook，并用 `result.ok` 显式判别，以正确处理 `throw undefined`。失败时先用内置属性创建 Span，再通过现有 `runSpanHook` 同步抛出捕获值以记录错误；请求和传播流程继续执行。
- [ ] 重跑定向 OpenTelemetry Vitest，确认初始属性、覆盖顺序、异常隔离和 transport scope 全部通过。
- [ ] 重跑 `(cd packages/opentelemetry-server && bunx tsc --project tsconfig.json --noEmit)`，确认退出码为 `0`；async `startSpanHook` 仍被拒绝，现有 request/response hook 保持兼容。

### Task 3：SSE AsyncDisposable lifecycle

**文件：**

- 修改：`packages/core/src/sse/transport/event_stream.ts`
- 修改：`packages/core/src/sse/transport/event_stream.advanced.spec.ts`
- 修改：`packages/core/src/sse/sse.spec.ts`
- 修改：`packages/core/src/sse/sse.type.test.ts`
- 修改：`packages/opentelemetry-server/src/test-utils.ts`

**接口：**

- `EventStreamHandle<TEvent>` 改为 `extends AsyncIterable<TEvent>, AsyncDisposable`
- 通过标准 `AsyncDisposable` 契约增加必需的 `[Symbol.asyncDispose](): PromiseLike<void>`
- 保持 `close(reason?: unknown): void`
- 保持 `closed: Promise<EventStreamCloseInfo>` 及其现有逻辑时序

- [ ] 添加 RED type test：`EventStreamHandle` 可赋给 `AsyncDisposable`，并且无需 cast 即可使用 `await using`。
- [ ] 运行 `(cd packages/core && bunx tsc --project tsconfig.json --noEmit)`。预期 RED：handle 尚无 `[Symbol.asyncDispose]`，出现新增且精确的类型诊断。
- [ ] 使用现有永不结束的本地 stream 添加 RED runtime test：调用 disposer 本身不能同步 throw；对同一个 handle 调用两次 `[Symbol.asyncDispose]()` 必须返回严格相同的 Promise。
- [ ] 断言 disposer 只请求一次取消、停止后续读取/重连、释放 reader lock 并最终 settled。沿用 parser 现有的 bounded-cancel 行为，不能要求故意卡住的 provider `cancel()` Promise 完成。
- [ ] 增加 error 终态测试：disposer 等待 teardown，但不能改变已经 settled 的 `closed` 结果，也不能增加第二套错误通道。
- [ ] 运行定向测试：

  ```sh
  (cd packages/core && bunx vitest run --config vitest.config.server.ts src/sse/transport/event_stream.advanced.spec.ts src/sse/sse.spec.ts)
  ```

  预期 RED：handle 没有 `Symbol.asyncDispose`，fire-and-forget `start()` Promise 也不能由 disposer 等待。

- [ ] 保存当前 `start()` 调用为 `lifecycleTask`，保留现有 terminal `finishError` fallback：

  ```ts
  const lifecycleTask = start().catch((error: unknown) => {
    finishError(error)
  })
  ```

- [ ] 只增加 closure-scoped `disposeTask: Promise<void> | undefined` 和非 `async` helper。必须先缓存 Promise，再在 microtask 中调用现有 `handle.close()`，避免同步重入创建第二个 Promise，并把任何同步 close 异常转换为 Promise rejection：

  ```ts
  function disposeHandle(): Promise<void> {
    return (disposeTask ??= Promise.resolve().then(disposeOnce))
  }

  async function disposeOnce(): Promise<void> {
    handle.close()
    await Promise.all([closedDeferred.promise, lifecycleTask])
  }
  ```

- [ ] handle 的 `[Symbol.asyncDispose]()` 直接返回 `disposeHandle()`；不增加 AbortController，不修改 `close()`/`settleClosed()`。
- [ ] `sse.spec.ts` 中真正拥有资源的 short-circuit stream 增加同一 symbol，并委托给现有 `close()`/`closed`，不用 cast 掩盖契约。
- [ ] `packages/opentelemetry-server/src/test-utils.ts` 的 SSE fake disposer 缓存一个 Promise，在其中调用 fake 既有 `close()` 并等待同一个 `closed`；不能返回一条与 fake lifecycle 无关的 `Promise.resolve()`。
- [ ] 重跑定向 SSE Vitest，确认类型、Promise identity、单次 close、reader release 和 lifecycle completion。
- [ ] 重跑 `(cd packages/core && bunx tsc --project tsconfig.json --noEmit)` 与 `(cd packages/opentelemetry-server && bunx tsc --project tsconfig.json --noEmit)`，确认两者退出码均为 `0`，SSE 结构化 fake 也满足新契约。

### Task 4：WebSocket 有界 AsyncDisposable lifecycle

**文件：**

- 修改：`packages/core/src/web_socket/web_socket.ts`
- 修改：`packages/core/src/interceptor/interceptor.ts`
- 修改：`packages/core/src/interceptor/interceptor.type.test.ts`
- 修改：`packages/core/src/client/client.type.test.ts`
- 修改：`packages/core/src/web_socket/web_socket.server.spec.ts`
- 修改：`packages/core/src/web_socket/web_socket.spec.ts`
- 修改：`packages/core/src/web_socket/web_socket.type.test.ts`
- 修改：`packages/opentelemetry-server/src/test-utils.ts`

**接口：**

- `WebSocketSession<TIncoming, TOutgoing>` 扩展 `AsyncDisposable`
- `WebSocketSessionLike` 扩展 `AsyncDisposable`
- 结构化实现必须提供 `[Symbol.asyncDispose](): PromiseLike<void>`
- 保持同步 `close(code?, reason?): void`
- 保持 `closed: Promise<WebSocketCloseInfo>` 的现有逻辑结果
- 内部把 `ERROR_CLOSE_GRACE_MS` 重命名为 `SOCKET_CLOSE_GRACE_MS`，值仍为 `1_000`

- [ ] 在 `web_socket.type.test.ts` 和 `interceptor.type.test.ts` 添加 RED：两个 session interface 都是 `AsyncDisposable`，真实 session 可用于 `await using`，symbol 返回 `PromiseLike<void>`。
- [ ] 在 `client.type.test.ts` 增加 negative assertion：`Client` 不存在 `[Symbol.asyncDispose]`。
- [ ] 运行 `(cd packages/core && bunx tsc --project tsconfig.json --noEmit)`。预期 RED：session disposer assertion 产生新增类型诊断；Client negative assertion 已通过。
- [ ] 只扩展现有 mock WebSocket constructor：统计 close 次数、延迟或省略 close event、让 `close()` 抛错、报告 listener 数量；不新增平行 socket mock。`closeErrors` 必须按数组索引是否存在决定是否 throw，不能用 `typeof value !== 'undefined'`，从而可真实模拟 `throw undefined`。
- [ ] 为以下精确场景添加 RED runtime test：

  | 场景                                          | 必需结果                                                                                                                          |
  | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
  | 正常 open socket                              | 调用本身不同步 throw；两次调用返回同一 Promise；native `close()` 只请求一次；close event 和 lifecycle 退出前 Promise 不 resolve   |
  | reconnect delay 进行中                        | reconnect/heartbeat timer 停止，disposer resolve                                                                                  |
  | `onInvalidEvent` callback 卡住                | callback wait 使用 message signal；disposer abort 后等待 message-pump task 退出                                                   |
  | 不发送 close event                            | `closed` 仍解析为 manual `kind: 'closed'`；一秒宽限内完成逻辑清理；只有 disposer 拒绝 `name === 'TimeoutError'` 的 `DOMException` |
  | native `close()` 抛错（含 `throw undefined`） | 调用 disposer 本身不抛；listener/queue/task 仍被清理；Promise 最后以同一个原始值拒绝                                              |
  | 已进入 aborted/error 终态                     | disposer 只等待自有 teardown，不把逻辑 `closed` 重新解释成物理 clean close                                                        |

- [ ] 每个终态通过可观察行为证明 teardown：callback 已退出、listener count 归零、不再创建 reconnect socket、queue 已终止。不能为了测试增加生产调试 getter。
- [ ] 在 `web_socket.spec.ts` 使用现有真实本地 WebSocket server 增加一个 `await using` smoke，证明真实握手、消息与退出路径可运行；有界异常分支保留在 server mock spec。
- [ ] 运行定向测试：

  ```sh
  (cd packages/core && bunx vitest run --config vitest.config.server.ts src/web_socket/web_socket.server.spec.ts src/web_socket/web_socket.spec.ts)
  ```

  预期 RED：session 没有 disposer，`run()`/message pump 仍是 fire-and-forget，缺失 close event 时也没有可等待的有界 teardown 结果。

- [ ] 保存现有 `run()` Promise 为 `lifecycleTask`，保留当前 failure-to-`finish` 行为。每个 message-pump Promise 加入 `Set<Promise<void>>`，并在 `finally` 删除。
- [ ] 把现有 message signal 传给 `notifyWebSocketInvalidEvent`，并通过已有 `awaitWithSignal` 等待 callback，使 abort 可以终止 callback wait；不增加另一套 timeout helper。
- [ ] 只增加 closure-scoped disposal state：

  ```ts
  let disposeTask: Promise<void> | undefined
  let disposeTimer: ReturnType<typeof setTimeout> | undefined
  let disposeTimeout: DOMException | undefined
  let hasCloseError = false
  let closeError: unknown
  let physicalCleanupDetach: (() => void) | undefined
  ```

- [ ] 让 `installPhysicalCleanup` 返回幂等 detacher，并只在现有 double-native-close failure 分支保存它。disposer 的 `finally` 在该 detacher 存在时调用它；普通路径仍由现有 attempt cleanup 清空 socket，只调用 `close()` 的旧行为保持不变。
- [ ] 实现非 `async` 的 `disposeSession()`：先用 `disposeTask ??= Promise.resolve().then(disposeOnce)` 缓存 Promise，再执行任何关闭副作用。首次 `disposeOnce` 按以下顺序执行：

  1. 调用一次现有 `session.close()`；若抛错则记录原始值，但继续清理。
  2. lifecycle 尚未 terminal 时，启动内部 `SOCKET_CLOSE_GRACE_MS` timer。
  3. timer callback 先再次检查 `finished`。若尚未终态，才创建 `new DOMException('WebSocket close event was not observed before teardown timeout', 'TimeoutError')`，并调用 `finish(toClosedInfo({}, manualClose), { skipNativeClose: true })`。`closed` 因此保持现有 manual close 的 `kind: 'closed'`，只有 disposer 拒绝 timeout。
  4. 等待 `lifecycleTask`；退出后等待剩余 message-pump task 的稳定快照。terminal 后不能再创建新 pump。
  5. 在 `finally` 清除 disposer timer，并仅在 optional physical detacher 存在时调用它。queue、listener、controller 与状态仍只由 `finish()` 终结。
  6. 若捕获 native close 错误则以它拒绝；否则若 timer 触发则以 `disposeTimeout` 拒绝；否则 resolve。

- [ ] 不能用 truthiness 判断 close 是否抛错，因为 JavaScript 允许 `throw undefined`；保留显式 `hasCloseError`。
- [ ] 返回 session 的 `[Symbol.asyncDispose]()` 直接返回 `disposeSession()`，确保重复调用保持 Promise identity。
- [ ] 把 `disposeSession` 作为与 `requestClose` 并列的 callback 传给 `createWebSocketSession`，由返回对象暴露；不增加 class 或 wrapper。
- [ ] `interceptor.type.test.ts` 断言 symbol 返回 `PromiseLike<void>`。
- [ ] `web_socket.spec.ts` 与 `web_socket.server.spec.ts` 中显式的 `WebSocketSessionLike` object literal 增加 symbol，并委托给各自现有 `close()`/`closed`。
- [ ] `packages/opentelemetry-server/src/test-utils.ts` 的 WebSocket fake disposer 缓存一个 Promise，在其中调用 fake 既有 `close()` 并等待同一个 `closed`；不能返回一条独立的 resolved Promise。
- [ ] 重跑定向 WebSocket Vitest，确认表格中的所有场景、清理断言、错误优先级和类型契约。
- [ ] 重跑 `(cd packages/core && bunx tsc --project tsconfig.json --noEmit)` 与 `(cd packages/opentelemetry-server && bunx tsc --project tsconfig.json --noEmit)`，确认两者退出码均为 `0`，HTTP Client negative assertion 仍通过。

### Task 5：公开文档与源码兼容性审计

**文件：**

- 修改：`packages/core/README.md`
- 修改：`packages/opentelemetry-server/README.md`
- 修改：`doc/api/errors.md`
- 修改：`doc/core/errors.md`
- 修改：`doc/api/sse.md`
- 修改：`doc/core/sse.md`
- 修改：`doc/api/web-socket.md`
- 修改：`doc/core/web-socket.md`
- 修改：`doc/api/interceptors.md`
- 修改：`doc/core/interceptors.md`
- 修改：`doc/api/opentelemetry-server.md`
- 修改：`doc/plugins/opentelemetry-server.md`
- 修改（以下 brace expression 是精确的 100 文件集合，不是开放 wildcard）：`doc/{ar,de-DE,es-ES,fr-FR,ja-JP,ko-KR,ru-RU,zh-Hans,zh-Hant-HK,zh-Hant-TW}/{api/errors.md,core/errors.md,api/sse.md,core/sse.md,api/web-socket.md,core/web-socket.md,api/interceptors.md,core/interceptors.md,api/opentelemetry-server.md,plugins/opentelemetry-server.md}`
- 修改：`scripts/verify-packed-consumer.ts`

**文档契约：**

- Error：统一 tuple 保持不变；`String(error)` 可直接记录；metadata 可枚举；`cause` 使用原生 cause chain；Struct helper 需要 cause narrowing。
- Telemetry：不增加 redactor 或敏感 key 策略；明确默认 `url.full` 仍不追加独立的 `req.queryString`；展示应用通过 `startSpanHook` 自行构造完整或脱敏 URL；说明 hook 在 Span 创建前同步执行，抛错只记录而不影响请求。
- SSE：展示 `await using`；保证范围是 Defjs 读取/重连停止与 reader-lock release，不是 provider cancel 完成。
- WebSocket：展示 `await using`；区分逻辑 `closed` 与有界 teardown，并明确 API 无法证明物理 TCP 关闭。
- HTTP：普通 HTTP 是 request-scoped，使用 timeout/`AbortSignal` 管理，所以 Client 不是 `AsyncDisposable`。
- Consumer：公开 `.d.ts` 的最低 lib contract 是 `ES2022`、`ESNext.Disposable`、`DOM`、`DOM.Iterable`；仓库继续使用固定 TypeScript 7 验证，不承诺未经测试的旧 compiler 版本。

- [ ] 编辑前搜索陈旧说明：

  ```sh
  rg -n "toDiagnosticError|Object\.assign|requestHook|responseHook|\.close\(|\.closed|AsyncDisposable|redact|saniti" packages/core/README.md packages/opentelemetry-server/README.md doc
  ```

- [ ] 删除 `doc/core/errors.md` 中陈旧的 `toDiagnosticError` adapter；改为原生 `String(error)` 和显式的 `error.cause instanceof StructError` narrowing。
- [ ] 同步更新 root English 与全部 10 个已启用 locale 的精确页面集合；每个页面保持现有语言。示例保持可执行 TypeScript，术语必须与公开 interface 一致。
- [ ] 为自定义 `EventStreamHandle` 和 `WebSocketSessionLike` 实现增加源码兼容说明：现在必须实现 `[Symbol.asyncDispose]`。这是结构化实现的编译期 breaking change，但只接收 Defjs handle 的使用者不会新增运行时调用要求。
- [ ] 在 root English 与全部 locale 的 interceptor 文档中补充 `WebSocketSessionLike` 的标准 disposer 成员，并说明包装/转发 session 时必须保留该 symbol。
- [ ] 把 packed consumer tsconfig 从宽泛的 `lib: ['ESNext', 'DOM']` 收紧为 `['ES2022', 'ESNext.Disposable', 'DOM', 'DOM.Iterable']`，target 使用 `ES2022`。
- [ ] 扩充生成的 `type-consumer.ts`：从打包后的 `@defjs/core` 导入 `EventStreamHandle`、`WebSocketSession`、`WebSocketSessionLike`，同时用 `readonly AsyncDisposable[]` 赋值和真实的 `await using` 语法编译三种 handle。不能只依赖 `lib` 配置间接证明声明可用；该 consumer 只由 `tsc --noEmit` 编译，不在 runtime smoke 中执行。

  ```ts
  import { createClient, type Client, type EventStreamHandle, type WebSocketSession, type WebSocketSessionLike } from '@defjs/core'

  declare const stream: EventStreamHandle<unknown>
  declare const session: WebSocketSession
  declare const sessionLike: WebSocketSessionLike

  const disposables: readonly AsyncDisposable[] = [stream, session, sessionLike]

  async function consumeManagedHandles(): Promise<void> {
    await using streamResource = stream
    await using sessionResource = session
    await using interceptorResource = sessionLike
    void streamResource
    void sessionResource
    void interceptorResource
  }

  void disposables
  void consumeManagedHandles
  ```

- [ ] 继续用现有 `test:packed` 验证构建后的 `.d.ts`，不新增脚本或测试框架。
- [ ] 使用仓库现有 test/build pipeline 覆盖文档代码，不新增文档测试框架。
- [ ] 对全部目标文档运行逐文件内容门禁，确保没有 locale 被“列入文件清单但漏写内容”：

  ```sh
  for file in \
    doc/{api,core}/errors.md \
    doc/{ar,de-DE,es-ES,fr-FR,ja-JP,ko-KR,ru-RU,zh-Hans,zh-Hant-HK,zh-Hant-TW}/{api,core}/errors.md; do
    rg -q 'String\(error\)' "$file" && rg -q 'cause' "$file" || { echo "missing native error docs: $file"; exit 1; }
  done

  for file in \
    doc/{api,core}/{sse,web-socket,interceptors}.md \
    doc/{ar,de-DE,es-ES,fr-FR,ja-JP,ko-KR,ru-RU,zh-Hans,zh-Hant-HK,zh-Hant-TW}/{api,core}/{sse,web-socket,interceptors}.md; do
    rg -q 'AsyncDisposable|asyncDispose|await using' "$file" || { echo "missing disposal docs: $file"; exit 1; }
  done

  for file in \
    doc/{api,plugins}/opentelemetry-server.md \
    doc/{ar,de-DE,es-ES,fr-FR,ja-JP,ko-KR,ru-RU,zh-Hans,zh-Hant-HK,zh-Hant-TW}/{api,plugins}/opentelemetry-server.md; do
    rg -q 'startSpanHook' "$file" || { echo "missing startSpanHook docs: $file"; exit 1; }
  done
  ```

- [ ] 重跑 scoped 搜索并人工检查每一个剩余匹配。

### Task 6：跨 package 验证与最终审查

**文件：** 审查任务 1-5 修改的全部文件；不能为了全局格式或 lint 输出修改无关 dirty 文件。

- [ ] 运行 Core 定向 server 测试：

  ```sh
  (cd packages/core && bunx vitest run --config vitest.config.server.ts src/error/factory.spec.ts src/http/http.error.spec.ts src/sse/transport/event_stream.advanced.spec.ts src/sse/sse.spec.ts src/web_socket/web_socket.server.spec.ts src/web_socket/web_socket.spec.ts)
  ```

- [ ] 运行 OpenTelemetry 定向测试：

  ```sh
  (cd packages/opentelemetry-server && bunx vitest run --config vitest.config.server.ts src/option.spec.ts src/telemetry/trace.spec.ts src/interceptor/http.spec.ts src/interceptor/sse.spec.ts src/interceptor/web_socket.spec.ts)
  ```

- [ ] 分别运行两个 package 的类型门禁：

  ```sh
  (cd packages/core && bunx tsc --project tsconfig.json --noEmit)
  (cd packages/opentelemetry-server && bunx tsc --project tsconfig.json --noEmit)
  ```

- [ ] 完整运行 `bun run verify`，记录退出码；区分新增失败和 dirty baseline 失败，不能把局部 gate 报告为完整成功。
- [ ] 只对计划列出的路径运行格式与 whitespace 检查，再检查 scoped diff 与 `git status --short`；`oxfmt` 必须覆盖当前仍为 untracked 的目标文件，因为 `git diff --check` 不会检查它们：

  ```sh
  scoped_paths=(
    packages/core/src/error/factory.ts packages/core/src/error/factory.spec.ts packages/core/src/http/http.error.spec.ts \
    packages/core/src/sse/transport/event_stream.ts packages/core/src/sse/transport/event_stream.advanced.spec.ts packages/core/src/sse/sse.spec.ts packages/core/src/sse/sse.type.test.ts \
    packages/core/src/web_socket/web_socket.ts packages/core/src/web_socket/web_socket.server.spec.ts packages/core/src/web_socket/web_socket.spec.ts packages/core/src/web_socket/web_socket.type.test.ts \
    packages/core/src/interceptor/interceptor.ts packages/core/src/interceptor/interceptor.type.test.ts packages/core/src/client/client.type.test.ts \
    packages/opentelemetry-server/src/option.ts packages/opentelemetry-server/src/option.type.test.ts packages/opentelemetry-server/src/option.spec.ts packages/opentelemetry-server/src/test-utils.ts \
    packages/opentelemetry-server/src/telemetry/trace.ts packages/opentelemetry-server/src/telemetry/trace.spec.ts \
    packages/opentelemetry-server/src/interceptor/http.ts packages/opentelemetry-server/src/interceptor/http.spec.ts packages/opentelemetry-server/src/interceptor/sse.ts packages/opentelemetry-server/src/interceptor/sse.spec.ts packages/opentelemetry-server/src/interceptor/web_socket.ts packages/opentelemetry-server/src/interceptor/web_socket.spec.ts \
    packages/core/README.md packages/opentelemetry-server/README.md scripts/verify-packed-consumer.ts \
    doc/api/errors.md doc/core/errors.md doc/api/sse.md doc/core/sse.md doc/api/web-socket.md doc/core/web-socket.md \
    doc/api/interceptors.md doc/core/interceptors.md doc/api/opentelemetry-server.md doc/plugins/opentelemetry-server.md \
    doc/{ar,de-DE,es-ES,fr-FR,ja-JP,ko-KR,ru-RU,zh-Hans,zh-Hant-HK,zh-Hant-TW}/{api/errors.md,core/errors.md,api/sse.md,core/sse.md,api/web-socket.md,core/web-socket.md,api/interceptors.md,core/interceptors.md,api/opentelemetry-server.md,plugins/opentelemetry-server.md}
  )
  bunx oxfmt --check "${scoped_paths[@]}"
  git diff --check -- "${scoped_paths[@]}"
  ```

- [ ] 使用 scoped 搜索验证禁止项：

  ```sh
  rg -n "class (HttpStatusError|TransportError|DefinitionError)|closeAndWait|ResourceManager|redact|sensitiveKeys" packages/core/src packages/opentelemetry-server/src
  rg -n -g '!*.spec.ts' -g '!*.test.ts' "async startSpanHook|startSpanHook: async" packages doc
  ```

- [ ] 发起一次只读整体验收审查；修复本计划范围内的 correctness/compatibility finding，然后重跑覆盖该修复的定向测试和完整 gate。

未加入 commit 步骤，因为主人没有授权提交。
