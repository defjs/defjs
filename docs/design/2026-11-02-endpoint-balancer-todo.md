# 端点负载均衡：全部待办

- 规格：`docs/design/2026-11-02-endpoint-balancer.md`，第六稿修订十四。括号里的「§」指规格章节。
- 第一期实施说明：`docs/design/2026-11-02-endpoint-balancer-phase1.md`。
- 标「授权」的项目需要主人明确同意后才能做。
- 每一期都按同一个流程走：sonnet 实现 → Claude 审查差异 → Claude 独立重跑六道闸门 → 主人决定是否提交。

## 0. 实施前

- [x] 设计定稿，第 2 节全部决定已确认（§2）
- [x] 第一期实施说明
- [x] 记录工作区快照：`/tmp/lbexp/baseline/dirty-snapshot.txt`
- [x] 跑 `main@ed1763e8` 的闸门基线：六道全部通过，`/tmp/lbexp/baseline/summary.txt`
- [ ] 授权：提交两份设计文件与本清单（`docs:` 前缀）
- [ ] 授权：为第一期建分支或工作树

## 1. 第一期：多端点配置、接口、挂接、两个基础工厂

### 1.1 类型与公开面（§3、§9.1）

- [x] 新建 `packages/core/src/balancer/`，带 `index.ts` 与 `public_api.ts`，接入 `src/public_api.ts`
- [x] 类型：`EndpointBalancer`、`EndpointPickOutcome`、`EndpointTransport`、`EndpointPickInfo`（本期不含 `hashKey`）、`EndpointPickResult`、`EndpointFaultCode`、`EndpointDoneInfo`
- [x] `ERR_NO_ENDPOINT`，品牌机制照 `error/cause.ts` 的 `ERR_ABORTED`
- [x] `isNoEndpointCause`，用 `Symbol.for` 品牌跨 Core 副本识别
- [x] 每个新导出写英文 TSDoc 与 `@group client`

### 1.2 配置（§3.2、§3.3）

- [x] `client/config.ts`：`endpoint: string` 改为 `endpoints: readonly string[]`，`ClientOptions` 与 `ClientConfig` 一起改
- [x] `ClientConfig.endpointBalancer`，`createClientConfig()` 为每个客户端放一个新的 `pickFirstBalancer()`
- [x] `client/option.ts`：`withEndpoint(...endpoints)` 复制并按首次出现去重，不校验 URL，后写覆盖
- [x] `withEndpointBalancer`：整体替换，保留对象引用
- [x] `HttpRequest.baseEndpoint` 的说明改为「本次选中的端点」（`internal/http_request.ts`）
- [x] 改 `ClientConfig` 默认值那句 TSDoc 和 `withEndpoint` 的 TSDoc

### 1.3 运行时处理 `pick` 的结果（§3.3）

- [x] 返回 `[Error, undefined]`：选项错误内部品牌 → `REQ_OPTIONS_INVALID`；其他错误与 `ERR_NO_ENDPOINT` → `REQ_BUILD_FAILED`，原错误作为 `cause`
- [x] `pick` 抛出 → `createPreflightFault("REQ_BUILD_FAILED", 抛出值)`
- [x] 返回值形状不对 → `REQ_BUILD_FAILED`，`cause` 是返回值本身
- [x] 以上情况都不调用 `done`，调用点不抛
- [x] `done` 同步调用、忽略返回值、吞掉异常，不替换已有元组
- [x] 选项错误的内部品牌（不导出）

### 1.4 两个工厂（§4.2–4.4、§7）

- [x] 共同规则：候选为空返回 `ERR_NO_ENDPOINT`；状态以端点字符串为键；`Math.random` 与 `Date.now()`
- [x] `pickFirstBalancer({ shuffle })`：粘滞状态、`order` 由 `done` 闭包捕获、只在 `NET_UNREACHABLE` 且粘住的仍是本次端点时前进；每次都返回 `done`
- [x] `shuffle`：每个端点首次出现时取排序键
- [x] `roundRobinBalancer({ weights })`：随机起点、计数器按 2^32 取模；有权重时用 nginx 平滑加权；不带健康过滤时省略 `done`
- [x] 第一期涉及的选项校验：`shuffle` 为布尔；`weights` 为 `Map`，值为有限正数；不合法时构造时记下，之后每次 `pick` 都返回选项错误

### 1.5 共同挂接规则（§6.1）

- [x] 初始选台在输入解析与取消检查之后、构建请求之前；选台前已取消的快速路径不 `pick`
- [x] 执行入口的 `try`/`finally` 覆盖交给传输层之前的全部出口
- [x] 每次 `pick` 都带 `transport` 与定义里的 `operation`
- [x] 结果只取自基址等于选中端点的尝试，按 §6.1 的映射表合成
- [x] 还没调用 `fetch`、也还没构造 `WebSocket` 时的截止时间和取消记 `{ attempted: false }`

### 1.6 HTTP（§6.2）

- [x] 在 `createHttpRequest` 之前选台
- [x] 拦截器链终端 `handler` 记录每次尝试：成功记状态码；`BodyFailure` 分三种；连接失败记 `NET_UNREACHABLE`
- [x] 多次 `next()` 共用初始选台
- [x] 声明的响应体解码结束之后、返回元组之前调用 `done`

