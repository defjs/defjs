# OpenTelemetry Server 可选 Logger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 为 `withOpenTelemetryServer` 增加可独立使用的 OTel `logger`，记录出站 HTTP、SSE、WebSocket 的失败诊断，并交付第三方日志库接入文档及可运行、可验证的 Winston 示例。

**Architecture:** 由应用注入 `@opentelemetry/api-logs` 的原生 `Logger`。三个现有拦截器共用一个内部日志构造与隔离函数，显式传入各自保存的 `spanCtx`；应用继续持有 SDK、provider、processor、exporter 及其关闭流程。业务代码通过 Winston transport 或 Pino instrumentation 接入同一日志系统，不在 Defjs 内实现日志框架适配层。

**Tech Stack:** Bun `>=1.4.3`、TypeScript、Vitest、现有 Core 拦截器、OTel API `1.9.1`、Logs API/SDK `0.223.0`、Winston OTel transport `0.33.0`。

**Spec:** 本会话已确认的要求：`withOpenTelemetryServer` 增加可选 `logger`；文档与 example 展示第三方日志库结合方式和不同日志等级。本文固化实现决定，不另建重复设计文档。已按本计划实施；实际验收结果与限制见文末。

## Global Constraints

- 基于当前工作区实施，保留已有 `tracer?: Tracer` 改动及 `doc/content` 文档迁移；不以旧 HEAD 覆盖工作区，不改已删除的旧文档路径。
- 公共配置只新增 `logger?: Logger`，不增加 `logLevel`、logger provider、exporter、过滤器、日志 hook 或 Pino/Winston 联合类型。
- `tracer`、`meter`、`logger` 可独立省略；保留空配置、既有 span/metric/传播及返回值行为。不改 Core 公共契约。
- 不自动读取全局 logger，不初始化 SDK，不注册全局 provider，不在请求或连接结束时 flush/shutdown 应用资源。
- `@opentelemetry/api-logs: ^0.223.0` 加入库的普通 `dependencies`，锁定实际解析版本 `0.223.0`，在 tsdown 中保持 external。它是公开类型和 severity 常量的实际依赖；不用 optional peer 掩盖消费者缺失声明依赖的问题。
- SDK、Winston、Pino 及其桥接包不得成为库的运行时依赖；Winston 示例依赖放在 `doc` workspace。保留全仓 Bun 工具链。
- 默认只发失败诊断，级别固定为 `WARN = 13`；输出阈值由应用日志库、SDK 处理器或 Collector 控制。
- 新增日志不能改变业务返回值、原异常对象、`closed` 结果、关闭时机或既有 metric/span 行为；这项隔离要求针对新增 logging 路径，不顺带重构整个遥测异常处理。
- 不自动输出 headers、body、完整 URL、query、baggage、关闭 reason、异常 message/stack 或原异常对象；不把 `startSpanHook` 返回的属性复制到日志。
- 本计划不授权提交、推送、发布或部署。

## Review Focus

1. 日志 emit 或异常属性读取抛错：原业务异常仍按原样传播，流仍按原契约关闭；任务 1、2、3 验证。
2. SSE/WS 返回之后活跃上下文改变：终止日志仍关联建立该生命周期时保存的 context；任务 3 验证。
3. 取消与超时混淆：主动取消不发诊断，超时发一条 WARN；任务 1、2、3 验证。
4. logger-only、传入 tracer 后的显式 bypass、不同协议开关：不得相互误关或生成全局 provider；任务 1、2、3 验证。
5. 第三方 bridge 重复发送及阈值误解：控制台 DEBUG、OTel INFO 可并存，Winston 阈值不控制 Defjs 原生日志；任务 4 验证。

## 当前代码事实与覆盖边界

