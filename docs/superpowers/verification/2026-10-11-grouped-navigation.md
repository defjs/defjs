# 分区分组导航验收记录

日期：2026-10-11。方案：[分区分组实施计划](../plans/2026-10-11-grouped-navigation.md)。工作区：`/Users/munmunmiao/.codex/worktrees/fumadocs-tdd/zen-kit`，分支 `codex/fumadocs-migration`。本次增量以实施前的 `before-navigation.tar.gz` 为基线，保留先前未提交的 Fumadocs 迁移工作。

**交付状态：导航实现、内容及工程审查完成，所有分项检查通过；完整 `bun run verify` 命令未整体通过。** 完整命令在 Core 浏览器测试启动前遇到本机 localhost 端口冲突，具体证据和范围见下文。没有通过修改配置、关闭浏览器或降低覆盖率门槛绕过失败。

## 实际行为

- 三个阅读区固定为“指南 / 操作示例 / API 参考”，分别进入原有指南、示例和 API 索引。
- 指南使用“开始使用、调用与契约、请求与实时通信、错误与拦截、框架与观测”五个可见分组；“设计决策”是最后一个独立入口。中文短标签保留 Struct、Command、Client 等准确技术名称。
- 示例按 HTTP、认证、实时通信、测试与封装组织；API 保留模块与集成包分类，170 个符号详情仍可到达。
- 指南与示例的静态目录包含全部文章；相关主题提供指南、示例及模块 API 之间的入口，不截断 API 链接。移除重复的常驻“章节目录”项。
- 当前阅读区和文章有明确语义；手机菜单使用现有 Fumadocs/Radix 组件完成初始焦点、Tab 约束、Escape 和焦点归还。无 JavaScript 时提供原生目录和普通链接。
- 11 种语言同步调整；原生面包屑、上下页和 API 符号相关链接继续使用现有树。没有新增组级面包屑行为。

本次没有新增依赖、修改库源码或更换运行时。实现集中于 `doc/app/lib/navigation.ts`、`navigation-copy.ts`、`doc/app/components/navigation.tsx`、共享页面入口和对应内容元数据及回归测试。

## 内容保留与审查

独立对比实施前快照与最终内容：Markdown/MDX 文件均为 **2277**，无新增或删除；275 个文件发生差异，其中正文变化仅有已授权重写的 **22 个指南/示例目录页**。去掉 frontmatter 后，其余正文逐字节相同。全语言真实内容树测试同时校验 URL 集合、页面引用、唯一性及源树不突变。

内容审查修正了目录中“设计决策”误归入框架列表的问题，以及法语 SDK 标签对发布行为的过度承诺。工程审查修正了 HTTP 主题缺少 API 入口及原生 separator 祖先关系；最终均无剩余阻塞发现。

证据：[内容对比](../../../.superpowers/sdd/2026-10-11-grouped-navigation/content-preservation.json)、[工程审查](../../../.superpowers/sdd/2026-10-11-grouped-navigation/engineering-review.md)、[过程台账](../../../.superpowers/sdd/2026-10-11-grouped-navigation/progress.md)。

## 检查结果

以下均为本次最终实现上的本地结果；没有用先前迁移验收代替本次验证。

| 命令或检查                                                     | 退出状态与结果                                                                            | 原始记录                                                                                      |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `bun run lint`、`bun run fmt:check`                            | 均为 0；完整 verify 也通过这两个阶段                                                      | `lint-green.log`、`fmt-final.log`、`verify-final.log`                                         |
| `bun run --cwd packages/core test`（启用 Playwright 诊断日志） | 0；99 文件、1780 测试；四项覆盖率均为 100%                                                | `core-protocol-diagnostic.log` / `.exit`                                                      |
| `bun run --cwd packages/opentelemetry-server test`             | 0；10 文件、180 测试；四项覆盖率均为 100%                                                 | `remaining-opentelemetry-server.log` / `.exit`                                                |
| `bun run --cwd packages/react test`                            | 0；4 文件、12 测试；四项覆盖率均为 100%                                                   | `remaining-react.log` / `.exit`                                                               |
| `bun run --cwd packages/vue test`                              | 0；4 文件、14 测试；四项覆盖率均为 100%                                                   | `remaining-vue.log` / `.exit`                                                                 |
| `bun run --cwd doc test`                                       | 0；12 文件、30 测试、17072 断言                                                           | `remaining-doc.log` / `.exit`                                                                 |
| `bun run build`                                                | 0；全仓类型检查、四库 JS/声明及文档静态构建完成；2279 个生成 HTML 的链接检查通过          | `final-build.log` / `.exit`                                                                   |
| `bun run --cwd doc test:site`                                  | 0；Chromium/Firefox 共 9 测试、2126 断言、4 文件                                          | `final-site.log` / `.exit`                                                                    |
| 独立浏览器脚本                                                 | 0；8 个页面/尺寸场景，无页面或控制台错误，无整页横向溢出                                  | `independent-browser.ts`、`.log`、`.json`                                                     |
| `git diff --check`                                             | 0                                                                                         | 本地最终差异检查                                                                              |
| 完整 `bun run verify` 及两次诊断重验                           | **均为 1**；Core 94/99 文件、1715 测试完成，另 5 个 Chromium 文件未开始；不能计为完整成功 | `verify-final.log`、`verify-final-diagnostic.log`、`verify-final-protocol.log` 及各自 `.exit` |

