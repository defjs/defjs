# Fumadocs 文档站开发规格

日期：2026-10-10。仓库基线：`feat/up`，`d618396c88bc84645953684c0cb20feaae0f55a8`。

状态：隔离工作区已完成实施和本地验收；替代同日 Starlight 规格。准备阶段的验证保留为历史依据，当前实现及验证结果见 [验收记录](../verification/2026-10-10-fumadocs-migration.md)。尚未提交、推送或部署。

## 1. 目标与已确认要求

1. 采用 Fumadocs 原生组织方式重建文档站。现有站点仅作为内容来源，不保留旧框架的目录、组件、主题、语法、路由或锚点契约。
2. 保留知识说明、有效示例、API 契约、资源及全部 11 种语言；允许重组、合并和拆分页面。验收内容完整性，不要求页面数量、目录条目或布局对应旧站。
3. 普通文档取消 Twoslash 类型悬浮提示；类型信息集中在 API 模块，查阅体验参考 Angular API。
4. 全仓类型检查统一使用 Bun，覆盖库、测试、脚本、配置、站点 TS/TSX 及可编译的文档 TS/TSX 示例。
5. 删除文档显式 TS6/Twoslash 依赖；保留根 TS7，供现有 tsdown 生成四个库的 `.d.ts`。
6. 只部署在正式主域名根路径；不做旧 URL、旧锚点、`.html` 或子路径部署兼容。
7. 开发、检查和构建保持 Bun 运行流程，不引入 Node.js 执行步骤。
8. 准备阶段仅编写资料；后续用户明确授权以 TDD 正式实施。实施仍不包含提交、推送或部署。

## 2. 本次采用的技术选择

以下为实施默认选择，不冒充用户逐项指定的技术细节。

- 宿主采用 React Router + Vite，页面使用 React/TSX，内容使用 Fumadocs MDX。输出全站静态预渲染产物，不依赖常驻服务器。
- 使用稳定的 `fumadocs-ui` 包；不使用当前脚手架自动选择的 `@fumadocs/base-ui` 别名。主题采用 Fumadocs 原生组件和 Tailwind CSS 4。
- 继续使用 Oxfmt 和 Oxlint，不新增 ESLint、Biome 或 Prettier。新增 React 规则只作用于文档站所需文件，不扩大为全仓规则整顿。
- 使用 Fumadocs 内置 ZBSearch 静态搜索、原生 Tabs、目录、导航和明暗模式；不新增收费搜索、AI 聊天、动态 OG 图片、博客、版本站或交互 playground。
- API 首期采用现有手写说明、签名及原生 TypeTable；索引筛选用小型 React 组件实现。`fumadocs-typescript` 暂不安装，自动提取不作为迁移完成的前置条件。
- LLM 输出使用官方 `llms()` 和 processed Markdown 能力，不另装 Starlight/VitePress 的 LLM 插件。

### 2.1 已验证的依赖组合

| 依赖                                 | 版本与用途                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Bun                                  | 1.4.3；运行、安装及类型检查                                                                       |
| `fumadocs-core` / `fumadocs-ui`      | 16.17.1 / 16.17.1；版本保持一致                                                                   |
| `fumadocs-mdx`                       | 15.4.7；内容编译与 Vite 集成                                                                      |
| `react-router` / `@react-router/dev` | 8.4.0 / 8.4.0；路由、类型生成与预渲染                                                             |
| `react` / `react-dom`                | 19.3.0 / 19.3.0                                                                                   |
| `vite`                               | 8.3.4；沿用工作区版本                                                                             |
| `tailwindcss` / `@tailwindcss/vite`  | 4.3.3 / 4.3.3                                                                                     |
| `typescript`                         | 根目录 7.0.2；声明生成，不作为类型检查入口                                                        |
| 类型定义及 UI 辅助依赖               | 按实际 imports 添加 `@types/react-dom`、`@types/mdx`、`lucide-react` 等；不直接照抄脚手架全部依赖 |

开发时写入 Bun workspace catalog/锁文件，不另立文档 TS 版本。只有实际引用的集成才安装其可选 peer。Vue 和工作区包仍可能被示例使用，不能作为旧主题依赖误删。

`fumadocs-typescript@5.5.1` 的直接 TypeScript 依赖为 `~7.0.2`，已核对发布元数据。但 AutoTypeTable 面向对象类型且函数存在限制，尚未验证本仓库复杂泛型的生成质量；可在后续明确要求自动生成时单独评估。

## 3. 内容来源与新站结构