- `src/option.ts` 通过三个拦截器配置出站请求；当前 `tracer` 已可选，新增功能应延续此实现。
- 三个拦截器已建立 `spanCtx = span ? trace.setSpan(parentCtx, span) : parentCtx`，但没有把它设为全局活跃上下文。日志必须设置 `LogRecord.context`，不能在异步关闭时重新取 `context.active()`，也不能靠字符串 attributes 模拟 trace/span ID。
- `tracer && requireParentSpan && !trace.getActiveSpan()` 当前会跳过整段 instrumentation。保留该行为，包含新日志；未传 tracer 时忽略 `requireParentSpan`，logger-only 正常工作。
- HTTP 的参数检查、部分解码与 Struct 校验位于拦截器之外；不能宣称这些日志覆盖全部 `client.execute()` fault。
- SSE 非 2xx 握手在拦截器中表现为连接拒绝，外层才构造 `HTTP_STATUS`。本次将它作为 SSE 建连失败诊断，不读取 Core 私有 `statusSignal` 或新增 Core API；普通 HTTP 返回 4xx/5xx 则不额外发异常日志。
- WebSocket 现有 span/metric 会将 `kind: 'aborted'` 计为错误，且测试约束了该行为。新日志排除主动取消，但本次不修改那些既有指标。
- `EventStreamHandle.closed` 与 `WebSocketSessionLike.closed` 是生命周期终止信号。只订阅它们，不额外订阅消息迭代错误、`onRuntimeError` 或每次内部重连，以免对同一终止重复发送。

## 日志契约

| 条件                                                                                     | eventName                          | phase        | 级别 / 数量                    |
| ---------------------------------------------------------------------------------------- | ---------------------------------- | ------------ | ------------------------------ |
| HTTP `next()` 拒绝，排除取消及公开 `HTTP_STATUS` fault                                   | `http.client.request.exception`    | `request`    | WARN，一次                     |
| HTTP 返回 2xx/4xx/5xx 或合成 status 0                                                    | —                                  | —            | 不发日志，保留现有 span/metric |
| SSE 建连拒绝，排除取消                                                                   | `defjs.client.sse.exception`       | `connect`    | WARN，一次                     |
| SSE `closed` 为 `error` 或拒绝，排除取消                                                 | `defjs.client.sse.exception`       | `connection` | WARN，一次                     |
| SSE `eof` / `aborted`                                                                    | —                                  | —            | 不发日志                       |
| WebSocket 建连拒绝，排除取消                                                             | `defjs.client.websocket.exception` | `connect`    | WARN，一次                     |
| WebSocket `closed` 为 `error`、拒绝，或既有兼容路径中的无 kind 但带 cause 结果，排除取消 | `defjs.client.websocket.exception` | `connection` | WARN，一次                     |
| WebSocket `closed` / `aborted`，或既有无 kind 且无 cause 的正常兼容结果                  | —                                  | —            | 不发日志                       |
| 成功、连接建立、消息、正常关闭、遥测 hook 错误                                           | —                                  | —            | 不新增日志                     |

`http.client.request.exception` 及 WARN 13 参考 OTel HTTP exception 约定，该约定当前为 Development；SSE/WS 使用 Defjs 自有名称，不冒充标准事件。一次表示一次拦截器调用所观察到的请求或连接生命周期；外层重试再次调用拦截器时属于新的生命周期。不能保证与应用自行写的业务日志或其他 HTTP instrumentation 全局去重。

每条日志包含 `severityNumber: SeverityNumber.WARN`、`severityText: 'WARN'`、显式 `context`。固定 body 分别为 `HTTP client request failed`、`SSE client connection failed`、`WebSocket client connection failed`。attributes 白名单为：

- `defjs.phase`：表中的 phase。
- `exception.type`：复用 `getErrorType(error)`，不进行 `String(error)` 或展开对象。
- `defjs.operation`、`server.address`、`server.port`：复用现有 `createServerMetricAttributes(req)`，仅放该函数已有字段。
- HTTP 的 `http.request.method`；SSE 终止错误的 `defjs.sse.fault.code`；WebSocket 终止错误可用的数值 `websocket.close.code`。

`defjs.operation` 由应用提供，应是稳定操作名，文档提醒不要填客户身份或秘密。错误详情仍由业务层在自己的脱敏规则下记录。不要使用 SDK 的实验 `LogRecord.exception` 字段，因为它会使原始错误详情进入后续处理。

