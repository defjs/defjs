# 菜单层级与可选 tracer 验收记录

日期：2026-10-11。工作区：`/Users/munmunmiao/.codex/worktrees/fumadocs-tdd/zen-kit`，分支 `codex/fumadocs-migration`。保留此前未提交的 Fumadocs 迁移与分组导航改动。

**实现及本轮相关检查完成；完整 `bun run verify` 仍未通过。** 本轮完整命令在 Core Firefox 会话连接阶段超时，详细边界见下文。没有提交、推送或部署。

## 实际变化

- 保留已选定的分区分组：分组标题使用加粗文字和浅色底，子项增加逻辑缩进和细引导线；设计决策保留独立位置，API 符号保留原生目录深度。桌面、移动抽屉及无 JavaScript 目录使用一致的层级规则，RTL 使用逻辑方向属性。
- `OpenTelemetryServerOptions.tracer` 改为可选。省略后不创建本地 span，不隐式获取全局 tracer，不调用 span hooks；单独传入 `meter` 仍记录 HTTP、SSE、WebSocket 指标。
- 无本地 span 时继续传播提取到的父 context，不修改或结束父 span。WebSocket query 传播仍需显式开启。
- 显式提供 tracer 时保留原 `requireParentSpan` 行为：没有活动父 span 时跳过整套 instrumentation。省略 tracer 时该选项不阻止指标记录。
- `withOpenTelemetryServer(options)` 的对象参数仍必传；可使用 `withOpenTelemetryServer({ meter })` 或 `{}`。SDK、provider、exporter 的初始化和生命周期仍由应用负责。
- README 与 11 种语言的 77 篇指南/API 页面同步说明，包含只传 meter 的例子。生成的库声明确认包含 `tracer?: Tracer`。

本轮没有增加依赖、修改其他库的生产代码或降低覆盖率要求。导航实现只涉及现有组件和 CSS；OpenTelemetry 生产改动集中于 options 与三个 transport interceptor。

## TDD 与内容保留

导航先在 Chromium 和 Firefox 复现父子文字起点相同：要求至少 12px 逻辑缩进，实际 0px，四项回归失败；实现后四项、50 断言通过。

OpenTelemetry 运行时 RED 为 23 failed / 102 passed，表现为缺省 tracer 时读取 `startSpan` 抛错，或错误跳过指标；类型 RED 为 13 个 tracer 必传错误。实现后完整包 204 项测试通过，四项覆盖率均为 100%。回归使用真实 W3C propagator，覆盖父 context、baggage、空 context、各传输启动失败与终止分支、指标计数和原有错误/结果保留。

新增 `approvedProseRevision` 记录本次授权修改的 22 篇 primary 正文，测试继续比较当前正文与批准的 hash。独立核对确认：385 条原迁移记录的所有字段均完整保留，仅追加这 22 条修订信息；没有把这些页面排除出内容保护测试。原迁移 hash 和本次批准 hash 均可追溯。

## 本轮最终检查

| 检查                                | 退出状态及结果                                                                                                                   | 日志                                                    |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `bun run typecheck`                 | 0；根项目 250、文档项目 65 个文件；1056 个完整示例、83 个不同上下文、2442 个明确分类的片段/签名；输入并集覆盖全仓 TS/TSX/MTS/CTS | `optional-tracer/typecheck-final.log`                   |
| `bun run lint`、`bun run fmt:check` | 均为 0                                                                                                                           | `optional-tracer/lint-final.log`、`fmt-final.log`       |
| `bun run --filter '@defjs/*' build` | 0；四个库的 JS 与声明构建通过                                                                                                    | `optional-tracer/libraries-build.log`                   |
| OpenTelemetry 完整包测试            | 0；10 文件、204 测试；Statements 277/277、Branches 219/219、Functions 55/55、Lines 252/252                                       | `optional-tracer/package-green.log`                     |
| 文档单位测试                        | 0；12 文件、30 测试、17072 断言                                                                                                  | `navigation-hierarchy/unit-final.log`                   |
| 文档静态构建与链接检查              | 0；2279 个生成页面的链接检查通过                                                                                                 | `navigation-hierarchy/build.log`                        |
| 文档完整浏览器验收                  | 0；Chromium/Firefox 共 13 测试、2176 断言、5 文件                                                                                | `navigation-hierarchy/site-final.log`                   |
| 内容历史、构建与预览一致性          | 0；385 条原记录未改写，22 条修订 hash 匹配；两个目标预览页面 HTTP 200                                                            | `optional-tracer/final-integrity.log`                   |
| 本轮完整 `bun run verify`           | **1**；Core 94/99 文件、1715 测试完成，另 5 个 Firefox 文件未开始；会话连接超时                                                  | `optional-tracer/verify-final.log`、`verify-final.exit` |

