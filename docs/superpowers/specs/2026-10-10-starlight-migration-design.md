# Starlight 文档迁移开发规格

> 已被 [Fumadocs 开发规格](2026-10-10-fumadocs-migration-design.md) 替代。本文仅保留调研历史，不作为当前实施依据。

日期：2026-10-10。仓库基线：`feat/up`，`d618396c88bc84645953684c0cb20feaae0f55a8`。

状态：开发前准备。本文件区分用户已确认的要求、实施默认选择及尚待回答的事项；尚未开始框架迁移。

## 1. 目标与已确认要求

1. 文档框架由 VitePress 切换为 Astro Starlight，保留现有正文、说明、示例、资源和全部语言版本。
2. 允许移动目录、调整页面组织、转换框架语法及将需要组件的 Markdown 改为 MDX。
3. 允许调整外观。普通文档取消 Twoslash 类型悬浮提示，类型信息集中在 API 参考模块。
4. API 查阅体验参考 Angular API：包分类、名称检索、类别筛选，以及包含签名、参数、返回值、类型和示例的详情。
5. **全仓类型检查统一使用 Bun**，覆盖各 package、测试、脚本、配置和可编译的文档 TS/TSX 示例。
6. 删除文档的 Twoslash 及其 TS6 依赖。当前库构建仍依赖 TS7 生成 `.d.ts`，本次不更换声明生成方案。
7. 只部署在正式主域名根路径。旧 URL、`.html` 路径、旧锚点和子路径部署均无兼容性要求；新站内部链接必须有效。
8. 本轮只编写开发准备资料；安装依赖、应用代码修改、提交、推送及部署均尚未执行。

## 2. 待确认的两项输入

| 编号 | 输入                   | 当前状态及影响                                                                                                      |
| ---- | ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Q1   | 正式主域名             | 已询问，尚未提供。用于 Astro `site`、canonical、sitemap 和 LLM 输出。不得把示例域名或 GitHub 项目路径当作正式域名。 |
| Q2   | Vue/Astro 模板检查边界 | 用户追问 Oxc 能否支持，已确认当前 Oxlint 也未覆盖模板错误。尚未同意用构建及浏览器测试替代完整模板静态检查。         |

Q1 不阻止内容整理和本地开发，但正式构建配置必须使用实际域名。Q2 必须在确定模板验收方案前解决，不得把未覆盖的模板标成“全仓类型检查通过”。

## 3. 现状清单与保留边界

| 项目           | 当前实测结果                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------- |
| 文档源文件     | 385 篇 Markdown；11 个语言版本，每个 35 篇                                                        |
| 默认语言       | 根路径英语，`lang: en-US`                                                                         |
| 其他语言       | `zh-Hans`、`zh-Hant-TW`、`zh-Hant-HK`、`ja-JP`、`ko-KR`、`de-DE`、`fr-FR`、`es-ES`、`ru-RU`、`ar` |
| API 源内容     | 每个语言 11 个手写页面；现有目录 162 个展示条目、130 个不同内容锚点                               |
| 原受检代码块   | 704 个：`typescript` 484、`ts` 132、`tsx` 55、`vue` 33，数量包含翻译中的重复示例                  |
| 特殊代码组织   | 44 条 `@filename`，11 条 `---cut---`；需保留多文件关系及隐藏的检查上下文                          |
| 安装命令标签页 | 22 组；含 Bun、npm、pnpm、Yarn、Deno                                                              |
| 现有文档测试   | ETag 的 200→304 和 Bearer 的 401→200 两个真实示例执行测试                                         |
| 现有链接检查   | `doc/.vitepress/check-links.ts` 检查构建 HTML 的内部文件、锚点、导航和语言切换链接                |
| 现有资产       | `doc/public/logo.jpg`；GitHub 编辑及仓库链接；许可证与页脚                                        |
| LLM 内容       | 当前只输出英语；保留 `llms.txt`、全文及按页读取 Markdown 的能力                                   |

“保留文档”按内容验收，不要求迁移后仍恰好只有 385 个页面。API 可拆分详情，但每份原文及其有意义的内容都必须有明确去向。建立一次性源文件/章节→目标文件映射，逐项核对，不能用总页数抵消内容丢失。

移除重复正文 H1，保留 frontmatter 标题和描述；转换 Tabs、代码文件名、相对链接和标题锚点。可以生成新锚点，但必须同步更新全部引用。清除展示中的 Twoslash 指令时，不得把多文件示例拼成语义不同的一个文件，或把隐藏的声明显示给读者。