日志位于本地被忽略的 `.superpowers/sdd/2026-10-11-grouped-navigation/`。验收记录及计划落盘后另做这两个文件的定向格式化和最终格式检查，不改动产品输入。

`bun run build` 中的 Bun 检查覆盖根项目 250、文档项目 64 个 TS 文件；1056 个完整文档示例按 83 个不同上下文检查，2442 个签名/片段明确分类。输入并集检查覆盖工作区 TS/TSX/MTS/CTS。Vue 模板及完整 MDX 模板的静态类型检查仍不属于这些结果。

## 完整验证失败的边界

前两次完整运行均在 Core Chromium 会话连接阶段等待 120 秒后退出。单独 Core 全包运行通过后，第三次完整运行启用协议日志，捕获到 **5 个 Chromium 会话入口均从 `[::1]:63315` 返回 HTTP 404**，尚未加载测试脚本。

成功的 Core 分项命令为 `DEBUG=pw:protocol,pw:api VITEST_PW_DEBUG=1 bun run --cwd packages/core test`；最终失败的完整命令为 `DEBUG=pw:protocol,pw:api VITEST_PW_DEBUG=1 bun run verify`。中间一次完整诊断使用 `DEBUG=vitest:browser:playwright,vitest:browser:pool VITEST_PW_DEBUG=1`，首次未加诊断变量。诊断变量只增加日志，没有更改测试选择或覆盖率要求。

同一时刻的监听检查显示，本次测试进程监听 `127.0.0.1:63315`，另一个工作区的测试进程监听 `[::1]:63315`。对同一会话 URL 指定地址请求，IPv4 返回 200，IPv6 返回 404。该证据说明 Chromium 请求到了另一个监听进程；未继续追查地址选择的底层原因，也没有终止外部进程或改动测试配置。

这使最终整体 `verify` 仍然是失败状态。其余 workspace 测试、根构建及文档浏览器测试随后按原命令分别执行并通过；分项结果不冒充完整命令成功。

证据：[端口调查摘要](../../../.superpowers/sdd/2026-10-11-grouped-navigation/port-conflict-evidence.md)、[5 个会话的协议响应](../../../.superpowers/sdd/2026-10-11-grouped-navigation/chromium-session-404.json)。

## TDD 与最终浏览器证据

| 回归行为                 | 先观察到的失败                                                      | 实现后的结果                                                                 |
| ------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 真实内容树分组、分区入口 | `tree-red.log`：预期五个指南分组，实际零个                          | `tree-green.log`；最终真实内容树契约全语言通过                               |
| 静态目录完整性           | `overview-red.log`：预期五个 Markdown 分组，实际零个                | `overview-green.log`；所有集成与示例入口保留                                 |
| 分组语义及手机焦点       | `semantics-red.log`、`mobile-red.log`：缺少命名导航，焦点留在抽屉外 | `semantics-green-final.log`；最终双浏览器再次通过                            |
| 无 JavaScript 目录       | `ssr-directory-red.log`：服务端尾斜线导致当前区目录为空             | `ssr-directory-green.log`；实际禁用脚本后的链接跳转通过                      |
| 设计决策独立位置         | `standalone-red.log`：继承框架分组祖先                              | `standalone-green.log`；两种渲染器均跳过无标题分隔标记                       |
| 指南、示例和 API 互链    | `related-red.log`：HTTP 页面缺少相关 API 导航                       | `related-unit-green.log`、`final-site.log`；全语言目标校验与双浏览器跳转通过 |

嵌套分区菜单有关闭动画，键盘测试等待实际选项隐藏后再验证外层 Escape；浏览器返回测试等待目标页面当前项提交后再 Back。没有固定延时、强制点击、错误过滤或删除失败断言。最初浏览器 RED 明确针对旧产物；最终验收在开始和结束均检查构建新鲜度。

最终构建 fingerprint：`66327e36c876bda89452ce6292f310d786dc6fd376a374a50c6635aefaae4984`。

最终双浏览器测试覆盖 11 语言切换、搜索、API 筛选/详情、主题、资源、直达/刷新/返回、分区切换、手机前向及反向 Tab、Escape、焦点归还、选择文章后关菜单、无 JavaScript 目录和相关链接。

独立脚本另覆盖 835px 设计决策、1440px 指南总览、835px 示例/API 详情、1280px 阿拉伯语、768px 德语及 767/390px 手机断点。实际查看最终 835px、390px、阿拉伯语和德语截图，未见遮挡或标签布局问题；手机截图等待抽屉动画结束并检查其边界位于视口内。

截图：[835px 菜单](../../../.superpowers/sdd/2026-10-11-grouped-navigation/design-835-dark.png)、[390px 菜单](../../../.superpowers/sdd/2026-10-11-grouped-navigation/mobile-390.png)、[RTL](../../../.superpowers/sdd/2026-10-11-grouped-navigation/rtl-1280.png)、[德语长标签](../../../.superpowers/sdd/2026-10-11-grouped-navigation/long-labels-768.png)。

## 交付范围

本地预览继续使用 `http://localhost:64246/zh-Hans/docs/design-decisions`，读取最终静态产物。原 checkout `/Users/munmunmiao/Documents/web/zen-kit` 仍只有原有四份未跟踪的迁移准备文档，本次未改动。

未提交、推送、部署或运行远程 CI。未验证 Safari、真实手机或真实读屏器；无 JavaScript 验收限于阅读和基本导航，不宣称搜索交互可用。构建保留已有 `::highlight` 优化及浏览器模块外置警告，最终双浏览器没有运行错误。
