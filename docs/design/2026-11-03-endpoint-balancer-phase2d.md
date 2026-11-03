# 端点负载均衡第二期丁：对齐成熟开源实现

- 规格：`docs/design/2026-11-02-endpoint-balancer.md` 第八稿修订十八，第 2.4 节的决定覆盖与之冲突的全部旧条文。
- 依据：`docs/design/2026-11-03-endpoint-balancer-oss-alignment.md`。上游源码的本地克隆在 `/tmp/lbexp/oss/`，实现时以这些固定版本的源码为准。
- 前置：第一期至第二期丙已实现，六道闸门已通过，尚未提交。本期要删除和改写其中一部分，见第 1 节。其余部分不要回滚、格式化或改写。
- 先读 `AGENTS.md`。按测试驱动开发：每一条行为测试先跑出修改前的失败，再实现，再通过。修改前的失败如果不是由缺少目标行为造成，用变异检查证明测试有效。只为覆盖率补的测试单独列出。

## 1. 范围

改写：

- 健康过滤：改为 Linkerd 的连续失败熔断，见第 2 节。
- p2c：在途数与 RTT 改由新的 `end` 回调驱动，见第 3 节。
- 同一次调用内换台：加重试预算，见第 4 节。

删除，连同对应的选项、校验、测试与文档：

- 健康过滤的 `maxEjectionPercent`、`baseEjectionMs`、`maxEjectionMs`、`intervalMs`、`failurePercentage`、`halfOpen`、`probeTimeoutMs`、`slowStartWindowMs`、`slowStartMinWeightPercent`，以及清算网格、倍数衰减、名额与「保留最后一台」。
- `EndpointDoneInfo.durationMs`。
- p2c 的 `isFailure` 选项与失败惩罚样本。

保留：失败分类与默认判据、`isFailure` 与 `isHealthy`（健康过滤的）、单试探、fail-open 兜底、`start` 回调、第二期甲的全部行为。

## 2. 健康过滤：连续失败熔断

出处：`linkerd2-proxy@8203cd2e` 的 `linkerd/app/outbound/src/http/breaker/consecutive_failures.rs` 与 `linkerd/exp-backoff/src/lib.rs`；Finagle `FailureAccrualFactory.scala` 的试探与复活。

### 2.1 选项

| 选项                  | 默认         | 说明                            |
| --------------------- | ------------ | ------------------------------- |
| `consecutiveFailures` | `5`          | 非负整数，`0` 表示不做被动熔断  |
| `minPenaltyMs`        | `1000`       | 有限正数，第一档惩罚            |
| `maxPenaltyMs`        | `60000`      | 有限正数，不小于 `minPenaltyMs` |
| `jitterRatio`         | `0.5`        | `[0, 1]` 的有限数               |
| `isFailure`           | 现行默认判据 | 不变                            |
| `isHealthy`           | 无           | 不变                            |

非法取值按现有选项错误处理，调用得到 `REQ_OPTIONS_INVALID`。

### 2.2 端点状态

每个端点三种状态：

1. **可用。** 记连续失败次数。
2. **熔断中。** 记惩罚结束时刻与当前档位 `level`，从 0 开始。
3. **试探中。** 惩罚期满后进入，有一个试探名额。

### 2.3 规则