### 1.7 SSE（§6.3）

- [x] 只有第一次 `next()` 参与选台；后续 `next()` 不 `pick`、不调用 `done`
- [x] `sseHandler` 的「已收尾」标记：基址被换、`resolveRequestUrl` 抛出、信号已取消、`ERR_FETCH_UNSUPPORTED` 时只 `done` 一次
- [x] `done` 传入 `fetchEventStream`；握手结束时快照结果，超时与取消按优先级覆盖
- [x] 在这次连接尝试结束时调用 `done`
- [x] 重连选台放在 `wait` 成功返回之后、构造下一轮 `Request` 之前，并重新解析 URL
- [x] 不重连的路径不 `pick`；`shouldReconnect` 返回真的非幂等方法仍会重连
- [x] 重连时 `pick` 失败与 URL 生成失败分开处理，都不抛进 `start()` 的重试 `catch`
- [x] `EventStreamFaultCode` 增加 `REQ_BUILD_FAILED` 与 `REQ_OPTIONS_INVALID`；`getEventStreamFaultCode` 不落成 `NET_UNREACHABLE`；`createEventStreamFault` 原样返回这两个码；同步 `closed` 的 TSDoc

### 1.8 WebSocket（§6.4）

- [x] 初始选台在 `buildOutbound` 之前；交给 `wsHandler` 之前的出口由执行入口 `done({ attempted: false })`
- [x] `wsHandler` 入口基址被换：立即 `done` 并立会话级「已收尾」标记，之后不再 `done`、不再 `pick`
- [x] 每次尝试的唯一调用点：已构造套接字时在 `settleAttempt`；未构造时在结束这次尝试的那次 `finish` 或 `finishFromSignal`
- [x] `connectFailure`（构造函数抛出、`binaryType` 赋值抛出）：在 `run()` 拿到结果后、`continue` 或终端 `finish` 之前 `done`，用逐次尝试的标记
- [x] `prepareAttempt` 里 `pick` 失败不调用 `done`；`pick` 成功后的 URL、`beforeConnect` 失败调用一次
- [x] 第 1 次及以后的尝试在 `prepareAttempt` 开头重新 `pick`
- [x] 结果映射：打开后正常关闭、打开后超时、打开后取消、从未打开、尚未构造时取消
- [x] 打开之后重连 `pick` 失败：包好的故障放进 `state.error`

### 1.9 夹具与类型测试（§9.3）

- [x] `packages/opentelemetry-server/src/option.spec.ts` 的 `makeConfig()`：改成 `endpoints` 并加 `endpointBalancer: pickFirstBalancer()`
- [x] `packages/core/src/client/client.type.test.ts`：字面量改成 `endpoints: ["https://api.example.com"]`，`OptionsCases` 断言 `ClientOptions["endpoints"]` 为 `readonly string[]`

### 1.10 测试（§10）

- [x] 均衡器逻辑的 `*.spec.ts`，随机与时间按 §10 的约定固定
- [x] 挂接点在 `packages/core/test/` 的夹具服务器上做集成测试
- [x] 一条 `*.browser.spec.ts`，在 Chromium 与 Firefox 上验证 HTTP 的选台与 `done`
- [x] 回归表中「期」为「一」的 22 条，每条修复前失败、修复后通过
- [x] 选项校验、`pick` 每种非法返回值、`done` 省略、`isNoEndpointCause` 跨副本识别的覆盖
- [x] 覆盖率保持 100%

### 1.11 文档（§9.2「每一期」与「第一期」）

- [x] 12 个新导出按目录顺序追加到 `doc/scripts/api-order.ts`
- [x] `bun run --cwd doc extract-api`，提交生成的三个文件
- [x] `navigation.spec.ts` 的 204 改为 216；`api-slug.spec.ts` 与 `api-html.spec.tsx` 两处的 165 改为 177
- [x] 11 个语言的 `api/client.mdx`：`ClientOptions` 改为 `endpoints`，`endpointBalancer` 写进 `ClientConfig`，用 `ApiSignature` 挂新签名
- [x] 11 个语言的 `api/sse.mdx` 与 `docs/sse.mdx`：`EventStreamFaultCode` 码表加两个码
- [x] 11 个语言的 `api/errors.mdx`：挂上 `ERR_NO_ENDPOINT` 与 `isNoEndpointCause`
- [x] 11 个语言的 `docs/interceptors.mdx`：`baseEndpoint` 是本次选中的端点
- [x] `packages/core/design.md`：快速开始改成 `endpoints`，写上选台与结果归因
- [x] 指南 `docs/client.mdx` 新增「多个端点」小节的第一期部分，11 个语言同步
- [x] `doc/examples/` 下的完整示例，按 `http/basic-setup.ts` 的写法，通过类型检查

### 1.12 收尾

- [x] 六道闸门全部通过，记录每条命令的退出码
- [x] Claude 审查差异，并对照工作区快照区分新旧改动
- [x] Claude 独立重跑六道闸门
- [ ] 授权：提交第一期（`feat(core)!:`，正文写明破坏性变更）

