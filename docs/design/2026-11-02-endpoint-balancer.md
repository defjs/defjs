# Defjs 端点负载均衡设计

- 日期：2026-11-02。
- 状态：第八稿修订十八，第一期至第二期丙已实现待提交，正在实施第二期丁。第 2.4 节的决定已于 2026-11-03 确认，覆盖本稿中与之冲突的全部条文，包括第 2.3 节第 7 条与第 5 节的大部分内容。第 2.3 节的决定已于 2026-11-03 确认，它们覆盖本稿中与之冲突的条文，细节见 `docs/design/2026-11-03-endpoint-balancer-phase2-redesign.md`。第 2 节的全部决定已于 2026-11-02 确认。修订过程见第 12.2 节。生产实现尚未变更。
- 基线：`main@ed1763e8`，`@defjs/core` 0.6.0。
- 交付范围：本设计稿。不修改生产实现、不提交、不发布、不改用户文档。
- 证据：仓库源码、业界一手资料、`/tmp/lbexp` 下的三份实测报告、一份 Go 库调研，以及 `/tmp/lbexp/review/` 下十一轮审查报告。第 12 节汇总实测与审查，第 13 节列出来源与未核对项。
- 本文描述目标 API，不表示当前已发布的实现已经支持。

## 1. 目标、范围与分层

产品方向：

1. 默认均衡器保持简单，不带健康逻辑。
2. 内置均衡器做成可配置的完整实现，使用者按需配置，不需要自己组合。
3. 内置的不够用时，使用者传入自己的均衡器。

业界把这件事分成三层，本稿照此分层：

| 层       | 职责                       | 业界对应                                                                  | 本稿                                                     |
| -------- | -------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------- |
| 选台策略 | 在候选端点里挑一台         | gRPC 的 `pick_first`、`round_robin`，Kratos 的 `selector`，tower 的 `p2c` | 第 4 节                                                  |
| 健康过滤 | 把不健康的端点从候选里拿掉 | gRFC A50 的 `outlier_detection`，Envoy 的离群剔除                         | 第 5 节，每个内置工厂的选项，也可包装自定义均衡器        |
| 重试     | 失败后换台再试             | go-kit 的 `lb.Retry`、gRPC 重试                                           | 不在本功能内。只有仍在归因的那条连接，每次重连才重新选台 |

不做的事见第 11 节。

## 2. 决定

### 2.1 已确认

| #   | 决定                                                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `withEndpoint(...endpoints: string[])`。零个参数在类型上合法                                                                             |
| 2   | 配置里的端点从 `string` 改为 `readonly string[]`，这是破坏性类型变更                                                                     |
| 3   | 没有显式选择均衡器时，默认是 pick_first                                                                                                  |
| 4   | 同一次 HTTP 调用选定一台之后不再换台，换台发生在下一次 `pick`，这不是重试。SSE 与 WebSocket 的例外见决定 B                               |
| 5   | 其余策略与自定义均衡器都通过 `withEndpointBalancer` 显式选用                                                                             |
| 6   | 被动健康检查内置；主动健康检查由调用方实现，通过回调接入；服务发现与熔断不做                                                             |
| B   | 只有仍在归因的那条连接，每次重连才重新选台。SSE 只算第一次 `next()` 打开的流；基址被拦截器换掉之后，SSE 与 WebSocket 的重连都不再 `pick` |

### 2.2 第六稿决定（2026-11-02 已确认）

字母沿用前几稿的编号。

| 项  | 决定                                                                                                                        | 依据                                                                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| A   | 命名对齐业界：`pickFirst`、`roundRobin`、`p2c`、`ringHash`、`done`、`hashKey`                                               | gRPC、Kratos、tower                                                                            |
| C   | 环哈希缺 `hashKey` 时随机选台，不失败                                                                                       | gRFC A42                                                                                       |
| D   | 权重表以端点字符串为键                                                                                                      | Kratos `wrr`                                                                                   |
| E   | pick_first 只在 `NET_UNREACHABLE` 时换台                                                                                    | gRPC pick_first 只看连接状态，不看 RPC 结果；`fetch` 看不到连接，只能用 `NET_UNREACHABLE` 近似 |
| F   | 初始选台在构建请求之前；`pick` 成功后，每个出口都恰好调用一次 `done`                                                        | 实测 C1：三种传输都在拦截器之前校验基址                                                        |
| G   | `done` 的结果只取自到达所选端点的传输尝试，不取自最终元组                                                                   | 实测 C2：合成响应可以复制出同值元组                                                            |
| H   | 配置字段从 `endpoint` 改名为 `endpoints`。本稿正文按改名后书写                                                              | 类型已经破坏，改名不增加迁移成本                                                               |
| I   | 新导出全部用 `@group client`，不新增概览页                                                                                  | AGENTS.md：每个语言只保留 11 个概览页                                                          |
| J   | 分三期交付，见第 10 节                                                                                                      | 挂接点风险最大，先落地                                                                         |
| K   | Core 升到 0.7.0，三个插件只放宽 peer 范围并各发一版                                                                         | 插件的 peer 范围是 `^0.6.0`                                                                    |
| L   | 内置四个工厂：`pickFirstBalancer`、`roundRobinBalancer`、`p2cBalancer`、`ringHashBalancer`                                  | 第 4.1 节的评估                                                                                |
| M   | 随机不内置                                                                                                                  | 与起点随机的轮询效果相同                                                                       |
| N   | 最少请求并入 p2c 的 `load: "pending"`                                                                                       | tower 把它作为 p2c 的一种负载度量                                                              |
| O   | 加权轮询并入 `roundRobinBalancer` 的 `weights`                                                                              | 少一个工厂，算法不变                                                                           |
| P   | 健康过滤是每个内置工厂的 `outlierDetection` 选项；包装函数只给自定义均衡器                                                  | 使用者按需配置                                                                                 |
| Q   | `pickFirstBalancer` 提供 `failback`                                                                                         | 浏览器主备需要自动回切                                                                         |
| R   | 选台信息带 `transport`                                                                                                      | p2c 必须区分延迟与会话时长                                                                     |
| S   | `done` 的结果区分三种情况：未发出尝试、传输故障、对端已应答。修订一改用 `attempted` 字段表达                                | 实测 A7：只靠 `code` 缺省会把成功排除出统计，失败率算成 100%                                   |
| T   | p2c 的默认延迟是初始估计，并参与衰减                                                                                        | 实测 A5：固定默认值会饿死未采样端点；tower 源码                                                |
| U   | 主动检查只排除端点，不提前解除被动摘除                                                                                      | 实测 A8；缓存的布尔快照不代表一次新的成功探测                                                  |
| V   | 清算锚定在固定时间网格上，错过的清算点按算术补算                                                                            | 实测 A7：懒清算的时刻依赖流量，摘除时长随之变化                                                |
| W   | `isHealthy` 返回值不是布尔值时，`pick` 返回选项错误，调用得到 `REQ_OPTIONS_INVALID`；`isFailure` 返回非布尔值时，样本不计入 | 实测 A8：返回 Promise 会被当成真值                                                             |
| X   | p2c 把失败结果记为惩罚样本                                                                                                  | 快速失败的端点延迟很小，不惩罚会吸走流量                                                       |
| Y   | 保留现有的单项 URL 基址缓存                                                                                                 | 实测 C8：轮换开销约 0.47 µs，约为一次本地 HTTP 调用的 0.63%                                    |

修订一（Go 风味审查）新增，2026-11-02 已确认：

| 项  | 决定                                                                               | 依据                                                                        |
| --- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Z1  | `pick` 返回错误优先元组，不抛出                                                    | gRPC `Pick` 返回 `(PickResult, error)`；仓库内部的 `StageOutcome`           |
| Z2  | 工厂从不抛出；非法选项在执行时报告为 `REQ_OPTIONS_INVALID`                         | 重连、心跳选项的现有做法                                                    |
| Z3  | 新增哨兵错误 `ERR_NO_ENDPOINT`                                                     | gRPC `ErrNoSubConnAvailable`、Kratos `ErrNoAvailable`；仓库的 `ERR_ABORTED` |
| Z4  | 类型改名为 `EndpointPickInfo`、`EndpointPickResult`、`EndpointDoneInfo`            | 对齐 gRPC 的 `PickInfo`、`PickResult`、`DoneInfo`                           |
| Z5  | `EndpointDoneInfo` 用扁平结构 `{ attempted, code?, status? }` 取代带 `type` 的联合 | gRPC `DoneInfo` 是扁平结构；回调写起来更直接                                |
| Z6  | `done` 可以省略                                                                    | gRPC `PickResult.Done` 可以为 nil                                           |
| Z7  | `EndpointPickInfo` 带 `operation`                                                  | gRPC `PickInfo.FullMethodName`                                              |

### 2.3 第七稿决定（2026-11-03 已确认）

依据五个领域的现场验证，汇总在 `/tmp/lbexp/field/SUMMARY.md`。提案全文见 `docs/design/2026-11-03-endpoint-balancer-phase2-redesign.md`，下列决定与本稿其他条文冲突时，以这里为准：

1. 推翻第 11 节「同一次 HTTP 调用里换一台再试」的不做条款，新增 `withEndpointFailover`（提案 P1）。
2. `withEndpointFailover` 默认启用：只对 RFC 9110 的安全方法、只在连接失败时、最多额外一次。
3. `roundRobinBalancer` 与 `p2cBalancer` 默认启用健康过滤，`outlierDetection: false` 关闭（提案 P6）。
4. `pickFirstBalancer` 的前进条件加入状态码 502、503、504（提案 P2）。
5. 用 `failbackMs` 取代第 4.3 节必须配合健康过滤的 `failback: true`（提案 P5）。
6. 分期改为二甲、二乙、三：二甲是 P1 至 P5 与 P7 的 `durationMs`；二乙是健康过滤、P6 与 `p2cBalancer`；三照原计划。
7. （2026-11-03 第二次确认）摘除到期后先半开试探，再可选慢启动，推翻第 11 节「慢启动」的不做条款。细节见 `docs/design/2026-11-03-endpoint-balancer-phase2c.md`。
8. （2026-11-03 第二次确认）`p2cBalancer` 的在途数从传输层开始尝试时起算，不再从 `pick` 起算。为此 `EndpointPickResult` 增加可选的 `start` 回调。
9. 分期增加二丙：第 7、8 条。

### 2.4 第八稿决定（2026-11-03 已确认）

依据与成熟开源实现的源码对照，提案全文见 `docs/design/2026-11-03-endpoint-balancer-oss-alignment.md`。Defjs 是客户端负载均衡，以 Linkerd 的熔断模型与 tower 的负载生命周期为主线，Finagle 补充。下列决定与本稿其他条文冲突时，以这里为准：

1. 健康过滤改用 Linkerd 的连续失败熔断：连续失败 5 次后熔断，惩罚 1 秒起、每次翻倍、上限 60 秒、正向抖动 0.5，试探成功后重置。
2. 删除摘除名额、「保留最后一台」、清算网格、倍数衰减与失败百分比判据。第 5.4 至 5.6 节与第 5.8 节作废。
3. 熔断期满后只放行一次试探。删除 `probeTimeoutMs` 与 `halfOpen` 选项；试探在传输层拿到响应时判定，出处为 Finagle。
4. 删除慢启动。第 2.3 节第 7 条中的慢启动部分作废，第 11 节恢复「慢启动」不做。
5. `EndpointPickResult` 新增 `end` 回调，在传输层拿到响应或在此之前失败时调用。p2c 在 `end` 时释放在途数并记 RTT，`done` 只承载健康结果。删除 `EndpointDoneInfo.durationMs`。p2c 默认 RTT 改为 30ms，删除失败惩罚与 p2c 的 `isFailure` 选项。出处为 tower `CompleteOnResponse` 与 Linkerd 的分类通道。
6. 同一次调用内换台加上重试预算，语义照 Finagle `RetryBudget`：默认 20%，每秒至少 10 次，TTL 10 秒。
7. 分期增加二丁：以上第 1 至 6 条。

## 3. 公开 API

### 3.1 类型

