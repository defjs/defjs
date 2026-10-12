# Starlight Migration Implementation Plan

> 已被 [Fumadocs 实施计划](2026-10-10-fumadocs-migration.md) 替代。不要执行本文中的 Starlight 任务。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 若用户选择子任务执行，再使用 superpowers:subagent-driven-development。以下复选框用于实施进度，本轮不执行应用开发。

**Goal:** 保留现有 11 种语言的文档内容，将站点迁至 Starlight，建立集中展示类型信息的 API 模块，并统一全仓 Bun 类型检查。

**Architecture:** 使用 Starlight 原生文档能力、Sidebar Topics 和 LLM 插件；复用现有 API 清单、链接检查和 recipe 测试。文档代码块在独立临时文件中由 Bun 检查，库的声明文件继续由现有 tsdown/TS7 生成。

**Tech Stack:** Bun 1.4.3、TypeScript 7.0.2、Astro 7.3.8、Starlight 0.42.6、Sidebar Topics 0.9.0、starlight-llms-txt 0.12.0、现有 Oxlint/Oxfmt/Vitest/Playwright。

**Spec:** [开发规格](../specs/2026-10-10-starlight-migration-design.md)。执行前同时阅读规格和本计划。

## Global Constraints

- 全仓类型检查统一使用 Bun，覆盖各 package、测试、脚本、配置和可编译的文档 TS/TSX 示例。
- 开发、检查和构建运行时最低 Bun 1.4.3；继续使用现有 Bun 锁文件及 CI。
- 删除文档的 Twoslash 及其 TS6 依赖。当前库构建仍依赖 TS7 生成 `.d.ts`，本次不更换声明生成方案。
- 只部署在正式主域名根路径。旧 URL、`.html` 路径、旧锚点和子路径部署均无兼容性要求；新站内部链接必须有效。
- 385 篇原文、11 种语言、162 个 API 目录展示条目及现有示例语义必须有完整去向。
- Q1 域名及 Q2 模板检查边界的状态以规格为准；不将未回答事项擅自视为批准。
- 不自动提交、推送、创建 PR、发布包或部署。用户授权开发后再按 worktree 技能选择隔离工作区，不在准备阶段创建应用工程。

## Review Focus

| 最容易遗漏的输入/条件                                  | 预期行为及所属任务                                                     |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| 原文中的多文件示例、隐藏声明及重复文件名               | 每个例子保持独立上下文；显示内容和检查内容正确对应。任务 2/3。         |
| 泛型尖括号、反引号、MDX Tabs 内的代码及翻译差异        | 提取后代码逐字保真；差异版本不能被错误去重。任务 2。                   |
| API 多条目共用一个原锚点、slug 冲突或缺译              | 每个条目均能到达完整说明，公共内容不丢失，已有翻译不回退。任务 4。     |
| 用户切换语言、RTL、无 JS、键盘操作及搜索空结果         | 基础内容可读取，交互有标签和反馈，链接保持目标语言。任务 3/4/7。       |
| 类型检查漏文件、空输入、正式域名缺失或构建输出目录改变 | 检查明确失败或报告缺失条件，不产生假通过及错误公开 URL。任务 1/2/5/6。 |

## 文件职责

| 文件/目录                                                                              | 职责                                               |
| -------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `doc/astro.config.ts`、`doc/src/content.config.ts`、`doc/src/env.d.ts`                 | 框架集成、内容 schema、生成类型                    |
| `doc/src/content/docs/`、`doc/src/content/i18n/`                                       | 迁移后的正文、API 详情及 UI 翻译                   |
| `doc/src/data/navigation.ts`、`doc/src/data/api-catalog.ts`                            | 从旧配置复用的导航与 API 数据                      |
| `doc/src/components/ApiIndex.astro`、`doc/src/components/ApiReference.astro`           | API 目录、详情元信息及类型引用展示                 |
| `doc/src/scripts/api-filter.ts`                                                        | 可由 Bun 检查的 API 浏览器筛选逻辑                 |
| `doc/scripts/check-examples.ts`、`doc/scripts/code-examples.ts`                        | 文档提取、文件分组、Bun 检查及诊断定位             |
| `doc/scripts/check-links.ts`、`doc/scripts/export-markdown.ts`                         | 复用 HTML 链接检查、输出供 LLM 阅读的页面 Markdown |
| `doc/test/`                                                                            | 提取与目录回归测试、迁移后的 recipe 测试           |
| `doc/e2e/site.test.ts`                                                                 | 构建完成后对真实站点执行浏览器测试                 |
| `package.json`、`doc/package.json`、根及文档 `tsconfig.json`、`bun.lock`               | 全仓检查入口、依赖及构建命令                       |
| `.gitignore`、`.github/workflows/ci.yml`、`.github/workflows/release.yml`、`README.md` | 忽略产物、CI/部署输出及开发说明                    |
| `doc/.vitepress/`                                                                      | 内容与检查迁出后删除旧框架目录                     |