表中日志简称对应 `.superpowers/sdd/2026-10-11-optional-tracer/` 与 `.superpowers/sdd/2026-10-11-navigation-hierarchy/`。验收记录落盘后另做格式检查和最终差异检查，不改变产品输入。

## 完整 verify 的限制

执行前检查 TCP 63315 没有监听进程，因此补跑一次未修改参数的完整 `bun run verify`。运行中该端口出现两个监听：本工作区 Core 测试监听 IPv6，另一个工作区 `/Users/munmunmiao/.cache/lyz-plan/p5b-sim/web` 监听 IPv4。完整命令最终报告 `core-browser (firefox)` 会话连接超时，持续约 120 秒后退出 1。

本轮确认了超时及并发监听，未采集该次会话的协议响应，因此不将端口竞争认定为本次失败的已证明唯一原因。此前独立的端口调查记录见 [分组导航验收](2026-10-11-grouped-navigation.md)。未终止其他工作区进程或改动测试配置，也没有将分项通过冒充完整命令成功。本轮完整命令在 Core 阶段退出，表中其余检查来自本轮单独执行的最终命令。

证据：[运行前端口检查](../../../.superpowers/sdd/2026-10-11-optional-tracer/port-final.log)、[运行中监听与工作目录](../../../.superpowers/sdd/2026-10-11-optional-tracer/port-during-verify.log)。

## 独立审查与预览

最终只读审查未发现阻塞缺陷，核对了无 tracer 生命周期、父 context 传播、指标独立性、兼容行为、公开说明、菜单键盘行为与 RTL，以及原内容 hash 保留。详见 [审查报告](../../../.superpowers/sdd/2026-10-11-optional-tracer/final-review.md)。

实现者与主线程均实际查看五张最终截图：[835px 中文](../../../.superpowers/sdd/2026-10-11-navigation-hierarchy/desktop.png)、[390px 手机抽屉](../../../.superpowers/sdd/2026-10-11-navigation-hierarchy/mobile.png)、[RTL](../../../.superpowers/sdd/2026-10-11-navigation-hierarchy/rtl.png)、[768px 德语长标签](../../../.superpowers/sdd/2026-10-11-navigation-hierarchy/german.png)、[API 目录深度](../../../.superpowers/sdd/2026-10-11-navigation-hierarchy/api.png)。这些场景未见横向溢出、遮挡或抽屉越界。

源码、静态产物与常驻预览的 fingerprint 一致：`4ba1e5a1d5a3a0c5d1788b22c3b9c9b5ba2d9f220da10f865e88274fed784e53`。

本地预览：[菜单](http://localhost:64246/zh-Hans/docs/design-decisions)、[OpenTelemetry 指南](http://localhost:64246/zh-Hans/docs/integrations/opentelemetry-server)。原 checkout 仍只有原有四份未跟踪的迁移准备文档，本轮没有改动。

未验证真实 SDK/exporter/collector、生产部署、Safari、真实手机或读屏器。全仓 Bun 类型检查不等于 Vue 模板或完整 MDX 模板静态类型检查；已完成的文档构建与浏览器验收范围如上。构建保留既有 TS7 API 实验性提示、React 指令和文档构建警告，未将其描述为无警告构建。