```ts
// client/option.ts
export function withEndpoint(...endpoints: string[]): ClientOption;
export function withEndpointBalancer(balancer: EndpointBalancer): ClientOption;

// balancer/types.ts
export interface EndpointBalancer {
  pick(info: EndpointPickInfo): EndpointPickOutcome;
}

/** 错误优先，与操作结果和内部 StageOutcome 的顺序一致。 */
export type EndpointPickOutcome =
  | readonly [err: Error, result: undefined]
  | readonly [err: null, result: EndpointPickResult];

export type EndpointTransport = "http" | "sse" | "websocket";

export interface EndpointPickInfo {
  /** 候选端点，可能为空；运行时已按首次出现去重；不得修改。为空时必须返回 [ERR_NO_ENDPOINT, undefined]。 */
  readonly endpoints: readonly string[];
  readonly transport: EndpointTransport;
  /** 定义里的 operation，对应 gRPC PickInfo.FullMethodName。 */
  readonly operation?: string;
  /** 第三期加入，只有环哈希读取。 */
  readonly hashKey?: string;
}

export interface EndpointPickResult {
  readonly endpoint: string;
  /** 可以省略。提供时，运行时对这次选台恰好调用一次。 */
  readonly done?: (info: EndpointDoneInfo) => void;
}

export type EndpointFaultCode =
  "NET_UNREACHABLE" | "NET_TIMEOUT" | "NET_BODY_INCOMPLETE";

export interface EndpointDoneInfo {
  /** 是否有传输尝试到达所选端点。为 false 时 code 与 status 都缺省，不计入任何统计。 */
  readonly attempted: boolean;
  /** 传输故障码。attempted 为 true 而 code 缺省，表示对端已应答。 */
  readonly code?: EndpointFaultCode;
  /** 对端返回的状态码。WebSocket 握手成功时缺省。 */
  readonly status?: number;
}

/** 候选为空。对应 gRPC 的 ErrNoSubConnAvailable 与 Kratos 的 ErrNoAvailable。 */
export declare const ERR_NO_ENDPOINT: Error;

/** 跨 Core 副本识别 ERR_NO_ENDPOINT，做法与 isAbortCause 相同。 */
export declare function isNoEndpointCause(cause: unknown): boolean;

export function pickFirstBalancer(options?: {
  readonly shuffle?: boolean;
  readonly failback?: boolean;
  readonly outlierDetection?: OutlierDetectionOptions;
}): EndpointBalancer;

export function roundRobinBalancer(options?: {
  readonly weights?: ReadonlyMap<string, number>;
  readonly outlierDetection?: OutlierDetectionOptions;
}): EndpointBalancer;

export function p2cBalancer(options?: {
  readonly load?: "peakEwma" | "pending";
  readonly choiceCount?: number;
  readonly defaultRttMs?: number;
  readonly decayMs?: number;
  readonly isFailure?: (info: EndpointDoneInfo) => boolean;
  readonly outlierDetection?: OutlierDetectionOptions;
}): EndpointBalancer;

export function ringHashBalancer(options?: {
  readonly minRingSize?: number;
  readonly maxRingSize?: number;
  readonly outlierDetection?: OutlierDetectionOptions;
}): EndpointBalancer;

/** 给自定义均衡器加上与内置工厂相同的健康过滤。 */
export function outlierDetection(
  child: EndpointBalancer,
  options?: OutlierDetectionOptions,
): EndpointBalancer;

export interface OutlierDetectionOptions {
  readonly intervalMs?: number;
  readonly baseEjectionMs?: number;
  readonly maxEjectionMs?: number;
  readonly maxEjectionPercent?: number;
  readonly consecutiveFailures?: number;
  readonly failurePercentage?: {
    readonly threshold?: number;
    readonly minimumHosts?: number;
    readonly requestVolume?: number;
  };
  readonly isFailure?: (info: EndpointDoneInfo) => boolean;
  readonly isHealthy?: (endpoint: string) => boolean;
}
```

一个最小的自定义均衡器：

```ts
const fixed: EndpointBalancer = {
  pick: ({ endpoints }) => {
    const endpoint = endpoints[0];
    return endpoint === undefined
      ? [ERR_NO_ENDPOINT, undefined]
      : [null, { endpoint }];
  },
};
```

### 3.2 配置与请求上的变化

- `ClientOptions.endpoints` 与 `ClientConfig.endpoints` 是 `readonly string[]`，取代原来的 `endpoint: string`。
- `ClientConfig.endpointBalancer: EndpointBalancer`。`createClientConfig()` 为每个客户端放一个新的 `pickFirstBalancer()`。
- `HttpRequest.baseEndpoint` 保持 `string`，含义从「客户端端点」改为「本次选中的端点」。拦截器看不见候选列表。
- `RequestOptions.hashKey?: string` 在第三期加入。`client(options)` 的 `snapshot()` 按字段复制它。三种传输的每一次 `pick` 都把它放进 `EndpointPickInfo`，见第 6.1 节。

### 3.3 接口约定

- `withEndpoint` 把参数复制进新数组，按首次出现的顺序去掉完全相同的字符串，写入 `config.endpoints`。它不校验 URL，也不替换均衡器。后写的 `withEndpoint` 覆盖列表，不合并。
- `withEndpointBalancer` 整体替换均衡器，保留对象引用，不复制。这符合 AGENTS.md「保留带身份的值」的规则。
- 每个工厂每次调用返回新实例，并在构造时复制自己的选项。工厂从不抛出。非法选项在构造时记下，之后每次 `pick` 都返回这个错误，运行时把它报告为 `REQ_OPTIONS_INVALID`。这与重连、心跳选项在执行时返回 `REQ_OPTIONS_INVALID` 的现有做法一致。内置工厂的选项错误带一个不导出的内部品牌，运行时据此区分。
- 运行时处理 `pick` 的结果：
  1. 返回 `[Error, undefined]`：错误带选项错误的内部品牌时，调用得到 `REQ_OPTIONS_INVALID`；其余错误，包括 `ERR_NO_ENDPOINT`，得到 `REQ_BUILD_FAILED`。错误原样作为 `cause`。候选为空时的故障码与今天缺端点相同。
  2. `pick` 抛出：与 builder 抛出相同，用 `createPreflightFault("REQ_BUILD_FAILED", cause)` 收成故障，`cause` 是抛出的值，不必是 `Error`。
  3. 返回值既不是 `[Error, undefined]`，也不是 `[null, { endpoint: string, done?: function }]`：同样收成 `REQ_BUILD_FAILED`，`cause` 就是这个返回值本身，不另造 `TypeError`。
  4. 读取或校验返回值时抛出，包括数组下标、`endpoint`、`done` 的 getter 与 Proxy 的拦截器：同样收成 `REQ_BUILD_FAILED`，`cause` 是抛出的值。每个字段只读一次，之后只用这份快照，避免校验通过后再读到不同的值（现场验证 B1）。
  5. 以上情况调用点都不抛，也都不调用 `done`。
- `ERR_NO_ENDPOINT` 带 `Symbol.for("defjs.cause.no-endpoint")` 品牌，`isNoEndpointCause(cause)` 跨 Core 副本识别它，做法与 `ERR_ABORTED` 和 `isAbortCause` 相同。它只作为 `cause` 出现，不新增 `FaultCode`。
- `done` 可以省略，省略时运行时不记录这次选台的结果。只有不带健康过滤的 `roundRobinBalancer` 省略它，每次调用少一次闭包分配。`pickFirstBalancer` 每次 `pick` 都返回 `done`，包括默认实例，因为它靠 `done` 收到的结果换台。有健康过滤时，同一个 `done` 先交给过滤层记账，再转给内层。
- `pick` 与 `done` 必须同步。运行时不等待它们的返回值。返回值是 thenable 时，运行时在 `try` 里读取它的 `then`，以 `then(undefined, noop)` 接住拒绝并忽略，避免未处理的拒绝终止进程；`pick` 返回 thenable 仍按第 3 条收成 `REQ_BUILD_FAILED`。严格 TypeScript 允许把 `async` 函数赋给返回 `void` 的 `done`，所以这条不能只靠类型保证（现场验证 B2）。`done` 抛出时，运行时吞掉异常，不替换已经产生的操作元组。这与 `onInvalidEvent` 抛出不关闭流的既有做法一致。
- 内置工厂的 `outlierDetection` 选项与 `outlierDetection(内置均衡器, 选项)` 等价。传 `{}` 表示按默认判据启用，省略表示不做健康过滤。
- 自定义均衡器是实现 `EndpointBalancer` 的普通对象，不需要类或继承。

### 3.4 Go 风味对照

借鉴的是 Go 的设计习惯，不是它的语法形态。`docs/research/2026-10-31-api-paradigms.md` 第 5 节已经定下这个立场。

| Go 习惯                  | 出处                                                  | 本稿                                                                                            |
| ------------------------ | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 小接口，一个方法         | `net/http.RoundTripper`、gRPC `Picker`                | `EndpointBalancer` 只有 `pick`                                                                  |
| 错误是返回值             | gRPC `Pick(info) (PickResult, error)`                 | `pick` 返回错误优先元组；工厂从不抛出                                                           |
| 哨兵错误                 | gRPC `ErrNoSubConnAvailable`、Kratos `ErrNoAvailable` | `ERR_NO_ENDPOINT` 与 `isNoEndpointCause`，与 `ERR_ABORTED`、`isAbortCause` 同一品牌机制         |
| 回调可以为 nil           | gRPC `PickResult.Done`                                | `done` 可以省略                                                                                 |
| 扁平结构，零值有意义     | gRPC `DoneInfo`                                       | `EndpointDoneInfo` 的 `attempted`、`code`、`status`                                             |
| 选台信息带方法名         | gRPC `PickInfo.FullMethodName`                        | `EndpointPickInfo.operation`                                                                    |
| `defer` 保证收尾         | Go 语言                                               | 每个出口都保证 `done` 恰好一次；长连接的 `done` 归传输层，见第 6.1 节                           |
| `recover` 兜底           | `net/http` 对 handler panic 的处理                    | `pick` 违约抛出或返回非法结果时，与 builder 抛出相同，收成 `REQ_BUILD_FAILED`，`cause` 原样保留 |
| 零值可用的配置结构体     | `tls.Config`、`http.Transport`                        | 选项对象，每个字段都可省略，省略即默认值                                                        |
| 装饰器式组合             | `func(http.Handler) http.Handler`                     | `outlierDetection(child, options)`                                                              |
| 库不在背后启动常驻任务   | Go 社区约定：有后台任务的类型要提供 `Close`           | 不创建计时器；主动探测归调用方                                                                  |
| 取消显式传播，不放进配置 | `context`                                             | `AbortSignal` 由调用方随调用传入，不放进均衡器                                                  |

有意不照搬的形态，理由同上述研究：

- 返回顺序保持错误优先。操作结果已经是 `[error, ...]`，均衡器不另起一种顺序。
- 不为每个字段提供 `with*` 函数选项。固定的标量配置用对象表达；函数选项只用于客户端这一层的组合，例如 `withEndpoint` 与 `withEndpointBalancer`。
- 不引入 `context` 那样的值袋。`pick` 同步、不做 I/O，不需要取消信号。
- 不能用包名限定构造函数，例如 `p2c.New()`，因为仓库禁止命名空间导入。工厂名自带算法名，例如 `p2cBalancer()`。

## 4. 选台策略

### 4.1 评估：内置哪些算法

评估依据是 Defjs 自己的条件：

- **可用信号。** 客户端知道每次尝试的结果、从 `pick` 到 `done` 的耗时、本客户端各端点的在途数。拿不到后端负载上报、连接状态、服务发现结果和机房位置。
- **运行环境。** 浏览器并发低，端点通常是两三个区域或镜像，对包体积敏感。Node 与 Bun 服务端做服务间调用，并发高。Worker 介于两者之间。
- **端点数量。** 静态列表，通常 2 到 10 台。
- **包体积。** 每个算法单独导出。`@defjs/core` 已经声明 `sideEffects: false`。实测 A9 中，只导入 `pickFirstBalancer` 的产物是 2620 B，按策略名选择的单一入口是 8556 B。所以不提供按字符串选算法的入口。

| 算法                           | 业界                                                       | 场景                     | 结论                                |
| ------------------------------ | ---------------------------------------------------------- | ------------------------ | ----------------------------------- |
| pick_first（有序粘滞故障转移） | gRPC 默认策略、gRFC A62；名称相同，行为不等价，见第 4.3 节 | 主备、多区域主备         | 内置，默认                          |
| 轮询与平滑加权                 | grpc-go `round_robin`、Kratos `wrr`                        | 均分或按容量分流         | 内置，合为一个工厂                  |
| 随机                           | Kratos `random`                                            | 与起点随机的轮询效果相同 | 不内置                              |
| 最少请求                       | gRFC A48                                                   | 后端处理时间差异大       | 并入 p2c 的 `load: "pending"`       |
| p2c + Peak-EWMA                | Kratos `p2c`、tower `p2c` 与 `PeakEwma`                    | 自动避开慢端点与过载端点 | 内置，自适应的首选                  |
| 环哈希                         | gRFC A42、Envoy                                            | 按键固定到同一台         | 内置，第三期                        |
| Maglev                         | Envoy                                                      | L4 大规模查找表          | 不做                                |
| ORCA 加权轮询                  | gRFC A58                                                   | 依赖后端上报负载         | 不做，没有信号                      |
| 区域感知                       | Envoy locality                                             | 依赖机房位置             | 不做，调用方排好顺序后用 pick_first |
| 子集划分                       | gRPC、Kratos `subsetSize`                                  | 后端成千上万台           | 不做                                |
| 慢启动                         | Envoy                                                      | 依赖服务发现             | 不做，列表是静态的                  |

### 4.2 共同规则

- `info.endpoints` 为空时，`pick` 返回 `[ERR_NO_ENDPOINT, undefined]`。运行时报告 `REQ_BUILD_FAILED`，与今天缺端点的故障码相同。
- 均衡器不得修改 `info.endpoints`。
- 状态以端点字符串为键，不以下标为键，所以候选列表变短或变长都不会越界。
- 随机数用 `Math.random`。这里的随机只为分散流量，不涉及安全，不使用 Web Crypto 或 `node:crypto`。
- 时间用 `Date.now()`，与仓库假时钟测试的约定一致。两次读数之差为负时按 0 处理。

### 4.3 `pickFirstBalancer`

只配置 `withEndpoint`、不配置 `withEndpointBalancer` 时，客户端使用 `createClientConfig()` 放好的 `pickFirstBalancer()`，没有任何选项，也不带健康过滤：

- 一个端点：每次都用它，行为与今天的单端点客户端相同。
- 多个端点：一直用第一台；只有某次调用以 `NET_UNREACHABLE` 结束，下一次调用才换到下一台。5xx、超时与读响应体中断都不换台。同一次调用不会换台再试。
- 零个端点：调用得到 `REQ_BUILD_FAILED`，`cause` 是 `ERR_NO_ENDPOINT`。
- 每个客户端各有一个默认实例，不与其他客户端共享状态。
- 只配置 `withEndpointBalancer`、不配置 `withEndpoint` 时，候选为空，同样得到 `REQ_BUILD_FAILED`。