## 2. 第二期：健康过滤、`failback`、p2c

### 2.1 实现

- [ ] `outlierDetection(child, options)` 包装函数与 `OutlierDetectionOptions` 类型（§3.1、§5.1）
- [ ] 两个第一期工厂加上 `outlierDetection` 选项；加选项后 `roundRobinBalancer` 返回 `done`（§3.3）
- [ ] 样本与失败判据、默认 `isFailure`（§5.2）
- [ ] 候选计算与兜底，兜底只用本次列表（§5.3）
- [ ] 端点状态在清算之前创建；清算网格、全局游标、算术补算；窗口清空与倍数衰减作用于全部端点（§5.4）
- [ ] 连续失败的记账，含 `consecutiveFailures` 为 0 和名额不足时的情况（§5.5）
- [ ] 失败百分比：只遍历参与集合、整数比较、跳过最后一个可用端点（§5.5）
- [ ] 摘除时长、名额、「最后一个可用端点」不调用 `isHealthy`（§5.6）
- [ ] `isHealthy` 只在过滤时调用，非布尔值或抛出时这一次得到 `REQ_OPTIONS_INVALID`；`isFailure` 异常不计样本且仍调用内层 `done`（§5.7）
- [ ] `pickFirstBalancer` 的 `failback`，未配 `outlierDetection` 时是选项错误（§4.3）
- [ ] `p2cBalancer`：抽样、`pending` 与 `peakEwma` 两种负载、惩罚样本、只有 HTTP 更新延迟、条目上限 256、开始时刻存在 `done` 闭包（§4.5）
- [ ] 第二期涉及的全部选项校验（§7）

### 2.2 测试

- [ ] 回归表中「期」为「二」的 17 条
- [ ] 第 5.8 节例子的两种时序，包括恰好在 40000 时
- [ ] 覆盖率保持 100%

### 2.3 文档

- [ ] 3 个新导出追加到 `api-order.ts`，`extract-api`，URL 数改为 219，目录条数改为 180
- [ ] `api/client.mdx` 补上 `p2cBalancer`、`outlierDetection` 与 `failback`，11 个语言同步
- [ ] `packages/core/design.md` 写上健康过滤的规则
- [ ] 指南补上健康过滤、主动检查示例、`failback`、p2c 与截止时间的建议，11 个语言同步
- [ ] 示例补充，通过类型检查

### 2.4 收尾

- [ ] 六道闸门、Claude 审查与独立重跑
- [ ] 授权：提交第二期（`feat(core):`）

## 3. 第三期：环哈希与 `hashKey`

### 3.1 实现

- [ ] 手写同步 `XXH64`，结果用 `bigint`，用 xxHash 官方测试向量校验（§4.6）
- [ ] `ringHashBalancer`：条目数与上限、序号与哈希输入、排序与查找、缺 `hashKey` 时随机、按候选内容缓存，带 `outlierDetection` 选项（§4.6、§7）
- [ ] `RequestOptions.hashKey`，`snapshot()` 按字段复制（§3.2）
- [ ] `EndpointPickInfo.hashKey`，三种传输每次 `pick` 都带上（§6.1）

### 3.2 测试

- [ ] 回归表中「期」为「三」的 1 条，以及 `XXH64` 测试向量
- [ ] `packages/core/src/client/operation.type.test.ts` 的 `keyof RequestOptions` 加 `"hashKey"`
- [ ] 覆盖率保持 100%

### 3.3 文档（§9.2「第三期」）

- [ ] 1 个新导出追加到 `api-order.ts`，`extract-api`，URL 数改为 220，目录条数改为 181
- [ ] 改掉「`RequestOptions` 有七个字段」与「某个传输只读其中几个字段」的说法，覆盖规格列出的全部位置：`client.ts` 的 TSDoc、`design.md`、`packages/core/README.md`、`skills/defjs/references/client.md`，以及 11 个语言的 `api/client.mdx`、`docs/client.mdx`（三处）、`api/http.mdx`、`api/sse.mdx`、`api/web-socket.mdx`
- [ ] 指南补上环哈希，11 个语言同步

### 3.4 收尾

- [ ] 六道闸门、Claude 审查与独立重跑
- [ ] 授权：提交第三期（`feat(core):`）

## 4. 发布（§9.3，全部需要授权）

- [ ] 授权：决定发布时机，是三期完成后一次发布，还是第一期后先发
- [ ] Core 版本改为 0.7.0
- [ ] React、Vue 只放宽 peer 范围（例如 `^0.6.0 || ^0.7.0`）并改版本号
- [ ] OpenTelemetry 放宽 peer 范围并改版本号
- [ ] 每个包的 `bun test/assert-pack.ts <publish-dir>` 通过
- [ ] 确认目标提交上 CI 通过
- [ ] 授权：运行 Release workflow
- [ ] 确认发布成功后，为每个包在发布用的提交上打轻量标签，例如 `core@0.7.0`、`react@0.0.4`
- [ ] 授权：推送标签（`git push origin refs/tags/<tag>`），并核对远端标签指向发布用的提交