## 4. 实施默认选择

以下属于根据当前需求选定的实施方案，不冒充用户逐项指定的设计。

### 4.1 页面、语言与导航

- 文档迁至 `doc/src/content/docs/`；英语放根目录，其余语言保持对应目录，避免无价值的语言路径改名。
- 使用 Starlight 原生主题、明暗模式、移动端导航、Pagefind 搜索、目录和无障碍交互。
- 保留“文档 / Recipes / API”三个阅读区域，通过 Sidebar Topics 切换区域及侧栏。
- 阿拉伯语设置 `dir: rtl`。香港和台湾繁体中文保持独立版本及语言标签。
- 原有翻译完整迁入，不把已有译文替换为英语回退。未来缺译页使用 Starlight 自带提示及回退。
- 安装命令使用 Starlight Tabs，设置共同 `syncKey`；仅使用组件的页面转 MDX。
- 根路径静态输出，`base: '/'`，`trailingSlash: 'always'`，输出目录 `doc/dist/`。

### 4.2 API 参考模块

- 复用 `doc/.vitepress/api-catalog.ts` 的包与符号清单，移除 VitePress 类型耦合，迁至 `doc/src/data/api-catalog.ts`。
- 新 API 索引放在 `/api/` 及各语言对应路径；支持名称大小写不敏感搜索、包筛选、类别筛选、结果计数和无结果状态。
- 类别依据实际导出声明确定，包括 function、interface、type、constant、class 及需要展示的成员；不得仅按名称大小写猜测类别。
- 为目录条目提供可直接访问的详情，例如 `/api/core/create-client/`、`/api/core/client-option/`。符号身份使用“包名 + 原始符号名”，路由 slug 显式记录并检测冲突。
- 原来多个条目共享锚点的情况需要显式拆分或引用公共说明。162 个条目都可找到说明；不建立只有标题的空详情页。
- 详情保留原有签名、泛型、参数、返回值、字段、说明、示例及相关教程。类型引用提供可点击链接，可以在签名下的相关类型区域呈现，不要求代码块中的每个 token 都变成链接。
- 包级/模块级公共说明保留为概览或在详情中引用，不随拆页丢失。所有语言同步组织；不得虚构原文中没有的参数说明或翻译。
- API 内容仍为手写 Markdown/MDX。此次不引入 TypeDoc、TypeScript Compiler API、自研类型提取器或源码文档自动生成体系。
- 使用 Astro 组件和少量浏览器 TS 实现索引交互，不为了 API 搜索额外引入 React/Vue 页面运行时；文档示例依赖另行保留。
- 不照搬 Angular 专属的 decorator/directive 分类、版本切换及实验状态筛选；仅展示项目实际存在的信息。

### 4.3 插件和依赖

版本为 2026-10-10 npm registry 实测值。实施时固定在下列兼容组合并写入 `bun.lock`；若版本变化，重新核对 peer 范围。

| 依赖                                                          | 版本/处理                         | 目的                                                |
| ------------------------------------------------------------- | --------------------------------- | --------------------------------------------------- |
| `astro`                                                       | 7.3.8                             | 静态构建、内容集合及页面组件                        |
| `@astrojs/starlight`                                          | 0.42.6                            | 文档主题、i18n、Pagefind、Expressive Code、MDX 支持 |
| `starlight-sidebar-topics`                                    | 0.9.0                             | 三个阅读区域及对应侧栏                              |
| `starlight-llms-txt`                                          | 0.12.0                            | 英语 LLM 索引与全文                                 |
| `typescript`                                                  | 保留根目录/库构建实际需要的 7.0.2 | `.d.ts` 生成及工具支持，不作为全仓类型检查入口      |
| 文档 `typescript@6.0.3`、`@shikijs/vitepress-twoslash`        | 迁移完成后删除                    | 不再运行 Twoslash                                   |
| `vitepress`、`vitepress-plugin-tabs`、`vitepress-plugin-llms` | 对应功能迁移完成后删除            | 清理旧框架                                          |
| `@astrojs/check`                                              | 不纳入当前基线方案                | 当前 0.9.10 peer 为 TS5/TS6，不能静默重新引入 TS6   |
| 链接检查插件                                                  | 不新增                            | 适配现有 Bun HTML 链接检查器                        |
| 独立搜索/高亮/Tabs 插件、TypeDoc、博客、版本站插件            | 不新增                            | 当前需求由已有或原生能力满足                        |