默认模式是有序粘滞故障转移：按列表顺序使用一台，成功后一直粘住它，它连不上时下一次调用换到下一台。名称沿用 gRPC 的 pick_first，但行为不等价，差别见本节末尾。状态是「当前粘住的端点字符串」。

- `pick`：先确定这次的顺序 `order`，即候选的配置顺序；开启 `shuffle` 时按排序键重排。若尚无粘住的端点，或它不在 `order` 里，先把粘住的端点写成 `order` 的第一项，再返回它。`done` 闭包捕获这次的 `order` 与返回的端点。
- `done` 收到 `{ attempted: true, code: "NET_UNREACHABLE" }`，并且此刻粘住的端点仍是这次返回的端点，才把粘住的端点改成闭包里 `order` 的下一项，到末尾回到第一项。粘住的端点已经变过，说明别的调用先处理过了，这次不再前进。所以重叠调用一起失败时只前进一台，也不会跳过中间那台。
- 其余结果都不前进，包括 5xx、`NET_TIMEOUT`、`NET_BODY_INCOMPLETE` 与 `attempted: false`。

选项：

- `shuffle: true` 时，每个端点第一次出现时随机取一个排序键，粘滞顺序先按该键排序。排序键按端点保存，候选被健康过滤缩短后顺序仍然稳定。它只作用于粘滞模式，不影响 `failback`。默认 `false`，与 gRFC A62 一致。
- `failback: true` 时不粘滞，每次都按配置顺序返回候选第一项，不参与 `shuffle`，`done` 也不改粘住的端点。主端点被摘除时，候选里没有它，流量落到下一台。摘除到期后它回到候选第一位，流量自动切回。没有健康过滤时，`failback` 等于永远只打第一台，所以必须同时配置 `outlierDetection`，否则这是一个选项错误，调用得到 `REQ_OPTIONS_INVALID`。默认 `false`。
- `failback` 的默认成本：同一端点连续失败 5 次才被摘除，摘除 30 秒；主端点恢复后不会立即切回，要等摘除到期后的下一次调用。实测 D1 中，从主端点恢复到切回约 30 秒，期间调用都打到备用端点。

主备加自动回切：

```ts
const client = createClient(
  withEndpoint("https://api-us.example.com", "https://api-eu.example.com"),
  withEndpointBalancer(
    pickFirstBalancer({
      failback: true,
      outlierDetection: { consecutiveFailures: 3 },
    }),
  ),
);
```

与 grpc-go pick_first 的差别，依据 `/tmp/lbexp/golib/REPORT.md` 核实的 grpc-go 源码：

| 方面               | grpc-go pick_first                                                                                                                                                 | Defjs `pickFirstBalancer`                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| 换址发生在哪一层   | 连接层。发送业务请求之前按顺序建连；前一个连接尝试还在等待时，约 250ms 后并行启动下一个地址（Happy Eyeballs）；连接被明确拒绝时立即尝试下一个；第一个 Ready 的胜出 | 调用层。`fetch` 看不到连接状态，这次调用以 `NET_UNREACHABLE` 失败，下一次调用才换台                                         |
| 主端点故障时的代价 | 连接建立前就在等待的 RPC，可以在同一个 RPC 里换址成功。已分配到连接的 RPC 在连接突然断开时仍会失败，`WaitForReady` 也不保证（实测 D6）                             | 故障后至少有一次调用失败；尚未完成的在途调用可能一并失败，强制断连时实测 32 个全部失败（至少一次见实测 D1，32 个见实测 D2） |
| 断开后从哪里开始   | 回到 Idle，下次从列表头重新尝试                                                                                                                                    | 移到下一台，不回列表头。要回到主端点，用 `failback`                                                                         |
| 是否重放请求       | 不重放已发出的业务请求，只有透明重试                                                                                                                               | 不重放。浏览器的网络错误不能证明请求没有送达，POST 等请求重放可能产生副作用                                                 |

`failback` 借用 Envoy 优先级「总是选可用的最高优先级」的思路。

选型建议：

- **浏览器的区域主备**，端点通常是两三个有顺序的区域：用默认的 pick_first；需要自动切回主区域时，用 `failback` 加 `outlierDetection`。轮询会把流量分到远端区域，改变「主、备」的含义。
- **服务端的同级副本池**：显式选 `roundRobinBalancer`，延迟差异大时选 `p2cBalancer`。长期运行的客户端用 pick_first，会把流量集中到一台。Kratos 默认平滑加权轮询，etcd 客户端默认轮询，都是这个场景。

业界默认值并不统一：grpc-go 默认 pick_first，Kratos 默认平滑加权轮询，go-zero 默认 p2c_ewma，Dubbo-go 默认加权随机加失败重试，etcd 客户端默认轮询，go-kit 要求调用方自己选。默认取 pick_first，依据的是 Defjs 浏览器场景的端点语义，不是业界的多数。

实测 A1、A2 证实了上述行为，包括重叠调用只前进一次，以及摘除到期后的下一次调用切回主端点。

### 4.4 `roundRobinBalancer`

- 没有 `weights` 时，用一个计数器，构造时取随机起点，`pick` 返回第 `counter % 候选数` 项，然后计数器加一。计数器按 2^32 取模，避免浮点精度问题。起点随机与 grpc-go 一致，许多标签页各建一个客户端时不会都先打第一台。
- 有 `weights` 时，用 nginx 平滑加权，与 Kratos `wrr` 相同：每台的当前值加上它的权重，选当前值最大的那台，再把它的当前值减去所有候选的总权重。当前值相同时，取候选里靠前的那台。候选变化时，删除不在候选里的当前值。
- 不在权重表里的端点，权重为 1。权重表里有、但不在候选里的端点被忽略。
- `done` 只转发给健康过滤。

例：权重 `a: 2`、`b: 1`，序列是 `a, b, a` 循环。每个周期里 `a` 两次、`b` 一次，周期交界处会出现相邻的 `a`。实测 A3 在长期运行中得到 2:1 的比例。

### 4.5 `p2cBalancer`

p2c 是 power of two choices：随机抽几台，选负载最低的那台。抽样方式取 Kratos，负载度量取 tower。

每个端点的状态：在途数 `pending`、延迟估计 `rttMs`、上次更新时刻 `updatedAt`。端点第一次出现在候选里时创建状态，`rttMs` 取 `defaultRttMs`，`updatedAt` 取当前时间。

`pick`：

1. 候选只有一台时不抽样，直接选它。
2. 否则无放回地随机抽 `min(choiceCount, 候选数)` 台，取负载最低的。负载相同时，先抽到的赢。A48 是有放回抽样，同一台可能抽到两次，比较就白做了，所以本稿采用 Kratos 的无放回做法。
3. 无论候选有几台，被选中端点的 `pending` 都加一。开始时刻 `Date.now()` 只存在这次的 `done` 闭包里，不写进端点状态，所以重叠调用互不覆盖。

负载：

- `load: "pending"`：负载就是 `pending`，对应 tower 的 `PendingRequests`。
- `load: "peakEwma"`，默认值：负载是 `rttMs × (pending + 1)`，对应 tower 的 `PeakEwma`。读取负载前，先按距 `updatedAt` 的时间把估计向 0 衰减：`rttMs = rttMs × e^(−Δt/decayMs)`，并更新 `updatedAt`。tower 也是这样，用一个零时长样本实现。因为默认值同样参与衰减，从未被选中的端点会慢慢变便宜，最终被抽中并拿到第一个真实样本。

`done`：

1. `pending` 减一，不低于 0。所有结果类型都减。
2. 只有 `transport` 为 `"http"` 时才更新延迟。SSE 与 WebSocket 的 `done` 在这一次连接尝试结束时才到，那段耗时是会话时长，不是延迟。所以长连接只计在途数，这时 p2c 在抽样集合里做最少连接。
3. `attempted` 为 `false` 时不产生样本。
4. 其余结果的样本值是 `max(0, 现在 − 闭包里的开始时刻)`。如果 `isFailure(info)` 为真，样本值取 `max(耗时, defaultRttMs)`。这是惩罚样本：连接被拒绝的端点几毫秒就失败，不惩罚的话它会显得最快，把流量吸过去。`isFailure` 返回非布尔值或抛出时，按非失败处理，不加惩罚。
5. 更新规则照 tower：样本大于当前估计时直接取样本，这就是「峰值」；否则 `rttMs = rttMs × d + 样本 × (1 − d)`，其中 `d = e^(−Δt/decayMs)`。然后更新 `updatedAt`。

`isFailure` 的默认判据与健康过滤相同，见第 5.2 节。

内存上限：状态条目超过 256 个时，删除当前不在候选里、并且 `pending` 为 0 的条目。静态列表永远到不了这个上限。这条只防止自定义包装层不断传入新端点字符串。

可以承诺的行为：

- p2c 偏向负载低的端点，但不保证总选最快的那台。三个候选抽两台时，最快的那台有 1/3 的概率不在样本里。
- 浏览器里在途数多半是 0，p2c 实际上按延迟选台，偏向最快的区域。
- 它是抽样集合内的最少连接，只有 `choiceCount` 不小于候选数时，才等于全局最少连接。

实测 A4、A5，tower 语义，三台本地服务器，`a` 中途从最快变成 500ms：

| 场景            | `decayMs` | 变慢前（a / b / c） | 变慢后（a / b / c） |
| --------------- | --------- | ------------------- | ------------------- |
| 串行 180 次     | 10000     | 109 / 66 / 5        | 5 / 119 / 56        |
| 串行 180 次     | 600       | 109 / 63 / 8        | 32 / 114 / 34       |
| 64 并发 1536 次 | 10000     | 971 / 430 / 135     | 233 / 940 / 363     |
| 64 并发 1536 次 | 600       | 998 / 466 / 72      | 191 / 977 / 368     |

`decayMs` 默认取 10000。串行场景下，`a` 变慢后只有 2.8% 的调用还打到它，600 时是 17.8%。这是单个随机种子、本机网络的观察，不能证明 10000 普遍最优。

### 4.6 `ringHashBalancer`（第三期）

遵循 gRFC A42 的结构，下面的规则只约束 Defjs 自身：

- 设 `n` 为候选数，每个端点的条目数 `k = ceil(minRingSize / n)`。若 `n × k > maxRingSize`，取 `k = floor(maxRingSize / n)`。若 `k < 1`，这次 `pick` 返回 `RangeError` 选项错误，不建空环。
- 每个端点取序号 `0` 到 `k − 1`。条目的哈希输入是 `UTF-8(端点 + "_" + 十进制序号)`，哈希函数是 `XXH64`，种子 0，手写同步纯函数，结果用 `bigint` 表示无符号 64 位整数，用 xxHash 官方测试向量校验。
- 环按哈希升序排列；哈希相同时，按端点字符串升序，再按序号升序。
- 请求的哈希是 `XXH64(UTF-8(hashKey))`。查找取第一个哈希大于等于请求哈希的条目；请求哈希大于全部条目时取环首。空字符串也照常哈希。
- `hashKey` 为 `undefined` 时不查环，取候选下标 `Math.floor(Math.random() × n)`，不失败。
- 环按候选内容缓存最近一份。健康过滤使候选变化时重建一次，端点减少一台时，约 1/N 的键迁移。
- 条目哈希输入的格式没有与 Envoy 逐字节核对，所以不承诺与 Go 客户端选出同一台。

## 5. 健康过滤

### 5.1 形态

健康过滤是一个包装层：它先算出候选，再交给内层均衡器的 `pick`；`done` 也经过它，再转发给内层。内置工厂的 `outlierDetection` 选项与导出的 `outlierDetection(child, options)` 是同一份实现。

核心包不创建计时器。`Client` 没有 dispose 生命周期，后台计时器没有人负责关掉。所以清算在 `pick` 或 `done` 中按需进行，见第 5.4 节；主动探测由调用方负责，见第 5.7 节。

### 5.2 样本与失败

- `attempted` 为 `false` 的结果不是样本，不进入任何统计，也不影响连续失败计数。
- `attempted` 为 `true` 的结果是样本。样本是否算失败由 `isFailure(info)` 决定。
- 默认判据：有 `NET_TIMEOUT` 或 `NET_BODY_INCOMPLETE` 时不算失败；否则，`code` 为 `NET_UNREACHABLE` 或 `status` 不小于 500 时算失败。
- 调用方的 `AbortSignal.timeout` 也会产生 `NET_TIMEOUT`，计入失败会让调用方自己设的短截止时间摘掉健康端点。读响应体中断时可能带着 503 的状态码，先看故障码，避免把它当成 5xx。

把超时也算失败：

```ts
roundRobinBalancer({
  outlierDetection: {
    isFailure: (info) =>
      info.code === "NET_UNREACHABLE" ||
      info.code === "NET_TIMEOUT" ||
      (info.code === undefined && (info.status ?? 0) >= 500),
  },
});
```

第五稿只用「`code` 缺省」区分成功与不归因。实测 A7 中，950 次 200 加 50 次 `NET_UNREACHABLE` 的真实失败率是 5%，按第五稿统计却是 100%，端点被误摘。`attempted` 字段修正了这一点。

### 5.3 候选计算