## 文件范围

| 路径                                                                                               | 工作                                     |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `packages/opentelemetry-server/package.json`、`tsdown.config.ts`、`bun.lock`                       | Logs API 依赖与发布边界                  |
| `packages/opentelemetry-server/src/option.ts`、`option.spec.ts`、`option.type.test.ts`             | 公共选项、配置传递及独立信号组合         |
| `packages/opentelemetry-server/src/telemetry/logs.ts`、`logs.spec.ts`（新增）                      | 白名单日志、取消判断、日志故障隔离       |
| `packages/opentelemetry-server/src/test-utils.ts`                                                  | 满足原生 Logger 类型的 mock              |
| `packages/opentelemetry-server/src/interceptor/{http,sse,web_socket}.ts` 及同名 `.spec.ts`         | 按现有生命周期接入和验证                 |
| `packages/opentelemetry-server/e2e.spec.ts`                                                        | 经 `client.execute` 的真实 Core 边界验证 |
| `doc/examples/opentelemetry-logging/winston.ts`、`README.md`（新增）                               | 可运行的第三方 logger 案例与运行说明     |
| `doc/test/opentelemetry-logging.test.ts`（新增）、`doc/package.json`、`doc/tsconfig.json`          | 真实 SDK/bridge 测试及示例类型检查       |
| `packages/opentelemetry-server/README.md`                                                          | 包安装和 logger-only/三信号用法          |
| `doc/content/<locale>/docs/integrations/opentelemetry-server.md`                                   | 11 语种契约同步；中英文完整教学          |
| `doc/content/<locale>/api/opentelemetry-server.md` 及其同名目录中涉及 Options 和函数的 `.mdx` 页面 | 手写 interface、参数和示例同步           |
| `doc/examples/contexts.json`、`content-map.json`                                                   | 精确更新变动代码块上下文及内容修订证据   |

不新增导航、recipe 页面或通用 logger facade。API 组件不会从 TypeScript 源码自动推导新增字段；现有 `api-parameters.ts` 没有 OTel 参数表，本次无需扩建该表或改 `ApiReference`。`public_api.ts` 已导出 `OpenTelemetryServerOptions`，只增加字段无需新公开符号。

## Task 1: 增加原生 Logger 契约和安全日志函数

**Files:** 上表中的依赖、构建配置、`option.*`、`telemetry/logs.*`、`test-utils.ts`，以及三个拦截器的 options 类型。

**Interfaces:**

- 公共：`OpenTelemetryServerOptions.logger?: Logger`，类型来自 `@opentelemetry/api-logs`。
- 内部：`HttpInterceptorOptions`、`SSEInterceptorOptions`、`WebSocketInterceptorOptions` 各接收同一个可选 `logger`。
- 内部新增 `emitClientException(logger: Logger | undefined, details: ClientExceptionLog): void`；`ClientExceptionLog` 为命名接口，字段是 `request: HttpRequest`、`context: Context`、`transport: 'http' | 'sse' | 'websocket'`、`phase: 'request' | 'connect' | 'connection'`、`error: unknown`，以及可选 `closeInfo: { code?: unknown }`（在日志隔离边界内读取并按协议验证 code）。不从 `public_api.ts` 导出。