准备阶段基线为 385 篇 Markdown，11 种语言各 35 篇；原 API 目录有 162 个展示条目、130 个内容锚点。这些数字用于发现内容遗漏，不限定新站页面或 API 条目数量。

语言保留：`en-US`、`zh-Hans`、`zh-Hant-TW`、`zh-Hant-HK`、`ja-JP`、`ko-KR`、`de-DE`、`fr-FR`、`es-ES`、`ru-RU`、`ar`。

### 3.1 内容与路由

- 采用原生目录式 i18n：`doc/content/<locale>/`，Fumadocs `parser: 'dir'`；集合根目录为 `content`。
- 默认英语 URL 不带语言前缀，其他语言加前缀；使用 `hideLocale: 'default-locale'`，通过静态路由实现，不依赖 middleware/cookie。
- 默认入口为 `/`，正文分为 `/docs/...`、`/recipes/...`、`/api/...`；其他语言例如 `/zh-Hans/docs/...`。
- 各区域通过原生 page tree 和根文件夹导航组织，不复刻旧侧栏。排序及标签使用 `meta.json`，已有 UI 译文按新功能复用。
- 纯正文保留 `.md`；确需组件时使用 `.mdx`。预渲染、内容检查和搜索均覆盖两种扩展名。
- 阿拉伯语页面设置 `lang` 和 `dir='rtl'`，并配置 RootProvider 的方向。已有译文不得以英语回退代替；迁移核对期间关闭缺译回退以暴露遗漏。
- 保留 logo、编辑入口及相关版权信息，清除脚手架作者、示例仓库、无关首页和外部字体等默认内容。

每份原文建立内部的内容去向记录，可一对多或多对一。保留知识和示例语义；发现与公开源码冲突的陈旧说明时据源码纠正并记录。此记录用于验收，不实现运行时兼容层。

### 3.2 示例与组件

- 安装命令改用 Fumadocs Tabs；代码高亮、复制与文件名使用原生能力。
- 704 个原 Twoslash 围栏包含 TS/TSX 和 33 个 Vue 示例；44 条 `@filename`、11 条 `---cut---` 是转换时需要处理的上下文线索。
- 一次性将多文件关系和隐藏声明整理为新检查上下文；新站及长期检查器不继续模拟 Twoslash 协议，不展示隐藏声明。
- 内容检查上下文放在 `doc/examples/`，仅保存辅助内容和映射，页面中的可见代码仍为唯一来源；不得另存一份手写代码冒充检查文档。
- Markdown/MDX 提取需保留围栏 info、原始代码及行号。Bun Markdown 回调的 `meta.language` 不能保留完整 info-string，这一已验证限制必须由提取器和回归测试处理。

## 4. API 阅读体验

- `/api/` 展示包、符号名称和类别；支持名称不区分大小写查询、包/类别组合筛选、结果计数和空结果反馈。
- 条目身份为“包 + 原始符号名”；路由 slug 显式指定并检测冲突。公开导出及现有 API 知识均须有去向，不要求照抄旧 162 行目录。
- 详情展示签名、泛型、参数、返回值、字段、说明、示例、相关类型及教程链接。函数和复杂泛型保留可读签名，适合表格的数据使用 TypeTable。
- 多个符号共享的说明可保留为模块概览或引用，避免拆页后丢失公共内容或生成空详情页。
- 保留全部现有翻译；源码只能用来核对技术事实，不虚构参数解释或翻译。
- 静态 HTML 中已包含目录与详情；JS 只增强筛选。键盘、无结果状态、移动端和禁用 JS 的基本阅读均需验收。

## 5. 检查、构建与部署

### 5.1 全仓 Bun 检查

根 `bun run typecheck` 为唯一全仓入口，顺序执行：

1. `bun run --cwd doc typegen`：使用 `bun --bun react-router typegen` 生成路由/内容所需类型。
2. `bun check --project tsconfig.json`：检查库、根脚本、测试和配置。
3. `bun check --project doc/tsconfig.json`：检查文档应用 TS/TSX、配置、脚本及测试。
4. `bun run --cwd doc check:examples`：提取并检查所有语言中的可编译 TS/TSX 示例。

文档有独立 JSX、路由生成目录和路径别名配置，因此根 tsconfig 可将 `doc` 交由文档项目检查；这不是漏检，验收必须核对两个项目输入的并集。根配置补齐 `.tsx`，不得通过排除真实源码、`any`、`noCheck` 或 `@ts-ignore` 隐藏错误。