1. 取 `endpoints.filter(isHealthy)`。没有配置 `isHealthy` 时全部算健康。
2. 去掉当前被摘除的端点。摘除到期的端点立即回到候选，不等清算。
3. 结果为空时，退一步只去掉被摘除的端点，不看 `isHealthy`；仍为空，就用这次 `pick` 收到的 `info.endpoints` 原文。宁可打到可能不健康的端点，也不让所有调用失败。兜底只在本次列表里进行，不掺入其他客户端留下状态的端点。
4. 候选与原列表相同时，直接传原数组；否则传新数组。`operation`、`hashKey` 与 `transport` 都原样转给内层。

### 5.4 清算网格

清算点是 `T_n = t0 + n × intervalMs`，`n` 从 1 起，`t0` 是工厂构造时的 `Date.now()`。均衡器记一个清算游标，表示已经处理到的最后一个清算点。端点的状态在它第一次出现在某次 `pick` 的列表里时创建，之后一直保留；健康过滤所说的「全部端点」，指均衡器里已有状态的全部端点，包括已经不在任何当前列表里的端点，按第一次出现的顺序排列。它用于名额、已摘除数、失败百分比的遍历顺序、「最后一个可用端点」，以及清算点上的窗口清空与倍数衰减；候选与兜底只用这次 `pick` 收到的列表，见第 5.3 节。本次调用才创建状态的端点，不参与这次补算里的失败百分比评估：端点总数、已摘除数、可用集合与遍历都不算它。补算结束后它立刻属于全部端点；同一次 `done` 里随后的连续失败摘除、名额计算，以及「只有一个端点时永远不摘除」，都算上它。

每次 `pick` 与 `done` 进入时，按这个顺序处理：

1. 给本次列表里还没有状态的端点创建状态，没有摘除，倍数为 0，窗口为空。
2. 处理游标之后所有 `T_n <= now` 的清算点，处理完把游标设到最后一个 `T_n <= now`。
3. 处理本次的选台或样本。

时间戳等于某个清算点的样本属于下一个窗口。处理清算点 `T` 时，判断端点是否在摘除期、计算已摘除数、判断「最后一个可用端点」，时钟都用 `T`：摘除结束时刻晚于 `T` 才算摘除中。

每个清算点 `T` 依次做两步，顺序照 gRFC A50：

1. 用上一个窗口的计数，按第 5.5 节对全部端点评估失败百分比判据。这里新摘除的端点，摘除结束时刻是 `T + 时长`。然后清空全部端点的窗口，无论这次是否做了评估。
2. 对全部端点中摘除结束时刻不晚于 `T` 的端点，摘除倍数减一，不低于 0。第 1 步刚摘除的端点不减。

错过多个清算点时，只有第一个未处理的清算点有窗口数据，之后的清算点窗口为空，只做第 2 步。第 2 步按算术补算：对每个端点，数出游标之后、`T <= now`、且 `T` 不早于其摘除结束时刻的清算点个数，一次减去，不低于 0。补算在第一个清算点的新摘除写入之后进行。开销与端点数成正比，与错过的清算点个数无关。

这样，在端点集合不变时，清算结果只取决于样本和清算点的时刻，与清算由哪一次调用触发无关，效果与 A50 的周期计时器相同。第五稿的懒清算从最近一次调用开始计时，摘除时长会随流量的到达时刻变化，实测 A7 复现了这个问题。

### 5.5 判据

**连续失败。** `consecutiveFailures` 默认 5，为 0 表示关闭。记账规则：

- `consecutiveFailures` 为 0 时：摘除期内的样本仍不进入窗口；不在摘除期的样本仍记入当前窗口；失败百分比照常评估；不维护连续计数，也不做连续失败摘除。下面的连续计数规则只适用于不为 0 的情况。

- 端点处于摘除期（`now < 摘除结束时刻`）时，它的样本不增加连续计数、不清零，也不进入失败百分比窗口。这包括第 5.3 节第 3 步兜底时，在摘除期新发出的调用。
- 端点不在摘除期时：先把这次样本记进当前窗口，再处理连续计数。失败样本使连续计数加一；只要计数不低于阈值、且第 5.6 节允许，就在这次 `done` 里立即摘除。没摘成时计数不置 0，之后每个不在摘除期的失败样本都会再判一次，名额一释放就摘。非失败样本把连续计数清零。
- 摘除一旦成功，无论由连续失败还是失败百分比触发，该端点的连续计数置 0。触发摘除的那一次失败算进当前窗口。

**失败百分比。** 默认关闭，配置 `failurePercentage` 后启用，在清算点 `T` 上评估全部端点：

1. 参与判定的端点：窗口内样本数 `total` 大于 0，且不小于 `requestVolume`（默认 50）。`requestVolume` 为 0 时，样本数为 0 的端点也不参与。
2. 参与判定的端点个数小于 `minimumHosts`（默认 5）时，本次不摘除。
3. 否则只遍历第 1 步的参与集合，按第一次出现的顺序逐台考虑满足 `failed × 100 >= threshold × total` 的端点。`total` 为 0 的端点不在集合里，不能因为 `0 >= 0` 而通过；样本数低于 `requestVolume` 的端点即使失败率是 100% 也不摘。用整数比较，避免浮点误差。每考虑一台之前，重算可用集合：不在摘除期的端点，即从未摘除过、或摘除结束时刻不晚于 `T` 的端点。这是第 5.4 节「摘除结束时刻晚于 `T` 才算摘除中」的否定。本轮刚摘除的立刻算摘除中。这台已在摘除期，或者可用集合里只剩它一台，就跳过并继续看下一台。已摘除数达到第 5.6 节的上限时，停止本轮。`threshold` 默认 85。A50 的配置注释写「大于等于」，算法步骤写「大于」，本稿取「不小于」。

成功率统计判据不做，见第 11 节。

### 5.6 摘除与恢复

- 摘除时，倍数先加一，摘除时长为 `baseEjectionMs × 倍数`，不超过 `max(baseEjectionMs, maxEjectionMs)`。默认 `baseEjectionMs` 30000、`maxEjectionMs` 300000、`intervalMs` 10000。
- 名额、已摘除数、失败百分比的遍历顺序与「最后一个可用端点」，都按第 5.4 节定义的全部端点计算，包括已经不在任何当前列表里的端点。同一个均衡器被两个列表不同的客户端共享时，某个客户端的候选可能因此被摘空；第 5.3 节第 3 步的兜底仍只用它这次的列表，不会选到它没有配置过的端点。
- 摘除比例上限 `maxEjectionPercent` 默认 10。已摘除数是全部端点中在判断时刻仍在摘除期的个数，判断时刻在 `done` 里是调用的 `now`，在清算点上是 `T`；它不小于 `max(1, floor(端点总数 × 比例 / 100))` 时，不再摘除新的端点。
- 无论比例是多少，都不摘除最后一个可用端点。「可用」指不在摘除期的端点，包括从未摘除过的端点。这条保护只针对被动摘除，判断时不调用 `isHealthy`；主动检查判为不健康的端点，由第 5.3 节的过滤与兜底处理。只有一个端点时永远不摘除。

### 5.7 主动健康检查

主动探测由调用方实现。调用方定时探测，把结果存在自己的缓存里，`isHealthy` 同步读缓存：

```ts
const healthy = new Map<string, boolean>();
const controller = new AbortController();

async function probe(): Promise<void> {
  for (const endpoint of endpoints) {
    const response = await fetch(new URL("/healthz", endpoint), {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2000)]),
    }).catch(() => undefined);
    healthy.set(endpoint, response?.ok === true);
  }
}

// 计时器归应用所有，应用退出时 clearInterval 并 abort。
const timer = setInterval(() => void probe(), 5000);

const balancer = roundRobinBalancer({
  outlierDetection: {
    consecutiveFailures: 0,
    isHealthy: (endpoint) => healthy.get(endpoint) ?? true,
  },
});
```

规则：

- `isHealthy` 只能排除端点，不能提前解除被动摘除。被摘除的端点只在摘除到期后回来。缓存里的 `true` 只是一个快照，不代表摘除之后又有一次成功的探测，用它解除摘除会让刚被摘掉的端点立即回来。第五稿第 3 节写的「主动检查通过则解除摘除」作废。
- `isHealthy` 只在 `pick` 过滤时对每个端点调用一次。它必须同步、廉价，不得发请求。
- 返回值用 `typeof` 判断是否为布尔值。`isHealthy` 在 `pick` 过滤时返回非布尔值或抛出：不调用内层 `pick`，这次 `pick` 返回带选项错误内部品牌的错误，调用得到 `REQ_OPTIONS_INVALID`。它只影响这一次 `pick`，不写入均衡器的永久选项错误。
- `isFailure` 返回非布尔值或抛出：这个样本不进入任何计数，连续计数不增也不清；过滤层吞掉异常，仍然调用内层 `done`，所以 p2c 的在途数不会泄漏。
- TypeScript 的类型会拒绝 `async` 回调；这些规则防的是绕过类型的调用方。实测 A8 证实，返回的 Promise 如果当成真值，所有端点都会被判为健康。
- 只用主动检查时，把 `consecutiveFailures` 设为 0，不配 `failurePercentage`。这样配置下任何失败都不会触发被动摘除。

### 5.8 例子

默认配置，`t0 = 0`，清算点是 10000、20000、30000、40000 毫秒。`a` 在 t=5000 第 5 次连续失败。

1. `a` 被摘除，倍数 1，摘到 35000，连续计数置 0。已摘除 1 台，三台时上限是 `max(1, floor(3 × 10 / 100)) = 1`，在 `a` 的摘除到期之前，不能再摘除别的端点；35000 之后 `a` 不在摘除期，名额释放。
2. 10000、20000、30000 这三个清算点，`a` 的摘除结束时刻 35000 晚于清算点，倍数不变。
3. 35000 时 `a` 回到候选。
4. 如果 `a` 的 5 次新失败都发生在 35000 之后、40000 之前，第 5 次失败时倍数是 2，第二次摘除 60000 毫秒。
5. 如果第 5 次新失败发生在 40000 或之后，这次 `done` 先处理 40000 这个清算点，倍数减回 0，第二次摘除仍是 30000 毫秒。恰好在 40000 时与之后相同。

### 5.9 对内层策略的影响

| 内层                 | 候选变化时                                                        |
| -------------------- | ----------------------------------------------------------------- |
| `pickFirstBalancer`  | 粘住的端点不在候选里时回到候选第一项；`failback` 时摘除到期就切回 |
| `roundRobinBalancer` | 计数器对新长度取模；加权时当前值只在候选里计算                    |
| `p2cBalancer`        | 状态以端点为键，摘除期间保留，回到候选后继续使用                  |
| `ringHashBalancer`   | 重建环，只有被摘除端点上的键迁移                                  |
| 自定义均衡器         | 只看见 `info.endpoints` 里的候选                                  |

与 gRFC A50 的差别：

- A50 让被摘除端点的子通道报告 `TRANSIENT_FAILURE`；本稿直接缩短候选，因为没有长连接需要保留。
- A50 用周期计时器；本稿用清算网格补算，效果相同。
- A50 在清算点解除摘除；本稿在摘除到期时立即解除。
- A50 的 `enforcement_percentage` 不做。
- 本稿加了「不摘最后一个可用端点」的规则。

## 6. 运行时挂接

### 6.1 共同规则

1. 定义里没有端点和均衡器。导入定义不选台，`createClient` 也不调用 `pick`。
2. 输入解析成功、取消检查通过之后，在构建请求之前做一次初始选台。HTTP 与 SSE 在 builder 运行之前，WebSocket 在 `buildOutbound` 之前。选中的字符串成为 `baseEndpoint`，builder 仍只放置当前 input。实测 C1 证实，三种传输都在构建阶段、拦截器之前校验基址。选台之前就已经取消的快速路径不 `pick`，也不调用 `done`。
3. `done` 的所有权分两种：
   - 执行入口用 `try`/`finally` 覆盖从这次 `pick` 到交给传输层之前的全部出口：builder 失败、构建后的取消检查、`createSocketRequest` 失败、`ENV_UNSUPPORTED`、拦截器短路、没调用 `next()`、`next()` 之前的取消。HTTP 的全部出口都由执行入口负责。`pick` 成功、且结果带 `done` 时，恰好调用一次。
   - SSE 一旦进入 `sseHandler`、WebSocket 一旦进入 `wsHandler`，这次选台以及之后每次 `pick` 的 `done` 都只由传输层调用，包括握手失败，以及会话交给调用方之前就结束的启动失败，见第 6.3、6.4 节。执行入口看到已经交给传输层，就不再调用。
4. 三种传输的每一次 `pick`，包括重连和 WebSocket 的后续尝试，都把定义里的 `operation` 与本次调用 `snapshot()` 里的 `hashKey` 放进 `EndpointPickInfo`，没有就是 `undefined`。`hashKey` 在第三期加入。
5. 传输边界只记录基址等于选中端点的那次尝试的结果，同一次选台有多次尝试时以最后一次为准。调用 `done` 的位置再按下表合成最终结果；没有这样的尝试时，`done` 收到 `{ attempted: false }`。

结果映射：