- [x] 更新依赖清单并用 Bun 更新 lockfile；检查 lock 差异只包含这项功能及后续示例必要依赖，保留现有改动。Logs API 加入 `tsdown.config.ts` 的 `deps.neverBundle`。
- [x] 在 `option.type.test.ts` 写类型用例：logger-only、logger+meter、logger+tracer、三信号及空配置均接受；普通 `{ info() {} }` logger 不可传入；原有无参和旧 API 负例继续成立。
- [x] 新增 helper 的行为测试：三协议固定 event/body/级别、白名单字段、缺失 logger 不做日志工作；`ERR_ABORTED`、`DOMException('...', 'AbortError')`、公开 `NET_ABORTED` fault 不 emit；`ERR_TIMEOUT` 与 `TimeoutError` 仍 emit；非 Error 原因只记录类型。
- [x] 加入隐私与失败测试：请求及错误中放入可识别秘密，断言 body/attributes 没有 URL/query/header/body/message/stack/cause；`emit()` 抛错和错误对象的属性 getter 抛错都不向调用者抛出。类型 mock 实现 `Logger.emit` 与 `Logger.enabled`，不假定 logger 就是 Winston。
- [x] 运行 `bun run --cwd packages/opentelemetry-server test --coverage.enabled=false src/telemetry/logs.spec.ts`，确认因 helper 未实现而失败；运行 `bun check --project tsconfig.json`，确认新选项类型用例在实现前失败。
- [x] 实现白名单日志函数和选项传递。复用已有错误类型/服务器属性函数；取消识别遵循 Core 当前规则，兼容 `NET_ABORTED`，不深度递归 cause，不用 `req.abort.aborted` 一刀切跳过超时。无需调用 `Logger.enabled()` 或提供额外过滤状态。
- [x] helper 内包住新增日志构造及 `emit()`；发生故障仅用 `diag.error` 报固定文本 `@defjs/opentelemetry-server: failed to emit client diagnostic log`，不附原始错误，不再次使用业务 logger。diag 自身抛错也不能外溢。
- [x] 重跑 helper 与 option 类型检查，确认正例通过、负例仍由 `@ts-expect-error` 验证。无需建立全局 logger、provider 或新的公共错误类型。

## Task 2: HTTP 失败日志与配置组合

**Files:** `src/interceptor/http.ts`、`http.spec.ts`、`option.spec.ts`、`e2e.spec.ts`。

**Interfaces:** 消费任务 1 的 logger 和 `emitClientException`，用已有 `spanCtx`、`req` 和捕获的原错误记录 `http/request`。

- [x] 在 HTTP 测试增加 `logger-only emits one WARN for a rejected next and preserves the cause`；断言 emit 一次、context 正确、错误仍是同一对象。参数化覆盖无 tracer 与有 tracer。
- [x] 新增取消、超时、200/404/500/0 与公开 `HTTP_STATUS` fault 用例：取消和状态响应为零条，超时一条 WARN；不将 span 的 ERROR 状态直接映射为 ERROR 日志。
- [x] 在 `option.spec.ts` 验证 logger 被传给每个启用协议、禁用协议不产生日志；logger-only 不读取全局 tracer/logger，且 `requireParentSpan: true` 不阻止它。明确传入 tracer 且没有 active parent 时，保持整段 bypass，包括不 emit。
- [x] 运行 `bun run --cwd packages/opentelemetry-server test --coverage.enabled=false src/interceptor/http.spec.ts src/option.spec.ts`，确认新日志断言失败。
- [x] 在现有传输失败路径接入 helper；HTTP 成功路径不 emit。新增 logging 不扩大已有 hook、span 或 metric 的执行范围，不将 helper 故障变为一次新的传输失败。
- [x] 通过 `e2e.spec.ts` 的本地 handle 验证 `client.execute` 返回 `NET_UNREACHABLE` 时有一条诊断；logger 抛错时 tuple 与 cause 不变；输入校验失败、HTTP 状态错误及拦截器外解码失败不凭空补日志。复用现有 fixtures，不连接公网。
- [x] 重跑上述用例和 `e2e.spec.ts`；结果应精确满足日志数量、关联 context 和原返回值断言。

## Task 3: SSE 与 WebSocket 终止日志

**Files:** `src/interceptor/sse.ts`、`sse.spec.ts`、`web_socket.ts`、`web_socket.spec.ts`；复用已有 deferred stream/session helpers。

**Interfaces:** 消费任务 1 的 helper；建连拒绝使用 `connect`，`closed` 的失败分支使用 `connection`。使用拦截器建立时保存的同一个 `spanCtx`。