`@astrojs/markdown-remark` 是 Astro/Starlight 的可选 peer，本次优先默认 Markdown 引擎，不为满足可选 peer 无条件安装。React/Vue 和工作区包是否保留，由文档示例真实 imports 决定，不把示例依赖误当作旧主题依赖删除。

四个目标包的 peer 版本相容，但这不等于已经证明 Astro 7 在 Bun 中构建成功。首个开发任务必须以 `bun --bun astro` 验证实际启动、MDX 和静态构建；不得为通过构建额外引入 Node.js 运行流程。

### 4.4 全仓检查和声明生成

- 开发、检查和构建运行时最低 Bun 1.4.3；继续使用现有 Bun 锁文件及 CI。
- 根 `bun run typecheck` 是全仓唯一类型检查入口：先同步 Astro 内容类型，再检查仓库 TS/TSX/MTS/CTS，最后检查文档示例。
- 示例检查通过 TypeScript `paths` 引用各库源码，不依赖先生成 `dist`。`doc build` 不反向调用根 `typecheck`，避免检查与构建循环。
- 明确排除依赖、构建产物、覆盖率及临时检查目录；不得以排除源码目录、`any` 或新增 `@ts-ignore` 换取通过。
- Markdown/MDX 代码块先提取到独立临时 TS/TSX 文件，保留 imports、泛型和多文件相对依赖，交给 `bun check`。诊断必须能回到原页面和代码块。
- 相同示例可按“代码 + 语言 + 辅助文件 + 编译上下文”去重；不能只检查英语而漏掉不同的译文示例。
- 完整示例必须检查。API 声明草图和依赖上下文的片段需要显式分类：补齐真实检查上下文，或记录其仅为签名/片段展示的原因；不能把所有普通 TS 代码块默认排除。
- 保留两个实际 recipe 运行测试，并覆盖文档提取器的负例：故意错误的 TS/TSX 必须使检查失败，空输入必须失败。
- Bun 原生 Markdown 回调可提取代码正文，但本次实测 `meta.language` 不保留整个 fence info-string。不得用它读取 `twoslash`、标题或组合元数据；实现中应单独保留原始围栏信息并用测试证明其正确。
- `tsdown` 继续生成四个库的 `.d.ts`。全仓检查交给 Bun，不代表可以删除声明生成依赖，也不在本次为删除 TS7 启用 `isolatedDeclarations` 或重写库导出。

模板检查的最终方案受 Q2 约束。候选方案为：把可独立检查的业务和浏览器 TS 放入 `.ts` 文件交给 Bun；Vue/Astro 模板通过真实编译与浏览器测试验证。此方案不等于完整模板静态类型检查，必须得到用户对该边界的确认。

验证顺序固定为：`bun run lint && bun run fmt:check && bun run test && bun run build && bun run --cwd doc test:site`。文档 `test` 只执行 `bun test ./test`，覆盖提取器、目录数据及 recipe；实际站点测试独立放在 `doc/e2e/`，由 `test:site` 执行 `bun test ./e2e`，在本次构建完成后运行。Bun 单元测试读取普通 TS 数据和内容文件，不直接导入仅由 Astro 提供的 `astro:content` 运行时虚拟模块。

### 4.5 LLM 输出、链接和部署

- `starlight-llms-txt` 保持默认英语输出；不得把 11 份重复内容全部混入英语全文。
- 插件不提供现有的按页 `.md` 导出，因此补充轻量静态导出，统一放在 `/_markdown/` 下；旧 Markdown URL 不做兼容。
- 按页 Markdown 必须包含正文、可见代码、API 签名和链接，不输出原 Twoslash 隐藏声明或仅剩 MDX 组件调用。索引组件需提供等价的文本 API 目录。
- `doc/.vitepress/check-links.ts` 移至 `doc/scripts/check-links.ts`，默认验证 `doc/dist/`，覆盖新页面和锚点。LLM 及 Markdown 导出的内部 URL 也要验证存在。
- GitHub Pages 文档任务先在仓库根目录执行 `bun run typecheck`，再执行文档构建；上传路径由 `doc/.vitepress/dist` 改为 `doc/dist`。部署权限和包发布行为不扩大。
- README、tsconfig、忽略规则、工作流及文档命令同步更新。旧文档系统仅在内容、检查和新构建均完成后删除。