| 情形                                                                                                                                                                                                                                      | 结果                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 没有落到选中基址：构建失败、进入传输前的 `RequestUrlError`、`ERR_FETCH_UNSUPPORTED`、`ERR_STREAMING_REQUEST_UNSUPPORTED`、`ENV_UNSUPPORTED`、没有响应元数据的 `EXT_OBSERVER_FAILED`、拦截器短路、基址被换、还没调用 `next()` 就超时或取消 | `{ attempted: false }`                                                        |
| 对端已给出响应，包括随后出现的 `RES_DECODE_FAILED`、`RES_MEDIA_TYPE_INVALID`、`RES_STRUCT_MISMATCH`                                                                                                                                       | `{ attempted: true, status }`，这些码不写入 `code`                            |
| 读响应体时中断                                                                                                                                                                                                                            | `{ attempted: true, code: "NET_BODY_INCOMPLETE", status }`                    |
| 连接失败，并且不是超时、也不是取消                                                                                                                                                                                                        | `{ attempted: true, code: "NET_UNREACHABLE" }`                                |
| 尝试已经发生，最终故障是本次调用的 `NET_TIMEOUT`                                                                                                                                                                                          | `{ attempted: true, code: "NET_TIMEOUT" }`，不带 `status`，即使已经记过状态码 |
| 尝试已经发生，最终故障是 `NET_ABORTED`，或调用方主动 `close()`                                                                                                                                                                            | `{ attempted: false }`                                                        |
| WebSocket 打开过、且正常关闭                                                                                                                                                                                                              | `{ attempted: true }`                                                         |

还没调用 `fetch`、也还没构造 `WebSocket` 时发生的截止时间和取消，都是 `{ attempted: false }`，包括 `beforeConnect` 期间，以及 `next()` 里信号已经取消、没有进入 `fetchHandler` 或 `send` 的情况。`fetch` 已经调用、或 `WebSocket` 已经构造之后的截止时间，才使用表里的 `NET_TIMEOUT` 一行，即使响应头还没到。

超时与取消的区分沿用现有的 `resolveAbortedFault` 与 `isTimeoutCause`，不另外判断是不是 `AbortSignal.timeout`。

实测 C2 证实，拦截器用 `makeResponse` 照抄真实响应的字段后，调用方拿到的元组与真实 503 的元组 `deepEqual`，连 `stack` 文本都相同，元组上没有来源标记。所以必须在传输边界取结果，不能按最终元组归因。

### 6.2 HTTP

- 初始选台在 `http/http.ts` 调用 `createHttpRequest` 之前。
- 拦截器链的终端 `handler` 里，`nextRequest.baseEndpoint` 等于选中端点时记下这次尝试：`fetchHandler` 成功记状态码；失败时按第 6.1 节的表归类。`http/transport/fetch.ts` 在 `handler` 返回的 promise 里抛出的 `BodyFailure` 分三种：`NET_BODY_INCOMPLETE` 记故障码与状态码；`RES_*` 只记状态码；`EXT_OBSERVER_FAILED` 有响应元数据时只记状态码，没有时按没有落到端点处理。其余错误经 `createNetworkFault` 得到 `NET_UNREACHABLE` 时，记为连接失败。超时与取消在合成最终结果时覆盖。
- 拦截器可以多次调用 `next()` 重试，所有尝试共用初始选台。「以最后一次为准」按调用顺序判定，不按结束顺序：先调用、后结束的尝试不会覆盖后调用的那次。基址不是选中端点的 `next()` 不改写已有记录。`ERR_FETCH_UNSUPPORTED` 与 `ERR_STREAMING_REQUEST_UNSUPPORTED` 按第 6.1 节的表算作没有落到端点，不记为连接失败。实测 C3 证实两次 `next()` 产生两次真实请求，替换基址后请求到达新基址。
- `done` 在元组返回之前、声明的响应体解码结束之后调用，所以 p2c 的在途数与延迟样本覆盖读响应体的时间。

### 6.3 SSE

- 现状：拦截器链只跑一次，但链结束之前可以多次调用 `next()`，每次 `next()` 进一次 `sseHandler` 和 `fetchEventStream`；链结束后再调用 `next()` 会被拒绝。`sse/transport/event_stream.ts` 在流启动时解析一次 URL，每次重连复用它；重连循环在 `start()` 内部，由 `resolveRetryDelay` 决定是否重连、等多久，`wait` 之后才构造下一轮 `Request`。`runEventStreamCommand` 在第一次握手成功时就返回，流仍在读、仍可能重连。实测 C5 证实，修改捕获的 `req.baseEndpoint` 不会改变重连目标。
- 只有第一次 `next()` 参与选台与归因，它使用初始选台。拦截器在链结束之前再次调用 `next()` 时，那些调用不 `pick`、不归因，它们的流和重连沿用各自的 URL，也不调用任何 `done`。这是少见的用法，要把结果归到某一条流，就得让每条流各自选台，复杂度与收益不相称。
- 第一次进入 `sseHandler` 后，初始选台的 `done` 归 `sseHandler` 与传输层，执行入口不再调用。`sseHandler` 记一个「这次选台已收尾」的标记，保证 `done` 最多调用一次：
  - 进入时基址已不等于初始选中的端点：立即 `done({ attempted: false })` 并标记已收尾。连接与重连照常进行，但不再归因、不再 `pick`，也不把 `done` 传进 `fetchEventStream`。
  - 尚未收尾时，在调用 `fetchEventStream` 之前返回的出口，即 `resolveRequestUrl` 抛出、信号已取消或已到截止、`ERR_FETCH_UNSUPPORTED`，调用一次 `done({ attempted: false })` 并标记已收尾。已经收尾之后，这些出口都不再调用 `done`。
  - 只有尚未收尾、确实调用了 `fetchEventStream`、且基址等于初始选中的端点时，才把 `done` 传入。
- 每次连接尝试在握手结束时快照结果：有响应时只记状态码；`fetch` 抛出时按第 6.1 节的表记故障码。读体中的网络错误、EOF 与致命错误不改写这个快照。但这一次尝试的信号最终是 `NET_TIMEOUT` 时，改记 `{ attempted: true, code: "NET_TIMEOUT" }`，不带 `status`；最终是 `NET_ABORTED` 或调用方 `close()` 时，改记 `{ attempted: false }`。还没调用 `fetch` 时的截止时间和取消，按第 6.1 节表后的规则记 `{ attempted: false }`；`fetch` 已经调用、响应头还没到时的截止时间，记 `{ attempted: true, code: "NET_TIMEOUT" }`。`done` 在这次尝试的流结束或握手失败时调用一次，所以 p2c 的在途数覆盖整段会话。
- 重连时，只对参与归因的那条流：`resolveRetryDelay` 返回非负延迟、`wait` 成功返回之后，在构造下一轮 `Request` 之前同步 `pick`，再用 `{ ...request, baseEndpoint }` 重新解析 URL。退避等待期间不计入 p2c 的在途数。新的选台在那一轮结束时 `done`。
- 不重连、因此也不 `pick` 的情况，沿用现有行为：正常结束（EOF）、致命错误（非 2xx、错误的 Content-Type、`CAP_*`、`EXT_*`）、取消、没有配置 `reconnect`、没有 `shouldReconnect` 时的非幂等方法、`ReadableStream` 请求体。`shouldReconnect` 返回 `true` 时，非幂等方法仍按现有谓词重连并重新 `pick`；真正的闸门是 `resolveRetryDelay` 返回非负延迟。握手抛出且允许重连时，会重新 `pick`。
- 重连时 `pick` 返回错误或抛出：这一轮没有成功选台，不调用 `done`，在途数也没有增加，直接终止循环，不再重连。`pick` 已经成功、随后重新解析 URL 抛出 `RequestUrlError`：同样终止循环，但对这一轮调用一次 `done({ attempted: false })`。两种情况都不把错误抛进 `start()` 的重试 `catch`。错误先按第 3.3 节包成故障，故障码是 `REQ_BUILD_FAILED`，带选项错误内部品牌时是 `REQ_OPTIONS_INVALID`，原错误作为 `cause`。
- 尚未打开时，操作元组就是这个故障：`sse/sse.ts` 的 `createEventStreamFault` 只在故障来自传输层时原样返回这两个码；来自传输层的这两个码不得再交给 `createNetworkFault`，否则会被收成 `NET_UNREACHABLE`。拦截器自己抛出的同码故障仍按原来的规则收成 `EXT_INTERCEPTOR_FAILED`。已经打开时，`EventStreamFaultCode` 增加 `REQ_BUILD_FAILED` 与 `REQ_OPTIONS_INVALID`，`getEventStreamFaultCode` 不得把它们落成 `NET_UNREACHABLE`，`design.md` 与 `closed` 的 TSDoc 同步。
- `Last-Event-ID` 照常发送。新选中的后端不一定认得这个 ID，这属于使用者自己的后端契约。

### 6.4 WebSocket

- 现状：`web_socket/web_socket.ts` 先 `buildOutbound`，再做构建后的取消检查、`createSocketRequest`、`resolveSocketConstructor`，然后进入 `wsHandler`。`prepareAttempt` 每次尝试都从同一个 `req` 重新生成 URL；拦截器只能调用一次 `next()`；握手成功时 `resolveSession` 让调用返回，`connectOnce` 要到连接关闭才结束。实测 C4 证实，修改捕获的 `req.baseEndpoint` 后，重连到了新基址。
- 初始选台在 `buildOutbound` 之前，用于第 0 次尝试。从这次 `pick` 到进入 `wsHandler` 之前的全部出口，由执行入口调用 `done({ attempted: false })` 恰好一次，见第 6.1 节。
- `wsHandler` 进入时，若 `req.baseEndpoint` 已不等于初始选中的端点，立即 `done({ attempted: false })` 并标记这次选台已收尾。已收尾之后，URL 生成失败、`beforeConnect` 失败或取消、连接结束、重连，都不再调用 `done`，也不再 `pick`。下面的结果条款只适用于尚未收尾的尝试。
- 每次尝试的 `done` 只有一个调用点，用这次尝试自己的「已收尾」标记保证最多调用一次：
  - 套接字已经构造时，只在这次物理尝试的 `settleAttempt` 里调用，包括 `finish` 或 `finishFromSignal` 经 `activeAttempt.cancel` 间接进入的情况。`run()` 因为 `finished` 直接返回时不再调用，`finish` 本身也不调用。重连时不经过 `finish` 的那一次尝试，同样在它的 `settleAttempt` 里调用。
  - 套接字还没构造时，在真正结束这次尝试的那一次 `finish` 或 `finishFromSignal` 里调用。这包括 `prepareAttempt` 中止、`prepareAttempt` 成功之后发现信号已中止，以及 `beforeConnect` 期间 `requestClose` 直接调用 `finish`。
  - `connectOnce` 在进入等待尝试结果的逻辑之前就返回 `connectFailure` 时，没有 `settleAttempt`。这有两种情况：构造函数抛出，以及构造成功之后 `binaryType` 赋值抛出。`done` 在 `run()` 拿到这个结果之后、决定重连或调用终端 `finish` 之前调用一次。这里记的是「这一次尝试已经 `done`」，不是基址被换掉时那个会话级的「已收尾」标记：它只挡住同一次尝试的后续出口，不阻止下一轮重新 `pick`。其后的 `continue`、`finish`、`finishFromSignal` 与退避期间的中止都不再调用。先 `done` 再进入退避，退避期间不保留在途数；`continue` 之后的下一轮仍按本节规则在 `prepareAttempt` 开头重新 `pick`，那一轮再失败就再 `done` 一次。结果按「从未打开」归类，普通构造错误得到 `{ attempted: true, code: "NET_UNREACHABLE" }`。
  - `prepareAttempt` 里 `pick` 返回错误或抛出属于上一条「终止重连」：结束重连的那次 `finish` 或 `finishFromSignal` 不调用 `done`，但要标记已收尾。`pick` 已成功之后的 URL 生成失败、`beforeConnect` 失败或取消，仍在那次 `finish` 或 `finishFromSignal` 里 `done` 一次。
- 基址仍相等时，第 0 次尝试的 `done` 在这条物理连接结束时调用，不在 `resolveSession` 时调用。第 1 次及以后的尝试，在 `prepareAttempt` 开头 `pick`，用 `{ ...req, baseEndpoint }` 生成 URL，在这次尝试结束时 `done`。
- 每次尝试的结果按第 6.1 节的表：
  - 打开过、且正常关闭：`{ attempted: true }`。
  - 打开之后，因截止时间结束：`{ attempted: true, code: "NET_TIMEOUT" }`，不带 `status`；因 `NET_ABORTED` 或调用方 `close()` 结束：`{ attempted: false }`。
  - 从未打开：按现有的 `createNetworkFault` 分类，得到 `NET_UNREACHABLE` 记连接失败，`NET_TIMEOUT` 与 `NET_ABORTED` 按表处理。
  - `beforeConnect` 期间或构造 `WebSocket` 之前的截止时间和取消，以及 `beforeConnect` 失败、URL 生成失败：这次尝试没有连接，记 `{ attempted: false }`。
- 拦截器没有调用 `next()` 就返回会话时，初始选台记 `{ attempted: false }`。
- 重连时 `pick` 返回错误或抛出：终止重连，不调用这一轮的 `done`。`pick` 已成功、随后 URL 生成失败时，记 `{ attempted: false }` 后终止重连。尚未打开时，操作元组是 `REQ_BUILD_FAILED` 或 `REQ_OPTIONS_INVALID`；已经打开过时，把包好的故障放进 `state.error`，不要把裸的 `ERR_NO_ENDPOINT` 交给 `faultFromCloseInfo`，否则它会被收成 `NET_UNREACHABLE`。

### 6.5 拦截器与可观测性