示例临时项目通过 `paths` 指向各库源码，不依赖 `dist`。不同译文中不同的代码分别检查；相同代码只在辅助文件及编译上下文也相同时去重。完整例子、签名草图和上下文片段必须有明确分类，空输入及未分类输入不能静默通过。

TSX 的类型错误必须有故意失败的探针。MDX 编译通过不等于其组件属性经过静态类型检查；Vue 代码围栏也不会自动被 Bun 检查，见第 7 节。

### 5.2 命令顺序

- 根 `build` 维持“全仓 typecheck → workspace build”。`doc build` 只执行 `bun --bun react-router build` 及静态产物检查，不反向调用根 typecheck。
- 文档 `test` 仅执行 `bun test ./test`，不要求已有构建产物。
- 文档 `test:site` 执行 `bun test ./e2e`，使用刚构建的静态产物。
- 根 `verify`：`lint → fmt:check → workspace test → build → doc test:site`。缺少本次构建产物必须失败，不测试旧输出。
- 继续用 tsdown 生成四个库的 JS/`.d.ts`；不更换库构建器。
- Bun 单元测试读取普通 TS 数据和内容文件；Fumadocs macro 模块只通过 Vite 加载，不能把它作为可直接在 Bun 中求值的普通模块。

### 5.3 静态交付

- 输出为 `doc/build/client/`。每个语言的所有页面、API 详情、搜索资源、LLM 资源均需预渲染；不依赖 SPA 重写来修复缺失页面。
- 预渲染枚举使用原生 `getSlugs` / `createGetUrl` 和共享 i18n 配置；必须与 Fumadocs 内容源生成的 URL 一致。验证直接访问和刷新嵌套路径。
- 搜索使用 `staticGET` 导出和静态客户端；默认内置引擎为 ZBSearch。按 locale 过滤结果，验收中文、日文及阿拉伯语，不复制旧教程的 Orama 插件配置。API 数据须生成可读的索引文本，不能让 TypeTable 的原始 JSX 属性成为搜索摘要。
- 保留英语 `llms.txt`、`llms-full.txt` 和按页 Markdown，其他语言不混入英语全文。Tabs、TypeTable、API 索引要有可读文本输出，不能只留下 JSX 调用。
- 将现有 HTML 链接检查的通用文件/锚点逻辑迁至 `doc/scripts/check-links.ts`，检查新输出；不保留旧主题选择器。额外核对搜索、LLM 与资源链接。
- 静态预览使用 Bun，只服务输出目录；无文件时返回真实 404。构建提供可用的 404 页面。
- 文档 release job 在根目录先运行 `bun run typecheck`，再构建文档，上传 `doc/build/client`。不增加发布权限或执行部署。

## 6. 开发前验证证据

隔离目录：`/tmp/defjs-fumadocs-preflight.R5c6h5`。它不是实施目录，不把样例站复制为最终产品。

| 验证               | 结果与边界                                                                                                                                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 官方 CLI           | `create-fumadocs-app@16.2.18` 在 Bun 1.4.3 下失败。根因是 `fuma-cli@0.3.2` 静态导入 Bun 尚未提供的 `node:module.findPackageJSON`；不纳入正式工作流                                                                         |
| 手动配置静态站     | 官方 React Router SPA 模板采用第 2 节稳定包，移除无需求的 OG/工具依赖后，`bun --bun react-router build` 退出 0；输出 HTML、搜索与 LLM 静态资源                                                                             |
| Bun 类型检查       | `bun --bun react-router typegen && bun check --project tsconfig.json` 退出 0，检查 26 个文件                                                                                                                               |
| TSX 负例           | 数字调用 `toUpperCase()` 与错误的 JSX `disabled` 属性分别报 TS2339/TS2322，整体退出 1；探针已移除                                                                                                                          |
| 原生 i18n 路由     | `parser:'dir'` + `hideLocale:'default-locale'` 对英语、中文、阿拉伯语生成预期 URL，内容源与显式路由枚举一致                                                                                                                |
| 搜索引擎           | 英语、中文、阿拉伯语检索与 locale 过滤均通过；静态索引导出通过。这是小数据探针，不代表全部内容的相关性与性能已经验收                                                                                                       |
| Chromium 静态页面  | Bun 提供构建目录：嵌套页面直达、刷新、TypeTable、Tabs、静态搜索、无 JS 正文/类型表和未知路径 404 均通过；未捕获页面异常或请求失败。屏蔽了模板的外部字体请求，未验收正式外观及全部语言 UI                                   |
| 静态资源与转换边界 | `llms.txt`、`llms-full.txt`、单页 Markdown 及搜索资源均 HTTP 200 且非空；默认 processed Markdown 保留 TypeTable/Tabs 的 JSX，搜索摘要也会暴露 TypeTable 属性。因此正式实施必须加入可读文本转换，不能以资源存在代替内容验收 |
| TS 依赖            | 基础隔离站锁文件只解析到 TypeScript 7.0.2；不保证正式全仓所有传递依赖也只有这一版本，实施后需复核                                                                                                                          |
| 独立规格复核       | 新的只读 builder-check 复核未发现除第 7 节已列事项外的重要规划空白；它不替代实现后的代码审查与测试                                                                                                                         |