- [x] 给两个协议补 logger-only 和 tracer+logger 的建连失败、正常终止、错误终止、closed 拒绝用例。SSE 验证 fault code；WS 验证 close code 和原有 legacy close 兼容分支。
- [x] 为主动取消加独立用例：SSE/WS `kind: 'aborted'` 即使带普通 Error cause 也不 emit；建连拒绝的原始取消原因及 `NET_ABORTED` fault 不 emit；超时仍为 WARN。WS 的原有 span/metric 断言保持不变。
- [x] 构造 context A 中打开、context B 中终止的流和会话，断言日志的 `context` 对应保存的 A/outbound span；无 tracer 时保留提取的 parent context，未采样 context 也不由本库擅自丢弃。
- [x] 断言建连失败与成功后终止分别最多一次，重复 close 调用、随后消费到同一终止错误不会增加日志；不监听 `onRuntimeError`，不对内部重连尝试逐条计数。Promise 的单次 settle 和唯一终止订阅已足够时，不额外创建全局去重表。
- [x] 增加 logger 抛错后的关闭验证：原 `closed` 值/拒绝原因不变，active metric 归零次数不变，span 仍按原逻辑结束，没有新增未处理 rejection。
- [x] 运行 `bun run --cwd packages/opentelemetry-server test --coverage.enabled=false src/interceptor/sse.spec.ts src/interceptor/web_socket.spec.ts` 确认新增断言失败，然后只在表中对应的失败路径接入 helper。
- [x] 重跑两个协议的完整测试。SSE 直接使用明确的 close kind；WS 日志判断单独排除 aborted，不改现有 `failed` 对 span/metric 的语义。

## Task 4: 可运行 Winston 示例与真实 SDK 验证

**Files:** 新增 `doc/examples/opentelemetry-logging/winston.ts`、该目录 `README.md`、`doc/test/opentelemetry-logging.test.ts`；修改 `doc/package.json`、`doc/tsconfig.json`、`bun.lock`。

**Interfaces:** 示例导出 `runWinstonLoggingExample(loggerProvider: LoggerProvider, otelLevel: 'info' | 'error' = 'info'): Promise<void>`，第二个参数只设置示例中的 Winston OTel transport 阈值；CLI 与测试运行同一业务示例。调用端创建并注册 provider/context manager，负责 flush/shutdown 和全局清理；函数负责创建、写完并关闭自己的 Winston logger。脚本在 `import.meta.main` 时启动示例，被测试导入时不自动运行。

- [x] 给 `doc` 添加 `@opentelemetry/api-logs: 0.223.0`、`@opentelemetry/sdk-logs: 0.223.0`、`@opentelemetry/context-async-hooks: 2.12.0`、`@opentelemetry/winston-transport: 0.33.0` 和兼容的 Winston 3.x 开发依赖；实施时查阅官方声明并记录实际锁定版本，不安装 SDK 到库本体。
- [x] 将 `examples/**/*.ts` 纳入 `doc/tsconfig.json`，新增脚本 `example:otel-logging`，命令为 `bun examples/opentelemetry-logging/winston.ts`。
- [x] 先写真实 SDK 测试：`LoggerProvider` + `SimpleLogRecordProcessor({ exporter })` + `InMemoryLogRecordExporter`；业务代码使用真实 `OpenTelemetryTransportV3`，Defjs 使用同一 provider 的 `getLogger('@defjs/opentelemetry-server')`。测试不 mock bridge 或 SDK。
- [x] CLI 和测试注册真实 `AsyncLocalStorageContextManager`，用 `trace.setSpanContext(ROOT_CONTEXT, { traceId: '11111111111111111111111111111111', spanId: '2222222222222222', traceFlags: TraceFlags.SAMPLED })` 构造演示用父 context，并在 `context.with(parentContext, ...)` 中执行示例。示例使用 logger-only；断言两路实际导出记录都带该父 traceId/spanId。另有 tracer 时日志可关联出站子 span，不能把“两路 spanId 相同”写成通用要求；子 span 已由任务 2、3 验证，不为此再安装完整 Trace SDK。
- [x] 测试捕获示例的控制台输出并检查 exporter：DEBUG 业务消息只出现在控制台，INFO/WARN 业务消息进入 OTel，各一条；本地拒绝请求产生一条 Defjs WARN，scope 与业务 transport scope 不同但 exporter 相同。
- [x] 用同一 provider 再调用 `runWinstonLoggingExample(provider, 'error')`，断言第二次业务 INFO/WARN 没进入 exporter，而第二条 Defjs 原生 WARN 仍进入；根据第一次 flush 后的记录数量截取增量，不另写一套假示例。明确区别 Winston 默认 logger level 与 transport 的显式 level；后者可以覆盖前者，不写出“修改 appLogger.level 就控制全部日志”的错误说明。
- [x] 实现示例：注册全局 provider 后才构造 Winston transport；`Console` 设置 DEBUG，OTel transport 使用传入的 `otelLevel`，默认 INFO；只启用这一条 Winston OTel 发送路径。使用 `withHTTPHandle` 的可控拒绝演示失败，不依赖外网或 Collector。
- [x] 示例函数在 `finally` 等待自己的 Winston 日志写入并关闭，调用端随后 `forceFlush()`；测试读取 exporter 后在 `finally` shutdown provider、`logs.disable()`、`context.disable()`，关闭对应 context manager，防止后续测试共享状态。CLI 也在 `finally` 关闭资源，不用 `process.exit()` 截断队列；一个测试装配只注册一次 provider，再调用两次示例。
- [x] 执行 `bun run --cwd doc example:otel-logging` 和 `bun test --cwd doc ./test/opentelemetry-logging.test.ts`，断言实际记录数量、severity、context 字段及清理。文档明确 Console exporter 便于本地观察，生产可由应用替换为 OTLP exporter。

