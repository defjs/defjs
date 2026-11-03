# 端点负载均衡：与成熟开源实现的对照与修订建议

- 状态：第 5 节六个决定已于 2026-11-03 全部采用，作为规格第八稿第 2.4 节。
- 目标：Defjs 的负载均衡器以开源社区的成熟方案为基础。语义与默认值都要有出处；确实需要偏离时，写明偏离的理由与现场证据。
- 依据：2026-11-03 三份源码调研。所有引用固定到具体提交，主代理在本地克隆里抽查了每份报告的关键结论。
- 现行设计：规格 `2026-11-02-endpoint-balancer.md` 第七稿修订十七，以及二甲、二乙、二丙三份实施说明。现场证据见 `/tmp/lbexp/field2b/REPORT.md` 与 `/tmp/lbexp/field2c/REPORT.md`。

## 1. 结论

Defjs 是客户端负载均衡：它在调用方进程里选端点，看不到连接池，也没有后台计时器。成熟项目里与它同类的是 **Linkerd2-proxy、tower 与 Finagle**；Envoy 与 gRPC 的 A50 是代理或 xDS 体系，适合借鉴语义，不适合照搬默认值。

现行设计混合了两类来源：健康过滤照 Envoy 与 A50（30 秒线性倍数、10% 名额、10 秒清算网格），p2c 照 tower，半开、试探超时、慢启动、名额公式则是根据现场数据自定的。调研表明，自定的几项在成熟项目里找不到共同依据，而两个待决问题在 Linkerd 与 Finagle 里都已有成熟答案。

建议改为以 **Linkerd 的熔断模型** 与 **tower 的负载生命周期** 为主线，Finagle 补充重试预算与试探判定，Envoy 与 gRPC 只在命名与语义上对照。

## 2. 核实过的关键事实

| 项目             | 事实                                                                                                                                                            | 固定出处                                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Envoy            | 名额判断为 `100 × (已摘除 + 1) / 总数 <= max`；默认 10% 时 2 到 3 台一台都不摘；`always_eject_one_host` 默认关闭                                                | `envoy@42638435` `source/common/upstream/outlier_detection_impl.cc` L542–596                                     |
| grpc-go          | 名额判断为 `已摘除 / 总数 × 100 >= max` 时停止；默认 10% 时 3 台先摘 1 台；0% 一台不摘；无「保留最后一台」                                                      | `grpc-go@c2165f27` `internal/xds/balancer/outlierdetection/balancer.go` L739–800                                 |
| Envoy、gRPC      | 都没有半开单试探阶段；摘除到期后直接恢复正常份额                                                                                                                | 同上与 A50                                                                                                       |
| Linkerd          | HTTP 均衡用 `PendingUntilFirstData`：首个响应体帧就释放在途计数；健康分类到响应流结束才发送，两者分开                                                           | `linkerd2-proxy@8203cd2e` `linkerd/proxy/http/src/balance.rs`、`linkerd/http/classify/src/channel.rs` L175–269   |
| Linkerd          | 连续失败熔断：默认 7 次，惩罚 1 秒起、指数翻倍、上限 1 分钟、抖动 0.5；惩罚期满 `gate.limit(1)` 只放一个真实请求试探；无摘除名额，可全部熔断                    | 同上 `consecutive_failures.rs` L27–103；默认值见官方文档 2.18 `circuit-breaking.md`                              |
| Linkerd          | Peak EWMA 默认 RTT 30ms、衰减 10s                                                                                                                               | `linkerd2-proxy@8203cd2e` `linkerd/app/outbound/src/http/logical/profile.rs` L45–50                              |
| tower            | `PeakEwma::new` 必须传入默认 RTT 与衰减，库不给默认值；默认完成策略 `CompleteOnResponse` 在响应 future 完成时释放，HTTP 通常是响应头；从两个不同的就绪端点里选  | `tower@df06d70d` `tower/src/load/peak_ewma.rs` L93、`completion.rs`、`balance/p2c/service.rs`                    |
| Finagle          | 失败计数默认开启：30 秒内成功率低于 80%（至少 5 个请求）或连续失败 5 次；退避 `exponentialJittered(5s, 300s)`；复活后重置；全部不可用时 fail-open（panic 模式） | `finagle@ca472deb` `FailureAccrualFactory.scala` L25–90、`FailureAccrualPolicy.scala` L92–101、`PanicMode.scala` |
| Finagle、Linkerd | 重试预算默认 20%，每秒至少 10 次，TTL 10 秒                                                                                                                     | `finagle@ca472deb` `RetryBudget.scala` L97–115；Linkerd ServiceProfile 默认值                                    |
| resilience4j     | 半开默认放行 10 个调用；配置了半开最长等待时，超时视为**失败**重新打开                                                                                          | `resilience4j@v2.3.0` `CircuitBreakerConfig.java` L42–46                                                         |