隔离命令为 `bun run build`、`bun run typecheck`（在 `site/` 中）和 `bun browser-probe.mjs`（在隔离根目录中），最终均退出 0；故意失败的 TSX 探针单独退出 1。浏览器使用仓库现有 Playwright 的 Chromium，未运行 Firefox。

准备阶段没有重跑原仓库完整测试：同日先前基线中根构建和 386 页链接检查通过；完整 `verify` 曾在 Core Firefox 连接处超时，定向复查 65 个测试通过，根因未确认。此历史状态不作为当前验收依据；当前完整验证结果另见验收记录。

## 7. 尚待输入和已知边界

- **正式主域名仍未提供。** 本地/隔离验证使用 localhost；实际域名集中在 `SITE_URL`，canonical、sitemap 和绝对 LLM 链接均读取该配置；发布门禁拒绝缺失值及 localhost/loopback，不把样例域名当正式域名。
- **非 TS 模板检查边界。** 33 个既有 Vue 围栏保留为教学内容；其 typed setup 脚本提取后由 Bun 检查，Vue 模板没有完整静态类型检查，也未新增 Vue 应用或 vue-tsc。该范围按实施阶段沟通处理，不声称用户批准了完整模板静态检查降级。
- 站点组件 TSX 和可编译 TS/TSX 围栏纳入 Bun；MDX 经实际内容构建和浏览器验收，其完整模板静态类型检查仍未覆盖。不把编译或浏览器通过等同于模板静态检查，不引入 Node、TS6 或宽泛声明掩盖错误。
- 静态构建仍有 CSS `::highlight` 优化和 `node:fs/promises` 浏览器模块外置警告。当前完整 Chromium/Firefox 验收未发现搜索、主题、导航交互异常或 console/pageerror；搜索高亮的逐项视觉效果没有单独断言。

## 8. 完成标准

1. 现有知识、有效示例、API 说明、资产和 11 种语言内容全部有去向，旧页面数量不作为目标。
2. 三个阅读区域、语言切换、RTL、搜索、移动端菜单、明暗模式、编辑链接及基本无 JS 阅读有效。
3. API 分类、组合筛选、详情直达、类型链接和共享说明完整，与公开源码契约一致。
4. Bun 全仓检查覆盖项目输入并集和可编译示例，错误探针有效；未覆盖的非 TS 格式明确列出。
5. 新 HTML/锚点、搜索数据、LLM、Markdown、资源无内部断链，所有路径可静态直接访问。
6. 四个库 JS/`.d.ts`、原有 recipe 运行测试保持通过，完整 `bun run verify` 退出 0，Chromium/Firefox 验收真实构建产物。
7. 原框架依赖及无用目录在新内容、检查和构建就绪后移除；最终差异只包含本次目标。

## 9. 依据

- [React Router 集成](https://www.fumadocs.dev/docs/manual-installation/react-router)、[Vite 内容集成](https://www.fumadocs.dev/docs/mdx/vite)、[静态构建](https://www.fumadocs.dev/docs/deploying/static)。
- [i18n 配置](https://www.fumadocs.dev/docs/headless/internationalization/config)、[RTL 与主题](https://www.fumadocs.dev/docs/ui/theme)。
- [TypeTable](https://www.fumadocs.dev/docs/ui/components/type-table)、[AutoTypeTable 限制](https://www.fumadocs.dev/docs/ui/components/auto-type-table)、[LLM 输出](https://www.fumadocs.dev/docs/integrations/llms)。
- [内置静态搜索及多语言](https://www.fumadocs.dev/docs/headless/search/orama)、[Bun 类型检查](https://bun.com/docs/runtime/check)。版本与依赖另以本轮 npm registry 和隔离锁文件核对。