- 样本照现行规则分类：`attempted: false` 不是样本；`isFailure` 返回非布尔值或抛出时丢弃样本。
- 可用状态下，失败样本使连续失败次数加一，非失败样本清零。次数达到 `consecutiveFailures` 时进入熔断，`level` 为 0。
- 惩罚时长照 Linkerd：`base = min(minPenaltyMs × 2^level, maxPenaltyMs)`，再加 `[0, base × jitterRatio]` 内的均匀随机数，结果不超过 `maxPenaltyMs`。随机数用 `Math.random()`。
- 与 Linkerd 源码的有意偏离：`linkerd/exp-backoff/src/lib.rs` 第 102 至 116 行的注释写明抖动在 `[0, base × jitter]` 上均匀取值，但实现把秒与纳秒分别乘以随机因子再各自截断成整数。默认 1 秒与 2 秒档的抖动因此恒为 0，4 秒档只能是 0 或 1 秒。抖动用来避免许多客户端同时试探，Defjs 照注释表达的意图取连续的均匀值，不复制截断。
- 熔断中的端点不在候选里。期满后的第一次 `pick` 进入试探中。时刻用 `Date.now()` 在 `pick` 与回调里判断，不创建计时器。
- 试探中的端点只在没有未结束的试探时进入候选。一次 `pick` 选中它，这次尝试就是试探；内层策略没选中它时，名额仍空着。
- **试探在 `end` 时判定**，规则见第 3.1 节：结果是非失败，端点回到可用，连续失败清零，`level` 重置为 0；结果是失败，回到熔断中，`level` 加一。
- 试探的尝试没有调用 `end` 就以 `done` 结束时：`attempted: false` 只释放名额；否则按 `done` 的结果判定。
- 试探判定之后才到达的 `done`，按普通样本记账。
- 熔断中与试探中的端点收到的其他样本不计数。
- 候选计算与兜底不变：先按 `isHealthy` 与熔断状态过滤；为空时先忽略 `isHealthy`；仍为空时用这次 `pick` 收到的原列表。出处为 Finagle 的 panic 模式。兜底选中的试探中端点，同样按试探归因。
- 不再有名额与「保留最后一台」，所有端点都可以熔断，全部熔断时由兜底接住。

## 3. 传输层响应信号 `end`

### 3.1 回调

`EndpointPickResult` 新增可选的 `end?(info: EndpointDoneInfo): void`，与 `done` 同一个参数形状，只是不再有 `durationMs`。

- 运行时在调用过 `start` 之后，于下列时刻同步调用一次：
  - HTTP 与 SSE：`fetch` 返回响应时，`info` 为 `{ attempted: true, status }`；`fetch` 在此之前失败时，`info` 为对应的故障码，例如 `{ attempted: true, code: "NET_UNREACHABLE" }`；被调用方取消时为 `{ attempted: false }`；单次尝试超时或握手超时照第二期甲的映射。
  - WebSocket：`open` 时为 `{ attempted: true }`；在 `open` 之前失败、超时或取消时，照第二期甲 `done` 的映射。
- 没有调用过 `start` 的尝试不调用 `end`。
- 每次选台至多一次，由运行时的包装保证，与 `start`、`done` 同一处实现。拦截器在同一次选台里多次调用 `next()` 时，多出的 `fetch` 共用这次选台，`start`、`end`、`done` 仍各至多一次；这是第一期「多次 `next()` 共用初始选台」的延续。现场复测在这种情况下观察到 2 次 `fetch`、1 次 `start`、1 次 `end`，符合本条。抛出与返回 thenable 照 `done` 处理。
- 健康过滤把 `end` 转给内层，并用它判定试探。
- 出处：tower `CompleteOnResponse` 在响应 future 完成时释放负载句柄；Linkerd 把负载释放与健康分类分成两个信号。

### 3.2 p2c

- `start` 时在途数加一，记下开始时刻。
- `end` 时在途数减一，并以 `Date.now() - 开始时刻` 作为 RTT 样本，照 tower PeakEwma 更新：样本大于估计时直接取样本，否则按 `decayMs` 衰减平滑。核对 `tower/src/load/peak_ewma.rs`，与之一致。
- `start` 之后没有 `end` 就以 `done` 结束时，在 `done` 时减在途数，不产生 RTT 样本，防止泄漏。
- 不再有失败惩罚样本，失败与成功一样按真实耗时记。快速失败的端点由健康过滤熔断。
- `defaultRttMs` 默认改为 `30`，出处为 Linkerd `linkerd/app/outbound/src/http/logical/profile.rs`。`decayMs` 保持 `10000`。
- 删除 p2c 的 `isFailure` 选项。

## 4. 重试预算

出处：Finagle `finagle-core/src/main/scala/com/twitter/finagle/service/RetryBudget.scala`；Linkerd ServiceProfile 的默认值相同。

