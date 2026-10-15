# Fumadocs 迁移开发验收记录

验收日期：2026-10-11。计划：[七项实施任务](../plans/2026-10-10-fumadocs-migration.md)。工作区：`/Users/munmunmiao/.codex/worktrees/fumadocs-tdd/zen-kit`，分支 `codex/fumadocs-migration`，基线 `d618396c88bc84645953684c0cb20feaae0f55a8`。原 checkout 未改；没有提交、推送或部署。

## 实施结果

原生 Fumadocs UI/MDX、React Router/Vite 全静态站已取代 VitePress/Twoslash。385 份原内容在 11 语言下均有目标；保留共享说明、可见示例、资源和既有 recipe。内容去向、来源 SHA 和正文摘要由 `doc/examples/content-map.json` 记录；独立审查另核对原正文及可见代码，没有整段知识丢失。四个库源码没有变动。

API 目录覆盖实际公开导出，现有 170 个包/符号身份均有 11 语言详情；目录提供名称、包和类别组合筛选及相关类型链接。参数表按源码保留必填/可选契约。首页、页面 title、单一 H1、原生 UI 翻译、主要 API 入口、根 `404.html` 和绝对单页 Markdown 链接均完成审查回归。

## 最终验证

`bun run verify` 实际退出 **0**，包含 lint、fmt、全部 workspace 测试、全仓 typecheck、四库及文档构建和双浏览器验收。完整日志：[verify-final.log](../../../.superpowers/sdd/2026-10-10-fumadocs-migration/verify-final.log)。

| 检查                               | 实际结果                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------- |
| Core / OpenTelemetry / React / Vue | 1780 / 180 / 12 / 14 测试通过，分别 99 / 10 / 4 / 4 个文件                  |
| 文档单元/recipe 测试               | 24 通过、0 失败；ETag `[200,304]`、Bearer `[401,200]`                       |
| Bun 项目类型检查                   | 根 250 文件、文档 57 文件无错误；输入并集覆盖全部工作区 TS/TSX/MTS/CTS 源码 |
| 文档示例                           | 1056 完整实例、83 不同编译上下文；2442 签名/片段明确分类                    |
| 库构建                             | 四包 JS 和 `.d.ts` 均存在且非空；声明继续由根 TS7/tsdown 生成               |
| 静态构建                           | `doc/build/client`；2279 个生成 HTML 的内部页面、资源和锚点检查通过         |
| Chromium / Firefox                 | 两项全部通过、0 失败，1936 个断言；实际最终产物，控制台和 pageerror 为空    |

浏览器覆盖直接导航与刷新、三个阅读区域、11 语言实际菜单切换及切回英语、RTL、移动菜单、主题、静态搜索及 locale 过滤、API 筛选与详情/类型跳转、键盘搜索跳转、未知路径真实 404、无 JS 首页/API 阅读。LLM 索引 207 条绝对 Markdown URL 逐条请求实际输出；配置域名映射另有单元测试。独立只读浏览器复验另确认首页、中文 API、阿拉伯语移动端、单一标题、无横向溢出及 Markdown 文件存在。

完整 verify 结束后，独立发布门禁修正 IPv6 hostname 方括号匹配：`SITE_URL='https://[::1]' bun doc/scripts/check-site-url.ts` 从错误退出 0 改为退出 1；`https://docs.example.test` 正例退出 0。该测试域名仅用于检查，不是正式域名。门禁修改后另运行文档 Bun 类型检查、lint 和格式检查。

## TDD 与过程证据

本地原始日志保留在被忽略的 `.superpowers/sdd/2026-10-10-fumadocs-migration/`；[进度台账](../../../.superpowers/sdd/2026-10-10-fumadocs-migration/progress.md) 按任务记录命令和实际结果。

| 行为                         | RED 证据                                                                  | GREEN 证据                                                             |
| ---------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 原生内容路由                 | `bun test doc/test/routes.test.ts`：2 失败                                | 同命令：2 通过                                                         |
| 围栏保真、例子隔离、Vue 脚本 | `task3-red.log`、`task3-isolation-red.log`、`task3-vue-red.log`           | 提取器/recipe 测试及实际示例检查通过                                   |
| API 筛选与公开导出           | `task4-red.log`；公开导出测试先发现 8 个遗漏                              | 目录与全部导出目标检查通过                                             |
| 参数必填契约                 | `task4-required-red.log`                                                  | 渲染断言覆盖 config、struct/value、client/children、零项 rest options  |
| 可读 Markdown 与真实链接     | `task5-markdown-red.log`、`task5-generics-red.log`、`task5-links-red.log` | 单元测试、全站链接检查通过                                             |
| 构建新鲜度与并发输入变化     | `task7-build-state-red.log`、`final-build-red.log`                        | 缺失/过期产物拒绝；构建前后 hash 不同拒绝盖章，相同才生成根 404 并盖章 |
| 绝对 LLM URL 与代码保真      | `llms-links-red.log`、`llms-code-red.log`                                 | 配置域名和围栏/内联代码保真测试通过                                    |
| 发布根 404 内容消费          | `preview-root404-red.log`                                                 | `preview-root404-green.log`，未知路径使用交付根 404 文件               |