## Task 5: 文档、第三方接法和等级说明

**Files:** 上述 package README、11 语种 integration/API 页面、示例 README、`doc/examples/contexts.json`、`doc/examples/content-map.json`。

**Interfaces:** 所有代码使用任务 1 的原生 Logger 选项；完整可运行 Winston 案例链接至任务 4 文件，不复制第二套实现。

- [x] 同步 11 个 locale：`en-US`、`zh-Hans`、`zh-Hant-TW`、`zh-Hant-HK`、`ja-JP`、`ko-KR`、`de-DE`、`fr-FR`、`es-ES`、`ru-RU`、`ar`。更新手写 options/interface、安装说明和不再准确的“仅 tracer/meter”描述；保留已有 optional-tracer 内容。
- [x] 中英文 integration 页完整展示 logger-only、三信号注入、Winston 显式 transport、应用关闭流程；其他语言同步公共契约并准确链接完整示例。现有页面直接链接可执行 example，不新增 recipe 或导航项。
- [x] 给 Pino 提供完整的 Node 初始化顺序示例：应用配置 Logs processor、注册 `PinoInstrumentation`、启动 SDK 后加载 Pino；分别说明 log correlation 与 log sending。需要进行代码块类型检查的依赖仅添加到 `doc` devDependencies：`@opentelemetry/sdk-node: 0.223.0`、`@opentelemetry/instrumentation-pino: 0.69.0` 和兼容的 Pino 10.x，锁定实施时核对的实际版本。明确这段是 Node 参考接法，Bun 类型检查不证明自动插桩可运行，不为此切换仓库运行时或自造 adapter。说明 Pino worker transport 可以使用独立 provider，不能声称它自动共享主线程 provider。
- [x] 加入等级映射表：OTel TRACE/DEBUG/INFO/WARN/ERROR/FATAL 的基础值为 1/5/9/13/17/21；Pino 10/20/30/40/50/60 对应；Winston 默认 npm 等级中 silly/debug/info/warn/error 对应 1/5/9/13/17，http 为 7，verbose 为 6，未默认提供 fatal。自定义级别必须明确映射，不能把第三方数字直接当成 OTel severity。
- [x] 区分事件等级和输出阈值，说明上游丢弃的 DEBUG 不能由下游找回；Winston 阈值不控制 Defjs 直接 emit 的日志。Logs API 不等于第三方业务 Logger；日志 TRACE 等级不等于 Tracer 信号。
- [x] 文档列出本计划的事件表、logger-only 行为、`requireParentSpan` 兼容规则、拦截器覆盖范围、隐私白名单、OTel Logs 对 span context 的显式关联，以及仅靠注入 logger 不会让任意业务日志自动进入 Defjs outbound span。
- [x] 明确去重边界：Winston 显式 transport 与自动 log sending 二选一；Defjs 只保证自己单次生命周期的诊断数量，其他自动 HTTP instrumentation 与应用重报需要应用协调。不暴露实验 `loggerConfigurator` 为 Defjs API。
- [x] 为变动 TS 代码块精确维护 `contexts.json` 的 ordinal 和 companion code，使用真实依赖和完整类型上下文，不用 `declare` 占位绕过校验。保留 `content-map.json` 原迁移 hash，只对本次目标页面追加或更新 `approvedProseRevision`，保留已有 optional-tracer 修订理由，不重建整个基线。
- [x] 运行 `bun run --cwd doc check:examples`、`bun run --cwd doc test`、`bun run typecheck`；链接和内容检查不能以关闭断言或排除新增示例来通过。