## 3. 逐项对照与建议

| #   | 设计点                   | Defjs 现行                                               | 成熟项目                                                                                     | 建议                                                                                                                                                                                                           |
| --- | ------------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 摘除触发                 | 连续 5 次；`NET_UNREACHABLE` 或 ≥500；不计超时与读体中断 | Linkerd 连续 7 次（5xx 与流错误）；Finagle 连续 5 次或成功率 < 80%；Envoy 连续 5 次 5xx      | **保留连续失败判据与失败分类**。次数取 5，与 Finagle、Envoy 一致                                                                                                                                               |
| 2   | 摘除时长                 | 30s 起，线性倍数，上限 300s；10s 清算网格衰减倍数        | Linkerd 1s 起指数翻倍，上限 60s，抖动 0.5，复活后重置；Finagle 5s 起，上限 300s，等量抖动    | **改为 Linkerd 的指数退避**：1s 起、×2、上限 60s、正向抖动 0.5，试探成功后重置。删除清算网格与倍数衰减                                                                                                         |
| 3   | 摘除名额                 | `max(1, floor(N × 10%))`，保留最后一台                   | Linkerd、Finagle 没有名额；Envoy 默认 2 到 3 台不摘；gRPC 先摘 1 台                          | **删除名额与「保留最后一台」**，与 Linkerd、Finagle 一致；全部熔断时走第 4 项                                                                                                                                  |
| 4   | 全部不可用               | 退回原列表照常发送                                       | Finagle fail-open（panic）；Linkerd 等待后 503；Envoy 50% panic 默认 fail-open               | **保留 fail-open**，出处为 Finagle panic 模式。浏览器 SDK 没有排队等待的地方，等待式不适用                                                                                                                     |
| 5   | 半开试探                 | 一次试探；5 秒没结果视为成功；兜底可绕过                 | Linkerd `limit(1)`；Finagle 单试探，以响应 future 的结果判定；三家都没有「超时即成功」       | **保留单试探，删除 `probeTimeoutMs`**。试探在传输层拿到响应时判定（见第 7 项的新信号），出处为 Finagle                                                                                                         |
| 6   | 慢启动                   | 默认关闭；按概率准入候选                                 | Linkerd、Finagle、tower 没有；Envoy、HAProxy、nginx 按权重放量，默认关闭                     | **删除慢启动**。客户端同类项目都没有，半开已解决第一波冲击。以后需要时再按 Envoy 的权重公式加                                                                                                                  |
| 7   | p2c 在途数               | `start` 起，`done` 止（含后置拦截器）                    | tower 在响应 future 完成时释放，HTTP 通常是响应头；Linkerd 在首个响应体帧释放，健康结果另发  | **新增传输层响应信号**：HTTP 与 SSE 收到响应头、WebSocket `open`、或传输层在此之前失败时调用。p2c 在这一刻释放在途数并记 RTT。`done` 只负责健康结果。出处为 tower `CompleteOnResponse` 与 Linkerd 的两信号分离 |
| 8   | p2c 默认值               | 默认 RTT 1000ms；失败惩罚 `max(duration, defaultRtt)`    | Linkerd 默认 RTT 30ms、衰减 10s；tower 无失败惩罚，按真实耗时记                              | **默认 RTT 改为 30ms，删除失败惩罚**，由熔断负责剔除快速失败的端点，与 Linkerd 一致                                                                                                                            |
| 9   | 延迟样本来源             | `EndpointDoneInfo.durationMs`                            | tower 在负载句柄释放时按真实耗时记 RTT                                                       | **删除 `durationMs`**，p2c 用第 7 项信号自己计时。这两项都还没发布，可以直接改                                                                                                                                 |
| 10  | 同一次调用内换台         | 默认开启：安全方法、连接失败、额外 1 次                  | Envoy、Linkerd 默认关闭；Finagle 默认只重放确定未写出的请求；gRPC 透明重试需要「未处理」证据 | **保留默认开启**（主人已确认），并**新增重试预算**：默认 20%，每秒至少 10 次，TTL 10 秒，出处为 Finagle 与 Linkerd                                                                                             |
| 11  | `gateway-error` 命名     | 只指无故障码的 502、503、504                             | Envoy 同名条件还包含无响应的断连与重置                                                       | 保留现名，文档写明与 Envoy 的差别                                                                                                                                                                              |
| 12  | 选台抽样                 | p2c 无放回抽样                                           | tower、Linkerd、Finagle 无放回；Envoy、gRPC 有放回                                           | 保持，已与客户端同类一致                                                                                                                                                                                       |
| 13  | 健康过滤默认开启         | 轮询与 p2c 默认开启                                      | Finagle 默认开启；Linkerd、Envoy 默认关闭                                                    | 保持，出处为 Finagle                                                                                                                                                                                           |
| 14  | 失败百分比判据           | 可选，按 A50 清算网格                                    | Finagle 默认带成功率判据；Linkerd 固定发布版只有连续失败                                     | **删除**，因为第 2 项删除了清算网格。需要时再按 Finagle 的成功率窗口实现                                                                                                                                       |
| 15  | 离线不归因、`failbackMs` | Defjs 自有                                               | 无直接对应：浏览器特有；gRPC pick_first 断开后回到列表头                                     | 保留，文档标明是 Defjs 针对浏览器的适配                                                                                                                                                                        |

