# Fumadocs Migration Implementation Plan

> **For agentic workers:** 使用 superpowers:executing-plans 逐任务执行；用户另行选择子任务实施时再使用 superpowers:subagent-driven-development。复选框记录正式实施进度；七项任务已在隔离工作区完成本地验收，见 [验收记录](../verification/2026-10-10-fumadocs-migration.md)。

**Goal:** 以 Fumadocs 原生方式重建文档站，保留全部内容与语言，提供集中展示类型的 API 模块和全仓 Bun 检查。

**Architecture:** React Router + Vite 静态预渲染，React/TSX 站点组件，Fumadocs MDX 内容集合及原生 UI。使用内置静态搜索和 LLM 输出；以现有内容为来源重新组织页面，复用通用检查逻辑。

**Tech Stack:** Bun 1.4.3、Fumadocs Core/UI 16.17.1、MDX 15.4.7、React Router 8.4.0、React 19.3.0、Vite 8.3.4、Tailwind CSS 4.3.3、根 TS7、现有 Oxfmt/Oxlint/Playwright。

**Spec:** [开发规格](../specs/2026-10-10-fumadocs-migration-design.md)。本计划替代同日 Starlight 计划；执行前阅读规格中的已验证结果及待确认项。

## Global Constraints

- 采用 Fumadocs 原生组织方式重建文档站。现有站点仅作为内容来源，不保留旧框架的目录、组件、主题、语法、路由或锚点契约。
- 保留知识说明、有效示例、API 契约、资源及全部 11 种语言；允许重组、合并和拆分页面。验收内容完整性，不要求页面数量、目录条目或布局对应旧站。
- 普通文档取消 Twoslash 类型悬浮提示；类型信息集中在 API 模块，查阅体验参考 Angular API。
- 全仓类型检查统一使用 Bun，覆盖库、测试、脚本、配置、站点 TS/TSX 及可编译的文档 TS/TSX 示例。
- 删除文档显式 TS6/Twoslash 依赖；保留根 TS7，供现有 tsdown 生成四个库的 `.d.ts`。
- 只部署在正式主域名根路径；不做旧 URL、旧锚点、`.html` 或子路径部署兼容。
- 开发、检查和构建保持 Bun 运行流程，不引入 Node.js 执行步骤。
- 正式域名及非 TS/TSX 文档内容检查边界以规格第 7 节为准，未回答不等于批准。未授权不提交、推送或部署。

## Review Focus

| 高风险输入/条件                                      | 预期行为与所属任务                                                            |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| 页面合并、共享 API 说明与翻译差异                    | 每份知识都有去向，不能用总页数或英文回退抵消丢失。任务 2/4。                  |
| `.md` 与 `.mdx`、语言目录、嵌套 URL、直接刷新        | 所有最终 URL 均预渲染且与内容源一致，未知路径真实 404。任务 1/5/7。           |
| 多文件示例、隐藏声明、同名文件与泛型尖括号           | 提取代码保真，上下文隔离，诊断回到原页面；错误示例检查失败。任务 3。          |
| API 重名/slug 冲突、空筛选、键盘及无 JS              | 符号身份稳定，组合筛选正确，静态目录与详情仍可读。任务 4/7。                  |
| 静态搜索 locale、MDX 组件的 LLM 文本、生成类型未就绪 | 不跨语言混搜或输出空文档；typegen 在 Bun 检查前，站点测试在构建后。任务 5/6。 |

## 文件职责