## Task 6: 发布兼容与最终验收

**Files:** 只涉及前述文件；若有失败，先辨别本改动与既有工作区问题，不顺手扩大范围。

- [x] 运行 `bun run --cwd packages/opentelemetry-server test`，保留该包当前 branches/functions/lines/statements 全部 100% 的覆盖率门槛。新增私有日志模块不得加入 coverage exclude。
- [x] 运行一次 `bun run verify`，读取退出码和完整失败摘要。该命令涵盖 lint、格式、全 workspace tests、类型/构建和站点 e2e；不能沿用本次修改前的验证结果。
- [x] 复用 verify 成功产生的 build 产物：检查 `dist/index.d.ts` 暴露原生 Logger 类型，`dist/package.json` 包含 Logs API 普通 dependency；产物中不包含 SDK、Winston/Pino、全局 SDK 初始化或文档示例。若 verify 在 build 前因既有问题退出，单独构建相关包供下面的消费者检查，并明确验证范围，不用旧产物冒充本次构建。
- [x] 在临时消费者目录测试构建后的包/tarball，安装其声明依赖，设置 `skipLibCheck: false`：原 `{ tracer }`、`{ meter }`、`{}` 调用无需手工新增 peer 即可编译；新 `{ logger }` 调用也编译。只使用 Bun 安装和检查；临时目录留在工作区之外，检查后删除本次创建的目录。
- [x] 最终检查 `git diff` 与工作区状态，确认只纳入计划范围变更；报告局部测试、全仓检查、消费者声明检查及 Winston 实跑各自结果。如果现有浏览器测试或站点检查失败，保留原因并明确不能宣称全仓通过。

验收结果必须同时证明：未传 logger 的行为兼容；logger-only 可用；三协议按表产生或抑制日志；保存 context；新日志失败不改变业务结果；实际第三方日志与 Defjs 日志进入同一 pipeline；不同等级及阈值的文档有运行证据。真实 Collector 接收、生产吞吐和 Bun Pino 自动插桩不在本次已验证范围内。

## 参考与实施前复核