只有实际需要的独立职责才创建文件；可以在不改变下述接口和测试边界的前提下合并小文件。原有 `doc/public/logo.jpg` 继续使用。

## Task 1: 建立 Starlight 构建基础与迁移基线

**Files:** 修改 `doc/package.json`、`bun.lock`、`.gitignore`；创建 `doc/astro.config.ts`、`doc/src/content.config.ts`、`doc/src/env.d.ts`、`doc/tsconfig.json`、`doc/src/data/navigation.ts`。

**Interfaces:** 产出 `doc` 的 `sync`、`dev`、`build`、`preview` 命令及 `doc/dist/`；内容集合名称固定为 `docs`。正式 `site` 使用 Q1 的回答。

- [ ] 重新核对工作区与基线；保留用户改动。将原 385 篇正文、标题、代码块、API 条目及资产记录为一次性迁移清单，保存于本次执行的临时产物目录。
- [ ] 安装规格中的四个直接依赖并核对锁文件；原内容和旧框架在新构建就绪前保留。
- [ ] 配置静态输出、根路径、11 个 locale、阿拉伯语 RTL、品牌、编辑链接和三个阅读区域。复用旧配置中的译文。
- [ ] 添加一个实际迁移页面及一个包含 Tabs 的 MDX 页面，运行 `bun run --cwd doc sync`、`bun run --cwd doc build`。
- [ ] 确认上述命令以 Bun 执行 Astro CLI、生成 `doc/dist/index.html` 且页面内容真实存在。若当前组合在 Bun 下失败，记录具体错误并解决兼容问题，不改用 Node.js 绕过要求。

低风险配置不新增只断言常量的测试；实际构建及生成 HTML 是本任务的验证。

## Task 2: 实现文档示例提取与 Bun 类型检查

**Files:** 创建 `doc/scripts/code-examples.ts`、`doc/scripts/check-examples.ts`、`doc/test/code-examples.test.ts`、必要的例子上下文数据；修改 `doc/package.json`、`doc/src/content.config.ts`。

**Interfaces:** `readCodeBlocks(source: string): CodeBlock[]` 返回 `language`、`code`、`info`、`line`；`collectExampleProjects(path: string, source: string): ExampleProject[]` 返回原页面定位、语言、相对文件名与内容。CLI `bun scripts/check-examples.ts` 非零退出表示示例错误、输入为空或分类缺失。

- [ ] 为下面的回归场景写断言并观察失败：泛型与字符串中的 `<>&` 原样保留；三/四反引号和波浪线围栏正确；MDX Tabs 内代码被提取；原始 fence info 不丢失。
- [ ] 为独立块、同名文件的两个独立例子、`users-sdk.ts`→`app.ts` 相对 import、Vue `App.vue.d.ts` 隐藏上下文写断言：文件组合正确，展示内容不混入辅助声明。
- [ ] 以现有代码为源实现提取，不让显示示例和被检查示例成为两份独立手写副本。解析器选择可由实施者决定；优先 Bun 原生能力，必须补足已知的完整 info-string 缺失。
- [ ] 对 TS/TSX 完整例子构造临时项目，通过 `paths` 引用工作区库源码，按上下文去重并调用 `bun check`；不依赖预先生成的 `dist`。临时目录限定在本次创建的目录，完成后清理，诊断映射回页面及代码块。
- [ ] 明确分类 API 签名草图和上下文片段；完整例子默认进入检查。任何跳过必须有具体来源及理由，不能用 `noCheck` 或通配排除跳过全部 API。
- [ ] 添加 CLI 负例：正确 TS/TSX 退出 0；数字赋给字符串退出非零并定位原页面；不同译文中单独出现错误时同样失败；空文档集合失败。
- [ ] 运行 `bun test doc/test/code-examples.test.ts`。按 Q2 确认后的方案处理 33 个 Vue 代码块；未确认前不得把它们标成已完成静态检查。