## 5. 验收标准

1. 385 份原文均有迁移映射；所有正文、代码、译文、公共 API 说明和资源均有去向。
2. 每个语言可从首页进入三个区域；语言切换、搜索、移动端导航、深浅色和 RTL 正常。
3. API 索引检索、包/类别筛选、空结果、键盘操作及详情直达有效；目录条目、页面和类型链接一致。
4. 全仓 Bun 检查覆盖实际源码清单和可编译文档示例；新增故意错误能被检测，未覆盖格式单独列出。
5. 文档中无 Twoslash UI 或内部指令泄漏；新代码块支持高亮、复制、文件名和必要的标签页。
6. 新 HTML、锚点、LLM 输出及按页 Markdown 无断链；站点域名和根路径配置准确。
7. 四个库的 JS 与 `.d.ts` 构建不退化；现有运行测试保持通过。
8. `bun run verify` 完整结束且退出 0，包含本次构建产物的 Chromium/Firefox 浏览器验收。不得把局部通过描述为全仓通过。

## 6. 准备阶段证据与风险

- 准备开始时工作区干净，位于 `feat/up`；当前受 Git 跟踪的 256 个 `.ts` 文件都出现在根 Bun 检查输入中。
- 本轮 `bun run typecheck`：退出 0，检查 260 个文件。
- 本轮文档 recipe 测试：2 通过，0 失败。
- 本轮 `bun run verify`：lint、格式检查通过，随后 Core Firefox 会话在 120 秒内未连接，退出 1；已执行 1,715 个测试通过，不能称为完整基线通过。构建阶段未到达。
- 随后独立运行根 `bun run build`：退出 0，全仓类型检查、四个库的 JS/`.d.ts` 及现有 VitePress 文档构建通过，386 个生成页面的内部链接验证通过。此结果只证明迁移前构建可用，不证明尚未安装的 Starlight 组合可用。
- Firefox 定向复查：`bun run test --project 'core-browser (firefox)' --browser.connectTimeout 15000 --coverage.enabled=false`，5 个文件、65 个测试通过。只在该诊断命令中把连接等待缩短至 15 秒，没有修改仓库配置；首次全量失败的根因尚未定位。
- Bun 已验证能报出 TS/TSX 故意类型错误；把相同错误放在 Markdown、Vue、Astro 中直接运行 Bun 检查不会覆盖它。
- Oxlint 1.87.0 + oxlint-tsgolint 7.0.2003 的隔离探针已完成：`--type-aware --type-check` 对普通 `.ts` 中数字的 `toUpperCase()` 报 TS2339，退出 1；同一错误放在 Vue template 或 Astro 模板后均退出 0、诊断为空。与官方模板支持缺失的说明一致，不能替代完整模板类型检查。
- 不保证依赖树绝不存在任何传递 TS6；迁移验收先要求删除文档显式 TS6/Twoslash 及其用途，再核对锁文件中剩余版本的实际来源。
- 独立规格审阅未发现 Q1/Q2 以外的实质缺口；已明确先构建再运行站点测试、检查直接引用库源码、独立文档部署先检查的命令顺序，避免构建循环及误用旧产物。

## 7. 不在本次范围

源码自动生成 API 文档、旧 URL 重定向、子路径部署、交互 playground、文档版本站、博客、重写库 API、替换声明生成器，以及生产发布和域名配置操作。

## 8. 调研依据

- [Angular API 索引](https://angular.dev/api)及 [signal 详情](https://angular.dev/api/core/signal)：API 信息组织参考。
- [Starlight 配置](https://starlight.astro.build/reference/configuration/)、[多语言](https://starlight.astro.build/guides/i18n/)和 [Tabs](https://starlight.astro.build/components/tabs/)：使用原生能力。
- [Sidebar Topics 配置](https://starlight-sidebar-topics.netlify.app/docs/configuration/)及 [LLM 插件](https://delucis.github.io/starlight-llms-txt/getting-started/)：导航与输出选型。
- [Bun 类型检查](https://bun.com/docs/runtime/check)：内置检查器不依赖 npm `typescript`，也不生成 `.d.ts`。
- [tsdown 声明生成](https://tsdown.dev/options/dts)：当前构建继续需要 TypeScript。
- [Oxc 支持范围](https://oxc.rs/compatibility.html)及 [Oxlint 类型检查](https://oxc.rs/docs/guide/usage/linter/type-aware.html)：脚本和模板能力分开验收。