- 拦截器看到的 `req.baseEndpoint` 是这次选中的端点，可以记录，也可以替换。
- `@defjs/opentelemetry-server` 用 `req.baseEndpoint` 计算 `url.full`、`server.address` 与 `server.port`，记录的是真实选中的端点，插件代码不用改。指标的 `server.address` 维度多出 N 个取值。
- HTTP 的拦截器多次调用 `next()` 时，共用进入链之前的那一次选台；本稿不把 HTTP 的 `pick` 移进 `next()`，因为那会改变拦截器可以替换 `baseEndpoint` 的既有语义。SSE 只有第一次 `next()` 参与选台；它打开的流在基址没被换掉时，每次重连各自选台，见第 6.3 节与决定 B。WebSocket 的 `next()` 只能调用一次。

### 6.6 URL 基址缓存

`internal/url.ts` 用模块级的单项缓存保存最近一个基址的解析结果。轮换端点时每次都会重建基址 URL。实测 C8 的额外开销约 0.47 µs，约为一次本地 HTTP 调用的 0.63%。保留现有缓存，不加多项缓存。以后 profile 证明它成为瓶颈时再改。

### 6.7 截止时间与黑洞主机

`@defjs/core` 没有默认超时。实测 C6 中，只接受连接、永不响应的服务器让一次没有截止时间的调用挂了 330 秒，仍未自行结束。

- 调用方用 `AbortSignal.timeout` 设截止时间，且请求已经落到选中端点时，结果是 `{ attempted: true, code: "NET_TIMEOUT" }`，这是一个非失败样本。截止时间在请求发出之前就到了时，结果是 `{ attempted: false }`。想把超时算作失败，自定义 `isFailure`。
- 调用方用普通 `abort()` 取消时，得到 `NET_ABORTED`，`done` 收到 `{ attempted: false }`。
- 默认的 pick_first 不会离开黑洞主机。指南里要建议调用方总是设置截止时间。

## 7. 选项取值范围

工厂不抛出。不符合下表的选项在构造时记为选项错误：类型不对是 `TypeError`，越界是 `RangeError`。之后每次 `pick` 都返回它，调用得到 `REQ_OPTIONS_INVALID`。

| 选项                                   | 默认         | 取值                                                 |
| -------------------------------------- | ------------ | ---------------------------------------------------- |
| `pickFirstBalancer.shuffle`            | `false`      | 布尔值                                               |
| `pickFirstBalancer.failback`           | `false`      | 布尔值；为 `true` 时必须配置 `outlierDetection`      |
| `roundRobinBalancer.weights`           | 无           | `Map`，键为字符串，值为有限正数                      |
| `p2cBalancer.load`                     | `"peakEwma"` | `"peakEwma"` 或 `"pending"`                          |
| `p2cBalancer.choiceCount`              | 2            | 不小于 2 的整数；大于 10 时按 10 处理，照 A48        |
| `p2cBalancer.defaultRttMs`             | 1000         | 有限正数                                             |
| `p2cBalancer.decayMs`                  | 10000        | 有限正数                                             |
| `p2cBalancer.isFailure`                | 第 5.2 节    | 函数                                                 |
| `ringHashBalancer.minRingSize`         | 1024         | 正整数，不大于 `maxRingSize`                         |
| `ringHashBalancer.maxRingSize`         | 4096         | 正整数，不大于 8388608，用来限制内存                 |
| `outlierDetection.intervalMs`          | 10000        | 有限正数                                             |
| `outlierDetection.baseEjectionMs`      | 30000        | 有限正数                                             |
| `outlierDetection.maxEjectionMs`       | 300000       | 有限正数                                             |
| `outlierDetection.maxEjectionPercent`  | 10           | 0 到 100                                             |
| `outlierDetection.consecutiveFailures` | 5            | 非负安全整数；0 表示不维护连续计数、不做连续失败摘除 |
| `failurePercentage.threshold`          | 85           | 0 到 100                                             |
| `failurePercentage.minimumHosts`       | 5            | 非负安全整数                                         |
| `failurePercentage.requestVolume`      | 50           | 非负安全整数                                         |
| `outlierDetection.isFailure`           | 第 5.2 节    | 函数                                                 |
| `outlierDetection.isHealthy`           | 无           | 函数                                                 |

`withEndpoint` 不校验 URL。非法端点在构建请求时得到 `REQ_BUILD_FAILED`，`done` 收到 `{ attempted: false }`，pick_first 不会因此离开它，错误会在每次调用时重复出现。

## 8. 状态、并发与运行时

- 均衡器的状态在均衡器对象内部，不放在 `ClientConfig` 的字段上。`createClient` 之后，库不再修改配置。
- 只调用 `withEndpoint` 的客户端各有一个默认均衡器，不共享状态。同一个均衡器对象传进两个 `createClient`，两个客户端共享其中的状态，包括健康状态。`client(options)` 派生的值共享根客户端的均衡器。
- `pick` 与 `done` 同步修改状态，中间没有 `await`。同一个 JavaScript agent 里不需要 `Atomics`。不要把同一个均衡器对象交给另一个 Worker 或线程。
- 不创建计时器，不导入 `node:` 模块，不使用异步 Web Crypto。浏览器、Node、Bun 与 Worker 共用同一份源码。
- 内存与端点数成正比。p2c 有第 4.5 节的条目上限；环哈希的环大小有上限。

## 9. 公开面、文档与发布

### 9.1 公开面

| 变化                                                                                                             | 位置                                                                               | 兼容性                                                    |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `withEndpoint(...endpoints)`                                                                                     | `client/option.ts`                                                                 | 单参数调用在源码层面兼容                                  |
| `endpoint: string` 改为 `endpoints: readonly string[]`                                                           | `client/config.ts`                                                                 | 破坏性。三个插件的生产代码都不读这个字段                  |
| `ClientConfig.endpointBalancer`                                                                                  | `client/config.ts`                                                                 | 新增，必填                                                |
| `withEndpointBalancer`、各工厂、`outlierDetection`、类型、`ERR_NO_ENDPOINT`、`isNoEndpointCause`                 | 新目录 `src/balancer/`，带 `index.ts` 与 `public_api.ts`，接入 `src/public_api.ts` | 新增                                                      |
| `EventStreamFaultCode` 增加 `REQ_BUILD_FAILED`、`REQ_OPTIONS_INVALID`；`createEventStreamFault` 原样返回这两个码 | `sse/transport/event_stream.ts`、`sse/sse.ts`                                      | 扩大联合类型；对 `closed.code` 做穷尽匹配的调用方要补分支 |
| `RequestOptions.hashKey`                                                                                         | `client/client.ts`                                                                 | 第三期新增；更新 `snapshot()` 与 TSDoc                    |
| `HttpRequest.baseEndpoint` 的说明                                                                                | `internal/http_request.ts`                                                         | 含义改为本次选中的端点                                    |

### 9.2 文档

每一期都要做：

- 每个新导出都有英文 TSDoc 与 `@group client`。签名写进现有的 `api/client.mdx`，用 `<ApiSignature name="withEndpointBalancer, pickFirstBalancer, …" />`。
- 把本期新增的 `@defjs/core:<name>` 按目录顺序追加到 `doc/scripts/api-order.ts`。`api-order.spec.ts` 要求这份清单与提交的目录逐项相等，漏加会让 `test:unit` 失败。
- 运行 `bun run --cwd doc extract-api`，提交生成的三个文件。
- `doc/app/components/navigation.spec.ts` 断言每个语言 204 个 URL。每新增一个导出，每个语言多一个 URL，按本期实际新增的导出个数更新，不要在第一期就改成终态。按本稿的导出清单，第一期新增 12 个（`withEndpointBalancer`、`EndpointBalancer`、`EndpointPickOutcome`、`EndpointTransport`、`EndpointPickInfo`、`EndpointPickResult`、`EndpointFaultCode`、`EndpointDoneInfo`、`ERR_NO_ENDPOINT`、`isNoEndpointCause`、`pickFirstBalancer`、`roundRobinBalancer`），变成 216；第二期新增 3 个（`p2cBalancer`、`outlierDetection`、`OutlierDetectionOptions`），变成 219；第三期新增 1 个（`ringHashBalancer`），变成 220。以 `extract-api` 的实际输出为准。
- 导出目录的条数也写死在三处测试里：`doc/scripts/api-slug.spec.ts` 第 7 行，以及 `doc/app/lib/api-html.spec.tsx` 第 170 行和第 196 行，都是 `toHaveLength(165)`。每个新导出占一条目录，和 URL 个数同期更新：第一期 177，第二期 180，第三期 181。URL 个数不能填进这三处。

第一期还要做：

- 11 个语言的 `api/client.mdx` 全部改写：`ClientOptions` 一段改成 `endpoints`（`readonly string[]`，默认 `[]`，空数组在类型上合法，执行时得到 `REQ_BUILD_FAILED`）；`endpointBalancer` 写在 `ClientConfig` 一段，不算进 `RequestOptions` 的字段。
- 11 个语言的 `api/sse.mdx` 与 `docs/sse.mdx` 里手写的 `EventStreamFaultCode` 码表（en-US 分别在约第 50 行与第 99 行）加上 `REQ_BUILD_FAILED` 与 `REQ_OPTIONS_INVALID`。`design.md` 若有相同枚举一并改。不新建概览页。
- 11 个语言的 `api/errors.mdx` 都用 `ApiSignature` 挂上 `ERR_NO_ENDPOINT` 与 `isNoEndpointCause`，写明它只作为 `REQ_BUILD_FAILED` 的 `cause`，跨副本识别与 `isAbortCause` 相同，不新增 `FaultCode`。
- 改 `client/config.ts` 里 `ClientConfig` 默认值那句 TSDoc（原文写 `endpoint` 是 `''`），再跑 `extract-api`。
- `packages/core/design.md` 的快速开始改成 `endpoints` 数组，并写上选台与结果归因的规则。健康过滤的规则随第二期写入，与指南随功能所在的那一期发布是同一个原则。
- 11 个语言的 `docs/interceptors.mdx` 都写明 `baseEndpoint` 是本次选中的端点，拦截器看不见候选列表。指南没有英文回退（`doc/app/lib/i18n.ts` 的 `fallbackLanguage` 为 `null`），不能只改 en-US。
- `withEndpoint` 的 TSDoc 随之更新。

第二期还要做：

- `packages/core/design.md` 写上健康过滤的规则。
- `api/client.mdx` 与指南补上 `p2cBalancer`、`outlierDetection` 与 `failback`。

第三期还要做：

- `RequestOptions` 一段的「七个扁平字段」和表格加上 `hashKey`，并同步 `packages/core/design.md` 的 Client rules：七个字段改为八个，写明 `snapshot()` 按字段复制 `hashKey`。同时改掉把 `RequestOptions` 写成七个字段、或说某个传输只读其中几个字段的说法，写明 `hashKey` 由选台读取，三种传输的每一次 `pick` 都会带上它。要改的位置：`client/client.ts` 里 `RequestOptions` 的 TSDoc（约第 23 行）与 `DerivableClient` 的复制清单；`design.md` 的 Client rules；`packages/core/README.md` 约第 55 行；`skills/defjs/references/client.md` 里 `RequestOptions` 的说明；11 份 `api/client.mdx`；11 份 `docs/client.mdx` 的三处，即 en-US 第 36 行的 `snapshot()` 复制清单、第 48 行的「seven flat fields」与「SSE reads only `signal`」、第 50 行起的字段表；11 份 `api/http.mdx` 里「HTTP reads `signal` and the progress callbacks and ignores the other fields」那句，en-US 在第 23 行，其他语言行号不同，按句子找；11 份 `api/sse.mdx` 约第 19 行；11 份 `api/web-socket.mdx` 第 19 行列出 WebSocket 读取字段的那句。`HttpExecuteOptions`、`EventStreamExecuteOptions`、`WebSocketExecuteOptions` 不加 `hashKey`。改完再跑 `extract-api`。同一个改动还要更新类型测试：`packages/core/src/client/operation.type.test.ts` 里 `keyof RequestOptions` 的断言要加上 `"hashKey"`，它是双向的 `Equal`，漏改根目录类型检查就失败。`client.derive.spec.ts` 与 `config_snapshot.spec.ts` 里两处 `client({})` 的 `toEqual` 不用改：`toEqual` 忽略值为 `undefined` 的键，这一点已核对 `@vitest/expect` 的 `hasDefinedKey` 实现。

指南：

- 写在 `doc/content/en-US/docs/client.mdx` 的新小节「多个端点」，其他 10 个语言同步。内容包括四种工厂的选择、健康过滤、主动检查示例、截止时间的建议；写明浏览器主备用默认值，服务端同级副本池显式选 `roundRobinBalancer`；写明默认 pick_first 与 gRPC 的差别，即故障后至少有一次调用失败。指南随对应功能所在的那一期发布。
- 完整示例放在 `doc/examples/`，按 `http/basic-setup.ts` 的写法，必须通过类型检查。

### 9.3 版本与插件

Core 从 0.6.0 升到 0.7.0。

- React 与 Vue 只放宽 peer 范围（例如 `^0.6.0 || ^0.7.0`）并改版本号，代码不用改。
- OpenTelemetry 的生产代码不用改，但同一个改动里必须更新 `packages/opentelemetry-server/src/option.spec.ts` 的 `makeConfig()`：`endpoint` 改为 `endpoints: ["https://api.example.com"]`，并加上 `endpointBalancer: pickFirstBalancer()`。它是一个类型为 `ClientConfig` 的手写字面量，不改的话根目录的类型检查会失败。放宽 peer 范围代替不了这一步。
- Core 自己的类型测试 `packages/core/src/client/client.type.test.ts` 里有一个 `satisfies ClientOptions` 的字面量（约第 155 行），还有断言 `typeof options.endpoint` 为 `string` 的 `OptionsCases`。同一个改动里把字面量改成 `endpoints: ["https://api.example.com"]`，不加 `as const`；`OptionsCases` 断言的是声明类型 `ClientOptions["endpoints"]` 为 `readonly string[]`，不是 `typeof options.endpoints`，后者在 `satisfies` 下仍然是 `string[]`。根目录的 `tsconfig.json` 包含所有 `*.ts`，漏改就会失败。
- 每个包按发布规则各打一个标签，例如 `core@0.7.0`、`react@0.0.4`。

