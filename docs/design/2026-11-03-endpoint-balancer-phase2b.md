# 端点负载均衡第二期乙：实施说明

- 规格：`docs/design/2026-11-02-endpoint-balancer.md` 第七稿修订十六。第 2.3 节的决定覆盖与之冲突的旧条文。
- 设计依据：同一目录下 `2026-11-03-endpoint-balancer-phase2-redesign.md` 的 P6、P7。
- 前置：第二期甲已实现，六道闸门已通过，见 `2026-11-03-endpoint-balancer-phase2a.md`。第一期、三个缺陷修复与第二期甲都还没有提交，不要回滚、格式化或改写它们。
- 先读 `AGENTS.md`，它的契约与六道闸门都适用。按测试驱动开发：每一项先写回归测试，跑出失败，再实现，再跑通过。

## 1. 范围

做：

- 健康过滤，规格第 5 节全部条文：包装层形态、样本与失败、候选计算、清算网格、连续失败与失败百分比两种判据、摘除与恢复、`isHealthy` 主动检查接口。
- 导出 `outlierDetection(child, options)` 与它的选项类型。内置工厂的 `outlierDetection` 选项与它是同一份实现，见规格第 3.3 节。
- `p2cBalancer`，规格第 4.5 节，延迟样本按本文第 3.2 节改用 `durationMs`。
- P6：`roundRobinBalancer` 与 `p2cBalancer` 默认启用健康过滤。
- 规格第 7 节里与上述功能有关的选项取值范围。

不做：`ringHashBalancer`、`XXH64`、`hashKey`（第三期）；版本号、发布与标签。

类型名、导出名、选项名、默认值以规格第 3、4.5、5、7 节为准。规格里的 `failback: true` 已被第二期甲的 `failbackMs` 取代，不要实现它。

## 2. P6 默认值

1. `roundRobinBalancer()` 与 `p2cBalancer()` 不传 `outlierDetection` 时，按规格第 5 节的默认判据启用健康过滤。
2. `outlierDetection: false` 关闭。传对象时按对象配置，省略的字段取默认值。其他取值是选项错误，调用得到 `REQ_OPTIONS_INVALID`。
3. `pickFirstBalancer()` 默认不启用，传对象时启用。
4. 第一期「不带健康过滤的 `roundRobinBalancer` 省略 `done`」：现在只在 `outlierDetection: false` 时成立。默认实例每次都返回 `done`。相应修改第一期的测试与 TSDoc，并在报告里列出。
5. 第二期甲的 P4 离线规则已在运行时的 `done` 包装里处理，健康过滤收到的是转换后的结果，不要重复判断。
6. 第二期甲的同一次调用内换台，每次尝试各自 `pick`、各自 `done`。健康过滤按每次尝试记账。被摘除的端点不在候选里，换台也就不会再选到它。

## 3. p2c 的延迟样本

### 3.1 来源

第二期甲给 `EndpointDoneInfo` 加了 `durationMs`：只对 HTTP，量的是被采用那次尝试从调用 `fetch` 到收到响应头的时间，不含拦截器。规格第 4.5 节原来用「`pick` 到 `done` 的时间」，现场测得拦截器会把它污染成 163 到 169 毫秒，所以改用 `durationMs`。

### 3.2 规则

替换规格第 4.5 节 `done` 的第 2 至第 4 条：

1. `pending` 减一，不低于 0。所有结果都减，这条不变。
2. `attempted` 为 `false` 时不产生样本。
3. `isFailure(info)` 为真时，产生惩罚样本，值为 `max(info.durationMs ?? 0, defaultRttMs)`。连接被拒没有 `durationMs`，所以取 `defaultRttMs`。
4. 不是失败、且有 `durationMs` 时，样本值为 `durationMs`。
5. 不是失败、又没有 `durationMs` 时，不产生延迟样本。SSE 与 WebSocket 都属于这种情况，所以长连接只计在途数。
6. 更新规则仍照 tower 的 PeakEwma，见规格第 4.5 节第 5 条。
7. `pick` 时不再记录开始时刻，闭包不需要它。

## 4. 回归测试

每条都要先失败、后通过。规格第 10 节「期」为「二」的全部行都要有测试，其中涉及 `failback: true` 的改按 `failbackMs` 理解，涉及 `pick` 到 `done` 计时的改按本文第 3 节。另加：

| 测试                                                                                                                         | 来源                  |
| ---------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| 三台副本滚动重启：默认 `roundRobinBalancer` 在连续失败达到阈值后摘除下线的副本，之后的 `pick` 不再选它；摘除到期后它回到候选 | 服务端扇出 55.42%     |
| 持续返回 503 的副本：默认轮询摘除它；摘除期间其余副本不受影响                                                                | 坏副本仍收 720 份请求 |
| `roundRobinBalancer({ outlierDetection: false })` 恢复第一期行为，成功的 `pick` 省略 `done`                                  | P6 第 4 条            |
| 默认 `roundRobinBalancer()` 每次 `pick` 都返回 `done`                                                                        | P6 第 4 条            |
| p2c：拦截器前后各延迟 80 毫秒，不影响延迟估计，快的端点仍被偏向                                                              | 现场 p2c 计时         |
| p2c：连接被拒的端点得到 `defaultRttMs` 惩罚样本，不会显得最快                                                                | 第 3.2 节第 3 条      |
| p2c：SSE 与 WebSocket 的 `done` 不产生延迟样本，只减在途数                                                                   | 第 3.2 节第 5 条      |
| 健康过滤与同一次调用内换台组合：第一次尝试的连接失败计入第一台的连续失败，第二次尝试的成功计入第二台                         | P6 第 6 条            |
| `outlierDetection` 的非法取值得到 `REQ_OPTIONS_INVALID`                                                                      | 第 2 节第 2 条        |

时间相关的测试按规格第 10 节：随机用 `vi.spyOn(Math, "random")` 固定序列，时间用 `vi.useFakeTimers({ toFake: ["Date"] })` 推进。健康过滤不创建计时器，测试只断言选台与状态的变化，不断言耗时。

集成测试走 `packages/core/test/` 的夹具服务器。

## 5. 文档

- 新导出写英文 TSDoc，`@group client`。
- 新导出按目录顺序追加到 `doc/scripts/api-order.ts`，运行 `bun run --cwd doc extract-api`。按实际新增导出调整 `navigation.spec.ts`、`api-slug.spec.ts`、`api-html.spec.tsx` 与 AGENTS.md 里的数字。
- `doc/e2e/site.browser.spec.ts` 第 100 至 102 行断言 API 页搜索 `withEndpoint` 的结果条数，现在是 3。新导出的名称如果包含 `withEndpoint`，要同步修改。
- 更新 en-US 指南 `docs/client.mdx` 的「Multiple endpoints」一节：健康过滤的作用、默认值、`outlierDetection: false`、两种判据、摘除与恢复、`isHealthy` 主动检查的写法、p2c 的选型建议。`api/client.mdx` 挂上新签名。参考表补上新导出。
- 只改 en-US。其他 10 个语言由审查方另派人同步。
- 更新 `packages/core/design.md` 与 `packages/core/README.md`。
- 示例放在 `doc/examples/`，通过类型检查。

## 6. 交付

- 不提交、不推送、不建分支。
- 不修改 `docs/` 下的设计文件。发现规格冲突时写进报告。
- 报告写明：每项的失败与通过输出、改动的文件、每条命令的退出码、规格没写清的地方以及你的决定。