Preview 包装最初先实现后测试，属于过程偏差，不计作初始 TDD，也没有删除实现补造记录。其直接访问、真实 404 和资源清理经实际测试；缺失/过期构建产物由验收前门禁拒绝。纯配置和机械内容搬迁使用构建、内容保留、输入覆盖及浏览器证据，没有机械新增映射测试。

早期完整 verify 曾在浏览器操作失败，未计为成功。后续快速导航阶段 Firefox 一次 React Router 错误未取得完整堆栈，原因未证实；直接导航/刷新等待 networkidle 后，双浏览器独立重验及最终 verify 都通过，未过滤 console 错误、强制点击或跳过浏览器。

## 检查边界与发布条件

当前 3465 个 TS/TSX 围栏中，1023 个完整例子检查，2024 个为 API 签名，418 个为需要调用方上下文的片段；逐项理由记录在 `doc/examples/contexts.json`。另 33 个 Vue typed setup 脚本检查，合计 1056 个完整实例。可见代码是唯一来源，辅助声明和多文件关系单独记录，检查失败的完整例子没有批量改为片段。

Vue 模板和完整 MDX 模板静态类型检查未覆盖。站点 TSX、TS/TSX 围栏和提取的 Vue TS 脚本由 Bun 检查，MDX 内容实际构建并在浏览器运行；这些证据不等同于完整模板静态检查。

正式 `SITE_URL` 尚未提供。本地默认 localhost；发布工作流先验证确认的 HTTPS origin，缺失/本地地址时失败，防止上传 localhost canonical、sitemap 和 LLM URL。仍有 CSS `::highlight` 优化及浏览器模块外置构建警告，完整双浏览器流程没有运行错误；逐项搜索高亮视觉效果未单独断言。本记录不宣称远程 CI、部署或生产验收完成。

## 导航反馈增量验收（2026-10-11）

用户反馈首页侧栏不直观。此轮只调整阅读区导航：使用原生 `DocsLayout` top tabs，删除重复 `links`；将既有首页归入文档阅读区，侧栏按“概览 → 快速开始 → 章节目录 → 既有章节/集成”排列。Recipes/API 索引在各自侧栏标为“概览”。全部 URL、11 种语言及教学正文保持不变，移动端沿用原生阅读区下拉菜单，没有重写 sidebar 或新增依赖。

原生 Fumadocs 16.17.1 的 top tabs 与正文共用 `grid-area:main`，首次启用时背景拉满正文高度，将 tab 链接推至首屏之外并遮挡内容。通过 `containerProps` 增加独立自动高度 tabs 行，保留原生列宽；局部 CSS 将原生 tabs div 放入该行，没有固定高度补偿或修改依赖。

TDD 证据保留于同一进度目录：

- `navigation-tree-red.log`：原树仍有首页与三个阅读区共四个根节点，回归失败；`navigation-tree-green.log`：11 语言、121 断言通过，URL 集合不变、源树不突变、首页/快速开始/章节目录触发文档 tab 原生 active。
- `navigation-browser-red.log`：旧站首页侧栏缺失“概览”，双浏览器失败。
- `navigation-layout-red.log`：首屏位置回归实际得到 tab 的 `y=2541.78`，超过 100px 门槛。修复后同时验证 tab/H1 位于首屏，以及 JS/无 JS 的 H1 中心点由 `elementFromPoint` 命中自身，避免把 DOM 可见误判为用户可读。
- 导航测试等待目标区域的概览链接 `data-active=true` 后检查章节，避免仅等待 URL 时读到旧侧栏；没有强制点击或过滤错误。

| 此轮检查命令                                  | 实际结果                                                              |
| --------------------------------------------- | --------------------------------------------------------------------- |
| `bun test doc/test`                           | 25 通过、0 失败，2833 断言，12 文件                                   |
| `bun check --project doc/tsconfig.json`       | 60 文件无错误                                                         |
| `bun doc/scripts/check-typecheck-coverage.ts` | 全仓源码输入并集无漏项                                                |
| `bun run lint`、`bun run fmt:check`           | 均退出 0                                                              |
| `bun run --cwd doc build`                     | 退出 0；2279 页内部链接检查通过                                       |
| `bun run --cwd doc test:site`                 | 退出 0；Chromium/Firefox 原验收与新增导航共 4 通过、0 失败、1982 断言 |

完整浏览器日志：[navigation-site-green.log](../../../.superpowers/sdd/2026-10-10-fumadocs-migration/navigation-site-green.log)。新增回归覆盖 835px 首页三个区域入口单次、概览与快速开始直接可见、当前页定位、区域切换后只显示对应章节、无 JS 阅读和导航、390px 手机菜单及阅读区切换。原迁移浏览器流程重新覆盖全部语言、搜索、API 筛选、主题、资源及控制台错误。

父侧独立只读截图复验通过：835px 首页/快速开始/API/阿拉伯语 RTL，390px 菜单，767/768/1280/1440px 响应式边界，1440px 折叠侧栏，以及无 JS 快速开始导航；实际查看首页/API/移动端/RTL/宽屏/折叠截图，顶部入口与正文正常且无横向溢出。截图位于本地 `/private/tmp/defjs-fumadocs-visual.nmlpnc/navigation-*.png`，构建前后 fingerprint 一致。

此轮没有修改库源码，按影响范围完成以上检查，没有重复四库测试。前述完整 `verify` 保留为上一轮迁移证据，不代替本轮增量验收。未提交、推送或部署；正式域名与模板静态检查边界仍同上。