## 10. 实施分期与测试

每一期是一个独立的改动，各自通过 AGENTS.md 的六道闸门，覆盖率保持 100%。

| 期  | 内容                                                                                                                                                                                                                                                                                 | 依赖                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| 一  | `endpoints` 配置、`EndpointBalancer` 及相关类型、`ERR_NO_ENDPOINT` 与 `isNoEndpointCause`、三种传输的挂接与结果归因（含 `EventStreamFaultCode` 的扩充）、`pickFirstBalancer`（含 `shuffle`）、`roundRobinBalancer`（含 `weights`）、OpenTelemetry 测试与 Core 类型测试里的配置字面量 | 无                                 |
| 二  | 健康过滤及第一期两个工厂的 `outlierDetection` 选项、`failback`、`p2cBalancer`                                                                                                                                                                                                        | 第一期的结果类型与 `transport`     |
| 三  | `ringHashBalancer`（含 `outlierDetection` 选项）、`XXH64`、`RequestOptions.hashKey`                                                                                                                                                                                                  | 第一期的挂接，以及第二期的健康过滤 |

测试要求：

- 均衡器逻辑用 `*.spec.ts`。随机用 `vi.spyOn(Math, "random")` 固定序列；时间用 `vi.useFakeTimers({ toFake: ["Date"] })` 推进，断言选台与状态的变化，不断言耗时。
- 挂接点用 `packages/core/test/` 的夹具服务器做集成测试；另加一条 `*.browser.spec.ts`，在 Chromium 与 Firefox 上验证 HTTP 的选台与 `done`。
- 选项校验、`pick` 的每种非法返回值、`done` 省略、`isNoEndpointCause` 跨副本识别，都要有测试覆盖，否则到不了 100% 分支覆盖。
- 实测与审查发现的每个问题都要有回归测试，在修复前失败、修复后通过。「期」一列是该测试随哪一期提交：

| 期  | 回归测试                                                                                                                                                                                                                                                                   | 来源      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 一  | 默认 `pickFirstBalancer()` 的 `pick` 返回 `done`；连接失败后下一次调用换到下一台                                                                                                                                                                                           | 审查      |
| 二  | 关闭连续失败，`failurePercentage` 为 `{ minimumHosts: 1, requestVolume: 50, threshold: 85 }`：一台端点 950 次 200 加 50 次 `NET_UNREACHABLE`，清算后不摘除；对照组用两台：故障台只有 50 次 `NET_UNREACHABLE`，另一台只有成功样本，清算后只摘故障台；不用单端点做摘除对照组 | A7        |
| 二  | 三台串行，p2c 的每个端点最终都拿到样本                                                                                                                                                                                                                                     | A5        |
| 二  | 第 5.8 节的两种时序分别得到 60000 与 30000 毫秒，包括恰好在 40000 时得到 30000                                                                                                                                                                                             | A7        |
| 二  | `isHealthy` 返回 `true` 不解除摘除；返回非布尔值时这一次得到 `REQ_OPTIONS_INVALID`，下一次 `pick` 恢复正常                                                                                                                                                                 | A8        |
| 二  | `isFailure` 抛出时，样本不计入，内层 `done` 仍被调用                                                                                                                                                                                                                       | 审查      |
| 一  | `pick` 抛出或返回非法结果时，调用得到 `REQ_BUILD_FAILED`，`cause` 原样保留，调用点不抛                                                                                                                                                                                     | 审查      |
| 一  | 重叠调用一起失败时，pick_first 只前进一台                                                                                                                                                                                                                                  | A1        |
| 一  | 照抄字段的 `makeResponse` 短路时，`done` 收到 `{ attempted: false }`                                                                                                                                                                                                       | C2        |
| 一  | 响应已到、解码失败（`RES_*`）时，`done` 只收到状态码，pick_first 不换台                                                                                                                                                                                                    | 审查      |
| 一  | SSE 已开启重连时，读体失败后的下一次尝试重新 `pick`；EOF 与第 6.3 节列出的终止路径不 `pick`                                                                                                                                                                                | C5        |
| 一  | SSE 与 WebSocket 的 `done` 在连接结束时调用，不在握手成功时调用                                                                                                                                                                                                            | 审查      |
| 一  | SSE 尚未打开、重连时 `pick` 返回错误：操作元组是 `REQ_BUILD_FAILED`，不是 `NET_UNREACHABLE` 或 `EXT_INTERCEPTOR_FAILED`                                                                                                                                                    | 审查      |
| 一  | SSE 已经打开、重连时 `pick` 返回错误：`closed.code` 是 `REQ_BUILD_FAILED`                                                                                                                                                                                                  | 审查      |
| 一  | 重连时 `pick` 成功、URL 生成失败：这一轮 `done({ attempted: false })` 恰好一次，p2c 的在途数不泄漏                                                                                                                                                                         | 审查      |
| 一  | SSE 在调用 `fetch` 之前、`fetch` 之后响应头之前、握手之后分别超时与取消，`done` 的结果符合第 6.1、6.3 节                                                                                                                                                                   | 审查      |
| 一  | SSE 在 `sseHandler` 入口基址已被换：`done({ attempted: false })` 恰好一次，替换后的状态码不记入原端点                                                                                                                                                                      | 审查      |
| 一  | SSE 拦截器在链结束前再次调用 `next()`：不 `pick`、不调用任何 `done`；第一次 `next()` 的流重连时重新 `pick`，退避等待期间在途数不增加                                                                                                                                       | 审查      |
| 一  | SSE 在 `sseHandler` 里、调用 `fetchEventStream` 之前的四个出口，`done({ attempted: false })` 恰好一次，在途数回到进入前                                                                                                                                                    | 审查      |
| 一  | WebSocket 打开后超时记 `NET_TIMEOUT`、取消记 `{ attempted: false }`；builder 失败时初始选台的 `done` 恰好一次                                                                                                                                                              | 审查      |
| 一  | WebSocket 的套接字已构造但未打开时超时、`error` 事件里直接 `finish`、重连时不经过 `finish` 的那一次、`beforeConnect` 期间尚无套接字就 `close()`：`done` 都恰好一次，在途数回到进入前                                                                                       | 审查      |
| 一  | WebSocket 基址已换，随后 URL 非法或连接正常关闭：`done` 仍然恰好一次                                                                                                                                                                                                       | 审查      |
| 二  | 两台端点、`consecutiveFailures: 0`、不配 `failurePercentage`：多次 `NET_UNREACHABLE` 之后两台都不被摘除                                                                                                                                                                    | 审查      |
| 二  | `consecutiveFailures: 0` 时，不在摘除期的失败样本仍进入失败百分比窗口                                                                                                                                                                                                      | 审查      |
| 二  | 5 台达到 `requestVolume` 且失败率为 0，另 1 台只有 1 次 `NET_UNREACHABLE`：清算后都不摘除                                                                                                                                                                                  | 审查      |
| 一  | WebSocket 构造函数抛出、`binaryType` 赋值抛出，不配置重连：`done` 恰好一次，结果是 `{ attempted: true, code: "NET_UNREACHABLE" }`，在途数回到进入前                                                                                                                        | 审查      |
| 一  | 同上，配置重连且不传 `shouldReconnect`（默认谓词返回真，`attempts` 默认 3）、构造始终抛出：每次尝试各调用一次 `done`，共 4 次，都在该次 `continue` 或终端 `finish` 之前；每一次的下一次 `pick` 之前在途数已释放                                                            | 审查      |
| 二  | `consecutiveFailures: 0`，`failurePercentage` 为 `{ minimumHosts: 1, requestVolume: 1, threshold: 85 }`，`maxEjectionPercent` 为 100：三台都过阈值时摘 2 台，留下最后一个可用端点                                                                                          | 审查      |
| 二  | 端点状态在清算之前创建：第一次失败发生在 t=25000 时，不会在 T=10000 上被评估                                                                                                                                                                                               | 审查      |
| 二  | 本次调用才出现的端点不进入这次补算的端点总数：19 台都过阈值、第 20 台在推进游标的调用里出现时，仍只摘 1 台                                                                                                                                                                 | 审查      |
| 二  | 只有一台端点、`consecutiveFailures` 为 1、第一次失败在首个清算点之前：不被摘除                                                                                                                                                                                             | 审查      |
| 二  | 端点被摘除后离开所有列表，别的调用把游标推过它的摘除结束时刻：倍数与逐点清算相同，窗口也被清空                                                                                                                                                                             | 审查      |
| 二  | 「最后一个可用端点」的判断不调用 `isHealthy`；`isHealthy` 抛出只影响这一次 `pick` 的过滤                                                                                                                                                                                   | 审查      |
| 一  | SSE 基址已换、同时信号已取消或 URL 非法：`done` 仍然恰好一次                                                                                                                                                                                                               | 审查      |
| 二  | 补算清算点时，用 `T` 而不是调用时刻判断摘除期与名额；两个列表不同的客户端共享均衡器时，名额按已有状态的全部端点计算，端点从两个列表都消失后仍占名额；候选被摘空时，兜底只用本次列表，不选到另一个客户端的端点                                                              | 审查      |
| 二  | 连续失败达到阈值但名额不足时不摘、计数不清，名额释放后的下一次失败摘除                                                                                                                                                                                                     | 审查      |
| 一  | WebSocket 每次重连重新选台；`wsHandler` 进入时基址已被换过，立即 `done({ attempted: false })`                                                                                                                                                                              | C4        |
| 二  | p2c 对连接被拒绝的端点记惩罚样本，不把它当成最快的；单端点也计在途数                                                                                                                                                                                                       | 第 4.5 节 |
| 三  | 环哈希：`n × k` 超过 `maxRingSize` 时按上限取 `k`；`k < 1` 时返回选项错误                                                                                                                                                                                                  | 第 4.6 节 |
| 一  | 构建失败、调用方取消与短路时，`done` 恰好调用一次                                                                                                                                                                                                                          | 第 6.1 节 |

## 11. 不做，以及已知上限

不做：

- ~~同一次 HTTP 调用里换一台再试。~~ 第 2.3 节第 1 条已推翻，见 `withEndpointFailover`。SSE 与 WebSocket 只在下一次重连时换台；SSE 拦截器再次调用 `next()` 打开的流不参与选台。
- 服务发现、熔断。
- 内置的主动健康检查。原因见第 5.1 节。
- 成功率统计摘除（A50 的 `success_rate_ejection`）。它默认要求至少 5 台端点、每台每个周期至少 100 次调用，客户端常见的两三台端点几乎不会触发。
- 随机均衡器与独立的最少请求均衡器，原因见第 4.1 节。
- ORCA 权重、区域感知、子集划分、慢启动、加权最少请求、Maglev。慢启动曾由第 2.3 节第 7 条改为要做，第 2.4 节第 4 条再次删除。
- 用策略名字符串选择算法。
- 摘除状态的变化事件。需要观测时，调用方在自定义均衡器里包一层，记录 `pick` 与 `done`。
- 进程全局的均衡器，以及 `ClientConfig` 上公开可写的游标。

已知上限：

- 默认的 pick_first 只在 `NET_UNREACHABLE` 时换台，不会离开黑洞主机，见第 6.7 节。
- 默认的 pick_first 在调用层换台：主端点故障后，至少有一次调用失败，尚未完成的在途调用也可能一并失败。gRPC 能在连接建立阶段替等待中的 RPC 换址，但已分配到连接的 RPC 在连接突然断开时同样会失败，见第 4.3 节。
- 摘除有期限。没有主动健康检查时，仍在停机的端点在摘除到期后会重新接受流量，可能再次失败、再次被摘除（实测 D3）。
- 清算只在有调用时处理，但按网格补算，结果与计时器相同。很久没有调用之后，第一次调用会先处理所有过去的清算点。
- `fetch` 跟随重定向到另一台时，结果仍记在选中的那台上，运行时无法识别。
- 构建失败也消耗一次选台：轮询计数前进，p2c 的在途数短暂加一，随后由 `done` 减回。
- p2c 的默认参数来自单个随机种子、本机网络的实验，没有在浏览器跨区域网络上验证。

## 12. 实测与审查记录

### 12.1 实测与审查结论

三轮实测于 2026-11-02 在 Bun 1.4.4、Darwin arm64 上完成，只写 `/tmp/lbexp`，没有改动仓库。报告分别是 `/tmp/lbexp/core/REPORT.md`、`/tmp/lbexp/algo/REPORT.md` 与 `/tmp/lbexp/default/REPORT.md`；Go 库调研见 `/tmp/lbexp/golib/REPORT.md`。主代理重跑了确定性实验；黑洞与真实网络实验沿用子代理的日志。