| 文件/目录                                                               | 职责                                              |
| ----------------------------------------------------------------------- | ------------------------------------------------- |
| `doc/vite.config.ts`、`doc/react-router.config.ts`、`doc/tsconfig.json` | Fumadocs/Vite 插件、静态预渲染、独立 TSX 检查配置 |
| `doc/app/root.tsx`、`doc/app/routes.ts`、`doc/app/app.css`              | 全局布局、路由、原生主题                          |
| `doc/app/lib/{source,i18n,routes,site}.ts`                              | 内容集合、语言、URL 规则、正式站点信息            |
| `doc/content/<locale>/{docs,recipes,api}/` 与 `index.md`                | 新站原文、翻译、导航及 API 内容                   |
| `doc/app/components/{mdx,api-index,api-reference,search}.tsx`           | 原生 MDX 组件、API 交互及静态搜索                 |
| `doc/app/data/api-catalog.ts`                                           | 包/符号身份、类别、slug 与相关类型映射            |
| `doc/app/routes/`、`doc/app/llms/`                                      | 内容页面、API 索引、搜索资源、LLM 资源            |
| `doc/examples/`、`doc/scripts/{code-examples,check-examples}.ts`        | 示例上下文与 Bun 检查                             |
| `doc/scripts/{check-links,preview}.ts`                                  | 新产物链接验证与 Bun 静态预览                     |
| `doc/test/`、`doc/e2e/`                                                 | 构建前单元/recipe 测试、构建后浏览器测试          |
| 根/文档 manifests、`bun.lock`、tsconfig、忽略规则、工作流及 README      | 工作区集成、声明构建、CI 与交付说明               |

只为实际职责创建文件，小文件可合理合并。执行阶段先按工作区隔离约定保护用户改动；不把 `/tmp` 验证站直接复制进仓库。

## Task 1: 建立原生站点与静态路由

**Files:** 文档框架配置、`app/root.tsx`、`app/routes.ts`、`app/lib/{source,i18n,routes,site}.ts`、基础内容和工作区依赖。

**Interfaces:** `ContentRoute` 包含 `locale`、`slugs`、`url`；`getContentRoute(relativePath: string): ContentRoute` 解析 `content/<locale>/...`，使用原生 `getSlugs` / `createGetUrl`。`collectPrerenderPaths(): Promise<string[]>` 枚举正文及资源路由。`doc typegen/build/dev` 均显式用 Bun 执行 React Router。

- [x] 核对当前分支和差异，记录原文/章节、代码及资产的内容去向清单。该清单用于核对知识，不约束新站布局。
- [x] 手动配置规格中的稳定依赖，不运行已知在 Bun 下失败的脚手架，不安装 `@fumadocs/base-ui`、OG、云搜索或开发工具默认包。
- [x] 为路由映射写断言：英语首页 `/`、中文 `/zh-Hans/docs/start`、阿拉伯语 `/ar/docs/start`；`.md/.mdx` 都被枚举，未知语言和重复 URL 失败。
- [x] 配置 `parser:'dir'`、默认英语无前缀、11 语言和关闭缺译回退；原生 page tree 分为文档、Recipes、API。
- [x] 加入英语/中文/阿拉伯语代表页面、Tabs 与 TypeTable；预渲染全部页面以及静态搜索和 LLM 路由。
- [x] 运行 `bun run --cwd doc typegen`、`bun check --project doc/tsconfig.json`、`bun run --cwd doc build`；断言嵌套 HTML、数据资源存在，直接访问不依赖 SPA 回退。

## Task 2: 按新站组织保留全部内容

**Files:** `doc/content/`、`doc/app/lib/i18n.ts`、原生导航/主题；保留 `doc/public/logo.jpg`。

**Interfaces:** 内容去向清单以原文/章节标识为键，允许多个目标；所有新引用使用任务 1 的路由规则。

- [x] 先整理英语与中文的一组完整教程/recipe/API 页面，采用 Fumadocs 写法，确认标题、代码、Tabs 和链接正确。
- [x] 迁入全部语言，按新信息组织方式拆合页面；转换专用语法、多文件示例和隐藏上下文，不创建旧框架兼容层。
- [x] 按内容去向清单核对正文、示例和共享说明；所有既有翻译有目标，未获授权不得删掉不易转换的内容。
- [x] 补齐 UI 翻译、RTL、编辑链接和品牌信息；清除模板作者、测试域名和默认演示内容。
- [x] 构建全部内容，逐语言核对区域入口、语言切换及资源；目标页面数不作为保留判据。