## 4. 修订后的效果

- **小集群问题从源头消失。** 没有名额；副本重启 2 秒后，下一次惩罚期满就能试探回来，不再空占 30 秒。
- **实现变简单。** 删除清算网格、倍数衰减、名额、失败百分比、慢启动、试探超时与 `durationMs`；健康过滤只剩连续失败计数与按端点的退避门。
- **p2c 与 tower、Linkerd 同构。** 在途数只覆盖到传输层响应，拦截器不再拉平快慢端点。
- **新增一项保护。** 重试预算防止换台在大面积故障时放大流量。

## 5. 需要确认的决定

1. 健康过滤改用 Linkerd 的连续失败熔断：1 秒起指数退避到 60 秒，抖动 0.5，试探成功后重置；次数保持 5。
2. 删除摘除名额、「保留最后一台」、清算网格、失败百分比判据。
3. 半开试探保留，删除 `probeTimeoutMs`，试探在传输层拿到响应时判定。
4. 删除慢启动。
5. 新增传输层响应信号，p2c 在此释放在途数并计时；删除 `durationMs`；p2c 默认 RTT 改为 30ms，删除失败惩罚。
6. 同一次调用内换台加上重试预算：20%、每秒至少 10 次、TTL 10 秒。

## 6. 调研限制

- 只读核对源码与官方文档，没有运行上游项目的测试或实网实验。
- Linkerd 较新的 HEAD 已有统一熔断器与成功率策略，本文以固定发布版的连续失败熔断为准。
- 浏览器 `fetch` 拿不到连接状态，所有「传输层」边界只能取响应头或 `open`，做不到 Envoy 的 stream 级或 Linkerd 的首帧级。