| #   | 断言                                                               | 判定                                                           | 对本稿的影响                |
| --- | ------------------------------------------------------------------ | -------------------------------------------------------------- | --------------------------- |
| C1  | 三种传输在拦截器之前校验基址                                       | 证实                                                           | 决定 F                      |
| C2  | 短路响应与真实响应无法区分                                         | 原表述推翻，动机成立                                           | 决定 G 的依据改写           |
| C3  | HTTP 拦截器能重试、能换基址                                        | 证实                                                           | 第 6.2 节                   |
| C4  | WebSocket 每次重连重新生成 URL                                     | 证实                                                           | 第 6.4 节                   |
| C5  | SSE 重连沿用原 URL                                                 | 证实                                                           | 第 6.3 节，补 EOF 不重连    |
| C6  | 调用方超时与黑洞的故障码相同                                       | 部分成立                                                       | 第 6.7 节                   |
| C7  | 连接拒绝与 500 的故障码                                            | 证实                                                           | 第 6.1 节的映射表           |
| C8  | 单项 URL 缓存在轮换时失效                                          | 证实，开销可忽略                                               | 决定 Y                      |
| A1  | pick_first 粘滞与重叠调用                                          | 证实                                                           | 第 4.3 节                   |
| A2  | `failback` 与健康过滤                                              | 证实                                                           | 第 4.3 节                   |
| A3  | 平滑加权轮询                                                       | 证实                                                           | 第 4.4 节，修正措辞         |
| A4  | p2c 的真实流量分布                                                 | 证实，范围限定                                                 | 第 4.5 节                   |
| A5  | p2c 的估计衰减                                                     | 部分成立                                                       | 决定 T                      |
| A6  | 长连接下的最少连接                                                 | 部分成立                                                       | 第 4.5 节，改为抽样内最少   |
| A7  | 摘除判据与时长                                                     | 部分成立                                                       | 决定 S、V                   |
| A8  | 主动检查的交互                                                     | 证实                                                           | 决定 U、W                   |
| A9  | 按需导出的包体积                                                   | 证实                                                           | 第 4.1 节                   |
| G1  | Go 库的默认均衡行为（静态读源码）                                  | 已核实关键源码行                                               | 第 4.3 节的差异表与选型建议 |
| D1  | 主备故障转移恰好失败 1 次；默认不回主；`failback` 在摘除到期后回主 | 证实                                                           | 第 4.3 节的 `failback` 成本 |
| D2  | 强制断连时 32 个在途调用全部失败，只前进一台                       | 证实，限强制断连                                               | 第 4.3 节差异表             |
| D3  | 主备场景用轮询：停机时失败 50%，健康时延迟增加约 230%              | 证实                                                           | 选型建议                    |
| D4  | 同级副本池：pick_first 集中到一台，并发受限时总用时约 3 倍         | 证实；p2c 相对轮询无稳定优势                                   | 选型建议                    |
| D5  | 黑洞主机：默认值不离开；把超时算作失败后第 6 次离开                | 证实                                                           | 第 6.7 节                   |
| D6  | grpc-go 连接层换址                                                 | 部分成立：已就绪的连接断开时 RPC 仍失败                        | 第 4.3 节差异表、第 11 节   |
| R1  | sonnet 全面审查：12 个镜头加 4 个补充镜头，每条发现 3 票反驳       | 88 条发现，40 条通过核验，合并为 23 处修订                     | 修订二                      |
| R2  | sonnet 第二轮复核：5 个镜头，每条发现 3 票反驳                     | 45 条发现，28 条通过核验，合并为 19 处修订                     | 修订三                      |
| R3  | sonnet 第三轮复核：5 个镜头，每条发现 3 票反驳                     | 24 条发现，16 条通过核验，合并为 9 处修订                      | 修订四                      |
| R4  | sonnet 第四轮复核：5 个镜头，每条发现 3 票反驳                     | 22 条发现，14 条通过核验，合并为 9 处修订                      | 修订五，并收窄两处范围      |
| R5  | sonnet 第五轮复核：5 个镜头，每条发现 3 票反驳                     | 18 条发现，13 条通过核验，合并为 8 处修订                      | 修订六                      |
| R6  | sonnet 第六轮复核：5 个镜头，每条发现 3 票反驳                     | 11 条发现，3 条通过核验，没有 blocker                          | 修订七                      |
| R7  | sonnet 第七轮复核：5 个镜头，每条发现 3 票反驳                     | 11 条发现，5 条通过核验，合并为 3 处，都源于「清算点作废」机制 | 修订八，删去该机制          |
| R8  | sonnet 第八轮复核：5 个镜头，每条发现 3 票反驳                     | 3 条发现，1 条通过核验                                         | 修订九                      |
| R9  | sonnet 第九轮复核：5 个镜头全部返回，每条发现 3 票反驳             | 8 条发现，3 条通过核验                                         | 修订十                      |
| R10 | sonnet 第十轮复核：5 个镜头全部返回，每条发现 3 票反驳             | 10 条发现，8 条通过核验，合并为 6 处，含 1 个 blocker          | 修订十一                    |
| R11 | sonnet 第十一轮复核：5 个镜头全部返回                              | 11 条发现，5 条通过核验，合并为 1 处                           | 修订十二                    |
| R12 | sonnet 第十二轮复核：5 个镜头全部返回，最后一轮                    | 3 条发现，1 条通过核验                                         | 修订十三                    |

### 12.2 修订记录

| 修订     | 依据                         | 主要内容                                                                                                                                                                                   |
| -------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 第六稿   | 三轮实测                     | 完整重写，取代第一稿到第五稿                                                                                                                                                               |
| 修订一   | Go 风味审查                  | `pick` 返回错误优先元组；工厂不抛出；`ERR_NO_ENDPOINT`；类型名对齐 gRPC；`done` 可省略；选台信息带 `operation`（决定 Z1–Z7）                                                               |
| 修订二   | R1 全面审查                  | 23 处：`done` 的所有权、结果映射、清算与判据的边界、环哈希规则、文档闸门                                                                                                                   |
| 修订三   | R2                           | 19 处                                                                                                                                                                                      |
| 修订四   | R3                           | 9 处                                                                                                                                                                                       |
| 修订五   | R4                           | 9 处；收窄两处范围：SSE 只有第一次 `next()` 参与选台；健康过滤按全部端点计算                                                                                                               |
| 修订六   | R5                           | 8 处：兜底只用本次列表、SSE `done` 只调用一次                                                                                                                                              |
| 修订七   | R6                           | 3 处                                                                                                                                                                                       |
| 修订八   | R7                           | 删去「清算点作废」机制；「最后一个可用端点」不调用 `isHealthy`；窗口清空与倍数衰减作用于全部端点                                                                                           |
| 修订九   | R8                           | 失败百分比可用集合的定义                                                                                                                                                                   |
| 修订十   | R9                           | WebSocket `done` 的唯一调用点与收尾标记；`consecutiveFailures` 为 0 的含义                                                                                                                 |
| 修订十一 | R10                          | 6 处：第三期类型测试、WebSocket 构造失败的 `done` 调用点、失败百分比参与集合                                                                                                               |
| 修订十二 | R11                          | 构造失败时每次尝试各自 `done`，与会话级收尾标记区分                                                                                                                                        |
| 修订十三 | R12                          | 每次 `pick` 都填入定义的 `operation`，健康过滤原样转发；此后停止复核，进入实施准备                                                                                                         |
| 修订十四 | 第一期实施审查               | 写回实施时确定的三处取舍：HTTP 多次 `next()` 按调用顺序取最后一次；两种环境不支持错误不算连接失败；拦截器抛出的 `REQ_*` 故障保持 `EXT_INTERCEPTOR_FAILED`                                  |
| 修订十五 | 五个领域的现场验证           | 第 3.3 节：读取 `pick` 返回值时抛出收成 `REQ_BUILD_FAILED`，字段只读一次；`pick` 与 `done` 返回的 thenable 被接住拒绝，不再算调用方违约                                                    |
| 修订十六 | 第七稿，现场验证后的重新设计 | 新增第 2.3 节六个决定：同一次 HTTP 调用内换台并默认启用；轮询与 p2c 默认健康过滤；pick_first 网关错误换台；`failbackMs`；分期改为二甲、二乙、三                                            |
| 修订十七 | 第二期乙现场复测             | 第 2.3 节新增第 7 至 9 条：摘除到期后半开试探与可选慢启动；p2c 在途数改从传输层起算，`EndpointPickResult` 增加 `start`；分期增加二丙                                                       |
| 修订十八 | 第八稿，与成熟开源实现对照   | 新增第 2.4 节：Linkerd 连续失败熔断与指数退避；删除名额、清算网格、失败百分比、慢启动、试探超时；新增 `end` 回调，p2c 在传输层响应时释放在途数；删除 `durationMs`；默认 RTT 30ms；重试预算 |

## 13. 来源与未核对项

仓库源码（`main@ed1763e8`）：`client/config.ts`、`client/option.ts`、`client/client.ts`、`error/types.ts`、`http/http.ts`、`http/request.ts`、`http/transport/fetch.ts`、`internal/transport_request.ts`、`internal/url.ts`、`internal/http_response.ts`、`internal/abort.ts`、`sse/sse.ts`、`sse/transport/event_stream.ts`、`web_socket/web_socket.ts`、`web_socket/build.ts`、`packages/opentelemetry-server/src/telemetry/url.ts`，以及各包的 `package.json`。

业界来源（均于 2026-11-02 读取）：

- gRPC：[load-balancing.md](https://github.com/grpc/grpc/blob/master/doc/load-balancing.md)、[gRFC A62](https://github.com/grpc/proposal/blob/master/A62-pick-first.md)、[gRFC A48](https://github.com/grpc/proposal/blob/master/A48-xds-least-request-lb-policy.md)、[gRFC A42](https://github.com/grpc/proposal/blob/master/A42-xds-ring-hash-lb-policy.md)、[gRFC A58](https://github.com/grpc/proposal/blob/master/A58-client-side-weighted-round-robin-lb-policy.md)、[gRFC A50](https://github.com/grpc/proposal/blob/master/A50-xds-outlier-detection.md)、[gRFC A17](https://github.com/grpc/proposal/blob/master/A17-client-side-health-checking.md)。
- grpc-go：[balancer/balancer.go](https://github.com/grpc/grpc-go/blob/master/balancer/balancer.go)、[balancer/endpointsharding/endpointsharding.go](https://github.com/grpc/grpc-go/blob/master/balancer/endpointsharding/endpointsharding.go)。
- Kratos：[selector/selector.go](https://github.com/go-kratos/kratos/blob/main/selector/selector.go)、[selector/p2c/p2c.go](https://github.com/go-kratos/kratos/blob/main/selector/p2c/p2c.go)、[selector/node/ewma/node.go](https://github.com/go-kratos/kratos/blob/main/selector/node/ewma/node.go)、[selector/wrr/wrr.go](https://github.com/go-kratos/kratos/blob/main/selector/wrr/wrr.go)、[selector/random/random.go](https://github.com/go-kratos/kratos/blob/main/selector/random/random.go)、[transport/http/client.go](https://github.com/go-kratos/kratos/blob/main/transport/http/client.go)。
- tower：[load/mod.rs](https://github.com/tower-rs/tower/blob/master/tower/src/load/mod.rs)、[load/peak_ewma.rs @ 6a3ab07b](https://github.com/tower-rs/tower/blob/6a3ab07b4c391b544a1e0e93931c92bd85c90f7c/tower/src/load/peak_ewma.rs)。
- grpc-go pick_first 的连接层行为（`bc90736a`）：[pickfirst.go 配置与 250ms 延迟](https://github.com/grpc/grpc-go/blob/bc90736a6fadc41582f9a23fb955bb66088f1bb8/balancer/pickfirst/pickfirst.go#L60-L123)、[Happy Eyeballs](https://github.com/grpc/grpc-go/blob/bc90736a6fadc41582f9a23fb955bb66088f1bb8/balancer/pickfirst/pickfirst.go#L530-L590)、[Ready 胜出与断开后回到 Idle](https://github.com/grpc/grpc-go/blob/bc90736a6fadc41582f9a23fb955bb66088f1bb8/balancer/pickfirst/pickfirst.go#L611-L667)。各库默认值的完整证据见 `/tmp/lbexp/golib/REPORT.md`。
- go-kit：[sd/lb/balancer.go](https://github.com/go-kit/kit/blob/master/sd/lb/balancer.go)、[sd/lb/retry.go](https://github.com/go-kit/kit/blob/master/sd/lb/retry.go)。
- Envoy：[load balancers](https://github.com/envoyproxy/envoy/blob/main/docs/root/intro/arch_overview/upstream/load_balancing/load_balancers.rst)、[outlier detection](https://github.com/envoyproxy/envoy/blob/main/docs/root/intro/arch_overview/upstream/outlier.rst)、[health checking](https://github.com/envoyproxy/envoy/blob/main/docs/root/intro/arch_overview/upstream/health_checking.rst)。

未核对：

- 环条目哈希输入与 Envoy、gRPC 的逐字节格式，所以不承诺跨语言选台一致。
- Envoy 优先级「总是选可用的最高优先级」的原文，`failback` 只借用了这个思路。
- p2c 惩罚样本是本稿自己的设计。Linkerd 有名为 `PenaltyPeakEwma` 的类型，本稿没有读它的语义。
- `decayMs` 默认值 10000 的依据只有第 4.5 节的本机实验，没有读 Finagle 或 Linkerd 的源码。
- `maxRingSize` 的上限 8388608 是本稿为限制内存所定，不是从 A42 摘来的。
- 健康过滤的默认值来自 A50 与 Envoy 文档，没有在浏览器或 Node 的真实部署里验证。
- 黑洞主机在没有截止时间时最终会得到什么故障码，实测 330 秒内没有结果。