## Task 3: 文档示例纳入 Bun 检查

**Files:** `doc/scripts/{code-examples,check-examples}.ts`、`doc/examples/`、`doc/test/code-examples.test.ts`、`doc/test/recipes.test.ts`。

**Interfaces:** `readCodeBlocks(source: string): CodeBlock[]` 返回 `language/code/info/line`；`collectExampleProjects(path: string, source: string): ExampleProject[]` 返回页面定位、相对文件名、代码和辅助文件。CLI 对错误、空输入及未分类示例非零退出。

- [x] 写失败测试：三/四反引号和波浪围栏、MDX Tabs 内代码、泛型及 `<>&` 保真、原始 info 不丢失。
- [x] 写失败测试：两个独立例子的同名文件互不污染；多文件相对 import 正确；隐藏声明参与检查但不进入展示/LLM 输出。
- [x] 实现从正文提取代码、引用新上下文映射并通过源码 paths 调用 Bun；不再长期解释 Twoslash 控制指令。
- [x] 正确 TS/TSX 退出 0；数字赋给字符串/错误 JSX 属性退出非零并定位原页面；翻译中独有错误和空集合也必须失败。
- [x] 显式分类签名草图及不完整片段；只在代码、辅助文件和编译上下文都相同时去重。
- [x] 迁移两个实际 recipe 运行测试，继续从文档提取执行，验证 ETag `[200,304]` 和 Bearer `[401,200]`。
- [x] 按规格第 7 节确认后的边界处理 Vue/MDX 非 TS 内容；未确认前标记未覆盖，不用宽泛 `.vue` 声明冒充模板已检查。
- [x] 运行 `bun test doc/test/code-examples.test.ts doc/test/recipes.test.ts` 与文档示例检查，期望所有正例通过且负例确实失败。

## Task 4: API 索引、详情与类型展示

**Files:** `doc/app/data/api-catalog.ts`、API 组件/路由、各语言 API 内容、`doc/test/api-catalog.test.ts`。

**Interfaces:** `ApiEntry` 包含 `package/name/kind/slug/related`；`filterApiEntries(entries: readonly ApiEntry[], query: string, packageName: string, kind: string): ApiEntry[]`，空字符串表示不筛选。符号身份不依赖旧锚点。

- [x] 核对公开导出与现有 API 知识，整理新目录；允许合并重复展示项，但共享说明和已公开契约不能丢失。
- [x] 写失败测试：查询不区分大小写、包/类别交集、无结果、不同包的同名符号、slug 冲突、相关类型不存在。
- [x] 使用原生 TypeTable 和签名代码块实现详情，保留复杂泛型、参数/返回值、描述和示例；不以自动生成器代替语义核对。
- [x] 实现静态可读的目录和 React 筛选，输入具备可访问名称和结果反馈；不将输入拼入 `innerHTML`。
- [x] 测试目录与内容一致：每个条目在全部语言中有真实内容，相关类型可跳转；不绑定旧 162 行的数量断言。
- [x] 运行目录测试并构建，验收 `createClient`、`ClientOption`、`struct.parse` 和 React/Vue 集成各一例。

## Task 5: 静态搜索、LLM 和链接完整性

**Files:** `doc/app/components/search.tsx`、搜索/LLM 资源路由、`doc/scripts/check-links.ts`、相关单元测试及预渲染枚举。

**Interfaces:** 搜索使用官方 `staticGET` 与静态客户端；英语 `/llms.txt`、`/llms-full.txt` 和 `/llms.mdx/<slugs>/content.md`。`checkLinks(directory: string): Promise<void>` 对空输出、缺页和缺锚点失败。