## Task 3: 迁移全部文档与多语言展示

**Files:** 移动 `doc/{index.md,guide,core,recipes,plugins,api,<locale>}` 至 `doc/src/content/docs/`；创建必要的 `doc/src/content/i18n/`；迁移 recipe 测试到 `doc/test/recipes.test.ts`。

**Interfaces:** 内容保留映射以原页面路径为键；所有新链接使用最终内容路由。消费任务 2 的提取与文件分组规则。

- [ ] 先转换一组英语和中文页面，核对标题只出现一次、相对链接正确、Tabs 共享 `syncKey`、代码文件名正确。
- [ ] 批量转换 385 篇正文：移除 Twoslash 渲染元信息，迁移多文件及隐藏上下文，转换标签页和新的锚点引用。需要组件的文件改为 `.mdx`。
- [ ] 对每份原文给出目标页面及章节去向，检查正文/代码差异；将允许的语法和链接转换与意外内容丢失分开记录。
- [ ] 对全部语言检查首页、导航、教程和示例存在；香港/台湾繁体内容分别保留，阿拉伯语布局为 RTL。
- [ ] 迁移 recipe 测试的路径和必要提取调用，继续执行页面中的真实例子，断言 ETag `[200, 304]` 与 Bearer `[401, 200]`，不改为测试复制代码。
- [ ] 运行 `bun test doc/test/recipes.test.ts`、示例检查和文档构建；保存原文迁移清单的核对结果。

## Task 4: 建立 API 索引和详情体验

**Files:** 迁移/扩充 `doc/src/data/api-catalog.ts`；创建 API 组件、`doc/src/scripts/api-filter.ts`、`doc/test/api-catalog.test.ts`、各语言 API 索引及详情内容。

**Interfaces:** `ApiEntry` 包含 `package`、`name`、`kind`、`slug`、`related`；`filterApiEntries(entries: readonly ApiEntry[], query: string, packageName: string, kind: string): ApiEntry[]` 以空字符串表示不筛选。目录保留 162 个展示条目的身份，不以旧锚点作为唯一身份。

- [ ] 为不区分大小写查询、包/类别组合筛选、无结果和重复 slug 写失败测试；断言组合筛选返回交集。
- [ ] 核对公开导出，给目录填写真实类别。保留现有包与条目；旧共享锚点需要在迁移映射中明确到新详情或公共说明。
- [ ] 创建可静态阅读的目录和详情，前端筛选只使用浏览器 TS；输入有可访问名称，结果变化有可感知反馈，不使用查询字符串拼接 `innerHTML`。
- [ ] 将手写 API 内容整理至详情，保留共享说明和相关指南，类型引用可跳转。补充元信息可以核对源码，但不虚构说明或批量自动生成翻译。
- [ ] 添加目录/内容一致性测试：全部 162 个条目有非空目标内容，所有语言目标可解析，`related` 引用存在，路由无冲突。
- [ ] Bun 单元测试读取普通 TS 目录数据和源内容文件，不直接导入 Astro 的 `astro:content` 运行时虚拟模块。
- [ ] 运行 `bun test doc/test/api-catalog.test.ts`；实际构建后验收 `createClient`、`ClientOption`、`struct.parse`、React/Vue 导出各一例。

## Task 5: 迁移链接检查和 LLM 输出

**Files:** 迁移 `doc/scripts/check-links.ts`；创建 `doc/scripts/export-markdown.ts`、`doc/test/check-links.test.ts`、`doc/test/export-markdown.test.ts`；修改构建脚本和 LLM 配置。

**Interfaces:** `checkLinks(directory: string): Promise<void>` 对无 HTML、缺页、缺锚点抛错；Markdown 导出至 `doc/dist/_markdown/`，路径由英语最终页面路由唯一确定。

- [ ] 为有效目录路由、带锚点链接、编码后的路径、静态资源和外链写断言；缺页/缺锚点/空构建必须失败。
- [ ] 适配已有 Bun HTMLRewriter 检查逻辑，复用文件和 ID 检查，不引入链接检查插件。
- [ ] 配置英语 `llms.txt` 及全文输出；实现按页 Markdown 导出，保留可见正文和代码，不泄漏辅助声明，API 索引有文本等价内容。
- [ ] 添加导出断言：英语列表不混入其他语言；API 详情包含签名；MDX Tabs 中的代码仍存在；索引和全文的内部目标均可解析。
- [ ] 运行本任务测试和 `bun run --cwd doc build`；检查生成的 LLM、Markdown、HTML 内部链接及 Q1 的正式域名。