- [OTel HTTP exception 语义约定](https://opentelemetry.io/docs/specs/semconv/http/http-exceptions/)：当前 Development，HTTP client exception 推荐 WARN 13；不把所有 HTTP 错误状态变成异常日志。
- [Logs API Logger 与版本源码](https://github.com/open-telemetry/opentelemetry-js/blob/92b844e8aa7d9655e4b3560154e912c4c1ced64d/experimental/packages/api-logs/src/types/Logger.ts)：本计划依据已发布 `0.223.0`，不混用主分支未来 API。
- [Winston transport](https://github.com/open-telemetry/opentelemetry-js-contrib/blob/cc263ac4e94320402ac3afe50d50eb00905e1bb8/packages/winston-transport/README.md) 与 [等级转换](https://github.com/open-telemetry/opentelemetry-js-contrib/blob/cc263ac4e94320402ac3afe50d50eb00905e1bb8/packages/winston-transport/src/utils.ts)。
- [Pino instrumentation](https://github.com/open-telemetry/opentelemetry-js-contrib/blob/cc263ac4e94320402ac3afe50d50eb00905e1bb8/packages/instrumentation-pino/README.md)：保留 Node 初始化顺序与 provider 所有权边界。

计划编写阶段仅完成源码、调用关系、测试、文档布局和上游接口调查；未安装依赖、实现功能或执行上述待开发测试。

## 实施与验收记录（2026-10-11）

任务 1–6 的实施与检查已执行。保留原工作区 optional-tracer 和 Fumadocs 迁移；未提交、推送、发布或部署。上方勾选表示步骤已经执行，完整检查的实际结果以本节为准，不表示所有首次运行均通过。

- 公共 API 新增原生可选 Logger；HTTP/SSE/WS 失败诊断使用 WARN 13、白名单字段和保存的 context，未传 logger 不新增日志行为。
- 库仅新增 Logs API 普通依赖；SDK、Winston/Pino 和桥接包仅用于文档开发依赖。真实 Winston 示例由应用持有 provider 并关闭资源。
- 更新 11 语种共 44 个相关文档页面以及 package/example README。中英文指南包含 logger-only、三信号、Winston、Pino、等级与过滤说明；其他语种同步公共契约并链接完整案例。
- TDD 已记录公共 API 类型和行为、HTTP、SSE/WS、真实 Winston exporter 的 RED→GREEN。独立审查发现 SSE 关闭 cause getter 在日志隔离边界外读取的问题，新增两个回归用例先复现，再延迟到 helper 的保护范围读取；审查复核后没有未关闭的发现。

| 验证                 | 实际结果                                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenTelemetry 包     | 274/274 tests，11 文件；statements/branches/functions/lines 全部 100%                                                                           |
| Workspace tests      | Core 1,780、OTel 274、React 12、Vue 14、doc 32，全部通过                                                                                        |
| 类型与文档示例       | 根 257 文件、doc 157 文件；1,062 complete examples / 86 distinct，全部通过                                                                      |
| lint / format        | 全仓通过；格式检查覆盖 2,708 文件                                                                                                               |
| build / links        | 所有包与文档站点构建通过；2,279 生成页面链接检查通过                                                                                            |
| Winston runtime      | Bun 1.4.3 实跑退出 0；真实 SDK 测试 1/1、10 个断言通过，包括等级阈值和 trace/span 关联                                                          |
| Packed consumer      | 新构建 tarball 在临时目录安装；未手动声明 api-logs，旧/新配置在 skipLibCheck:false 下通过；实际调用产生一条 WARN 并保留原 cause；临时目录已清理 |
| 首次 bun run verify  | 退出 1；前序检查通过，站点测试 14/15，Firefox 在 site.test.ts:116 等待搜索对话框超时                                                            |
| Firefox 失败用例复查 | 同一构建、未修改实现或断言，单项 1/1 通过，968 个断言；首次失败根因未确认，不能将首次 verify 表述为通过                                         |

实施中按真实 Core 流程校正了文档边界：handler 内的响应读取/JSON 解析失败可能先产生 WARN，再成为 RES_DECODE_FAILED；后置 Struct 或媒体类型校验不产生日志。内部 helper 改为在保护区内读取关闭 code；SSE cause 采用延迟读取，未扩大公共 API。

完整 RED/GREEN、CLI、全仓验证和消费者日志保存在仓库内的 .superpowers/sdd/2026-10-11-opentelemetry-server-logger/。关键记录为 23-sse-getter-green.log、30-verify.log、31-consumer.log、32-firefox-recheck.log；feature.patch 对比的是本任务启动时的 dirty-worktree 快照，避免混入此前改动。

消费者安装时 Bun 对当前 Core 的 registry peer 范围给出警告；本地已明确提供本次构建的 Core tarball，类型和运行检查通过。这不是 npm 发布可用性验证。真实 Collector 接收、生产吞吐和 Pino 自动插桩在 Bun 下的运行未验证；Pino 文档是 Node 初始化顺序参考。既有 span/metric 异常处理保持原行为。