- [x] 为搜索正负例建立断言：英语/中文/日文/阿拉伯语可找到代表内容，locale 过滤不混入其他语言；TypeTable 数据转成可读索引文本，结果摘要不暴露原始 JSX 属性。
- [x] 构建时导出索引与资源，枚举所有资源路径；浏览器不请求部署时不存在的后端服务。
- [x] 使用 processed Markdown 输出英语索引、全文和单页；为 Tabs、TypeTable、API 索引提供有意义的文本转换。
- [x] 写导出测试：保留可见代码和签名，隐藏声明不泄漏，英语全文不混入其他语言，内部资源链接存在。
- [x] 复用通用 HTML 文件和锚点检查，删除旧主题耦合；测试编码路径、静态资源、缺页/锚点及空输出。
- [x] 运行本任务测试、文档构建与链接检查；检查直接 HTTP 读取搜索、Markdown、LLM 资源正常。

## Task 6: 全仓检查、构建和部署配置

**Files:** 根/文档 manifests、`bun.lock`、根/文档 tsconfig、忽略规则、工作流、README；删除已迁空的旧框架配置。

**Interfaces:** 根 `typecheck` 顺序为 `doc typegen → 根 bun check → doc bun check → check:examples`。根 `verify` 为 `lint → fmt:check → workspace test → build → doc test:site`；`build` 继续先运行全仓 typecheck。

- [x] 配置根项目和文档项目的输入边界与 JSX/别名；生成类型先于检查，示例引用库源码，不依赖构建产物。
- [x] 对比 Git 跟踪 TS/TSX/MTS/CTS 与两个 Bun 项目输入的并集，漏项失败；排除依赖/构建/临时产物而非漏掉源码。
- [x] 文档 `test` 为 `bun test ./test`，`test:site` 为 `bun test ./e2e`；文档 build 不回调根 typecheck，避免循环。
- [x] 删除文档 TS6、Twoslash 与旧框架插件；复核锁文件剩余 TypeScript 来源，保留 TS7 声明生成及真实示例依赖。
- [x] 将 release 文档任务改为根 typecheck 后构建文档，上传 `doc/build/client`；CI 保留 Chromium/Firefox 安装，更新忽略规则和 README。
- [x] 运行全仓 typecheck 与构建，核对四个库的 JS/`.d.ts` 及新站输出；不改变包发布目标或权限。

## Task 7: 真实静态站验收与交付

**Files:** `doc/scripts/preview.ts`、`doc/e2e/site.test.ts`；修正前述任务的实际问题。

**Interfaces:** Bun 预览只服务 `doc/build/client`，无文件返回 404；浏览器测试在 finally 中关闭服务器与浏览器，缺失本次构建产物时失败。

- [x] 使用 Chromium/Firefox 验证直接打开和刷新嵌套页面，未知路径返回 404，资源不依赖 SPA fallback。
- [x] 验证三个阅读区、全部语言切换、RTL、移动菜单、主题、搜索及 API 筛选、键盘操作、详情与类型链接。
- [x] 禁用 JS 验证正文和基本导航可读；验收控制台错误与构建警告的实际影响。
- [x] 完成内容去向、API 契约、类型检查覆盖、静态资源及链接核对，按已确认边界报告非 TS 格式检查结果。
- [x] 运行完整 `bun run verify` 并等待退出 0；若既有 Firefox 超时复现，定位处理，不跳过该浏览器伪造通过。
- [x] 检查最终差异，只交付本次目标及实际验证证据；域名缺失或检查边界未确认时明确保留，不宣称生产验收完成。

## 实施交接

准备阶段只交付规格、计划和隔离验证；后续用户明确要求以 TDD 开发，七项任务已在 `codex/fumadocs-migration` 隔离工作区完成。原 checkout 保持不变。完整本地验证及过程偏差见验收记录；正式域名仍未提供，未提交、推送或部署。