- `withEndpointFailover` 增加 `retryBudget?: { percentCanRetry?: number; minRetriesPerSecond?: number; ttlMs?: number }`，默认 `0.2`、`10`、`10000`。`retryBudget: false` 关闭预算。
- 预算属于客户端配置，同一个客户端的所有调用共享。
- 每次调用的首次尝试存入额度，每次换台取出额度；额度不足时不换台，直接返回这次尝试的结果。
- 额度计算照 Finagle `TokenRetryBudget` 的语义：保留 `minRetriesPerSecond × floor(ttlMs / 1000)` 的底额（与 Finagle `RetryBudget.apply` 的 `ttl.inSeconds` 一样按整秒截断，TTL 为 1500ms 时底额按 1 秒计），按 `percentCanRetry` 折算每次存入的额度，存入的额度在 `ttlMs` 后过期。核对本地克隆的 Finagle 源码，把公式写进报告。
- 不创建计时器：过期在存取时按时间戳惰性清理。为避免无界增长，按固定时间片聚合时间戳，在报告里说明时间片的大小与误差。
- 非法取值得到 `REQ_OPTIONS_INVALID`。

## 5. 回归测试

| 测试                                                                                                                   | 来源                  |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------- |
| 三台副本依次停机约 2 秒：每台熔断 1 秒档后能试探回来，不再空占 30 秒；滚动期间额外尝试次数明显低于第二期丙的 3421/2880 | 小集群名额问题        |
| 惩罚按 1s、2s、4s 增长，带抖动，上限 60s；试探成功后回到 1s                                                            | 2.3                   |
| 三台全部熔断时，兜底使用原列表，调用不因为没有候选而失败                                                               | 2.3                   |
| 期满后 60 个并发 `pick`，只有 1 个落到试探中的端点                                                                     | 第二期丙的恢复冲击    |
| 试探在 `end` 时判定：HTTP 收到 200 即恢复，不等 `done`；收到 503 即重新熔断并升档                                      | 3.1                   |
| SSE 与 WebSocket 的试探在握手成功时判定，长连接不会把端点一直卡在试探中                                                | 删除 `probeTimeoutMs` |
| `end` 的调用时机与次数：HTTP、SSE、WebSocket 各一组；构建失败、拦截器短路、`makeResponse` 不调用 `end`                 | 3.1                   |
| 拦截器前后各等 80 毫秒：p2c 分给慢端点的流量接近没有拦截器时的水平                                                     | p2c 25.35%            |
| p2c：`start` 后没有 `end` 的 `done` 仍释放在途数                                                                       | 3.2                   |
| 大面积故障时，重试预算限制换台次数；预算在 TTL 后恢复                                                                  | 4                     |
| 每个新选项的非法取值得到 `REQ_OPTIONS_INVALID`；删除的选项传入时同样得到 `REQ_OPTIONS_INVALID`                         | 2.1、4                |

时间用 `vi.useFakeTimers({ toFake: ["Date"] })`，随机用 `vi.spyOn(Math, "random")`，集成测试走 `packages/core/test/` 的夹具服务器，断言选台与状态变化，不断言耗时。删除的功能连同其测试一起删除，在报告里列出删除的测试文件与用例。

## 6. 文档

- 改写 en-US `docs/client.mdx` 的健康过滤与 p2c 小节、自定义均衡器一段与参考表；`api/client.mdx` 同步。写明每项行为的出处项目，以及与 Envoy、gRPC 的差别（无名额、`gateway-error` 含义不同、传输层响应只能到响应头或 `open`）。
- 公开导出有增删时，更新 `doc/scripts/api-order.ts` 与各处计数，运行 `bun run --cwd doc extract-api`。`doc/e2e/site.browser.spec.ts` 第 100 至 102 行搜索 `withEndpoint` 的条数现在是 3。
- 更新 `packages/core/design.md`、`packages/core/README.md` 与 `doc/examples/`。
- 只改 en-US，其他 10 个语言由审查方另派人同步。

## 7. 交付

- 不提交、不推送、不建分支。不修改 `docs/` 下的设计文件，发现冲突写进报告。
- 报告写明：每项的失败与通过输出、变异检查结果、删除的代码与测试、改动的文件、每条命令的退出码、核对上游源码得到的公式、规格没写清的地方以及你的决定。