## Task 6: 收敛全仓检查入口和清理旧依赖

**Files:** 修改根/文档 `package.json`、根/文档 `tsconfig.json`、`bun.lock`、`.gitignore`、`README.md`、CI 和 release 工作流；删除已迁空的 `doc/.vitepress/`。

**Interfaces:** 根 `bun run typecheck` 顺序执行 Astro 类型同步、仓库 Bun 检查、文档示例 Bun 检查。`bun run verify` 为 `bun run lint && bun run fmt:check && bun run test && bun run build && bun run --cwd doc test:site`；根 `build` 继续先调用 `typecheck`。文档上传产物为 `doc/dist`。

- [ ] 配置根检查显式覆盖 `.ts/.tsx/.mts/.cts` 和各类工作区文件；类型同步在依赖 Astro 虚拟模块的检查前执行。
- [ ] 文档 `test` 设为 `bun test ./test`，`test:site` 设为 `bun test ./e2e`。保持单元/recipe 测试在构建前，真实站点测试在本次构建后；`doc build` 不反向调用根 `typecheck`。
- [ ] 比较 Git 跟踪的 TS 源文件清单与 Bun 的实际输入清单，任何缺项必须解释并修复。临时目录及输出目录不得成为源码检查的意外输入。
- [ ] 删除 VitePress/Tabs/LLM/Twoslash 旧依赖和文档 TS6；保留库声明生成所需 TS7、真实示例依赖。检查锁文件中的剩余 TS6 来源，不以删除直接依赖冒充传递依赖已消失。
- [ ] 更新 README 中的框架、检查、代码片段和构建说明；独立 release 文档任务先从仓库根运行 `bun run typecheck`，再构建文档并上传 `doc/dist`，不改变包发布权限和目标。
- [ ] 删除旧主题、配置及不再使用的声明；检查当前代码/脚本没有残留的 VitePress 路径和 imports，历史设计记录不做无关改写。
- [ ] 运行 `bun run typecheck`、四个库构建、文档构建，核对四个库的公开 `.d.ts` 仍生成且导出契约未变。

## Task 7: 完整验收与开发交付

**Files:** 创建 `doc/e2e/site.test.ts` 及必要的浏览器测试入口；修正前面任务中的实际问题。

**Interfaces:** `bun run --cwd doc test:site` 使用仓库已有 Playwright 和 Bun 测试基础，在本次构建完成后启动真实静态预览，并在 finally 中关闭服务器/浏览器。缺少构建产物时明确失败；不得将构建成功等同于浏览器验收。

- [ ] 对实际站点运行 Chromium 和 Firefox：首页、三个区域、语言切换、Pagefind 搜索、移动端菜单、明暗模式、阿拉伯语 RTL。
- [ ] 验证 API 查询/类别/包筛选、空结果、键盘操作、详情直达及类型链接；禁用 JS 时正文和基本导航仍可用。
- [ ] 按 Q2 确认的模板检查方案执行负例及正例。若选择构建/浏览器替代模板静态检查，在交付中保留这一边界。
- [ ] 完成源文档迁移清单、API 条目映射、类型检查覆盖及输出链接检查。
- [ ] 运行 `bun run verify` 并等待真实退出状态。检查准备阶段的 Firefox 连接超时是否复现；若仍阻止完整验收则定位处理，不能跳过 Firefox 或修改超时后直接称为通过。
- [ ] 检查最终差异及工作区，只交付本次变更；报告验证结果、未覆盖项和必要限制。未得到授权不执行 Git 外部操作或部署。

## 准备阶段与开发交接

本轮仅完成规格、计划和基线检查。实施任务均保持未勾选。独立规格审阅未发现 Q1/Q2 以外的实质缺口；测试与构建的执行顺序已根据审阅明确。Q1/Q2 回答到达后更新规格中对应状态。

建议由当前会话顺序实施，原因是内容迁移、代码块检查与 API 拆页共享同一份内容映射，过早并行容易出现路由及示例上下文冲突。若用户另选执行方式，以用户选择为准。
