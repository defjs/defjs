# zen-kit 全量审计报告

- 基线：分支 `feat/up`，提交 `6b0b0c1e`，2026-10-12
- 结果：77 项发现（P0 1、P1 5、P2 46、P3 25），由 82 项复核确认的发现去重合并而来
- 配套文件：[`module-map.md`](module-map.md)（全部 2863 个跟踪文件的作用）

## 执行摘要

### 范围与方法

- **对象**：zen-kit monorepo，分支 `feat/up`，HEAD `6b0b0c1e`。
  - 软件包：`@defjs/core` 0.4.0、`@defjs/opentelemetry-server`、`@defjs/react`、`@defjs/vue`。
  - 文档站：基于 Fumadocs 与 React Router，覆盖 11 个语言。
  - 运维与项目文档：`.github/workflows`、根 README、行为准则、设计稿等。
- **分区**：共 15 个。
  - P01 Struct、P02 HTTP 客户端、P03a SSE、P03b WebSocket、P04 核心基础设施、P05 core 测试。
  - P06 OpenTelemetry 服务端插件、P07 React/Vue 适配器、P08 文档站工程。
  - P09a 指南、P09b API 参考、P10a 中日韩译文、P10b 其他语言译文。
  - P11 发布与运维、P12 项目文档。
- **双盲审计**：每个分区由 codex（gpt-6.1-sol，xhigh）与 grok（grok-4.7，xhigh）各自独立审计，共 30 次运行，审计员之间互不可见。
- **对抗式复核**：每个分区再由一名复核者在独立克隆上尝试推翻每条结论。
  - 行为类结论在 Bun 1.4.3 与 Node 26.11.1 上分别复现。
  - 测试类结论用变异探针证明"测试无法失败"。
  - 外部事实只读获取：npm/jsdelivr、WHATWG SSE 规范、GraphQL 规范、DNS over HTTPS、Codecov API。
- **基线**：协调者在 HEAD 上运行 `bun run verify`，全部通过。
  - 覆盖 lint、fmt、typecheck 与 build。
  - 测试：core 1915、otel 288、react 12、vue 14、doc 49、doc e2e 23。
  - 基线全绿与下列问题并存，这本身说明部分测试与门禁覆盖不足（见系统性主题 7、8）。
- **汇总阶段**：在复核结果之上做跨分区去重、复核分歧裁决和全局定级校准，不重新审计。

### 统计

| 阶段                                  | 条数 |  P0 |  P1 |  P2 |  P3 |
| ------------------------------------- | ---: | --: | --: | --: | --: |
| 审计员原始条目（codex 76 + grok 71）  |  147 |   1 |  17 | 116 |  13 |
| 复核保留（CONFIRMED 81，PLAUSIBLE 1） |   82 |   1 |   5 |  50 |  26 |
| 跨分区去重与校准后（最终）            |   77 |   1 |   5 |  46 |  25 |

**原始到复核**：

- 147 条原始条目经分区内两名审计员的同根合并、不可复现项和设计内行为的驳回后，保留 82 条。
- 其中 2 条由复核者新增：P03a-core-sse-06，以及来自 P06 复核旁注的 P12-project-docs-04。
- 原始 17 条 P1 中，12 条在复核时按实际后果下调。
- P10b（其他语言译文）两名审计员与复核者均为零发现。

**复核到最终**：

- 5 条并入同根主条目。
- 1 条降级：F055，P2 → P3。
- 1 个合并组的定级取 P2：F042，被并入的 P09a-doc-guides-05 原为 P3。
- 无删除。

最终条目按严重度与类别分布如下：

| 类别             |  P0 |  P1 |  P2 |  P3 | 合计 |
| ---------------- | --: | --: | --: | --: | ---: |
| correctness      |   0 |   3 |  13 |   2 |   18 |
| contract         |   0 |   1 |  17 |   0 |   18 |
| docs             |   0 |   0 |   7 |  11 |   18 |
| test             |   0 |   0 |   4 |   8 |   12 |
| ops              |   1 |   0 |   3 |   0 |    4 |
| security         |   0 |   1 |   2 |   0 |    3 |
| i18n             |   0 |   0 |   0 |   2 |    2 |
| over-engineering |   0 |   0 |   0 |   2 |    2 |
| 合计             |   1 |   5 |  46 |  25 |   77 |

按主条目所属分区统计：

| 区域               | 分区与条数                                                | 合计 |
| ------------------ | --------------------------------------------------------- | ---: |
| core 运行时        | Struct 6、HTTP/客户端 11、SSE 10、WebSocket 7、基础设施 7 |   41 |
| core 测试          | P05                                                       |    5 |
| OpenTelemetry 插件 | P06                                                       |    5 |
| React/Vue          | P07                                                       |    1 |
| 文档站工程         | P08                                                       |    6 |
| 文档内容与译文     | P09a 3、P09b 3、P10a 2                                    |    8 |
| 发布与运维         | P11                                                       |    5 |
| 项目文档           | P12                                                       |    6 |

### P0 / P1 一览

- **F001（P0，ops）core 发布包缺少第三方许可声明**：SSE 解析器改编自 Microsoft 版权的 Azure/fetch-event-source（MIT），但 core tarball 只复制 `LICENSE` 与 `README.md`，`THIRD_PARTY_NOTICES.md` 未随包发布，且其中的源码路径已过期。已发布的 `@defjs/core@0.4.0-beta.1` 同样缺失。
- **F002（P1，security）定义路径校验可被绕过**：只在原始字符串上检查 `^scheme:` 与 `//`。反斜杠、前导空白或内嵌制表/换行可以绕过检查，HTTP、SSE、WebSocket 请求会连同默认头和拦截器注入的认证头一起发往其他主机。
- **F003（P1，contract）SSE 启动失败元组携带其他请求的数据**：模块级 `errorOpenInfoMap` 以共享哨兵 `ERR_ABORTED`/`ERR_TIMEOUT` 为键，且从不清除。结果是：
  - 启动失败元组的第三槽可能返回另一个请求（可跨 client）的响应状态、头与 URL，在多租户服务端进程中构成跨请求数据暴露；
  - 取消可能被误报为 `HTTP_STATUS`。
- **F004（P1，correctness）默认 fetch 在导入时固定**：默认 HTTP/SSE handle 在模块求值时绑定当时的 `globalThis.fetch`。导入之后再安装的 mock 或插桩会被所有默认客户端绕过；导入时环境没有 fetch 则整个包导入失败。
- **F005（P1，correctness）Node 上 FormData 上传进度整体缓冲**：带 `onUploadProgress` 时，正文先被整体读入内存（实测约为文件大小的 3 倍），期间不受 timeout/abort 约束；文件流停滞时 `execute` 永不返回。
- **F006（P1，correctness）Bun 上 FormData 上传进度丢失 boundary**：带 `onUploadProgress` 时以 `application/octet-stream` 发送 multipart 正文，服务端无法解析，违背文档对 Bun 上 FormData 进度的承诺。

### 系统性主题

以下根因各自对应多条发现，宜一次性修复，不逐条修补。

1. **模块级 side table 与对象身份承载跨请求状态。**
   - 相关条目：
     - F003：`errorOpenInfoMap` 以共享哨兵为键。
     - F012：transport-origin `WeakSet` 永久标记共享哨兵，拦截器抛出的 `ERR_ABORTED`/`ERR_TIMEOUT` 的分类随进程历史翻转。
     - F039：OTel 以 `error === ERR_ABORTED` 判断取消，多实例下失效。
     - F038：Struct 的 `activeErrorMap` 是模块状态，跨包副本时失效。
   - 修复原则：每次执行的元数据随失败值一起传递，不再标记或索引进程级共享哨兵；跨实例识别使用 `Symbol.for` 品牌，而不是对象身份。
2. **配置校验发生在传输内部，确定性的配置错误被报告为 `NET_UNREACHABLE`。**
   - 相关条目：
     - F011：缺失或非法 endpoint，路径含 `?`/`#`；被正确拒绝的绝对路径同样如此（见 F002 附带观察）。
     - F013：越界 jitter 到首次断流才暴露。
     - F015：`Last-Event-ID` 写头在 try 之外抛错。
     - F023：`binaryType` 写入失败。
   - 启用 `withSSEReconnect` 时，这类错误还会被按预算重试。
   - 修复原则：在进入传输前统一解析和校验 URL 与选项，以 `REQ_*` 报告；只有真实的传输失败才打上来源标记。
3. **SSE 与 WebSocket 的重连/退避语义各自实现，且未写入文档。**
   - 相关条目：
     - F008、F009：`attempts` 是整条逻辑流或会话的累计预算，退避指数跨健康期累计；默认 `attempts: 3` 的长连接会在生命周期内第 4 次掉线时永久结束。
     - F013：SSE 不校验参数，WebSocket 会校验。
     - F032：`maxDelayMs` 在 jitter 之前生效。
     - F041：`backoff.ts` 中 `0 × Infinity` 得到 NaN。
     - F048：SSE 退避参数没有有效测试。
   - 建议先就预算语义做一次产品决策，再让两种传输共用同一份归一化与文档。
4. **传输边界规则不统一。**
   - 出站编码：F010，WebSocket 文本帧没有复用 HTTP 的 `rejectNonJson`。
   - 上传进度转换 `prepareUploadProgressRequest`：F005、F006、F024 集中于此。
   - Content-Type 元数据：F025。
   - 下载进度计量：F026。
   - 修复应落在共享的转换与序列化边界上，而不是逐条件修补。
5. **错误消息与日志卫生。**
   - F007：默认 issue 消息和 JSON 解析器报错含原值，而文档称 `String(fault)` 可直接记录。
   - F037：errorMap 返回 `''` 无法用于脱敏。
   - F038：跨副本时 errorMap 被绕过。
   - 三者合起来，使"按文档写法记录日志"会把标量 payload 写进日志。
6. **Fumadocs 迁移与门禁删除后的文档漂移。**
   - 失效链接与过期过程陈述：F043（发布 README 链接旧路由）、F064、F042（已删除的 packed-consumer 门禁）、F044、F065、F066。
   - 文档与代码不符：F019–F021、F053、F054、F056–F061。
   - en-US 的错误多数原样复制到 11 个语言（例如 `docs/sse.mdx:64`、`:99`），应先修 en-US 源文，再同步各语言。
7. **测试名不副实或无法失败。**
   - 相关条目：F046、F047、F048、F049、F068、F069、F070、F072，以及门禁类的 F050、F071。
   - 多条变异探针显示：删除被测语句后，core-server 全部 1757 个测试仍通过。
   - 建议：对清理、计时、监听器身份这类代码做抽样变异检查，并断言回调身份与计划延迟，而不只计数。
8. **发布流水线没有门禁。**
   - 四个发布 job 只执行 `bun ci` → build → `npm publish`。
   - 声明生成固定使用 `--noCheck`，不要求所选 SHA 已通过 CI，`copy` 列表也从未包含第三方声明。
   - 对应条目：F001、F016、F017，以及 F042 所述"已删除的验证"。
   - 建议加一个发布前检查步骤：
     - 先构建 core；
     - 对 build 配置执行 `tsc --noEmit`；
     - 用 `npm pack --dry-run` 断言文件清单（含 `THIRD_PARTY_NOTICES.md`）；
     - 校验该 SHA 的 CI 状态。
9. **CI 只在 Bun 上运行（F018）。**
   - 文档声明支持 Node 与 Deno，但 Node 专属分支（如原生 WebSocket 的 error-before-close）在 CI 中从不执行。
   - F005 只在 Node 上出现，F006 只在 Bun 上出现，说明两个运行时都需要自动守卫。
   - Deno 完全未测试。

### 建议修复顺序

1. **发布合规与发布前检查（下一次任何发布之前）。**
   - F001：把 `THIRD_PARTY_NOTICES.md` 加入 core 的 `copy`，并修正其中的路径。
   - F016、F017：发布 job 先构建 core，再做类型检查和打包清单校验。
   - 这些改动集中在 `release.yml` 与 tsdown 配置，成本低，且能防止同类问题再次发布。
2. **安全与跨请求隔离。**
   - F002：解析后比较 origin，并移到构建阶段以 `REQ_BUILD_FAILED` 报告。
   - F003 与 F012：作为同一次改动，去掉以共享哨兵为键的模块级表。
   - F007 与 F037。
3. **P1 传输缺陷。**
   - F004。
   - F005、F006 与 F024：同一函数，一并修复。
4. **配置错误分类（主题 2）**：F011、F013、F015、F023。
5. **重连语义决策（主题 3）**：F008、F009、F032、F041，测试 F048 随行补齐。
6. **其余运行时 P2**：F010、F014、F022、F025–F031、F033–F040。
7. **测试与 CI 守卫**：F018 增加 Node job；F046、F047、F049 及其他测试缺口最好与对应代码修复一起提交。
8. **文档一轮清理**：先改 en-US，再同步 10 个语言。
   - 涉及 F019–F021、F034、F042–F045、F050–F061。
   - 译文 F055、F067。
   - 文档站 F050–F052。
9. **P3 清理**：F062–F077。

### 仓库外事项

- **文档站域名无法解析**：`defjs.org` 在复核时为 NXDOMAIN（2026-10-12，Cloudflare 与 Google DoH 均返回 `Status: 3`）。
  - GitHub 仓库 homepage 指向该域名，`defjs.github.io/defjs/` 返回 404；`SITE_URL` 由仓库外变量提供。
  - 修正 F043 的路由路径之后，链接仍要等域名或 Pages 配置恢复才能生效。这需要所有者在 DNS/Pages 层处理。
- **npm 上已发布的包无法原地修正**：npm tarball 不可变。
  - `@defjs/core@0.4.0-beta.1` 已在缺少第三方声明的状态下发布，修复只能随新版本发布；是否 `npm deprecate` 该版本由维护者决定。
  - `latest`（0.3.3）及更早版本未逐一核查。
- **适配器版本号（流程备注，不立项）**：`@defjs/react` 在 npm 上只有 `0.0.1-beta.0/1`，且并非由 `release.yml` 发布。`release.yml` 不修改版本号，`0.0.1` 只能发布一次，之后每次发布都需要人工提升版本。
- **行为准则举报渠道（F045）**：需要维护者选定一个满足隐私承诺的实际联系渠道，不能由代码修复。
- **Codecov（F066）**：Codecov 上的项目数据停在 2025-03-14；恢复上传或删除徽章都涉及外部服务配置。
- **上游缺陷（F051）**：缓存缺陷位于 `fumadocs-core@16.17.1`，宜向上游报告，或在站点侧包装可重试的加载器。
- **npm provenance（不立项）**：P11 复核者把 provenance / trusted publishing 列为可选加固项，不算缺陷。

### 局限

- **浏览器相关项目未运行。**
  - 审计员与复核者都没有运行浏览器 Vitest 项目（Chromium/Firefox）、doc e2e、preview/dev，原因是固定端口与并行冲突；这些只在协调者基线中运行过。
  - 依赖浏览器的结论：
    - F014：没有在真实 Worker 中端到端验证；
    - F051：UI 呈现部分未验证；
    - F052：tr-TR 区域的 Firefox/Safari 未实测，结论为 PLAUSIBLE，也是唯一的 PLAUSIBLE 条目；
    - F002：浏览器 `withCredentials` cookie 路径未验证。
- **未覆盖的运行时与环境。**
  - Deno 未测试。
  - 发布 job 只在本地 macOS arm64 上模拟，没有在 GitHub ubuntu runner 上执行。
  - F004 未针对具体第三方库（MSW、OTel、Sentry）验证安装时机。
  - F005 的时间与内存数字只代表量级，不是基准测试。
- **译文审读方式。**
  - 10 个非英语语言由模型机器阅读，不是母语校对。
  - 机械一致性脚本覆盖全部文件；逐段语义精读只做了抽样，同一段内部的措辞翻转仍可能遗漏。
  - 阿拉伯语的 RTL 实际排版没有查看。
- **复现材料不在仓库内**：探针、变异脚本与日志位于 `/tmp/zen-audit/verified/*/scratch` 和 `/tmp/zen-audit/verify/*` 克隆中，可能被清理。修复时需要在仓库内重新编写回归测试。
- **法律判断边界**：F001 依据 MIT 条款文本与代码结构对应关系作出判断，不构成法律意见。
- **定级方法**：严重度为审计员与复核者的判断，经汇总阶段校准；两级之间取低。
- **简报事实更正**：审计简报 `_shared.md` §4 称取消形态"无论来自何处都保持 `NET_*`"。这对 SSE/WebSocket 拦截器抛出的取消哨兵不成立，它们报告为 `EXT_INTERCEPTOR_FAILED`，与公开文档一致。这是简报本身的事实更正，不作为发现。

## 发现索引

| ID            | 严重度 | 类别             | 结论      | 标题                                                     | 主要位置                                                                               |
| ------------- | ------ | ---------------- | --------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [F001](#f001) | P0     | ops              | CONFIRMED | core 发布包遗漏 fetch-event-source 的 MIT 声明           | `packages/core/tsdown.config.ts:48`                                                    |
| [F002](#f002) | P1     | security         | CONFIRMED | 定义路径校验可被反斜杠或空白绕过，认证头发往他域         | `packages/core/src/internal/url.ts:217`                                                |
| [F003](#f003) | P1     | contract         | CONFIRMED | SSE errorOpenInfoMap 键为共享哨兵，跨请求泄露响应快照    | `packages/core/src/sse/transport/event_stream.ts:703`                                  |
| [F004](#f004) | P1     | correctness      | CONFIRMED | 默认 fetch 在模块求值时固定，之后替换的全局 fetch 被绕过 | `packages/core/src/client/config.ts:199`                                               |
| [F005](#f005) | P1     | correctness      | CONFIRMED | Node 上 FormData 带进度时整体缓冲，无视超时与取消        | `packages/core/src/http/transport/fetch.ts:447`                                        |
| [F006](#f006) | P1     | correctness      | CONFIRMED | Bun 上 FormData 带进度上传丢失 boundary                  | `packages/core/src/http/transport/fetch.ts:496-499`                                    |
| [F007](#f007) | P2     | security         | CONFIRMED | String(fault) 含响应字段原值，与“可直接记录”相冲突       | `packages/core/src/error/factory.ts:59`                                                |
| [F008](#f008) | P2     | contract         | CONFIRMED | WebSocket 重连 attempts 为整个会话累计预算，文档未说明   | `packages/core/src/web_socket/web_socket.ts:401`                                       |
| [F009](#f009) | P2     | contract         | CONFIRMED | SSE 重连 attempts 为整条逻辑流累计预算，文档未说明       | `packages/core/src/sse/transport/event_stream.ts:157`                                  |
| [F010](#f010) | P2     | correctness      | CONFIRMED | WebSocket 出站 JSON 静默改写非 JSON 值，HTTP 同值拒绝    | `packages/core/src/web_socket/codec.ts:11`                                             |
| [F011](#f011) | P2     | contract         | CONFIRMED | endpoint 或路径配置错误被报告为 NET_UNREACHABLE          | `packages/core/src/internal/url.ts:148-151`                                            |
| [F012](#f012) | P2     | correctness      | CONFIRMED | transport-origin 标记永久记住共享哨兵，拦截器故障误分类  | `packages/core/src/internal/transport_origin.ts:1`                                     |
| [F013](#f013) | P2     | contract         | CONFIRMED | withSSEReconnect 数值参数不校验，NaN 预算导致无限重连    | `packages/core/src/client/option.ts:202-206`                                           |
| [F014](#f014) | P2     | security         | CONFIRMED | Worker 中 XSRF token 会附加到跨源请求                    | `packages/core/src/http/transport/fetch.ts:28-30`                                      |
| [F015](#f015) | P2     | correctness      | CONFIRMED | 非 ASCII 事件 ID 致 Last-Event-ID 重连失败或编码错误     | `packages/core/src/sse/transport/event_stream.ts:241-247`                              |
| [F016](#f016) | P2     | ops              | CONFIRMED | 发布 job 不运行 typecheck、lint 或测试                   | `.github/workflows/release.yml:34-100`                                                 |
| [F017](#f017) | P2     | ops              | CONFIRMED | 适配器单独发布时 ClientProvider 返回类型退化为 any       | `.github/workflows/release.yml:51-100`                                                 |
| [F018](#f018) | P2     | ops              | CONFIRMED | CI 只在 Bun 上运行测试，Node 运行时行为无守卫            | `.github/workflows/ci.yml:12-20`                                                       |
| [F019](#f019) | P2     | docs             | CONFIRMED | SSE 打开后 TimeoutError 中止抛错，文档称为 aborted       | `doc/content/en-US/docs/sse.mdx:93`                                                    |
| [F020](#f020) | P2     | docs             | CONFIRMED | SSE 重连非 2xx 的终止码与文档 HTTP_STATUS 不符           | `doc/content/en-US/docs/sse.mdx:64（其余 10 个 locale 的 `docs/sse.mdx:64` 是同一句）` |
| [F021](#f021) | P2     | docs             | CONFIRMED | withEndpoint 文档称接受相对 base，实际只接受绝对 URL     | `packages/core/src/client/option.ts:19`                                                |
| [F022](#f022) | P2     | contract         | CONFIRMED | HTTP 拦截器结果非 HttpResponse 时 reject 或误报          | `packages/core/src/http/http.ts:412`                                                   |
| [F023](#f023) | P2     | correctness      | CONFIRMED | binaryType 写入抛错时已建 socket 被遗留且不关闭          | `packages/core/src/web_socket/web_socket.ts:606-620`                                   |
| [F024](#f024) | P2     | contract         | CONFIRMED | onUploadProgress 覆盖显式指定的 Content-Type             | `packages/core/src/http/transport/fetch.ts:452-455`                                    |
| [F025](#f025) | P2     | contract         | CONFIRMED | 拦截器替换 body 后无法指定 Content-Type，空 body 留旧头  | `packages/core/src/http/transport/body.ts:32-34`                                       |
| [F026](#f026) | P2     | correctness      | CONFIRMED | 下载进度把压缩后的 Content-Length 当作解码总量           | `packages/core/src/http/transport/fetch.ts:264`                                        |
| [F027](#f027) | P2     | contract         | CONFIRMED | 递归 Struct 遇深层或循环输入抛 RangeError                | `packages/core/src/struct/parse.ts:78`                                                 |
| [F028](#f028) | P2     | correctness      | CONFIRMED | 外层重试复用 Headers，后续 span 挂在已结束的 span 下     | `packages/opentelemetry-server/src/interceptor/http.ts:32`                             |
| [F029](#f029) | P2     | correctness      | CONFIRMED | queryPropagation 只追加不替换同名键，接收方读到旧上下文  | `packages/opentelemetry-server/src/propagation/carrier.ts:35`                          |
| [F030](#f030) | P2     | contract         | CONFIRMED | HTTP responseHook 的 rejection 未被记录                  | `packages/opentelemetry-server/src/telemetry/trace.ts:106-116`                         |
| [F031](#f031) | P2     | contract         | CONFIRMED | SSE 元组第三槽读 live open，链尾异步期间可被重连覆盖     | `packages/core/src/sse/sse.ts:373-384`                                                 |
| [F032](#f032) | P2     | contract         | CONFIRMED | maxDelayMs 只约束 jitter 前的基数，实际等待可超上限      | `packages/core/src/internal/backoff.ts:11-12`                                          |
| [F033](#f033) | P2     | contract         | CONFIRMED | 路径占位符文法未文档化，含冒号的静态段无法表达           | `packages/core/src/internal/url.ts:36`                                                 |
| [F034](#f034) | P2     | correctness      | CONFIRMED | GraphQL 配方拒绝 data: null，应用错误被误报              | `doc/examples/recipes/graphql-http-envelope.ts:13-17`                                  |
| [F035](#f035) | P2     | contract         | CONFIRMED | 嵌套 intersection 展平时丢弃内层 nullable                | `packages/core/src/struct/constructors.ts:446-447`                                     |
| [F036](#f036) | P2     | contract         | CONFIRMED | 单成员 intersection 的公开类型丢失 optional              | `packages/core/src/struct/constructors.ts:417-418`                                     |
| [F037](#f037) | P2     | contract         | CONFIRMED | errorMap 返回空字符串时不替换默认消息                    | `packages/core/src/struct/errors.ts:129-131`                                           |
| [F038](#f038) | P2     | contract         | CONFIRMED | 跨包副本的 bigint/date 转换失败绕过本次 errorMap         | `packages/core/src/struct/constructors.ts:378`                                         |
| [F039](#f039) | P2     | contract         | CONFIRMED | 两份 @defjs/core 实例并存时调用方取消被记为 WARN         | `packages/opentelemetry-server/src/telemetry/logs.ts:30`                               |
| [F040](#f040) | P2     | correctness      | CONFIRMED | SSE 按行和按字段值剥离 BOM，偏离规范                     | `packages/core/src/sse/transport/parser.ts:181`                                        |
| [F041](#f041) | P2     | correctness      | CONFIRMED | 退避基数为 0 时第 1025 次重试抛 RangeError               | `packages/core/src/internal/backoff.ts:11-16`                                          |
| [F042](#f042) | P2     | docs             | CONFIRMED | 文档仍宣称已删除的 packed-consumer 与 ES2022 基线验证    | `docs/releases/0.4.0.md:66`                                                            |
| [F043](#f043) | P2     | docs             | CONFIRMED | Core 与 OTel 发布包 README 的文档站链接全部失效          | `packages/core/README.md:83-87`                                                        |
| [F044](#f044) | P2     | docs             | CONFIRMED | design.md 关于 subprotocol token 的说明与实现相反        | `packages/core/design.md:237`                                                          |
| [F045](#f045) | P2     | docs             | CONFIRMED | CODE_OF_CONDUCT 举报渠道为空，执行流程不可用             | `CODE_OF_CONDUCT.md:61-63`                                                             |
| [F046](#f046) | P2     | test             | CONFIRMED | abort 监听器回归测试只比次数，移除错误回调仍全绿         | `packages/core/test/regression/abort-listeners.spec.ts:15-27`                          |
| [F047](#f047) | P2     | test             | CONFIRMED | WebSocket attempt 清理的两处移除无任何测试锁定           | `packages/core/src/web_socket/web_socket.ts:640`                                       |
| [F048](#f048) | P2     | test             | CONFIRMED | SSE 退避参数测试只断言次数，去掉接线后仍全绿             | `packages/core/src/sse/transport/event_stream.advanced.spec.ts:1355-1373`              |
| [F049](#f049) | P2     | test             | CONFIRMED | responseHook 先于 span 结束的测试检不出顺序倒置          | `packages/opentelemetry-server/src/interceptor/http.spec.ts:409-425`                   |
| [F050](#f050) | P2     | correctness      | CONFIRMED | checkLinks 把无 index.html 的目录当作有效链接目标        | `doc/scripts/check-links.ts:41-44`                                                     |
| [F051](#f051) | P2     | correctness      | CONFIRMED | 搜索索引首次加载失败后被永久缓存，搜索静默失效           | `doc/app/components/search.tsx:16`                                                     |
| [F052](#f052) | P2     | correctness      | PLAUSIBLE | API 索引筛选在 tr/az 默认区域下大写 I 漏匹配             | `doc/app/data/api-catalog.ts:11`                                                       |
| [F053](#f053) | P3     | docs             | CONFIRMED | 多处文档把已声明 body 一律视为 JSON 检查与解析           | `doc/content/en-US/api/opentelemetry-server.mdx:99`                                    |
| [F054](#f054) | P3     | docs             | CONFIRMED | OTel 文档称 execute timeout 总记一条日志，链外超时不记   | `packages/opentelemetry-server/README.md:95`                                           |
| [F055](#f055) | P3     | i18n             | CONFIRMED | 简中与港繁 OTel 页把“已声明 body 缺失”译成“未声明”       | `doc/content/zh-Hans/docs/integrations/opentelemetry-server.mdx:71`                    |
| [F056](#f056) | P3     | docs             | CONFIRMED | 解码结果表对 SSE 握手 error struct 失配不成立            | `doc/content/en-US/docs/errors.mdx:79-81`                                              |
| [F057](#f057) | P3     | docs             | CONFIRMED | withTimeout JSDoc 仍写不存在的 ABORTED/TIMEOUT           | `packages/core/src/client/option.ts:49`                                                |
| [F058](#f058) | P3     | docs             | CONFIRMED | struct.object 页称 .alias 按 wire key 读取               | `doc/content/en-US/api/core/struct-object.mdx:16`                                      |
| [F059](#f059) | P3     | docs             | CONFIRMED | HttpRequestShape.body 在模块页误写为 unknown             | `doc/content/en-US/api/http.mdx:160`                                                   |
| [F060](#f060) | P3     | docs             | CONFIRMED | OTel README 把 server.port 列为必记属性                  | `packages/opentelemetry-server/README.md:230-232`                                      |
| [F061](#f061) | P3     | docs             | CONFIRMED | Errors 指南称 data.status 通过 struct 即证明来自后端     | `doc/content/en-US/docs/errors.mdx:124-126`                                            |
| [F062](#f062) | P3     | correctness      | CONFIRMED | send 内同步派发的心跳 ACK 被随后新建的超时覆盖           | `packages/core/src/web_socket/heartbeat.ts:69`                                         |
| [F063](#f063) | P3     | correctness      | CONFIRMED | injectClient() 在注入上下文外报错时误称未安装插件        | `packages/vue/src/core.ts:44-48（主）`                                                 |
| [F064](#f064) | P3     | docs             | CONFIRMED | Struct README 四条文档链接失效，构造器表行重复           | `packages/core/src/struct/README.md:383`                                               |
| [F065](#f065) | P3     | docs             | CONFIRMED | DESIGN-builder.md 仍自称现行契约且与代码相反             | `DESIGN-builder.md:3`                                                                  |
| [F066](#f066) | P3     | docs             | CONFIRMED | 根 README 的 Codecov 徽章停在 2025-03-14 快照            | `README.md:12`                                                                         |
| [F067](#f067) | P3     | i18n             | CONFIRMED | 港繁 interceptors 指南有一整句英文未翻译                 | `doc/content/zh-Hant-HK/docs/interceptors.mdx:83`                                      |
| [F068](#f068) | P3     | test             | CONFIRMED | types.type.test.ts 的 Equal 接受 any                     | `packages/core/src/error/types.type.test.ts:5`                                         |
| [F069](#f069) | P3     | test             | CONFIRMED | 被 ignore 的 discriminatedUnion 守卫无测试               | `packages/core/src/struct/constructors.ts:314-317`                                     |
| [F070](#f070) | P3     | test             | CONFIRMED | 五个 Content-Length 测试只断言 duplex                    | `packages/core/src/http/transport/fetch.spec.ts:467`                                   |
| [F071](#f071) | P3     | test             | CONFIRMED | 文档构建指纹不含依赖版本，升级后旧产物仍判新鲜           | `doc/scripts/build-state.ts:3-12`                                                      |
| [F072](#f072) | P3     | test             | CONFIRMED | exports.test.ts 对 export type * 等纯类型导出失明        | `doc/test/exports.test.ts:13-37`                                                       |
| [F073](#f073) | P3     | test             | CONFIRMED | 进程级 miss 日志使 http.e2e 同进程重跑误报失败           | `packages/core/test/e2e-routes.ts:12-23`                                               |
| [F074](#f074) | P3     | test             | CONFIRMED | teardown 端口探测在端口被他进程重绑时误报失败            | `packages/core/test/setup.ts:653-659`                                                  |
| [F075](#f075) | P3     | test             | CONFIRMED | preview.ts 三处路径边界与静态托管不一致                  | `doc/scripts/preview.ts:8`                                                             |
| [F076](#f076) | P3     | over-engineering | CONFIRMED | fillUrl 数组取首项分支在公开执行链上不可达               | `packages/core/src/internal/url.ts:17`                                                 |
| [F077](#f077) | P3     | over-engineering | CONFIRMED | @types/react-dom 版本在两处各自固定                      | `package.json:34-35`                                                                   |

## 发现详情

### P0

#### F001

**core 发布包遗漏 fetch-event-source 的 MIT 声明**

- 复核编号：P11-ops-01
- Verdict: CONFIRMED
- Severity: P0
- Category: ops
- Location: packages/core/tsdown.config.ts:48; packages/core/src/sse/transport/parser.ts:1-4; packages/core/THIRD_PARTY_NOTICES.md:5; .github/workflows/release.yml:41-49
- Sources: P11-ops-codex-01, P11-ops-grok-02
- Summary: core 的构建只复制 `LICENSE` 和 `README.md`。打包进 `index.js` / `index.min.js` 的 SSE 解析器改编自 Microsoft 版权的 MIT 代码，而 tarball 中没有任何该版权或许可文本。
- Failure scenario: 任一次 core 发布（release.yml 的 core job，或从 `packages/core/dist` 手工 `npm publish`）产出的 tarball 都缺少 Microsoft 声明，也不满足 MIT “copyright notice and this permission notice shall be included in all copies or substantial portions” 的条件。下游用户和许可证扫描工具只能看到 MunMunMiao 的 MIT 声明。已发布的 `@defjs/core@0.4.0-beta.1` 就是这种情况。
- Evidence:
  - 源码 `parser.ts:2-3` 写有 `Portions of this file are adapted from Azure/fetch-event-source.` 和 `See packages/core/THIRD_PARTY_NOTICES.md for the license text.`。对照上游 `src/parse.ts`（curl 只读获取）：`getBytes`/`getLines`/`getMessages` 分别对应 `readStreamBytes`/`createLineParser`/`createMessageParser`，`ControlChars` 枚举、`discardTrailingNewline`、`fieldLength` 状态机结构一致，属于实质部分。
  - `tsdown.config.ts:48` 为 `copy: ['../../LICENSE', './README.md'],`。
  - 在 clone 中执行 `cd packages/core && bun --bun run build`，exit 0；随后 `cd dist && npm pack --dry-run`，exit 0，`total files: 6`，文件为 `LICENSE README.md index.d.ts index.js index.min.js package.json`。
  - `grep -ci microsoft` 在这 6 个文件中计数均为 0。唯一的线索在 `index.d.ts:668-669`，只是一句 Azure 来源说明，并指向未打包的 `packages/core/THIRD_PARTY_NOTICES.md`。
  - 已发布包：jsdelivr 文件列表 API 显示 `@defjs/core@0.4.0-beta.1` 只有 `/index.d.ts /index.js /index.min.js /LICENSE /package.json /README.md`；其 `index.js` 中 `discardTrailingNewline` 出现 4 次，`microsoft` 出现 0 次。
  - git 历史：这个 notice 从来没有进入过 copy 列表（`744f7791` 起就是 `['../../LICENSE', './README.md']`），属于长期存在的问题，不是回归。
  - 另外，`THIRD_PARTY_NOTICES.md:5` 写的是旧路径 `src/transport/sse/parser.ts`，实际文件在 `src/sse/transport/parser.ts`。
  - 定级说明：运行时零影响，修复只需一行。定为 P0 的依据是 `_shared.md` §5 明确把“release produces a non-compliant package”列为 P0，且问题已在线上存在。如果协调者按纯功能后果定级，P1 是下限。
- Fix direction: 把 `./THIRD_PARTY_NOTICES.md` 加入 core 的 `copy`，并修正其中的源码路径。之后用 `npm pack --dry-run` 确认 tarball 包含该文件。
- Tags: cross-partition（notice 文件路径属文档范围）

### P1

#### F002

**定义路径校验可被反斜杠或空白绕过，认证头发往他域**

- 复核编号：P04-core-infra-01
- Verdict: CONFIRMED
- Severity: P1
- Category: security
- Location: packages/core/src/internal/url.ts:217, packages/core/src/internal/url.ts:218, packages/core/src/internal/url.ts:226, packages/core/src/internal/url.ts:138, packages/core/src/http/transport/fetch.ts:213, packages/core/src/sse/transport/event_stream.ts:254, packages/core/src/web_socket/build.ts:31, doc/content/en-US/docs/http.mdx:24, doc/content/en-US/api/core/createresolvedrequesturl.mdx:13
- Sources: P04-core-infra-codex-01
- Summary: `normalizeEndpointPath` 只在原始字符串上检查 `^scheme:` 与字面 `//`；随后的 `new URL(path, base)` 按 WHATWG 规则把 `\` 当作 `/`，去掉前导 C0 控制字符和空格，并删除任意位置的 `\t`/`\n`。因此这些等价的绝对 URL 和协议相对写法都能通过校验，HTTP、SSE、WebSocket 三种传输都会把请求发往路径中指定的其他主机。
- Failure scenario: 客户端配置 `withEndpoint('https://trusted.example/api')` 与 `withHeaders({ authorization: 'Bearer …' })`，或使用 `basicAuthHttpInterceptor`/`basicAuthSSEInterceptor`，或在浏览器中启用 `withCredentials` cookie。定义路径为以下任一形式时，请求实际发往 `https://other.example/x`（WebSocket 为 `wss://other.example/ws`），并带上全部默认头和拦截器注入的认证头：`'\\\\other.example/x'`、`'/\\\\other.example/x'`、`'\\/other.example/x'`、`' https://other.example/x'`、`'\thttps://…'`、`'h\tttps://…'`、`'\t//other.example/x'`、`'\n//other.example/x'`。对照：字面 `https://other.example/x` 与 `//other.example/x` 会被拒绝。
- Evidence:
  - 契约 `docs/http.mdx:24`：“Definition path can’t contain `?` or `#`, and can’t be absolute or protocol-relative.”
  - 实现 `url.ts:218` 为 `if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(path) || path.startsWith('//'))`；`:226` 只去掉前导 `/`；`:138` 直接调用 `new URL(normalizedPath, base)`。
  - 复现（不发网络请求，自定义 handle 只记录 Request）：`cd …/repo/packages/core && bun --bun run build`（Build complete），然后 `cd /tmp/zen-audit/verified/P04-core-infra/scratch && bun url-bypass.mjs && node url-bypass.mjs`，两者 exit 0，输出一致（节选）：
    ```text
    http {"path":"https://other.example/x","code":"NET_UNREACHABLE","msg":"Endpoint path must not be an absolute URL","sent":null}
    http {"path":"\\\\other.example/x","code":null,"sent":{"url":"https://other.example/x","auth":"Bearer FAKE_TOKEN"}}
    http {"path":"/\\\\other.example/x","code":null,"sent":{"url":"https://other.example/x","auth":"Bearer FAKE_TOKEN"}}
    http {"path":" https://other.example/x","code":null,"sent":{"url":"https://other.example/x","auth":"Bearer FAKE_TOKEN"}}
    http {"path":"h\tttps://other.example/x","code":null,"sent":{"url":"https://other.example/x","auth":"Bearer FAKE_TOKEN"}}
    http {"path":"\n//other.example/x","code":null,"sent":{"url":"https://other.example/x","auth":"Bearer FAKE_TOKEN"}}
    sse {"path":"\\\\other.example/sse","code":"HTTP_STATUS","sent":{"url":"https://other.example/sse","auth":"Basic dTpw"}}
    ws {"path":"\\\\other.example/ws","code":"NET_UNREACHABLE","url":"wss://other.example/ws"}
    ```
  - 定级为 P1 而非 P0：
    - 触发需要定义路径本身含这些形式，或拦截器把 `req.endpoint` 改写成这些形式。
    - 按文档把不可信值放进占位符时，`encodePathSegment` 会用 `encodeURIComponent` 把这些字符编码为 `%5C`/`%20`/`%09`，无法触发。
    - 但这是文档声明的唯一同源防线，被绕过时会把凭据交给第三方主机。
  - 附带观察：被正确拒绝的绝对路径以 `NET_UNREACHABLE` 返回，而不是构建类错误码。原因是校验在传输内抛出，并被标记为来自传输。
- Fix direction: 在解析之后比较结果 URL 的 `origin`（以及路径前缀）是否与 base 一致，不要在原始字符串上模拟 URL 解析器。最好把这一步放到构建阶段，让它以 `REQ_BUILD_FAILED` 报告，并补上反斜杠、空白、制表符各形式的回归测试。
- Tags: cross-partition, runtime=both

#### F003

**SSE errorOpenInfoMap 键为共享哨兵，跨请求泄露响应快照**

- 复核编号：P03a-core-sse-01
- Verdict: CONFIRMED
- Severity: P1
- Category: contract
- Location: packages/core/src/sse/transport/event_stream.ts:703; packages/core/src/sse/transport/event_stream.ts:705-711; packages/core/src/sse/transport/event_stream.ts:505-512; packages/core/src/sse/transport/event_stream.ts:528-529; packages/core/src/sse/sse.ts:389-395; packages/core/src/sse/sse.ts:530-539; packages/core/src/internal/abort.ts:51-55; packages/core/src/internal/abort.ts:144; packages/core/src/error/cause.ts:2; packages/core/src/error/cause.ts:5
- Sources: P03a-core-sse-codex-01
- Summary: `attachOpenInfo` 把当前流最近一次的打开信息写入模块级 WeakMap，键是失败对象。取消和超时路径传入的是进程级单例 `ERR_ABORTED` / `ERR_TIMEOUT`，映射从不清除；`runEventStreamCommand` 取回它时不检查归属。
- Failure scenario:
  - 超时路径：client A 以 `{ signal: AbortSignal.timeout(n) }` 打开流，打开后到期。`finishAborted` 走 `finishError(ERR_TIMEOUT)`，于是 `errorOpenInfoMap[ERR_TIMEOUT] = A.open`。随后另一个 client B 调用 SSE `execute(cmd, { timeout: 30 })`，服务端一直不响应，deadline 以 `ERR_TIMEOUT` 中止（`abort.ts:144`）。B 得到 `[NET_TIMEOUT 故障, undefined, A 的 open]`，其中的状态、响应头、URL 全部属于 A。在服务端多租户进程中，B 的错误处理会读到 A 的响应元数据。
  - 取消路径：每次正常的 `close()`、`break` 或 dispose 都会把 `errorOpenInfoMap[ERR_ABORTED]` 写成该流的 open。如果最近写入的是一个被取消的 401 握手，之后 handle 抛 `ERR_ABORTED` 的启动会被 `createEventStreamFault` 按这个陈旧的 401 报成 `HTTP_STATUS`，而正确结果应为 `NET_ABORTED`。
- Evidence:
  - 复核者探针 `scratch/verify-probe.ts`：`bun verify-probe.ts` exit 0；`bun build … --target=node` 后执行 `node node/verify-probe.js` exit 0。Node 26.11.1 与 Bun 1.4.3 输出一致：
    - `stream-A {"openUrl":"","closed":{"kind":"error","code":"NET_TIMEOUT"}}`
    - `stream-B-startup-timeout {"code":"NET_TIMEOUT","stream":"undefined","openUrl":"","tenantHeader":"A"}`
    - B 使用不同的 client 和 endpoint，handle 永不返回，但第三槽带着 A 的 `x-tenant: A` 头。openUrl 为空是因为探针用的是合成 Response。
  - 在本 clone 上复跑 codex 探针（`scratch/codex-probe.ts`），Bun 与 Node 均 exit 0：
    - `stale-timeout-open {"code":"NET_TIMEOUT","fetchStarted":true,"secondGotResponse":false,"returnedRequestId":"first-request","bodyUnlocked":true}`
    - `stale-abort-classification {"expected":"NET_ABORTED","actual":"HTTP_STATUS","status":401,"returnedRequestId":"prior-401"}`
  - 相关代码：
    - `event_stream.ts:703` 为 `const errorOpenInfoMap = new WeakMap<object, EventStreamOpenInfo>()`；`:706` 在本次没有 open 时直接 return，旧映射保留。
    - `:507-508` 为 `if (abortedError === ERR_TIMEOUT) { finishError(ERR_TIMEOUT) …}`；`:512` 为 `attachOpenInfo(abortedError, latestOpen)`。
    - `abort.ts:55` 为 `return timedOut ? ERR_TIMEOUT : ERR_ABORTED`。
    - `sse.ts:391` 为 `const openInfo = getErrorOpenInfo(cause)`，`:395` 原样放进第三槽；`:530-539` 只要拿到非 ok 响应就生成 `HTTP_STATUS`。
  - 文档 `docs/sse.mdx:32` 写的是 "A response snapshot can still sit in the third tuple slot when validation fails after the response arrives."，而本场景中 B 从未收到响应。
  - 定级理由：只用普通 API 组合（`AbortSignal.timeout` 作为 signal，加上 `timeout` 选项），文档化的返回槽就会携带另一个请求的数据，因此定 P1。不定 P0：没有崩溃，超时路径的故障码本身正确，泄露的前提是调用方读取或记录第三槽。
- Fix direction: 让打开信息随本次 `fetchEventStream` 的失败一起传递，例如记录在 `sseHandler` 的 owned stream 上，或包装后在 catch 处解包；不再用跨请求共享的哨兵作 side table 的键。补一条隔离回归测试：先让一条流关闭或超时，再让另一个 client 启动超时或取消。本条与 P04-core-infra-03（transport-origin WeakSet）是同一设计缺陷，宜一并修复。
- Tags: cross-partition（与 P04-core-infra-03 同类）, runtime=both

#### F004

**默认 fetch 在模块求值时固定，之后替换的全局 fetch 被绕过**

- 复核编号：P02-core-http-client-01
- Verdict: CONFIRMED
- Severity: P1
- Category: correctness
- Location: packages/core/src/client/config.ts:199, packages/core/src/client/config.ts:205, packages/core/src/client/config.ts:212-220, packages/core/src/client/config.ts:225, packages/core/src/client/config.ts:234, packages/core/src/http/http.ts:340, packages/core/src/sse/sse.ts:348, doc/content/en-US/api/core/clientconfig-type.mdx:29
- Sources: P02-core-http-client-codex-01, P02-core-http-client-grok-01
- Summary: `PLATFORM_FETCH = globalThis.fetch` 与 `DEFAULT_FETCH = PLATFORM_FETCH.bind(globalThis)` 在导入时求值并写进默认配置。之后替换全局 fetch，对所有未传 `withHTTPHandle`/`withSSEHandle` 的客户端都无效，即使客户端是在替换之后才创建的；导入时如果没有 fetch，整个包在导入时就抛错。
- Failure scenario: 先 `import '@defjs/core'`，再由 mock 或插桩工具替换 `globalThis.fetch`，然后 `createClient(withEndpoint(...))`。请求绕过替换直接打到真实网络，mock 计数为 0；同一时刻 `fetchHandler()` 的默认参数却会走到新函数。若导入时 `globalThis.fetch` 为 `undefined`，导入根入口就抛 `TypeError`，只用 `struct` 的使用者也一样。
- Evidence:
  - `config.ts:199` 是 `const PLATFORM_FETCH = globalThis.fetch`，`config.ts:205` 是 `export const DEFAULT_FETCH: FetchHandle = PLATFORM_FETCH.bind(globalThis)`。
  - `config.ts:212-220` 把它写进 `DEFAULT_HTTP_OPTIONS`/`DEFAULT_SSE_OPTIONS`，`config.ts:225/234` 只做浅拷贝。
  - `http.ts:340` 总是把 `clientConfig.http.handle` 传给 `fetchHandler`，所以 `fetch.ts:360` 默认参数里的 `resolveGlobalFetch()` 在客户端路径上永远不会生效。
  - 文档 `clientconfig-type.mdx:29` 写的是 “`http.handle` and `sse.handle` are the global `fetch`”。
  - `test/fetch-native-suite.ts:193-253` 只锁定“全局未替换时默认 handle 等于 `DEFAULT_FETCH`”，没有测试把“导入后替换被忽略”定为预期。
  - 复现用真实本地服务器（端口 0）：
    - `bun scratch/a_fetch_capture.ts capture`（exit 0）：`client created after patch {"fault":null,"data":"wire","patchedCalls":0}`，`fetchHandler() default after patch {"data":"mocked","patchedCalls":1}`。
    - `node scratch/node/a_fetch_capture.js capture`（exit 0）：输出相同。
    - missing 模式（两者均 exit 0）：Bun 为 `IMPORT_THREW TypeError undefined is not an object (evaluating 'PLATFORM_FETCH.bind')`，Node 为 `IMPORT_THREW TypeError Cannot read properties of undefined (reading 'bind')`。
  - SSE 由同一常量驱动（`sse.ts:348`），没有单独开 SSE 连接复现。
  - 没有验证具体第三方库（MSW、OTel、Sentry）的安装时机。
- Fix direction: 默认配置不要在模块顶层绑定平台 fetch，改为发送时解析当前全局，沿用 `resolveGlobalFetch()` 的语义（未替换走平台快路，已替换按自定义 handle 处理）。缺少 fetch 的失败推迟到首次 HTTP/SSE 调用，报 `ENV_UNSUPPORTED`。
- Tags: runtime=both, cross-partition（SSE 默认 handle 属 P03）

#### F005

**Node 上 FormData 带进度时整体缓冲，无视超时与取消**

- 复核编号：P02-core-http-client-03
- Verdict: CONFIRMED
- Severity: P1
- Category: correctness
- Location: packages/core/src/http/transport/fetch.ts:447, packages/core/src/http/transport/fetch.ts:496-499, packages/core/src/http/transport/fetch.ts:404, packages/core/src/http/http.ts:376-381, packages/core/README.md:49, doc/content/en-US/docs/http.mdx:150
- Sources: P02-core-http-client-codex-03
- Summary: 进度转换对 FormData 执行 `await new Response(body).blob()`，没有任何 signal 约束。结果是文件型 FormData 被完整物化，内存约为文件大小的 3 倍；取消或 deadline 到期后，`execute` 仍要等物化结束才返回。
- Failure scenario: 在 Node 上用 `fs.openAsBlob` 把 512 MiB 文件放进 FormData，带 `onUploadProgress`，再加 `timeout: 20` 或在 20 ms 时 abort。不带进度时 22 ms 返回，峰值 RSS 约 136 MiB；带进度时 442–574 ms 才返回，峰值 RSS 约 1.6 GiB。文件越大，延迟线性增长，可能直接 OOM。File 流停滞时 `execute` 永不返回。
- Evidence:
  - 代码：
    - `fetch.ts:447` 的 `await convertBodyToUploadStream(body)` 没有和 signal 竞速。
    - `fetch.ts:497-498` 是 `new Response(body)` 加 `await serialized.blob()`。
    - `http.ts:378-379` 的取消分支是 `await Promise.allSettled([inflightTransport])`，必须等转换结束。
  - 契约：
    - `README.md:49`：“Ordinary HTTP work … is bounded with its execute-time timeout or `AbortSignal`”。
    - `docs/http.mdx:150` 说 FormData “converts … to a stream”，没有提到整体缓冲。
  - 复现：真实本地服务器、512 MiB 文件，每个组合单独一个进程，均 exit 0。
    - `node plain timeout {"code":"NET_TIMEOUT","settledMs":23,"serverRequests":1,"maxRssMiB":136}`
    - `node plain abort {"code":"NET_ABORTED","settledMs":22,"abortFiredMs":20,"maxRssMiB":136}`
    - `node progress timeout {"code":"NET_TIMEOUT","settledMs":442,"serverRequests":0,"maxRssMiB":1618}`
    - `node progress abort {"code":"NET_ABORTED","settledMs":574,"abortFiredMs":19,"maxRssMiB":1630}`；复跑为 532 ms / 1621 MiB。
  - 停滞变体：codex 的 File 子类脚本，改为指向本克隆，Node 上 exit 0，输出 `{"outcome":"STILL_PENDING_AFTER_200MS","fetches":0,"opened":1,"closed":0}`。只有释放流之后才得到 `NET_TIMEOUT`。
  - Bun 不算库的问题：Bun 的平台 fetch 本身就同步物化 FormData。plain 为 158 ms / 1041 MiB，progress 为 166 ms / 1043 MiB，两者几乎相同。Bun 也不保留 File 子类。
  - codex 的子结论“Bun 上 handle 在 deadline 过后才启动”在真实服务器上没有可观察后果（serverRequests 0），未纳入。
  - 时间数字只表示量级，不作为基准。
- Fix direction: FormData 不要整体 `blob()`，改为可取消的流式序列化，例如 `new Response(body).body`；总量未知时 `lengthComputable=false`。转换要和请求 signal 竞速，取消时释放 reader。
- Tags: runtime=node

#### F006

**Bun 上 FormData 带进度上传丢失 boundary**

- 复核编号：P02-core-http-client-02
- Verdict: CONFIRMED
- Severity: P1
- Category: correctness
- Location: packages/core/src/http/transport/fetch.ts:496-499, packages/core/src/http/transport/fetch.ts:453-455, packages/core/src/http/transport/fetch.ts:472-477, packages/core/src/http/transport/body.ts:59-61, packages/core/src/http/transport/body.ts:76-77, packages/core/src/http/transport/fetch.streaming.spec.ts:420-485
- Sources: P02-core-http-client-grok-02
- Summary: `convertBodyToUploadStream` 在 `await serialized.blob()` 之后才读 `headers.get('Content-Type')`。Bun 1.4.3 在 `blob()` 之后该头为 `null`，流式 body 走检测分支得到 `application/octet-stream`。
- Failure scenario: 在 Bun 的服务端或 CLI 里用 FormData（含文件）POST，并传 `onUploadProgress`。服务器收到 multipart 正文，但 Content-Type 是 octet-stream，没有 boundary，multipart 解析失败。不传进度时正常；Node 不受影响。
- Evidence:
  - 平台机制（`bun -e` / `node -e`，exit 0）：
    - Bun：`{"readBefore":"multipart/form-data; boundary=","readAfterBlob":null,"blobType":"multipart/form-data; boundary="}`
    - Node：`{"readAfterBlob":"multipart/form-data; boundary=",...}`
  - 库路径：真实服务器回显收到的 Content-Type，用 `bun scratch/b_upload_ct.ts` 和 `node scratch/node/b_upload_ct.js` 运行，均 exit 0。
    - `bun default formdata plain {"ct":"multipart/form-data; boundary=----WebKitFormBoundary…","len":335}`
    - `bun default formdata progress {"ct":"application/octet-stream","len":335,"head":"------WebKitFormBoundary"}`
    - custom handle 结果相同。
    - `node default formdata progress {"ct":"multipart/form-data; boundary=----formdata-undici-…"}`
  - 测试缺口：`fetch.streaming.spec.ts:420-485` 的 FormData 进度用例用 mock fetch，不检查请求 Content-Type。分区测试在 Bun 上 356 项全过；CI 只跑 Bun。
  - 定为 P1 的理由：`docs/http.mdx:150` 明确承诺 Bun 上 FormData 会转流并报告进度，而这个组合下的上传必然无法解析。
- Fix direction: 在 `blob()` 之前读 Content-Type，或直接用 `blob.type`（两个运行时都带 boundary）。补一条断言，检查真实请求的 Content-Type 同时含 `multipart/form-data` 和 `boundary=`。
- Tags: runtime=bun

### P2

#### F007

**String(fault) 含响应字段原值，与“可直接记录”相冲突**

- 复核编号：P04-core-infra-02（合并：P01-core-struct-02）
- Verdict: CONFIRMED
- Severity: P2
- Category: security
- Location: packages/core/src/error/factory.ts:59, packages/core/src/error/cause.ts:30, packages/core/src/struct/errors.ts:124, packages/core/src/struct/utils.ts:248, packages/core/README.md:46, doc/examples/errors/log-fault.ts:5, doc/content/en-US/api/errors.mdx:63, doc/content/en-US/docs/errors.mdx:177, doc/content/zh-Hans/api/core/fault-type.mdx:14; doc/examples/errors/log-fault.ts:7; doc/content/en-US/docs/errors.mdx:152-158
- Sources: P04-core-infra-codex-02, P04-core-infra-grok-03
- Summary: `createDecodeFault` 用 `describeCause(cause)` 作为 fault 的 message。README、API 页和官方日志示例都把 `String(fault)` 当作可直接记录的形式，而同一套文档又要求把 Struct issues 和响应体视为敏感数据。
  - `RES_STRUCT_MISMATCH` 时，message 是 StructError 的首条 issue message，含 `received` 的字符串或数字原值。
  - `RES_DECODE_FAILED` 时，message 是 JSON 解析器的报错；在 Node 下其中含响应体的前若干字符。
- Failure scenario: 服务端返回 `{"email":"ada.lovelace@example.test"}`，而客户端契约把 `email` 声明为 `struct.number()`。调用方按 `log-fault.ts:5` 执行 `console.error(String(fault), …)`，日志行为 `DefjsFault: Expected number at email, received "ada.lovelace@example.test"`。若响应体不是 JSON，Node 下 `String(fault)` 为 `DefjsFault: Unexpected token 's', "session=FA"... is not valid JSON`。
- Evidence:
  - 文档一侧：
    - `README.md:46`：“`String(error)` is directly loggable”。
    - `api/errors.mdx:63`：“produces a directly loggable `DefjsFault: <message>`”。
    - `log-fault.ts:5` 无条件记录 `String(fault)`，`:7` 还无条件记录 `prettify()`。
    - 与之矛盾的是：`docs/errors.mdx:173` 把 “Struct issues, body, input values” 列为敏感，`:177` 要求 “Treat … Struct issues, input values … as sensitive”。
  - 实现一侧：`struct/utils.ts:248` 对字符串执行 `JSON.stringify(value)`，`struct/errors.ts:124` 把它拼进 message，`factory.ts:60` 原样用作 fault message。
  - 复现：`bun|node fault-message.mjs` 与 `bun|node json-frag.mjs`，均 exit 0，输出：
    ```text
    mismatch number<-email {"code":"RES_STRUCT_MISMATCH","string":"DefjsFault: Expected number at email, received \"ada.lovelace@example.test\""}
    mismatch string<-ssn {"code":"RES_STRUCT_MISMATCH","string":"DefjsFault: Expected string at ssn, received 123456789"}
    {"rt":"bun","code":"RES_DECODE_FAILED","string":"DefjsFault: JSON Parse error: Unexpected identifier \"session\""}
    {"rt":"node","code":"RES_DECODE_FAILED","string":"DefjsFault: Unexpected token 's', \"session=FA\"... is not valid JSON"}
    ```
  - 定级 P2：对象类型的 received 只写成 `object`，泄漏限于标量字段和解析器片段；但触发条件只是普通的契约漂移，且走的正是文档推荐的日志写法。
- Fix direction: 二选一并保持一致。一是让 `RES_*` fault 的 message 只含 code 和路径，把原值留在 `cause` 上；二是撤回 “directly loggable” 的说法，把示例改为只记录 `code`/`status`（`summarize-fault.ts` 已有现成写法），并说明 `prettify()` 的输出敏感。
- Tags: cross-partition, runtime=both

<details><summary>合并项 P01-core-struct-02 的复核记录</summary>

##### P01-core-struct-02 默认 issue 消息内嵌标量 payload，官方日志示例原样写进日志

- Verdict: CONFIRMED
- Severity: P2
- Category: security
- Location: packages/core/src/struct/errors.ts:124; packages/core/src/struct/utils.ts:247-248; packages/core/src/error/cause.ts:31; packages/core/src/error/factory.ts:60; packages/core/README.md:46; doc/examples/errors/log-fault.ts:5-7; doc/content/en-US/docs/errors.mdx:152-158
- Sources: P01-core-struct-codex-08, P01-core-struct-grok-03
- Summary: 默认消息的格式是 `Expected ${expected} at ${path}, received ${describeValue(received)}`，字符串原值会被 `JSON.stringify` 后整段放进去，再依次成为 `StructError.message` 和 `Fault.message`。根 README 说 `String(error)` "directly loggable"，文档示例又同时打印 `String(fault)` 和 `fault.cause.prettify()`，于是标量 payload 进了日志。
- Failure scenario: 某个响应字段声明为 `struct.number()`，服务端却在这个字段里返回了 token 或邮箱。应用照 `log-fault.ts` 的写法记日志，日志里会出现 `DefjsFault: Expected number at id, received "SYNTHETIC_PAYLOAD_123"`，`prettify()` 那一行也带着同一个值。对象和数组在消息里只显示为 `object` / `array`，所以泄漏只限于标量。
- Evidence:
  - **复现输出（两个运行时相同，数据为合成）：** `@@ H {"code":"RES_STRUCT_MISMATCH","text":"DefjsFault: Expected number at id, received \"SYNTHETIC_PAYLOAD_123\"","pretty":"× id: Expected number at id, received \"SYNTHETIC_PAYLOAD_123\""}`。
  - **消息传递链：** `errors.ts:124` 拼出消息 → `utils.ts:248` 对字符串执行 `JSON.stringify(value)` → `errors.ts:27-28` 把首条 issue 的 message 当作 Error message → `cause.ts:31` 的 `describeCause` 取出 `cause.message` → `factory.ts:60` 用它创建 fault。
  - **文档互相矛盾：**
    - 鼓励直接记录的一方：`packages/core/README.md:46` 写着 "`String(error)` is directly loggable"；`log-fault.ts:5` 是 `console.error(String(fault), { code: fault.code })`，`:7` 是 `console.error(fault.cause.prettify())`，这个示例由 `errors.mdx:158` 引入。
    - 要求脱敏的一方：`errors.mdx:173` 把 "Struct issues, body, input values" 列为敏感内容；`docs/struct.mdx:95` 写着 "Issues can hold untrusted input — redact before logging"；`src/struct/README.md:360` 也有同样的警示。
  - **定为 P2 的理由：** Struct 文档已有局部警示，而且泄漏只发生在不匹配字段的标量上。
- Fix direction: 二选一。一是默认消息不再嵌入 received 的值，只保留在 `StructIssue.received` 上；二是把 README 的 "directly loggable" 说法和 `log-fault.ts` 示例改成与 Struct 文档一致的脱敏要求。
- Tags: cross-partition（P09、P12）, runtime=both

</details>

#### F008

**WebSocket 重连 attempts 为整个会话累计预算，文档未说明**

- 复核编号：P03b-core-ws-02
- Verdict: CONFIRMED
- Severity: P2
- Category: contract
- Location: packages/core/src/web_socket/web_socket.ts:401; packages/core/src/web_socket/web_socket.ts:484-512; packages/core/src/web_socket/web_socket.ts:521; packages/core/src/client/config.ts:71; packages/core/src/client/config.ts:75; doc/content/en-US/docs/web-socket.mdx:52; doc/content/en-US/api/core/withwebsocketreconnect.mdx:25-27; doc/content/en-US/api/core/clientwebsocketoptions-type.mdx:34; doc/content/en-US/api/core/websocketexecuteoptions-type.mdx:30; doc/content/en-US/api/web-socket.mdx:106
- Sources: P03b-core-ws-grok-02（codex 在 coverage H1 中确认同一行为但未列为发现；争议已裁定）
- Summary: `attempt` 在会话开始时为 0、只增不减，成功 `open` 不补充预算；同一计数还作为退避指数，相隔数小时的独立断线也会使用越来越长的首次等待。
- Failure scenario: `withWebSocketReconnect({ attempts: 3, delayMs: 100, factor: 2 })`，连接每次正常工作 1 小时后被服务端以 1012 断开、且每次重连立即成功。第 1/2/3 次断线后的首次等待为 100/200/400 ms（而非每次 100 ms），第 4 次断线后会话以 `{ kind: 'closed', code: 1012 }` 结束，不再重连、无错误。以默认 `attempts: 3` 运行的长连接会在生命周期内第 4 次掉线时静默终止。
- Evidence: `web_socket.ts:401` `let attempt = 0`；`:484` `const nextAttempt = attempt + 1`，`:487` 仅当 `nextAttempt <= reconnect.attempts` 时询问谓词，`:512` `attempt = nextAttempt`，`:521` `computeReconnectDelay(reconnect, nextAttempt)`；`handleOpen`（`:692-732`）不触碰 `attempt`，全文件无其他写回。复核探针（假计时器，每个连接先推进 1 小时健康期，Node/Bun 一致）：`PROBE BUDGET node=26.11.1 opens=4 beforeConnect=[0,1,2,3] gapsMs=[100,200,400] closed={"code":1012,"kind":"closed","reason":"drop","wasClean":true}`（bun=1.4.3 相同）。文档：`docs/web-socket.mdx:52` "`attempts` counts retries after the initial attempt"；`withwebsocketreconnect.mdx:25` "`attempts` is the retry budget after the first connect"，`:27` "every close is retried while the budget lasts"；`config.ts:71` "Retry budget after the first connect."；`config.ts:75` `factor` 为 "Multiplier applied to the delay after each failed attempt."。前几句没有说明成功 open 是否补充预算；`config.ts:75` 与运行时矛盾（成功重连后指数仍增长）。无测试锁定 "成功后不重置" 语义。争议裁定：codex 以 "文档未承诺按次重置" 不报，grok 报 P2；brief H1 标准为 "若未写明终身预算语义，至少是 docs/contract 发现"，行为已复现、文档未写明且 `factor` JSDoc 与实际矛盾，采纳 grok。不升 P1：默认谓词对干净关闭也返回 true，累计预算可防 "连上即被关" 的无限重连，属合理设计但未被说明。
- Fix direction: 若累计是有意设计，在 `withWebSocketReconnect` 页、WebSocket 指南与 `ClientWebSocketOptions.reconnect` JSDoc 写明 "预算与退避序号在整个逻辑会话累计，成功 open 不重置"，并修正 `factor` 描述；若要按次断线计算，则在 open 后重置计数，并为默认谓词增加防 "连上即关" 的约束。
- Tags: runtime=both；SSE `retryCount`（P03a）同类，交 P03a 复核者判断

#### F009

**SSE 重连 attempts 为整条逻辑流累计预算，文档未说明**

- 复核编号：P03a-core-sse-02（合并：P09b-doc-api-01）
- Verdict: CONFIRMED
- Severity: P2
- Category: contract
- Location: packages/core/src/sse/transport/event_stream.ts:157; packages/core/src/sse/transport/event_stream.ts:412; packages/core/src/sse/transport/event_stream.ts:442; packages/core/src/sse/transport/event_stream.ts:458-460; packages/core/src/sse/transport/event_stream.ts:470; packages/core/src/client/config.ts:99; packages/core/src/client/config.ts:103; doc/content/en-US/docs/sse.mdx:62; doc/content/en-US/api/core/withssereconnect.mdx:31; doc/content/en-US/api/core/clientsseoptions-type.mdx:36; doc/content/en-US/api/client.mdx:241; doc/content/en-US/api/client.mdx:247; doc/content/en-US/recipes/consume-sse.mdx:22
- Sources: P03a-core-sse-grok-03。codex 在 coverage H1 中复现了同一行为但没有报告，争议已裁定。
- Summary: `retryCount` 从 0 开始，只在 `resolveRetryDelay` 里递增；握手成功、事件交付之后也不清零。同一个计数同时用作预算、`shouldReconnect` 收到的 `attempt`，以及 `computeReconnectDelay` 的指数。
- Failure scenario: 使用 `withSSEReconnect({ attempts: 3 })`（或默认值 3）的长连接，每次物理连接都正常工作一段时间后掉线，重连也立即成功。到第 4 次掉线时不再重连：迭代器抛出原始网络错误，`closed` 为 `{ kind: 'error', code: 'NET_UNREACHABLE' }`。如果设置了 `factor > 1`，相隔很久的独立掉线等待时间也会逐次变长。
- Evidence:
  - `scratch/verify-probe.ts` 的 lifetime-budget 段，配置 `attempts: 3, delayMs: 40, factor: 2`，每个连接交付一个事件、健康 30 ms 后出错。
    - Bun 输出 `{"fetches":4,"events":["e1","e2","e3","e4"],"iterationError":"connection lost","closed":{"kind":"error","code":"NET_UNREACHABLE"},"approxBackoffMs":[42,82,163]}`。
    - Node 的 `approxBackoffMs` 为 `[45,82,162]`，其余字段相同。
  - 文档措辞：
    - `sse.mdx:62`："`attempts` counts retries after the initial attempt"
    - `withssereconnect.mdx:31`："`attempts` is the retry budget after the first attempt"
    - `config.ts:99` 与上面同义；`config.ts:103` 对 `factor` 的描述是 "Multiplier applied to the delay after each failed attempt."
    - 以上都没有说明成功打开后预算是否恢复。
  - 用 grep 查遍 SSE 规格中的 `attempts`，没有测试锁定“成功后不重置”或相反的语义。
  - SSE 特有情况：
    - 默认 `factor` 为 1，所以指数累计只在显式设置 `factor > 1` 时可见；预算耗尽则在默认配置下就会发生。
    - 浏览器原生 `EventSource` 会无限重连，从它迁移过来的用户更可能预期“按每次掉线计算”。
  - 定级与裁定和 P03b-core-ws-02（WebSocket 同一语义，P2 contract）保持一致。
- Fix direction: 如果累计是有意设计，就在 SSE 指南、`withSSEReconnect` 页和 `ClientSSEOptions.reconnect` 的 JSDoc 里写明：预算与退避序号在一次 `execute` 的整条逻辑流内累计。如果本意是按每次掉线计算，就在一次尝试成功打开（或交付事件）后重置 `retryCount`，并与 WebSocket 一起决定。
- Tags: runtime=both；与 P03b-core-ws-02 同根（各自实现）

<details><summary>合并项 P09b-doc-api-01 的复核记录</summary>

##### P09b-doc-api-01 SSE 重连参考页未写明 `attempts` 是整段逻辑流的累计预算，成功重连不恢复预算

- Verdict: CONFIRMED
- Severity: P2
- Category: docs
- Location: doc/content/en-US/api/core/withssereconnect.mdx:31; doc/content/en-US/api/core/clientsseoptions-type.mdx:36; doc/content/en-US/api/client.mdx:241; doc/content/en-US/api/client.mdx:247; packages/core/src/sse/transport/event_stream.ts:157; packages/core/src/sse/transport/event_stream.ts:412; packages/core/src/sse/transport/event_stream.ts:459; packages/core/src/sse/transport/event_stream.ts:470; packages/core/src/client/config.ts:99
- Sources: P09b-doc-api-codex-03, P09b-doc-api-grok-04（只保留 SSE 部分；WebSocket 部分重复 P03b-core-ws-02，见 rejected.md）
- Summary: SSE 的 `retryCount` 在一次 `execute` 创建的逻辑流开始时置 0，之后只增不减。成功重连不恢复预算，退避指数也跨健康期累计。API 参考页只写“首次尝试之后的重试预算”和默认值，没写预算的范围。
- Failure scenario: 配置 `withSSEReconnect({ attempts: 2, delayMs: 7, factor: 3 })`。三次连接都成功打开，各投递一个事件后读流失败。第二次掉线的等待是 21 ms 而不是 7 ms，虽然上一次重连已经成功。第三次掉线后流以 `closed.kind === 'error'` 结束，不再重连。用默认 `attempts: 3` 的长连接，会在整个生命周期内第 4 次掉线时永久结束。把 budget 理解成“每次中断各有 3 次”的读者会少拿到重试。
- Evidence: 源码 `event_stream.ts:157` `let retryCount = 0`；`:412` `retryCount += 1`；`:459` `if (retryCount > attempts) {`；`:470` `return computeReconnectDelay({ delayMs, factor, jitter, maxDelayMs }, retryCount)`。用 `grep -n retryCount` 查过，全文件没有其他写回，成功打开不会归零。文档原文：`withssereconnect.mdx:31` “`attempts` is the retry budget after the first attempt. It defaults to `3` …”；`clientsseoptions-type.mdx:36` “`attempts` defaults to **3** …”；`client.mdx:241` 默认值表和 `:247` 都没写生命周期范围；源码 JSDoc `config.ts:99` 也是同一句 “Retry budget after the first attempt.”。复核探针 `/tmp/zen-audit/verified/P09b-doc-api/scratch/sse-budget.mjs` 使用新构建的 `packages/core/dist`，通过公开 `withSSEHandle` 注入，并 hook `setTimeout` 记录退避值：
  ```text
  bun 1.4.3 SSE attempts=2 fetches=3 delivered=["gen-1","gen-2","gen-3"] policyAttempts=[1,2,3] backoffDelays=[7,21] closed=error
  node 26.11.1 SSE attempts=2 fetches=3 delivered=["gen-1","gen-2","gen-3"] policyAttempts=[1,2,3] backoffDelays=[7,21] closed=error
  ```
  两个运行时都 exit 0。`shouldReconnect` 第三次被调用后才检查预算，这和页面上“runs before the attempts limit is checked”一致，不算问题。定级理由：WebSocket 同根项 P03b-core-ws-02 定为 P2，这里保持一致。不升 P1，因为文档没有承诺“成功后重置”，累计预算也可以理解为防“连上即断”式无限重连的合理设计，缺的是对它的说明。
- Fix direction: 在 `withSSEReconnect` 页、`ClientSSEOptions` 页、`client.mdx` 默认值段和 `config.ts` JSDoc 中写明：预算和退避序号在一次 `execute` 的整段逻辑流内累计，成功重连不重置；如果打算改为按次断线计算，归 P03a 在代码层处理。
- Tags: cross-partition（代码行为属 P03a；指南 `docs/sse.mdx:62` 属 P09a；WS 同根为 P03b-core-ws-02）, runtime=both

</details>

#### F010

**WebSocket 出站 JSON 静默改写非 JSON 值，HTTP 同值拒绝**

- 复核编号：P03b-core-ws-01（合并：P01-core-struct-01）
- Verdict: CONFIRMED
- Severity: P2
- Category: correctness
- Location: packages/core/src/web_socket/codec.ts:11; packages/core/src/web_socket/web_socket.ts:1223; packages/core/src/web_socket/heartbeat.ts:65; packages/core/src/internal/outbound_request.ts:342; packages/core/src/web_socket/web_socket.ts:1236; packages/core/src/internal/outbound_request.ts:347-367
- Sources: P03b-core-ws-codex-01, P03b-core-ws-grok-01
- Summary: `serializeOutgoingWebSocketMessage` 对 struct 校验后的值直接 `JSON.stringify`，只拦截结果为 `undefined` 的根值，`send` 成功返回但 wire 数据与调用者交出的值不同。
- Failure scenario: `outgoing: struct.number()` 时 `session.send(Infinity)`，socket 收到文本 `null`；`struct.object({ n: struct.number() })` 发送 `{ n: -Infinity }` 得到 `{"n":null}`；`struct.any()` 发送 `new Map(...)`/`new Set(...)` 得到 `{}`，对象内函数字段被删除。`send` 不抛错，同一 `struct.number()` 在对端无法解析 `null`。直接发送、`reconnecting` 期间排队（排队的是已改写的字符串）以及 heartbeat 共用这条路径。
- Evidence: `codec.ts:11-15` 为 `const wire = JSON.stringify(encodeJson(outgoing, parseStructValue(outgoing, message)))`，随后仅 `if (typeof wire !== 'string') throw new TypeError(...)`。`struct/constructors.ts:41` 的 number 判定为 `typeof value === 'number' && !Number.isNaN(value)`，`docs/struct.mdx:127` 写 "`struct.number()` rejects `NaN`, accepts infinities."。同仓库 HTTP JSON body 在 `outbound_request.ts:342` 使用 `JSON.stringify(encodeOutbound(body), rejectNonJson)`，`:347-366` 拒绝非有限数字、函数、symbol 和非 plain object；`docs/http.mdx:86` 写明这些值 "fails with `REQ_BUILD_FAILED` before anything is sent, instead of being sent as `{}`, `null`, or no body at all"。WebSocket 路径无对应保护。复核探针（Node/Bun 一致）：`PROBE JSON node=26.11.1 number Infinity: threw=false wire=null`；`object{n:-Infinity}: threw=false wire={"n":null}`；`any Map: threw=false wire={}`；`any Set: threw=false wire={}`；`any nested fn: threw=false wire={"keep":1}`；`PROBE JSON bun=1.4.3 number Infinity: threw=false wire=null`。定级说明（两位审计者均报 P1，此处降为 P2）：WebSocket 公开文档对 `send` 的描述正是 "struct encode, then `JSON.stringify`"（`docs/web-socket.mdx:26`，`api/web-socket.mdx:112`），没有违反书面契约；问题是与 HTTP 路径不一致导致的静默失真，只在非有限数字或 `any`/`unknown` 字段内的非 JSON 值时出现，真实但较窄。因其静默性列为 P2 首位。
- Fix direction: 在 `serializeOutgoingWebSocketMessage` 这一共享边界使用与 `rejectNonJson` 等价的 replacer，使 `send`/排队/heartbeat 对无法忠实表示为 JSON 的值同步抛错，并在 WebSocket 文档写明该规则。
- Tags: cross-partition, runtime=both

<details><summary>合并项 P01-core-struct-01 的复核记录</summary>

##### P01-core-struct-01 WebSocket 出站 JSON 静默改写 Struct 已接受的非 JSON 值，HTTP 对同一值失败关闭

- Verdict: CONFIRMED
- Severity: P2
- Category: correctness
- Location: packages/core/src/web_socket/codec.ts:11; packages/core/src/web_socket/web_socket.ts:1223; packages/core/src/web_socket/web_socket.ts:1236; packages/core/src/internal/outbound_request.ts:342; packages/core/src/internal/outbound_request.ts:347-367
- Sources: P01-core-struct-codex-01, P01-core-struct-grok-01
- Summary: `serializeOutgoingWebSocketMessage` 对 `encodeJson` 的结果做 `JSON.stringify` 时不带 replacer。结果是 `struct.number()` 接受的 `±Infinity` 被写成 `null`，`struct.any()` 字段中的 `Map` 被写成 `{}`，`session.send` 不报错。HTTP JSON body 遇到同样的值会得到 `REQ_BUILD_FAILED`。
- Failure scenario:
  - `outgoing: struct.object({ n: struct.number() })` 下执行 `session.send({ n: Infinity })`，线上帧是 `{"n":null}`，再用同一个 Struct 解析这一帧会得到 `invalid_type`。
  - `struct.object({ p: struct.any() })` 下发送 `{ p: new Map([['k', 1]]) }`，线上帧是 `{"p":{}}`。
  - 两种情况发送端都不抛异常。
- Evidence:
  - **复现输出（两个运行时相同）：** `@@ A.ws {"inf":"{\"n\":null}","ninf":"{\"n\":null}","map":"{\"p\":{}}","roundtrip":"invalid_type"}`，以及 `@@ A.http {"code":"REQ_BUILD_FAILED"}`。
  - **WebSocket 路径：** `codec.ts:11` 是 `const wire = JSON.stringify(encodeJson(outgoing, parseStructValue(outgoing, message)))`。`web_socket.ts:1223` 取得这个结果，`:1236` 执行 `openSocket.send(serialized)`。
  - **HTTP 路径：** `outbound_request.ts:342` 用的是 `JSON.stringify(encodeOutbound(body), rejectNonJson)`。`:347-348` 的注释写明，这个守卫专门防止 "writes NaN and Infinity as null, and turns a Map, Set, stream or class instance into `{}`"。
  - **`number` 本身没错：** `struct.number()` 接受 Infinity 是写在文档里的（`struct-number.mdx:12`），缺口在 WebSocket 边界少了这层守卫。
  - **降级理由（P1 → P2）：** `websocketsession-type.mdx:25` 只承诺 send 会 "validates and encodes the message with the `outgoing` struct, then sends JSON text"，并没有承诺拒绝非 JSON 值；而且只有 `±Infinity`，以及 any/unknown 字段里的非普通对象和函数才会触发。
  - **不在本项范围：** path/query 里的 `String(Infinity)` 是标量文本，与这里的问题无关。
- Fix direction: WebSocket 文本帧复用 `rejectNonJson`（或与 HTTP 共享同一份检查）。遇到非 JSON 值时 `send` 同步抛 `TypeError`，这和它现有的 `StructError` 抛出路径一致。
- Tags: cross-partition（P03b）, runtime=both

</details>

#### F011

**endpoint 或路径配置错误被报告为 NET_UNREACHABLE**

- 复核编号：P02-core-http-client-06
- Verdict: CONFIRMED
- Severity: P2
- Category: contract
- Location: packages/core/src/internal/url.ts:148-151, packages/core/src/internal/url.ts:199-203, packages/core/src/http/transport/fetch.ts:407, packages/core/src/http/transport/fetch.ts:213, packages/core/src/http/http.ts:388-397, packages/core/src/error/types.ts:13-14, doc/content/en-US/docs/errors.mdx:33-34, packages/core/src/sse/sse.ts:551; packages/core/src/sse/transport/event_stream.ts:254; packages/core/src/internal/url.ts:217-224
- Sources: P02-core-http-client-grok-06（codex 在 coverage H2 观察到同一现象，但没有列为发现）
- Summary: `resolveRequestUrl` 在传输内部抛出的配置 `TypeError` 被打上传输来源标记，经 `createNetworkFault` 归为 `NET_UNREACHABLE`。实际上请求从未离开，handle 调用次数为 0。
- Failure scenario: 忘了 `withEndpoint`，或写了 `withEndpoint('/api')` / `withEndpoint('not a url')`，每次调用都得到 `NET_UNREACHABLE`。按 errors 文档对 `NET_*`（“Nobody, or retry”）做重试的调用方，会把配置错误当成网络问题反复重试。
- Evidence:
  - `error/types.ts:13-14` 的定义：
    - `REQ`：“The request never left: input, execute options, or build.”
    - `NET`：“No usable response: cancel, timeout, connect, truncated body.”
  - 复现：用 `bun scratch/ejkl_misc.ts` 和 `node scratch/node/ejkl_misc.js` 运行，均 exit 0。
    - `no endpoint {"code":"NET_UNREACHABLE","message":"Client endpoint is required","handleCalls":0}`
    - relative `/api` 和 `not a url` 都得到 `NET_UNREACHABLE`，message 为 `Client endpoint must be a valid URL`，`handleCalls` 为 0。
  - SSE 同根：`bun scratch/k_sse.ts`（exit 0）得到 `{"code":"NET_UNREACHABLE","message":"Client endpoint is required","calls":0}`，路径是 `sse.ts:551`。
  - 现有测试只在 `fetch.spec.ts:426-442` 断言抛出 `TypeError`，没有锁定 `execute` 返回的故障码。
  - message 文本是正确的，所以定为 P2。
- Fix direction: 在进入传输的 `try` 之前解析并校验 endpoint（HTTP 与 SSE 共用），以 `REQ_*`（如 `REQ_BUILD_FAILED`）返回。
- Tags: runtime=both, cross-partition（SSE 属 P03，`internal/url.ts` 属 P04）

#### F012

**transport-origin 标记永久记住共享哨兵，拦截器故障误分类**

- 复核编号：P04-core-infra-03
- Verdict: CONFIRMED
- Severity: P2
- Category: correctness
- Location: packages/core/src/internal/transport_origin.ts:1, packages/core/src/internal/transport_origin.ts:18, packages/core/src/internal/transport_origin.ts:31, packages/core/src/http/http.ts:330, packages/core/src/http/http.ts:346, packages/core/src/http/http.ts:374, packages/core/src/sse/sse.ts:329, packages/core/src/sse/sse.ts:389, packages/core/src/sse/sse.ts:551, doc/content/en-US/api/core/err-aborted-type.mdx:12, doc/content/en-US/api/core/err-timeout-type.mdx:12
- Sources: P04-core-infra-codex-04（复核时找到比原报告更直接、由库自身触发的路径）
- Summary: `markTransportOrigin` 把值加入模块级 `WeakSet`，且从不移除。HTTP 与 SSE 传输在取消或超时时标记的是 `resolveAbortCause` 返回的共享单例 `ERR_ABORTED`/`ERR_TIMEOUT`。因此进程内第一次发生传输侧取消之后，这两个文档化的哨兵就永久被当作“来自传输”；同一个值之后从拦截器抛出时，分类结果取决于进程历史。
- Failure scenario:
  - 文档 `err-aborted-type.mdx:12` 写明：“SSE and WebSocket interceptors that throw it are reported as `EXT_INTERCEPTOR_FAILED`.”
  - 进程刚启动时，SSE 拦截器 `throw ERR_ABORTED` 得到 `EXT_INTERCEPTOR_FAILED`，符合文档。
  - 之后只要任一不相关客户端的 HTTP 请求在 fetch 进行中被调用方中止，同一个 SSE 拦截器就得到 `NET_ABORTED`。
  - `ERR_TIMEOUT` 同理：任一 HTTP 超时之后，翻转为 `NET_TIMEOUT`。
  - 原报告中的用户侧变体同样成立：同一个 Error 实例先由 Fetch handle 抛出，再由另一个客户端的拦截器抛出，结果是 `NET_UNREACHABLE`；拦截器抛出新建的 Error 则得到 `EXT_INTERCEPTOR_FAILED`。
- Evidence:
  - `transport_origin.ts:1` 定义模块级 WeakSet，`:18` 只有 add，没有删除。
  - `http.ts:346` 为 `throw markTransportOrigin(resolveAbortCause(transportAbort) ?? error)`；`abort.ts:51-55` 只返回两个模块级单例之一。
  - `sse.ts:389` 调用 `isTransportOrigin(error)`；结果为真时，`sse.ts:551` 走 `createNetworkFault`。
  - 复现：`bun|node origin-mark.mjs` 与 `bun|node origin-timeout.mjs`，均 exit 0，两个运行时输出一致：
    ```text
    sse-throw-ERR_ABORTED before any cancellation "EXT_INTERCEPTOR_FAILED"
    unrelated http fault "NET_ABORTED"
    sse-throw-ERR_ABORTED after an unrelated HTTP cancellation "NET_ABORTED"
    reused: first thrown by transport "NET_UNREACHABLE"
    reused: then thrown by interceptor "NET_UNREACHABLE"
    fresh error thrown by interceptor "EXT_INTERCEPTOR_FAILED"
    sse-throw-ERR_TIMEOUT before "EXT_INTERCEPTOR_FAILED"
    unrelated http with timeout "NET_TIMEOUT"
    sse-throw-ERR_TIMEOUT after "NET_TIMEOUT"
    ```
  - 现有测试看不到这个问题：`sse.fault.spec.ts:92` 每次都新建 Error，而 Vitest 按文件隔离模块。
  - 定级 P2：后果是分类错误而非数据错误，且需要拦截器抛出共享哨兵，或复用同一个 Error 实例。
- Fix direction: 把来源记录限定在单次执行之内（每次执行用局部集合，或包装后在 catch 处解包），并且不再标记模块级共享哨兵。补一个回归测试：先发生一次 HTTP 取消，再让 SSE 拦截器抛出 `ERR_ABORTED`。
- Tags: cross-partition, runtime=both

#### F013

**withSSEReconnect 数值参数不校验，NaN 预算导致无限重连**

- 复核编号：P03a-core-sse-04
- Verdict: CONFIRMED
- Severity: P2
- Category: contract
- Location: packages/core/src/client/option.ts:202-206; packages/core/src/sse/transport/event_stream.ts:458-470; packages/core/src/sse/transport/event_stream.ts:329-331; packages/core/src/internal/backoff.ts:11-16; packages/core/src/web_socket/reconnect.ts:20-35（对照）
- Sources: P03a-core-sse-codex-02, P03a-core-sse-grok-02
- Summary: `withSSEReconnect` 只保存传入的对象。`attempts` 完全不检查；`delayMs`、`factor`、`maxDelayMs` 只在断流后才参与计算；`jitter` 只在重连路径检查。相比之下，WebSocket 的 `normalizeReconnectConfig` 会在会话开始前就拒绝同类非法值。
- Failure scenario:
  - `attempts`：
    - `withSSEReconnect({ attempts: Number(process.env.SSE_ATTEMPTS) })` 在环境变量未设置时得到 `NaN`，而 `NaN ?? 3` 仍是 NaN。`retryCount > NaN` 永远为 false，持续失败时会无限重连；再碰上服务端 `retry: 0` 或 `delayMs: 0`，就成了热循环。
    - `attempts: 1.5` 实际允许 2 次 Fetch；`-1` 等同于 0。
  - `delayMs: -100`（jitter 为 0）或 `maxDelayMs: -1` 会静默关闭重连。
  - `jitter: 1.1` 时流能正常打开，直到首次断流才抛 `RangeError`，并以 `NET_UNREACHABLE` 结束。
  - `factor: NaN` 时第二次重连抛 `Reconnect delay must be finite`。
- Evidence:
  - 复跑 codex 探针，Bun 与 Node 均 exit 0，输出一致：
    - `budget`：NaN 为 `{"name":"NaN","calls":8,"code":"NET_ABORTED"}`；Infinity 同为 8 次（第 8 次是探针主动 abort 止损）；`fraction` 2 次；`negative` 1 次。
    - `invalid-config-opens`：六种非法配置都以 `eof` 正常打开。
    - `invalid-config-on-drop`：
      - `jitter 1.1` 以 `NET_UNREACHABLE` 结束，cause 为 `SSE reconnect jitter is out of range`。
      - `factor NaN` 在 2 次后报 `Reconnect delay must be finite`。
      - `delayMs -100` 和 `maxDelayMs -1` 都在 1 次后以原始错误结束。
  - 代码：
    - `option.ts:203-205` 只做赋值。
    - `event_stream.ts:458-459` 为 `const attempts = reconnect.attempts ?? 3; if (retryCount > attempts)`；`:466` 是唯一的 jitter 检查；`:329` 让负延迟走 `finishError`。
  - 文档 `withssereconnect.mdx:34` 写明 `jitter (0 to 1)`。
  - 负 `delayMs` 并不会直接造成热循环（`:329` 拦住了），两名审计者都已正确排除这一点。
- Fix direction: 在 `execute` 开始前（或在 `withSSEReconnect` 中）按 WebSocket 同级规则归一化：
  - `attempts` 为非负安全整数；
  - `delayMs` 和 `maxDelayMs` 有限且 ≥ 0；
  - `factor` 有限且 > 0；
  - `jitter` 在 [0,1] 内。
    非法时以配置错误（例如 `REQ_OPTIONS_INVALID`）失败，同时保留已公布的 SSE 默认值。
- Tags: cross-partition（option.ts、backoff.ts 属 P04）, runtime=both

#### F014

**Worker 中 XSRF token 会附加到跨源请求**

- 复核编号：P02-core-http-client-09
- Verdict: CONFIRMED
- Severity: P2
- Category: security
- Location: packages/core/src/http/transport/fetch.ts:28-30, packages/core/src/http/transport/fetch.ts:52-61, packages/core/src/http/transport/fetch.ts:80-81, packages/core/src/http/transport/fetch.ts:430-432, doc/content/en-US/api/core/withxsrf.mdx:19, doc/content/en-US/docs/http.mdx:142
- Sources: P02-core-http-client-codex-04, P02-core-http-client-grok-04
- Summary: `isBrowserRuntime()` 要求 `document` 与 `location` 同时存在。Worker 没有 `document`，于是进入“非浏览器、有 baseEndpoint 即视为同源”的分支，跳过与 `location.origin` 的比较。
- Failure scenario: Worker 中的客户端使用 `withXSRF({ tokenProvider })`，base 指向另一个源。Worker 里会附加 token；同样的配置在 Window 中会被同源检查拦下。
- Evidence:
  - 代码：
    - `fetch.ts:28-30` 是 `typeof document !== 'undefined' && typeof location !== 'undefined'`。
    - `fetch.ts:57-58` 的 `return true` 先于 `fetch.ts:61` 的 origin 比较执行。
    - 同一文件 `fetch.ts:430-432` 的 `isBrowserWindowOrWorker()` 却把 Worker 视为浏览器，两处判定不一致。
  - `http.upload_progress.worker.browser.spec.ts:14` 断言 Worker 内 `documentType === 'undefined'`。
  - 文档：`withxsrf.mdx:19` 写 “in a browser, the request URL has the same origin as the page”；`docs/http.mdx:142` 写法相同。
  - 全局对象模拟，用 `bun scratch/ejkl_misc.ts` 和 `node scratch/node/ejkl_misc.js` 运行，均 exit 0：
    - `window cross-origin {"xsrf":null}`
    - `worker cross-origin {"xsrf":"FAKE-TOKEN"}`
    - `window same-origin {"xsrf":"FAKE-TOKEN"}`
  - 没有在真实浏览器 Worker 中做端到端验证。
  - 影响有限：路径不能是绝对 URL（`internal/url.ts:218-220`），token 只会发往客户端配置的 base 或拦截器改写后的源。
- Fix direction: 只要有 `location`，就用 `resolveRequestUrl(request).origin === location.origin` 判断同源；`document.cookie` 仍只在有 `document` 时读取。
- Tags: runtime=both, needs-browser（端到端）

#### F015

**非 ASCII 事件 ID 致 Last-Event-ID 重连失败或编码错误**

- 复核编号：P03a-core-sse-03
- Verdict: CONFIRMED
- Severity: P2
- Category: correctness
- Location: packages/core/src/sse/transport/event_stream.ts:241-247; packages/core/src/sse/transport/event_stream.ts:196-200; packages/core/src/sse/transport/event_stream.ts:561-562; packages/core/src/sse/transport/parser.ts:231-235; doc/content/en-US/docs/sse.mdx:64; doc/content/en-US/api/core/withssereconnect.mdx:36; doc/content/en-US/api/core/clientsseoptions-type.mdx:36
- Sources: P03a-core-sse-codex-03, P03a-core-sse-grok-01
- Summary: 解析得到的 ID 是 UTF-16 的 JS 字符串，`headers.set(LAST_EVENT_ID_HEADER, lastEventId)` 直接把它当作 ByteString 写入。
- Failure scenario:
  - 服务端发出 `id: 猫` 后断流，客户端已启用重连：只发生 1 次 Fetch，迭代器抛出平台 TypeError，`closed` 为 `error` / `NET_UNREACHABLE`。
  - 服务端发出 `id: été` 时重连能成功，但请求头的字节是 `e9 74 e9`。服务端按 UTF-8 解析会得到错误的 ID，续传点被静默改错。
- Evidence:
  - 复跑 codex 探针，Bun 与 Node 均 exit 0。`id-header {"id":"猫","calls":1,"seen":[null],"eventIds":["猫"],"terminal":"error","code":"NET_UNREACHABLE",…}`。cause 在 Bun 上是 `Header 'last-event-id' has invalid value`，在 Node 上是 `Cannot convert argument to a ByteString because the character at index 0 has a value of 29483 which is greater than 255.`。ASCII 和 `é` 的对照都是 2 次 Fetch、以 `eof` 结束。
  - 复核者探针用真实的全局 fetch 和本机 TCP 服务器读取原始请求字节，Bun 与 Node 一致：`last-event-id-wire {"events":[{"data":"first","id":"été"},{"data":"second"}],"closed":"eof","requests":2,"headerBytes":["e9","74","e9"],"utf8Expected":["c3","a9","74","c3","a9"]}`。
  - 代码：`event_stream.ts:241-247` 的写头位于 `:253` 的 `try` 之前，异常因此落入 `:196-200` 的兜底 catch。该 catch 标注了 `istanbul ignore`，注释称它 "only guards a type-invariant failure"，但服务端数据就能触发它。
  - WHATWG HTML 的 SSE 章节（本次经 firecrawl 抓取）在重连步骤中写的是 "Let lastEventIDValue be the … last event ID string, encoded as UTF-8"。
  - 定级：grok 提议 P1。本条确实违背了文档化的续传契约，但前提是服务端使用非 ASCII ID，而常见 ID 多为数字或 UUID；两级之间取低，定 P2。
- Fix direction: 写头时按 UTF-8 编码 ID，以字节串形式交给 Headers；把写头移入每轮尝试的错误处理，避免异常逃逸到兜底 catch。补 Unicode 与 Latin-1 ID 的重连测试，并断言线上字节。
- Tags: runtime=both

#### F016

**发布 job 不运行 typecheck、lint 或测试**

- 复核编号：P11-ops-03
- Verdict: CONFIRMED
- Severity: P2
- Category: ops
- Location: .github/workflows/release.yml:34-100; .github/workflows/ci.yml:3-6
- Sources: P11-ops-codex-03
- Summary: 四个 npm 发布 job 只有 `bun ci` → `bun --bun run build` → `npm publish`。没有 lint、typecheck 或 test，也不检查所选 SHA 是否通过了 CI；而声明生成使用 `--noCheck`，构建本身也不检查类型。
- Failure scenario: 在 CI 未通过或未运行的 ref 上 dispatch 发布，带有类型错误的代码仍能构建并发布。在 HEAD 上，即使 SHA 已通过 CI，P11-ops-02 的产物也照样会被发布，因为 CI 从不检查发布用的构建配置。
- Evidence:
  - 已读 `release.yml:34-100`：各包 job 都没有检查步骤，也没有 `needs:`。只有 docs job（119 行）运行 `bun run typecheck`。
  - 本人复现了“构建不检查类型”这一层：缺少 core dist 时 tsc 对 build config 报 TS2307 并 exit 1，同一状态下 tsdown 却 exit 0（见 P11-ops-02），`--noCheck` 的出处同上。
  - codex 的 `scratch/bad-release`（在副本中把 `{ value: client }` 改为 `{ value: 42 }`：tsc 报 TS2769，tsdown exit 0）已读过脚本，逻辑合理，本人没有重跑。
  - 手动勾选发布本身是设计约定，但并不包括“发布时不做任何检查”。删除 packed-consumer gate 的提交 `77a75294` 只说那个 gate 是 overhead，没有说明发布时不需要类型检查。
- Fix direction: 在发布 job 中对所发布的包运行 `tsc -p tsconfig.build.json --noEmit`（或 `bun run typecheck`），或者校验所选 SHA 的 CI 已通过。前者还能同时拦住 P11-ops-02。

#### F017

**适配器单独发布时 ClientProvider 返回类型退化为 any**

- 复核编号：P11-ops-02
- Verdict: CONFIRMED
- Severity: P2
- Category: ops
- Location: .github/workflows/release.yml:51-100; packages/react/tsconfig.build.json:10-12; packages/react/src/core.ts:31-32; packages/vue/tsconfig.build.json:10-12; packages/opentelemetry-server/tsconfig.build.json:10-12
- Sources: P11-ops-codex-02, P11-ops-grok-01
- Summary: react/vue/opentelemetry-server 的发布 job 在全新 checkout 中只构建本包，`tsconfig.build.json` 把 `@defjs/core` 映射到不存在的 `../core/dist/index.d.ts`。tsdown 用 tsgo `--noCheck` 生成声明并以 0 退出，React 中依赖推断的 `ClientProvider` 返回类型因此变成 `any`。
- Failure scenario: 维护者勾选 react 发布（即使同时勾选 core，两者也在不同 runner 上运行）→ 发布出的 `index.d.ts:27` 为 `FunctionComponentElement<ProviderProps<any>>`，而 CI 和根构建得到的是 `ProviderProps<Client | null>`。消费者把 `ClientProvider(...).props.value` 当作其他类型使用时，编译不会报错。常规的 `<ClientProvider client={c}>` 和 `useClient()` 不受影响。
- Evidence:
  - 在 clone 中删除全部 gitignored 构建产物，模拟全新 checkout。确认 `packages/core/dist` 不存在后，依次执行 `cd packages/{react,vue,opentelemetry-server} && bun --bun run build`：三个都 exit 0，日志中除 `TypeScript 7.0 ... experimental` 外没有任何诊断（`scratch/isolated/*.build.log`）。
  - 再按序构建 core 和适配器（4 个都 exit 0），然后 diff 两组产物：
    - react `index.d.ts` 只有第 27 行不同：`ProviderProps<any>` 对 `ProviderProps<Client | null>`。
    - vue 和 otel 的 d.ts 完全相同，原因是公开函数写了显式返回类型（`withOpenTelemetryServer(...): ClientOption` 在 option.ts:78）。
    - 三个包的 `index.js` 和 `package.json` 都相同。
  - 移除 core dist 后执行 `node_modules/.bin/tsc -p packages/<p>/tsconfig.build.json --noEmit`：三个包都 exit 1，报 `TS2307: Cannot find module '@defjs/core'`；otel 另有 `TS7006`。
  - tsdown@0.23.0 所用的 `rolldown-plugin-dts@0.28.6` `dist/index.mjs:300` 固定传入 `"--noCheck"`，这就是构建仍以 0 退出的原因。
  - 消费者对照（`scratch/consumer-{isolated,ordered}`，TS 7、`skipLibCheck: false`）：`usage.tsx` 的 JSX 用法两边都通过；`misuse.ts` 中 `const asText: string = ClientProvider({client}).props.value`，isolated 版 exit 0，ordered 版 exit 1（`TS2322: Type 'Client | null' is not assignable to type 'string'`）。
  - 线上状态：jsdelivr 上 `@defjs/react@0.0.1-beta.1/index.d.ts:27` 为 `Client | null`。该版本的 manifest 是 `0.0.1-beta.1` / peer `0.4.0-beta.1`，而 gitHead `f2b2a66d` 提交的是 `0.0.1` / `^0.4.0`，release.yml 又不改版本号，所以可以推断它不是由 release.yml 发布的。这个缺陷尚未出现在线上。
  - 定级说明：只有一个推断返回类型退化，常规用法不受影响，因此从 auditor 给的 P1 下调为 P2。风险在于今后任何依赖推断的公开导出都会走同一条静默退化路径。
- Fix direction: 适配器发布 job 在构建本包之前先构建 `@defjs/core`（或改用会等待 core 的 workspace 过滤构建），并加一步 `tsc -p tsconfig.build.json --noEmit`，让无法解析 `@defjs/core` 时直接失败。
- Tags: cross-partition（packages/react/src）

#### F018

**CI 只在 Bun 上运行测试，Node 运行时行为无守卫**

- 复核编号：P05-core-tests-02
- Verdict: CONFIRMED
- Severity: P2
- Category: ops
- Location: .github/workflows/ci.yml:12-20; bunfig.toml:5-6; package.json:50; packages/opentelemetry-server/e2e.spec.ts:267-288; packages/opentelemetry-server/README.md:97; doc/content/en-US/docs/start.mdx:12; packages/core/src/internal/http_request.ts:23-24
- Sources: P05-core-tests-codex-04
- Summary: 唯一的 CI job 执行 `bun run verify`，而 `[run] bun = true` 让 Vitest 在 Bun 上运行。文档声明支持 Node.js 和 Deno，但 Node 上不同的平台事件顺序和由此决定的测试分支在 CI 中从不执行。
- Failure scenario: core 处理原生 WebSocket "`error` 先于 `close`" 的路径，或 OTel 对 1006 断连记录 WARN 的逻辑出现回归时，只有 Node 用户会受影响：断连按 README 应结束为 `error` 并记一条 WARN。Bun 上不会触发 `error`，所以 CI 保持绿色，回归会被发布。
- Evidence:
  - `ci.yml` 只有一个 `ubuntu-latest` job，步骤是 `oven-sh/setup-bun@v2`、`bun ci`、`bun run verify`；`bunfig.toml` 是 `[run] bun = true`。
  - `start.mdx:12`："`@defjs/core` is ESM and runs on Node.js, Bun, or Deno."
  - OTel `README.md:97` 写明 Node 上 1006 断连会记一条 WARN，Bun 上不记。
  - `e2e.spec.ts:274-288` 按 `reportsErrorFirst` 在两种断言之间选一种。
  - 我实测两运行时的事件顺序（`scratch/ws1006-order.mjs`，同一个 ws 服务端在 20ms 后 `terminate()`）：`bun 1.4.3 ["close:1006"]`，`node 26.11.1 ["error","close:1006"]`。所以 CI 只会走 `reportsErrorFirst=false` 那个分支。
  - grok 否定 H1 的依据是本地 Node 和 Bun 都 1757 通过、没有只在单一运行时出现的 skip。这说明当前 Node 没坏，但不能证明 CI 覆盖了 Node，两者并不矛盾。
- Fix direction: 保留现有 Bun verify，再加一个显式用 Node 进程跑 core-server 与 OTel 非浏览器测试的 job（例如 `bunx vitest run --config vitest.config.ts --project core-server`，不加 `--bun`）；Deno 要么补 smoke test，要么收窄支持声明。
- Tags: cross-partition (P11 ops), runtime=node

#### F019

**SSE 打开后 TimeoutError 中止抛错，文档称为 aborted**

- 复核编号：P03a-core-sse-06
- Verdict: CONFIRMED
- Severity: P2
- Category: docs
- Location: doc/content/en-US/docs/sse.mdx:93; doc/content/en-US/api/core/eventstreamcloseinfo-type.mdx:15; packages/core/src/sse/transport/event_stream.ts:505-509; packages/core/src/sse/transport/event_stream.advanced.spec.ts:888-921
- Sources: 复核者新增。复现 P03a-core-sse-01 时观察到，两名审计者都没有报告。
- Summary: 实现和测试都把“打开后以 TimeoutError（或 `ERR_TIMEOUT`）为原因的调用方中止”当作失败处理，文档却笼统地写成迭代器正常结束、`closed` 报 `aborted`。
- Failure scenario: 常见写法 `client.execute(cmd, { signal: AbortSignal.timeout(60_000) })` 用来限制流的时长。到期后 `for await` 抛出 `ERR_TIMEOUT`，`closed` 为 `{ kind: 'error', code: 'NET_TIMEOUT' }`。按文档只检查 `closed.kind === 'aborted'`、没有包 try/catch 的消费循环会收到意料之外的异常。
- Evidence:
  - 文档 `sse.mdx:93` 写的是 "So does aborting the `signal` or `abort` given to `execute` after the stream is open: the iterator ends normally and `closed` reports `aborted`."
  - `eventstreamcloseinfo-type.mdx:15` 写的是 "`aborted` means the stream was closed with `close()` or disposal, or its signal aborted"。
  - 代码 `event_stream.ts:507-508` 为 `if (abortedError === ERR_TIMEOUT) { finishError(ERR_TIMEOUT) … }`。
  - 测试 `event_stream.advanced.spec.ts:888-921` 明确锁定：`next` 以 `ERR_TIMEOUT` reject，`closed` 为 `{ kind: 'error', code: 'NET_TIMEOUT', … }`。另外 `:923` 锁定 `close(timeoutError)` 仍报 `aborted`。
  - 复核者探针输出 `stream-A {"closed":{"kind":"error","code":"NET_TIMEOUT"}}`，Bun 与 Node 一致。
  - 这一行为符合 _shared §4 的“取消形态保持 NET_TIMEOUT”，所以问题出在文档过度概括，而不是实现错误。
- Fix direction: 在 SSE 指南和 `EventStreamCloseInfo` 页写明：打开后调用方 signal 若以 TimeoutError 或 `ERR_TIMEOUT` 中止，迭代器抛 `ERR_TIMEOUT`，`closed` 为 `error` / `NET_TIMEOUT`；只有其他原因才是 `aborted`。
- Tags: cross-partition（文档内容属 P09a/P09b）, runtime=both

#### F020

**SSE 重连非 2xx 的终止码与文档 HTTP_STATUS 不符**

- 复核编号：P03a-core-sse-05
- Verdict: CONFIRMED
- Severity: P2
- Category: docs
- Location: doc/content/en-US/docs/sse.mdx:64（其余 10 个 locale 的 `docs/sse.mdx:64` 是同一句）; packages/core/src/sse/transport/event_stream.ts:661-667; packages/core/src/sse/transport/event_stream.ts:298-305; packages/core/src/sse/transport/event_stream.ts:561-562; packages/core/src/sse/transport/event_stream.ts:41-51
- Sources: P03a-core-sse-codex-07
- Summary: 首次启动遇到非 2xx 时，`sse.ts:530-539` 会把它转成 `HTTP_STATUS` 故障。流已经打开之后，重连握手的非 2xx 则走 `validateOpenResponse`，抛出 `EventStreamFatalError('RES_DECODE_FAILED', …, { statusSignal: true })`，并直接成为终端码。`EventStreamFaultCode` 本身也不含 `HTTP_STATUS`。
- Failure scenario: 首次握手 200，读流失败后重连，第二次握手返回 401（凭证过期，正是文档举的例子）。`closed` 为 `{ kind: 'error', code: 'RES_DECODE_FAILED' }`，按文档匹配 `HTTP_STATUS` 去重新认证的代码不会命中。状态码只能从 live 的 `stream.open.response.status` 读到。
- Evidence:
  - 复跑 codex 探针，Bun 与 Node 均 exit 0：`reconnect-401 {"calls":2,"code":"RES_DECODE_FAILED","status":401}`。
  - 文档 `sse.mdx:64` 写的是 "If a credential still expires, the next handshake gets a non-2xx response, which ends the stream with `HTTP_STATUS`."。对 11 个 locale 逐个执行 `sed -n 64p | grep HTTP_STATUS`，命中数为 11，即全部 locale 的第 64 行都含同一结论。
  - `event_stream.ts:663-664` 的注释说这个码 "only the fallback for a response that never carried a status"，对重连路径不成立。
  - 没有测试覆盖重连后的非 2xx 终端码：SSE 规格里的 401/503 用例全部在启动阶段。
- Fix direction: 文档要区分两种情况：启动故障是 `HTTP_STATUS`；已打开流的重连失败当前是 `RES_DECODE_FAILED`，状态码在 `stream.open.response.status`。也可以评审后为 `closed` 增加一个状态类终端码，并同步类型和文档。
- Tags: cross-partition（文档内容属 P09a）, runtime=both

#### F021

**withEndpoint 文档称接受相对 base，实际只接受绝对 URL**

- 复核编号：P02-core-http-client-07
- Verdict: CONFIRMED
- Severity: P2
- Category: docs
- Location: packages/core/src/client/option.ts:19, doc/content/en-US/api/core/withendpoint.mdx:14, packages/core/src/internal/url.ts:199-203, packages/core/src/internal/url.spec.ts:13
- Sources: P02-core-http-client-codex-06
- Summary: JSDoc 写 “Absolute or relative base endpoint”，API 页写 “absolute or relative base endpoint”。实现只调用 `new URL(baseEndpoint)`，不传第二个参数，测试也锁定 `/api` 非法。
- Failure scenario: 浏览器里调用同源 API 的使用者按 API 页写 `withEndpoint('/api')`，所有请求都以 `NET_UNREACHABLE` 失败，handle 从未被调用（复现见 06）。
- Evidence:
  - 原文：`option.ts:19` 和 `withendpoint.mdx:14`。
  - 实现：`url.ts:199-203`，失败时抛 `TypeError('Client endpoint must be a valid URL')`。
  - 测试：`url.spec.ts:13` 断言 `createResolvedRequestUrl('/api', '/user/info')` 抛出该错误。
  - 其他文档都要求绝对 URL：`design.md:17`、`docs/client.mdx:52`（“Absolute base endpoint for all transports”）。
- Fix direction: 把 JSDoc 和 API 页改成“绝对 base URL”。
- Tags: cross-partition（`withendpoint.mdx` 属 P09）

#### F022

**HTTP 拦截器结果非 HttpResponse 时 reject 或误报**

- 复核编号：P04-core-infra-05
- Verdict: CONFIRMED
- Severity: P2
- Category: contract
- Location: packages/core/src/http/http.ts:412, packages/core/src/http/http.ts:413, packages/core/src/http/http.ts:470, packages/core/src/interceptor/interceptor.ts:23, packages/core/src/interceptor/interceptor.ts:147, doc/content/en-US/docs/errors.mdx:145
- Sources: P04-core-infra-grok-01
- Summary: HTTP 链的返回值在 try/catch 之外被当作 `HttpResponse` 读取，于是：
  - 链解析为 `undefined` 时（JS 中漏写 `return` 很常见），execute 以 TypeError reject；
  - 链解析为原生 `Response` 时，结果是 `RES_STRUCT_MISMATCH`，因为它把 ReadableStream 当成了 body；
  - SSE 和 WebSocket 遇到同样的错误，会收成 `EXT_INTERCEPTOR_FAILED` 元组。
- Failure scenario:
  - JS 或 `any` 代码写成 `createHttpInterceptor(async (req, next) => { await next(req) })`。此时 `await client.execute(cmd)` 抛出 `TypeError: Cannot read properties of undefined (reading 'headers')`（Bun 下为 `undefined is not an object (evaluating 'response.headers')`）。这违背了 `errors.mdx:145` 的 “The execute promise settles once, with the tuple.”
  - 拦截器返回原生 `Response` 时，这个错误被归为服务端契约错误 `RES_STRUCT_MISMATCH: Expected object at <root>, received [object ReadableStream]`，而不是扩展错误。
- Evidence:
  - `http.ts:412-413` 在 catch 之后执行 `const settledResponse = response as HttpResponse<unknown>; const meta = toHttpMeta(settledResponse)`。
  - 复现：`bun|node interceptor-result.mjs`，均 exit 0。以下为 Node 输出；Bun 结论相同，只有 TypeError 文案不同：
    ```text
    http: forgot return {"settled":"REJECTED","error":"TypeError: Cannot read properties of undefined (reading 'headers')"}
    http: native Response {"settled":"tuple","code":"RES_STRUCT_MISMATCH","msg":"Expected object at <root>, received [object ReadableStream]"}
    sse: forgot return {"settled":"tuple","code":"EXT_INTERCEPTOR_FAILED","msg":"Cannot read properties of undefined (reading 'closed')"}
    ws: resolves undefined {"settled":"tuple","code":"EXT_INTERCEPTOR_FAILED","msg":"Cannot read properties of undefined (reading 'connection')"}
    ```
  - 定级 P2 而非 P1：这两种返回值都已被类型禁止。`InterceptorFn` 的返回类型是 `Promise<HttpResponse>`，`interceptor.type.test.ts:110-111` 也用 `@ts-expect-error` 锁定了原生 `Response`。
- Fix direction: 链返回之后、仍在 catch 范围内时，检查 `HTTP_RESPONSE` 品牌；不满足就收成 `EXT_INTERCEPTOR_FAILED`，与 SSE/WebSocket 保持一致。
- Tags: cross-partition（`http.ts` 属 P02）, runtime=both

#### F023

**binaryType 写入抛错时已建 socket 被遗留且不关闭**

- 复核编号：P03b-core-ws-05
- Verdict: CONFIRMED
- Severity: P2
- Category: correctness
- Location: packages/core/src/web_socket/web_socket.ts:606-620; packages/core/src/web_socket/web_socket.ts:622; packages/core/src/client/config.ts:30-43; doc/content/en-US/api/core/websockethandle-type.mdx
- Sources: P03b-core-ws-codex-02
- Summary: 构造 socket 与 `socket.binaryType = 'arraybuffer'` 共用一个 catch，后者抛错时返回失败 outcome，但已构造的 socket 既未关闭也未登记到 `sessionController.currentSocket`，之后任何清理路径都找不到它。
- Failure scenario: 用户经 `withWebSocketHandle` 注入以只读 getter 暴露 `binaryType` 的适配器类（`WebSocketHandle` 省略 `binaryType`，类型上合法）。严格模式下赋值抛 `TypeError`；execute 返回 `NET_UNREACHABLE`；`reconnect: { attempts: 2 }` 时共构造 3 个 socket，全部 `readyState 1`、`close` 调用 0 次。`NET_UNREACHABLE` 看似可重试，外层重试循环会持续累积未关闭连接。
- Evidence: `web_socket.ts:608` 先 `new WebSocketImpl(...)`，`:610-612` `if ('binaryType' in socket) { socket.binaryType = 'arraybuffer' }`（getter-only 访问器使 `in` 为 true），`:613-619` catch 直接返回 `{ opened: false, cause: error }`，`:622` 的 `sessionController.currentSocket = socket` 不执行。`websockethandle-type.mdx` 写 "The transport sets `binaryType = 'arraybuffer'` when the property exists."，未要求可写。复核探针：`PROBE BINARYTYPE node=26.11.1 fault=NET_UNREACHABLE cause=TypeError: Cannot set property binaryType of #<Socket> which has only a getter session=undefined sockets=3 states=[1,1,1] closeCalls=[0,0,0]`；`bun=1.4.3 ... cause=TypeError: Attempted to assign to readonly property. ... sockets=3 states=[1,1,1] closeCalls=[0,0,0]`。定级说明：浏览器、undici、Bun、`ws` 的 `binaryType` 都可写，触发限于自定义适配器且启动必然失败；但后果是遗留真实网络连接并给出误导性的可重试 fault，保留 P2。
- Fix direction: 把 `binaryType` 设置与构造分开：设置失败时忽略（该属性只是优化），或对已构造 handle 做 best-effort `close()` 后再返回失败；不让构造成功的 socket 脱离清理责任。
- Tags: runtime=both

#### F024

**onUploadProgress 覆盖显式指定的 Content-Type**

- 复核编号：P02-core-http-client-04
- Verdict: CONFIRMED
- Severity: P2
- Category: contract
- Location: packages/core/src/http/transport/fetch.ts:452-455, packages/core/src/http/transport/fetch.ts:472-477, packages/core/src/http/transport/fetch.ts:484-494, packages/core/src/http/transport/body.ts:41-51, doc/content/en-US/docs/http.mdx:84, packages/core/design.md:159
- Sources: P02-core-http-client-codex-02
- Summary: 进度转换把 `converted.contentType` 写进 header 和 `bodyContentType`，并把新 stream 设为 source。builder 在 `headers` 里写的 `content-type` 因此失去覆盖权。
- Failure scenario: 在服务端，builder 返回 `{ body: arrayBuffer, headers: { 'content-type': 'image/png' } }`，并传 `onUploadProgress`。服务器收到 `application/octet-stream`；Blob/File 则收到 `blob.type`。Content-Type 参与签名的上传会失败，按媒体类型分流的服务会选错处理器。
- Evidence:
  - 契约：
    - `docs/http.mdx:84`：“Set `content-type` on `headers` to override the default.”
    - `design.md:159`：builder 的 `content-type` 覆盖检测结果。
  - 代码：`fetch.ts:453-455` 和 `fetch.ts:475-476` 写入检测值，`body.ts:49-51` 无条件采用它。
  - 复现：真实服务器，用 `bun scratch/b_upload_ct.ts` 和 `node scratch/node/b_upload_ct.js` 运行，均 exit 0；default 与 custom handle 结果一致。
    - `arraybuffer_custom plain {"ct":"application/x-custom"}`
    - `arraybuffer_custom progress {"ct":"application/octet-stream"}`
    - Bun 上 `blob_custom progress {"ct":"text/plain;charset=utf-8"}`
    - Node 上 `file_custom progress {"ct":"text/plain"}`
  - 由 P1 降为 P2：需要“服务端运行时 + 进度观察者 + 二进制 body + 显式类型与检测值不同”四个条件同时成立，正文字节不变。
  - 与 02 同在 `prepareUploadProgressRequest` 里，但触发条件和修复点不同，所以分开记录。
- Fix direction: 转流时保留原请求最终生效的 Content-Type（显式头或 `bodyContentType` 优先），只有原请求没有类型时才用检测值。FormData 仍以实际序列化出的 boundary 为准。
- Tags: runtime=both

#### F025

**拦截器替换 body 后无法指定 Content-Type，空 body 留旧头**

- 复核编号：P02-core-http-client-05
- Verdict: CONFIRMED
- Severity: P2
- Category: contract
- Location: packages/core/src/http/transport/body.ts:32-34, packages/core/src/http/transport/body.ts:41-42, packages/core/src/http/transport/body.ts:55-61, packages/core/src/internal/transport_request.ts:55, packages/core/src/internal/transport_request.ts:66, doc/content/en-US/docs/interceptors.mdx:42, doc/content/en-US/api/core/httprequest-type.mdx:13
- Sources: P02-core-http-client-grok-05
- Summary: `applyRequestContentType` 只按 body 身份判断元数据是否过期。body 一变，拦截器新写的 `content-type` 头和公开字段 `bodyContentType` 都会被检测值覆盖，只有改写 `@internal` 的 `bodyContentTypeSource` 才能生效。body 变成 `undefined` 时函数直接返回，构建阶段检测出的 `application/json` 留在了空请求上。
- Failure scenario:
  - (a) 拦截器按文档复制请求并重写 JSON 正文，同时设置头或 `bodyContentType: 'application/json'`。线上请求一律是 `text/plain;charset=UTF-8`，依赖 JSON Content-Type 的服务端解析器读不到正文。
  - (b) 拦截器执行 `next({ ...req, body: undefined })`。发出的请求正文为空，却带 `Content-Type: application/json`，严格的框架会拒绝空 JSON 正文。
- Evidence:
  - 文档：
    - `interceptors.mdx:42`：“Fetch ignores stale content-type metadata when the body value changed.”
    - `httprequest-type.mdx:13` 公开了 `bodyContentType`，source 字段标注为 `@internal`。
  - 代码：
    - `transport_request.ts:55` 设置 source，`:66` 在进入拦截器之前就把检测结果写进 headers。
    - `body.ts:41-42` 与 `body.ts:55-61`：source 与当前 body 不一致时，忽略 `bodyContentType` 和已有头。
    - `body.ts:32-34`：body 为 `undefined` 时直接 return。
  - 复现：用 `bun scratch/ejkl_misc.ts` 和 `node scratch/node/ejkl_misc.js` 运行，均 exit 0，两个运行时一致。
    - `new json string + header {"ct":"text/plain;charset=UTF-8"}`
    - `new json string + bodyContentType {"ct":"text/plain;charset=UTF-8"}`
    - `body undefined {"ct":"application/json","body":""}`
  - `interceptor.spec.ts:125-155` 锁定的“换成纯字符串、不声明类型时重新检测为 text/plain”属于设计，不在本发现内。
  - 关于 (b) 的争议：codex 认为没有契约要求删除用户写的头。但这里的头不是用户写的，是 `transport_request.ts:66` 检测出来的，正是文档所说的 stale metadata，所以采纳 grok 的结论。
  - 定为 P2：只影响重写或删除 body 的拦截器，并且存在借助内部字段的绕行方式。
- Fix direction: 拦截器显式给出的 `bodyContentType`（或与原值不同的 `content-type` 头）应对新 body 生效。body 变为 `undefined` 时，删除由检测写入的 Content-Type。
- Tags: runtime=both, cross-partition（`internal/transport_request.ts` 属 P04）

#### F026

**下载进度把压缩后的 Content-Length 当作解码总量**

- 复核编号：P02-core-http-client-08
- Verdict: CONFIRMED
- Severity: P2
- Category: correctness
- Location: packages/core/src/http/transport/fetch.ts:264, packages/core/src/http/transport/fetch.ts:307-310, packages/core/src/http/transport/utils.ts:4-12, doc/content/en-US/docs/http.mdx:148
- Sources: P02-core-http-client-codex-05, P02-core-http-client-grok-03
- Summary: `total` 取的是线上编码后的字节数，`loaded` 累加的是解码后的字节数。遇到 gzip/br 时，事件报告 `lengthComputable: true`，但 `loaded` 远大于 `total`。
- Failure scenario: 声明 JSON `output` 并传 `onDownloadProgress`，响应经 gzip 压缩且带 `Content-Length`。进度显示远超 100%（实测 68 501%）；解码结果本身正确。
- Evidence:
  - 代码：`fetch.ts:264` 读 Content-Length；`fetch.ts:307-310` 累加 `byteLength`，并设置 `lengthComputable: contentLength > 0`；没有任何 Content-Encoding 分支。
  - 复现：真实 socket 上的 gzip 响应，用 `bun scratch/f_gzip_progress.ts` 和 `node scratch/node/f_gzip_progress.js` 运行，均 exit 0；default 与 custom handle 结果相同。
    - Bun：`{"decodedLen":100000,"wireBytes":146,"last":{"lengthComputable":true,"loaded":100011,"total":146},"maxPct":68501}`
    - Node：`{"wireBytes":145,"last":{"lengthComputable":true,"loaded":100011,"total":145},"maxPct":68973}`
  - `docs/http.mdx:148` 没有说明两者的计量口径不同。
  - codex 当时只能用 fixture 复现，这次补齐了真实线上复现。
- Fix direction: 存在非 `identity` 的 `Content-Encoding` 时，报 `lengthComputable: false`、`total: 0`。
- Tags: runtime=both

#### F027

**递归 Struct 遇深层或循环输入抛 RangeError**

- 复核编号：P01-core-struct-03
- Verdict: CONFIRMED
- Severity: P2
- Category: contract
- Location: packages/core/src/struct/parse.ts:78; packages/core/src/struct/parse.ts:245; packages/core/src/struct/introspection.ts:51-57; packages/core/src/struct/encode.ts; packages/core/src/struct/codec/json.ts:8
- Sources: P01-core-struct-codex-04, P01-core-struct-grok-02
- Summary: getter 递归的 object Struct 既没有深度上限，也不检测循环。一段 `JSON.parse` 能正常解析的深层文档就能让 `struct.parse` 抛 `RangeError: Maximum call stack size exceeded`。
- Failure scenario: 设 `Node = struct.object({ get child() { return Node.null() } })`，输入 `JSON.parse('{"child":'.repeat(50000) + 'null' + '}'.repeat(50000))`。此时 `struct.parse` 直接抛异常，而不是返回 `[StructError, undefined]`；`decodeJson` 和 `encodeJson` 同样抛异常。输入改为循环对象 `cyc.child = cyc` 时，`struct.parse` 也抛异常。
- Evidence:
  - **复现输出（两个运行时相同）：** 1000、5000、10000 层均为 `no-throw`；50000 层为 `parse=RangeError decode=RangeError encode=RangeError`；循环对象输出 `@@ D.cycle "RangeError"`。
  - **阈值会变：** 触发层数取决于 schema 和运行时。grok 用更宽的 schema 在 Node 上 8000 层左右就触发了。
  - **违反的契约：** `api/core/struct-parse.mdx:20` 写着 "Invalid input never throws."，而这里的输入本身是合法的。
  - **为什么没有兜住：** `parseEntry`（`parse.ts:77-83`）只有 try/finally；`parseStructTuple`（`introspection.ts:51-57`）也不捕获异常。
  - **传输层都兜住了：**
    - HTTP 输出 `@@ D.http {"code":"RES_DECODE_FAILED","cause":"RangeError"}`，对应 `http.ts:456`。
    - WebSocket 在 `web_socket.ts:747-751` 转为 `emitRuntimeError`。
    - SSE 在 `sse.ts:439-448` 转为 `notifyInvalidEvent`。
  - **定为 P2 的理由：** 只影响直接调用这三个 API 的代码，不会导致进程崩溃。
- Fix direction: 在递归边界加深度计数和循环检测（或改用显式栈），超限时返回带 path 的 `StructError`。这样 HTTP 层自然会归到 `RES_STRUCT_MISMATCH`。
- Tags: cross-partition, runtime=both

#### F028

**外层重试复用 Headers，后续 span 挂在已结束的 span 下**

- 复核编号：P06-otel-server-01
- Verdict: CONFIRMED
- Severity: P2
- Category: correctness
- Location: packages/opentelemetry-server/src/interceptor/http.ts:32, packages/opentelemetry-server/src/interceptor/http.ts:53-54, packages/opentelemetry-server/src/interceptor/sse.ts:37, packages/opentelemetry-server/src/interceptor/sse.ts:50-51, packages/core/src/internal/transport_request.ts:44, packages/core/src/interceptor/interceptor.ts:10-17, doc/examples/interceptors/retry-safe-reads.ts:47-55, doc/content/en-US/docs/integrations/opentelemetry-server.mdx:171, packages/opentelemetry-server/src/interceptor/http.spec.ts:566-580, packages/opentelemetry-server/src/interceptor/sse.spec.ts:618
- Sources: P06-otel-server-codex-01, P06-otel-server-grok-02
- Summary: 拦截器从 `req.headers` 提取父上下文，再把本次 span 的 `traceparent` 原地写回同一个 `Headers`。外层拦截器用同一请求再次调用 `next(req)` 时，下一次尝试提取到的父节点是上一次的客户端 span。
- Failure scenario: 在一个入站 server span 内执行 `createClient(withInterceptors(retry), withOpenTelemetryServer({ tracer }), withHTTPHandle(...))`。`retry` 与 `retry-safe-reads.ts` 结构相同，都在循环里对同一个 `request` 调用 `next(request)`。handle 依次返回 503、503、200。预期三个 CLIENT span 都以入站 span 为父节点；实际第 2 次以第 1 次为父，第 3 次以第 2 次为父，形成链。SSE 场景：外层 SSE 拦截器在握手 503 后重试，第 2 次 span 同样以第 1 次为父。
- Evidence: 探针 `/tmp/zen-audit/verified/P06-otel-server/scratch/zz_verify_p06.spec.ts`，使用真实 `BasicTracerProvider`、`InMemorySpanExporter` 和 `AsyncLocalStorageContextManager`。运行时临时复制到 `packages/opentelemetry-server/src/`，运行后已删除。
  - 命令：`bunx vitest run --config vitest.config.ts --coverage.enabled=false --silent=false src/zz_verify_p06.spec.ts`，Node exit 0，12/12；`bun --bun vitest run ...` 相同命令，exit 0，12/12。
  - Node 输出：`H1-http {"order":"retry-outer",...,"server":"1cd0541b987382f0","attempts":[{"id":"de15de4905a4bf68","parent":"1cd0541b987382f0","status":503},{"id":"090c0cc704974001","parent":"de15de4905a4bf68","status":503},{"id":"484b2a8318e480c4","parent":"090c0cc704974001","status":200}]}`。
  - 对照组（OTel 注册在重试之前，即位于外层）：只有一个 span，`parent` 为入站 span。
  - SSE 输出：`{"server":"7c9b...","attempts":[{"id":"8581...","parent":"7c9b...","status":2},{"id":"e02c...","parent":"8581...","status":1}]}`。
  - Bun 结果与 Node 结构相同。
  - 代码依据：`http.ts:32` 为 `propagator.extract(context.active(), req.headers ?? new Headers(), headersGetter)`；`http.ts:53-54` 为 `const headers = req.headers instanceof Headers ? req.headers : new Headers(req.headers)` 后接 `propagator.inject(spanCtx, headers, headersSetter)`。Core 每次 execute 创建一个 `Headers`（`transport_request.ts:44`）。`interceptor.ts:13-16` 明确允许同一层再次调用 `next`；集成指南 :171 写道 “A new outer retry is a new lifecycle”。
  - 现有测试 `should reuse existing Headers when req.headers is already Headers`（http.spec.ts:566、sse.spec.ts:618）锁定的是原地复用同一对象，没有覆盖重入后的父子关系；mock tracer 的 span id 固定，也无法发现这一点。
  - 严重度：codex 报 P1，grok 报 P2，取 P2。trace id 不变；每次尝试发出的 `traceparent` 都指向它自己的 span，所以下游服务端 span 的父子关系正确；指标和日志不受影响。出错的只是“重试位于 OTel 外层”这种顺序下、被重试请求在客户端的树形结构，没有数据丢失。
- Fix direction: 从进入拦截器时的载体提取父上下文，把注入写到交给 `next` 的 Headers 副本上，不改调用方持有的对象。同时修改两条锁定对象同一性的测试，并补一条真实 SDK 测试，断言多次重试的 span 是同一父节点下的兄弟。
- Tags: cross-partition, runtime=both

#### F029

**queryPropagation 只追加不替换同名键，接收方读到旧上下文**

- 复核编号：P06-otel-server-03
- Verdict: CONFIRMED
- Severity: P2
- Category: correctness
- Location: packages/opentelemetry-server/src/propagation/carrier.ts:35, packages/opentelemetry-server/src/interceptor/web_socket.ts:68-74, packages/opentelemetry-server/src/interceptor/web_socket.ts:155-173, packages/core/src/web_socket/build.ts:30-38, packages/opentelemetry-server/test/setup.ts:46, doc/content/en-US/docs/integrations/opentelemetry-server.mdx:65, packages/opentelemetry-server/README.md:214
- Sources: P06-otel-server-codex-03, P06-otel-server-grok-01
- Summary: `queryStringSetter` 使用 `params.append`，`appendInjectedQueryString` 只把新值接在原 query string 末尾。query 里原有的同名传播字段留在前面，接收方取第一个值时拿到的是旧上下文。
- Failure scenario: 开启 `webSocket.queryPropagation: true`。builder 返回的 `URLSearchParams` 中已含上游 `traceparent` 和 `baggage=tenant=old`，当前上下文的 baggage 为 `tenant=new`。Core 把拦截器给出的 queryString 用于 socket URL，最终 URL 含两个 `traceparent` 和两个 `baggage`，`new URL(url).searchParams.get('traceparent')` 返回旧值，而不是本次 WebSocket span。
- Evidence: 同一探针。内存 WebSocket 构造器收到的真实 URL（Node 与 Bun 相同）：`wss://api.example.test/ws?room=a&traceparent=00-11111111111111111111111111111111-2222222222222222-01&baggage=tenant%3Dold&traceparent=00-68f5...-420cf7b3225c044a-01&baggage=tenant%3Dnew`，输出 `"firstIsCurrentSpan":false`。对照组（query 中原本没有同名键）输出单个值，`firstIsCurrentSpan:true`。
  - 本包测试服务器 `test/setup.ts:46` 用 `c.req.query('traceparent')` 读取，取的也是第一个值。
  - 变异探针：把 `carrier.ts:35` 改为 `set` 后，整个 OTel 套件 Node exit 0、288/288（日志 `scratch/mutation-carrier-set-node.log`），已 `git checkout` 还原。说明现有测试既没锁定 append 也没锁定 set，重复键这种情况未被测试覆盖。
  - 集成指南 :65 写 “propagator fields append to the connection query string”，说明的是追加的位置，没有说重复键时旧值优先。
  - 只有显式开启（默认 false）且 query 中已有同名键时才触发，所以定为 P2。
- Fix direction: 注入时替换 propagator `fields()` 列出的同名键，并让 `queryParams` 与 `queryString` 保持同步，其他键保留原有的序列化字节。补一条测试：query 中预置 traceparent/baggage，断言 `get()` 返回当前 span 的值。
- Tags: cross-partition, runtime=both

#### F030

**HTTP responseHook 的 rejection 未被记录**

- 复核编号：P06-otel-server-02
- Verdict: CONFIRMED
- Severity: P2
- Category: contract
- Location: packages/opentelemetry-server/src/telemetry/trace.ts:106-116, packages/opentelemetry-server/src/interceptor/http.ts:62-64, packages/opentelemetry-server/src/telemetry/trace.ts:87-88, packages/opentelemetry-server/README.md:219, doc/content/en-US/api/opentelemetry-server/opentelemetryservertransportoptions-type.mdx:21, doc/content/en-US/api/opentelemetry-server.mdx:79, doc/content/en-US/docs/integrations/opentelemetry-server.mdx:36, doc/content/en-US/api/opentelemetry-server/opentelemetryserverhttpoptions-type.mdx:15
- Sources: P06-otel-server-codex-02, P06-otel-server-grok-03
- Summary: `runSpanHook` 用 `void Promise.resolve(result).catch(...)` 把 rejection 的记录排到微任务里，而 HTTP 成功路径紧接着同步调用 `setSpanHttpResponse` 结束 span。因此 HTTP `responseHook` 的 rejection 总是赶不上，真实 SDK 不保留这条记录。
- Failure scenario: 配置 `http.responseHook: () => Promise.reject(new Error('rej'))`，或在 `await` 之后抛错，请求正常返回 200。导出的 span 上既没有 `defjs.otel.hook.error`，也没有 `exception` 事件。同步抛错时这两个事件都在。SSE 的同类 rejection 会被记录，因为 SSE span 要等到 `closed` 才结束。
- Evidence: 同一探针，Node 与 Bun 结果相同：
  - `H2 {"name":"http responseHook Promise.reject","events":[]}`
  - `H2 {"name":"http responseHook sync throw","events":["defjs.otel.hook.error","exception"]}`
  - `H2 {"name":"http responseHook attr after await","events":[],"appBefore":true,"appAfter":null}`
  - `H2 {"name":"sse responseHook Promise.reject","events":["sse.connected","defjs.otel.hook.error","exception","sse.closed"]}`

  文档口径：README:219 写 “may return `void` or `Promise<void>`; their throws/rejections are recorded without blocking the operation”；传输选项页 :21 与 API 总页 :79 写 “a throw or rejection is recorded the same way”；集成指南 :36 写 “A hook failure records `defjs.otel.hook.error`”。只有 HTTP 选项页 :15 写了 “only its synchronous part can still change the span”，所以 await 之后写属性丢失属于已文档化的行为，不在本项范围内；但没有任何一处文档说 rejection 会丢失。

  严重度：codex 报 P1，降为 P2。业务结果不受影响，丢失的是应用自己 hook 的诊断信息；而且 HTTP 选项页已经限制了异步定制的能力。

- Fix direction: 二选一并让所有文档统一口径。一是在不让业务结果等待 hook 的前提下，用一个不依赖 span 仍在记录的通道记录 HTTP hook 的 rejection；二是明确写出 HTTP `responseHook` 的异步部分（包括 rejection）不会被记录，并让 README:219 与 HTTP 选项页 :15 一致。补一条返回 `Promise.reject(...)` 的测试，所用 tracer 要在 span 结束后丢弃写入。
- Tags: cross-partition, runtime=both

#### F031

**SSE 元组第三槽读 live open，链尾异步期间可被重连覆盖**

- 复核编号：P03a-core-sse-09
- Verdict: CONFIRMED
- Severity: P2
- Category: contract
- Location: packages/core/src/sse/sse.ts:373-384; packages/core/src/sse/transport/event_stream.ts:161-171; packages/core/src/sse/transport/event_stream.ts:263; doc/content/en-US/docs/sse.mdx:34; doc/content/en-US/api/sse.mdx:58
- Sources: P03a-core-sse-codex-05
- Summary: `fetchEventStream` 每次握手都会覆盖 `latestOpen`。`sse.ts:380` 的 `const open = stream.open` 在 `await` 完整个拦截器链之后才执行，代码里没有单独保存首次成功握手。
- Failure scenario: 某个 SSE 拦截器在 `await next(req)` 之后还要等一段异步工作（例如刷写日志）。这期间首个连接断开并成功重连，`execute` 返回的 `startupOpen` 已经是第二次的响应。依赖首个响应头（例如会话 ID）的调用方拿到的是错误的值。
- Evidence:
  - 复跑 codex 探针，Bun 与 Node 均 exit 0。拦截器内部断言 `next` 返回时 `x-attempt` 为 `1`；而 `execute` 返回的元组是 `startup-snapshot {"calls":2,"startupAttempt":"2","liveAttempt":"2"}`。
  - 文档 `sse.mdx:34` 写的是 "`startupOpen` is the initial snapshot. … Keep the tuple value when the first response matters."；`api/sse.mdx:58` 写的是 "The tuple's third slot is the startup snapshot of `open`"。
  - 触发条件很窄：需要链尾有异步工作的拦截器、早期断流和快速重连同时出现。
- Fix direction: 在 `fetchEventStream` 中单独保存首个成功握手（或在 `sseHandler` 解析时捕获），让 `execute` 元组引用它；`stream.open` 继续跟随最新的连接。
- Tags: cross-partition（拦截器链属 P04）, runtime=both

#### F032

**maxDelayMs 只约束 jitter 前的基数，实际等待可超上限**

- 复核编号：P03b-core-ws-04
- Verdict: CONFIRMED
- Severity: P2
- Category: contract
- Location: packages/core/src/internal/backoff.ts:11-12; packages/core/src/client/config.ts:79; packages/core/src/client/config.ts:107; doc/content/en-US/api/core/withwebsocketreconnect.mdx:26; doc/content/en-US/docs/web-socket.mdx:58
- Sources: P03b-core-ws-grok-03
- Summary: `computeReconnectDelay` 先 `Math.min(..., maxDelayMs)` 再乘 `(1 ± jitter)`，jitter > 0 且已达上限时等待最多为 `(1 + jitter) × maxDelayMs`。
- Failure scenario: 默认 `maxDelayMs: 30000` 加 `jitter: 0.2`，第 7 次及以后的重试等待最高约 36000 ms；`maxDelayMs: 3000`、`jitter: 1` 时最高约 6000 ms。依赖 "上限 30 s" 做 SLA、超时或 UI 倒计时的调用者会等得更久。默认 `jitter: 0` 不受影响。
- Evidence: `backoff.ts:11` `const exponential = Math.min(config.delayMs * config.factor ** Math.max(0, attempt - 1), config.maxDelayMs)`；`:12` `Math.round(exponential * (1 + (Math.random() * 2 - 1) * config.jitter))`；之后仅 `:17` 夹到 `2_147_483_647`。`web_socket.ts:521` 直接调用。复核探针（`Math.random` 固定 0.9999，Node/Bun 一致）：`PROBE JITTER node=26.11.1 cap=3000 jitter=1 attempt10=5999; cap=30000(default) jitter=0.2 attempt7=35999`。文档：`config.ts:79`（WebSocket）与 `config.ts:107`（SSE）JSDoc 均为 "Upper bound for computed backoff delay."；`withwebsocketreconnect.mdx:26` "The delay for retry _n_ is `delayMs * factor^(n-1)`, capped at `maxDelayMs`."。`docs/sse.mdx:62` 写 "`maxDelayMs` caps the base"，对 SSE 准确，提示 "基数封顶" 可能是有意语义，但 WebSocket 页与两处 JSDoc 未如此表述。`reconnect.spec.ts:140-148` 只在 `jitter: 0` 下断言封顶，`:174-185` 的 jitter 用例未达上限，均不锁定叠加行为。
- Fix direction: 二选一并统一：jitter 之后再夹到 `maxDelayMs`；或保留现状，把 WebSocket API 页与 `config.ts` 两处 JSDoc 改为 "caps the base delay before jitter"，并补一条同时设置 jitter 与上限的用例。
- Tags: cross-partition（backoff.ts 属 P04；SSE 共用，属 P03a）, runtime=both

#### F033

**路径占位符文法未文档化，含冒号的静态段无法表达**

- 复核编号：P04-core-infra-04
- Verdict: CONFIRMED
- Severity: P2
- Category: contract
- Location: packages/core/src/internal/url.ts:36, packages/core/src/internal/builder_types.ts:42, doc/content/en-US/docs/http.mdx:22, doc/content/en-US/docs/commands.mdx:44, doc/content/en-US/api/core/definerequest.mdx:25
- Sources: P04-core-infra-codex-05, P04-core-infra-grok-05
- Summary: `fillUrl` 用 `/:([^/]+)/g` 识别占位符，类型层的 `PathParams` 用的是同一规则。文档只用 `:id` 作示例，从未定义这套文法，也没有给出字面冒号的写法，所以静态段里只要有冒号，执行时就会失败。
- Failure scenario:
  - `defineRequest({ method: 'POST', path: '/models/gemini-pro:generateContent' })` 是 AIP-136 自定义方法风格。它不声明 input，因为 `HttpRequestShape.path` 可选，所以能通过类型检查；但执行时返回 `REQ_BUILD_FAILED: Missing path param: generateContent`，请求不会发出。
  - 写成 `'/models/:model:generateContent'` 时，占位符名变成 `model:generateContent`；按这个键填值，会把 `:generateContent` 一起替换掉。
  - `'/files/:name.json'` 的占位符名是 `name.json`。
  - `'/v1/time/12:30'` 报 `Missing path param: 30`。
- Evidence:
  - `url.ts:36` 为 `return path.replace(/:([^/]+)/g, …)`；`builder_types.ts:42-46` 也是从冒号一直匹配到 `/` 或字符串末尾。
  - 文档方面：`http.mdx:22` 只讲编码规则，`commands.mdx:44` 只有 “Use `builder` for path placeholders”，`definerequest.mdx:25` 没有定义语法。
  - 复现：`bun|node misc.mjs`，均 exit 0，输出：
    ```text
    static colon {"path":"/models/gemini-pro:generateContent","code":"REQ_BUILD_FAILED","msg":"Missing path param: generateContent"}
    static colon {"path":"/v1/time/12:30","code":"REQ_BUILD_FAILED","msg":"Missing path param: 30"}
    placeholder+custom verb {"code":"REQ_BUILD_FAILED","msg":"Missing path param: model:generateContent"}
    suffix placeholder {"code":"REQ_BUILD_FAILED","msg":"Missing path param: name.json"}
    dispatched urls []
    ```
  - 定级 P2：失败会以 `REQ_BUILD_FAILED` 明确报出。另有绕行办法：把 `gemini-pro:generateContent` 整体作为占位符的值传入，冒号会被编码成 `%3A`，但服务端是否接受要看服务端实现。
- Fix direction: 在 `http.mdx`/`commands.mdx` 写明占位符文法和字面冒号的写法。若要支持自定义方法，则把占位符名收紧为标识符字符，并让 `PathParams` 同步。
- Tags: runtime=both

#### F034

**GraphQL 配方拒绝 data: null，应用错误被误报**

- 复核编号：P09a-doc-guides-01
- Verdict: CONFIRMED
- Severity: P2
- Category: correctness
- Location: doc/examples/recipes/graphql-http-envelope.ts:13-17; doc/examples/recipes/graphql-http-envelope.ts:24-26; doc/content/en-US/recipes/graphql-http-envelope.mdx:8; doc/content/en-US/recipes/graphql-http-envelope.mdx:20
- Sources: P09a-doc-guides-codex-01
- Summary: 配方把 `data` 声明为 `struct.object({...}).optional()`，不接受 `null`。GraphQL 执行期错误返回 `data: null` 加 `errors[]` 时，`client.execute` 先以 `RES_STRUCT_MISMATCH` 失败，配方的 `errors[]` 解包分支到不了。
- Failure scenario: 读者照搬配方去查询一个根字段非空的 schema（例如 `user(id): User!`）。服务端返回 HTTP 200 和 `{"data":null,"errors":[{"message":"viewer unavailable"}]}`。`loadViewer` 抛出 `RES_STRUCT_MISMATCH`，消息为 `Expected object at data, received null`，而不是应用错误 `viewer unavailable`。这个应用错误会被误判为服务端契约破坏。
- Evidence:
  - 配方正文 `graphql-http-envelope.mdx:20` 写道："Application errors stay in `errors[]` until your unwrap throws or returns."；`:8` 写道："unwrap `errors[]` / missing `data` in your own helper"。
  - 示例 `:13-17` 中 `data: struct.object({ viewer: ….null() }).optional()`，`:24` 的 `if (error) throw error` 位于 `:25` 读取 `result.errors` 之前。
  - GraphQL 规范 October 2021 §7.1.2（用 firecrawl 抓取 spec.graphql.org/October2021）原句："If an error was raised during the execution that prevented a valid response, the `data` entry in the response should be `null`."
  - 复现：`/tmp/zen-audit/verified/P09a-doc-guides/scratch/probe.mjs` 原样复制示例 `:6-30` 的定义与 `loadViewer`，`bun probe.mjs` 与 `node probe.mjs` 均 exit 0，输出相同：
    `GRAPHQL {"body":{"errors":[{"message":"viewer unavailable"}]},"code":null,"message":"viewer unavailable"}`
    `GRAPHQL {"body":{"data":null,"errors":[{"message":"viewer unavailable"}]},"code":"RES_STRUCT_MISMATCH","message":"Expected object at data, received null"}`
  - Core 行为本身正确（`http.ts:452-453` 把 StructError 归为 `RES_STRUCT_MISMATCH`），问题出在配方的 envelope。
  - 定级说明：配方自带 fixture 只覆盖"无 data"分支，自身输出 `ada viewer unavailable` 无误；示例 schema 中 `viewer` 可空，所以该 schema 很少出现 `data:null`。但这个 envelope 本意是供读者套用的模式，套用到非空根字段即失效，属于窄而真实的问题，定为 P2。
- Fix direction: envelope 的 `data` 改为 `.nullish()`，保持 errors 优先的解包顺序；fixture 增加一个 `data:null` + `errors` 响应。
- Tags: runtime=both

#### F035

**嵌套 intersection 展平时丢弃内层 nullable**

- 复核编号：P01-core-struct-04
- Verdict: CONFIRMED
- Severity: P2
- Category: contract
- Location: packages/core/src/struct/constructors.ts:446-447; packages/core/src/struct/constructors.ts:435-437; packages/core/src/struct/parse.ts:439-444; packages/core/src/struct/types.ts:216; packages/core/src/struct/types.ts:350
- Sources: P01-core-struct-codex-02
- Summary: 外层 intersection 的某个成员如果本身是 object-side intersection，`flattenObjectIntersectionSides` 会执行 `options.push(...definition.options)`，把它拆成原始成员，内层 `.null()` 设置的 `flags.nullable` 就丢掉了。
- Failure scenario: 设 `inner = struct.intersection(objA, objB).null()`，`outer = struct.intersection(inner, objC.null())`。
  - 类型上，`StructInput<typeof outer>` 和 `Infer<typeof outer>` 都包含 null。
  - 运行时，`struct.parse(inner, null)` 成功，`struct.parse(outer, null)` 却返回 `invalid_type`。
  - 对照：`struct.intersection(objA.null(), objC.null())` 解析 null 成功。
- Evidence:
  - **复现输出（两个运行时相同）：** `@@ B {"inner":[null,null],"outer":[{"code":"invalid_type","expected":"object","message":"Expected object at <root>, received null","path":[],"received":null}],"flatBothNullable":[null,null]}`。
  - **类型探针：** 用 `Check<Equal<null extends StructInput<typeof outer> ? true : false, true>>` 断言，`CLAUDECODE= bun check --no-pretty --project .audit-tmp/tsconfig.json` 退出 0，`node_modules/.bin/tsc --noEmit` 退出 0。
  - **断言有效性：** 反向对照断言按预期报 TS2344（bun check 退出 1）。
  - **原因：** null 输入走 `parse.ts:439-444`，对每个成员调用 `parseNode`，而这些成员已经是不带 nullable 的原始 object。
  - **降级理由（P1 → P2）：** 要同时满足"嵌套的 intersection 带修饰符"和"外层所有成员都 nullable"才会触发；而且结果是拒绝合法输入并给出明确 issue，不会悄悄放过错误数据。
- Fix direction: 只展平没有修饰符的内层 intersection；带 nullable 或 optional 的内层保留为一个整体成员。补一条嵌套 nullable intersection 的回归测试。
- Tags: runtime=both

#### F036

**单成员 intersection 的公开类型丢失 optional**

- 复核编号：P01-core-struct-05
- Verdict: CONFIRMED
- Severity: P2
- Category: contract
- Location: packages/core/src/struct/constructors.ts:417-418; packages/core/src/struct/types.ts:216; packages/core/src/struct/types.ts:225; packages/core/src/struct/types.ts:345-348
- Sources: P01-core-struct-codex-03
- Summary: 运行时按文档把单个成员原样返回（`struct-intersection.mdx:17` 写着 "A single struct is returned unchanged"）。返回类型却是 `IntersectionStruct<[x]>`，它对 input/output 做了 `Exclude<…, undefined>`，并继承默认的 `optionalOut = false`。
- Failure scenario: 设 `s = struct.intersection(struct.string().optional())`，此时 `Infer<typeof s>` 是 `string`。
  - 顶层：`struct.parse(s, undefined)` 返回 `[null, undefined]`。`if (!e) v.toUpperCase()` 能编译通过，运行时却抛 TypeError。
  - 字段：放进 `struct.object({ v: s })` 后，类型要求必填，运行时对 `{}` 却成功并省略该字段。
  - 成员换成 `.nullish()` 时情况相同。
- Evidence:
  - **复现输出（两个运行时相同）：** `@@ C {"same":true,"top":[null,"<undef>"],"field":[null,{}]}`。
  - **类型探针：** `Check<Equal<Infer<typeof single>, string>>` 和 `Check<Equal<Infer<typeof wrapped>, { v: string }>>` 都通过（bun check 与 tsc 均退出 0）；反向对照报 TS2344。
  - **降级理由（P1 → P2）：** 单成员调用多见于 `intersection(...parts)` 这类泛型展开，较少见。
- Fix direction: 给单成员调用加一个重载，返回成员自身的类型（与运行时"原样返回"一致）；或者让 `IntersectionStruct` 在单成员时保留 input/output/optionalOut。
- Tags: runtime=both

#### F037

**errorMap 返回空字符串时不替换默认消息**

- 复核编号：P01-core-struct-06
- Verdict: CONFIRMED
- Severity: P2
- Category: contract
- Location: packages/core/src/struct/errors.ts:129-131
- Sources: P01-core-struct-codex-05, P01-core-struct-grok-04
- Summary: 判断条件是 `if (override)`，合法的 `''` 因此被当成"保留默认消息"，与"返回 string 就替换，只有 undefined 才保留"的契约不符。
- Failure scenario: 调用方想借 errorMap 去掉默认消息里的原值（参见 02），执行 `struct.parse(struct.number(), 'secret-value', { errorMap: () => '' })`，消息仍然是 `Expected number at <root>, received "secret-value"`。
- Evidence:
  - **复现输出（两个运行时相同）：** `@@ E {"message":"Expected number at <root>, received \"secret-value\""}`。
  - **契约原文：** `errors.ts:7` 写着 "Return a string to replace the default message, or `undefined` to keep it."；`api/core/errormap-type.mdx:12` 措辞相同；`api/core/struct-parse.mdx:19` 写着 "Returning `undefined` keeps the default message."。
  - **测试缺口：** `errors.spec.ts:160` 只覆盖了 `() => undefined`。
- Fix direction: 改为 `override !== undefined`，并补一条空字符串的回归测试。
- Tags: runtime=both

#### F038

**跨包副本的 bigint/date 转换失败绕过本次 errorMap**

- 复核编号：P01-core-struct-07
- Verdict: CONFIRMED
- Severity: P2
- Category: contract
- Location: packages/core/src/struct/constructors.ts:378; packages/core/src/struct/constructors.ts:394; packages/core/src/struct/errors.ts:104; packages/core/src/struct/errors.ts:128; packages/core/src/struct/parse.ts:172-174
- Sources: P01-core-struct-codex-06
- Summary: 跨副本 decode hook 已经改为通过解析方传入的 `fail` 上报失败，但 issue 仍由 hook 所在副本的 `issue()` 创建。`issue()` 读取的是那个副本模块里的 `activeErrorMap`，值为 undefined，所以解析方设置的 errorMap 不会被调用。
- Failure scenario: 应用里存在两份 `@defjs/core`。项目明确支持这种情况：`parse.protocol.spec.ts:771` 起有专门的用例。此时用副本 A 的 `struct.parse` 解析副本 B 构造的 `struct.bigint()` 或 `struct.date()`，转换失败时 `errorMap: () => 'redacted'` 一次也不会被调用，消息保留默认文本，其中含原值。对照：副本 B 的 `struct.string()` 发生类型不匹配时，errorMap 正常生效。
- Evidence:
  - **复现方法：** 用 `cp -R packages/core/src` 做出第二份副本 `scratch/copyB-src`。
  - **复现输出（两个运行时相同，第一个数字是 errorMap 调用次数）：** `@@ F {"distinctCopies":true,"foreignBigint":[0,"Expected bigint at <root>, received \"nope\"",true],"foreignDate":[0,"Expected Date at <root>, received \"nope\""],"foreignString":[1,"redacted"],"localBigint":[1,"redacted"]}`。
  - **原因：** `constructors.ts:378` 是 `return fail(issue(path, 'invalid_type', 'bigint', input))`，这里的 `issue` 来自 hook 所在副本；`errors.ts:128` 只检查本模块的 `activeErrorMap`。
  - **测试缺口：** `parse.protocol.spec.ts:779` 的测试名写着 "decode hooks accept and reject exactly like the hooks of this copy"，但没有覆盖 errorMap。
  - **定为 P2 的理由：** 只在多副本组合下出现，而且只影响 bigint/date 的转换失败。
- Fix direction: 让 hook 只返回失败原因，由解析方副本创建 issue 并执行映射；或者由解析方的 `fail` 补跑 errorMap。在现有的跨副本用例上补一条回归即可。
- Tags: runtime=both

#### F039

**两份 @defjs/core 实例并存时调用方取消被记为 WARN**

- 复核编号：P06-otel-server-05
- Verdict: CONFIRMED
- Severity: P2
- Category: contract
- Location: packages/opentelemetry-server/src/telemetry/logs.ts:30, packages/core/src/error/cause.ts:2, packages/opentelemetry-server/README.md:95
- Sources: P06-otel-server-codex-04（grok 在其 coverage 中以“没有第二份 Core 安装、无法演示”为由未立案；本次复现后裁定成立）
- Summary: 取消抑制只认 `error === ERR_ABORTED`，即对象身份。`ERR_ABORTED` 是每个模块实例各自 `new Error(...)` 出来的，所以客户端由另一份 Core 实例创建时，插件认不出这个取消哨兵。
- Failure scenario: 应用用一份 Core 实例创建客户端，插件 import 的是另一份实例，例如服务端打包时只把其中一个包打进 bundle、另一个保持 external。调用方 `AbortController.abort()` 后，业务结果是正确的 `NET_ABORTED`，但插件发出一条 `http.client.request.exception` WARN；只配 logger 时也会发生。README:95 承诺 “caller cancellation produce no LogRecord”。
- Evidence: 在 clone 中构建 `packages/core/dist`（`bun --bun run build`，exit 0）。探针中应用侧使用 `packages/core/dist/index.js` 创建客户端，插件侧经 vitest alias 使用 `packages/core/src`。Node 与 Bun 输出相同：`H4 {"which":"second-core","fault":"NET_ABORTED","logs":[["http.client.request.exception","Error"]]}`；同一实例对照组：`{"which":"same-core","fault":"NET_ABORTED","logs":[]}`。在单一实例下，Core（`internal/abort.ts:51-55`）会把所有非超时的取消原因统一成 `ERR_ABORTED`，所以正常安装不受影响。前提条件很窄：peer dependency 本来就是为了让包管理器只保留一个实例，本次也没有在任何具体 bundler 配置下验证过。后果是每次取消多一条 WARN 噪声，业务结果正确。五项中优先级最低；如果项目明确不支持多实例，可以删掉本项。
- Fix direction: 取消分类改为不依赖对象身份的判断。例如根据请求的 abort signal 是否已中止、且原因不是超时来判断，或使用 Core 导出的跨实例标记（如 `Symbol.for` 品牌）。TimeoutError 仍需照常记日志。
- Tags: cross-partition, runtime=both

#### F040

**SSE 按行和按字段值剥离 BOM，偏离规范**

- 复核编号：P03a-core-sse-08
- Verdict: CONFIRMED
- Severity: P2
- Category: correctness
- Location: packages/core/src/sse/transport/parser.ts:181; packages/core/src/sse/transport/parser.ts:217; packages/core/src/sse/transport/parser.ts:259-264; packages/core/src/sse/transport/parser.spec.ts:314-320
- Sources: P03a-core-sse-codex-04
- Summary: 每个字段值都单独调用一次非流式的 `TextDecoder.decode`；默认 `ignoreBOM: false`，所以每次调用都会剥掉开头的 BOM。另外 `fieldName` 对每一行都会跳过开头的 `EF BB BF`。规范只允许在流开头去掉一个 BOM。
- Failure scenario:
  - `data: ﻿payload` 经 `struct.string()` 交付后变成 `payload`，与文档 "A `string` struct keeps that text" 不符。
  - 流中途出现的 `﻿data: injected` 会产生一个额外事件。按规范，这一行的字段名是 `﻿data`，应当被忽略。
  - `id: ﻿1` 同理变成 `1`。
- Evidence:
  - 复跑 codex 探针，Bun 与 Node 均 exit 0，输出一致：
    - `bom {"name":"payload-bom","data":["payload"],"codepoints":[[112,97,121,108,111,97,100]]}`
    - `bom {"name":"midstream-field-bom","data":["first","injected"],…}`
    - 流开头 BOM 的对照组得到 `["ok"]`，是正确的。
  - WHATWG（本次抓取）给出 `stream = [ bom ] *event`，并写明 "The UTF-8 decode algorithm strips one leading UTF-8 Byte Order Mark (BOM), if any."。
  - `parser.ts:259-261` 的 JSDoc 自述 "Decoding dropped one leading BOM, so one is skipped here too"。
  - `parser.spec.ts:314-315` 的用例名为 "skip one leading BOM"，却把 BOM 放在四行之后，实际锁定的是“流中途 BOM 被接受”的行为。
  - 本条在 P2 中优先级较低：需要 U+FEFF 恰好出现在行首或值首；而且服务端本来就是可信方，不构成跨信任边界的注入。
- Fix direction: 只在每个物理流的第一个字节处跳过一次 BOM；字段值改用 `ignoreBOM: true` 或流式解码，保留 U+FEFF。把现有用例拆成三个契约场景：流开头、值开头、流中途的字段。
- Tags: runtime=both

#### F041

**退避基数为 0 时第 1025 次重试抛 RangeError**

- 复核编号：P03a-core-sse-10
- Verdict: CONFIRMED
- Severity: P2
- Category: correctness
- Location: packages/core/src/internal/backoff.ts:11-16; packages/core/src/sse/transport/event_stream.ts:463-470; packages/core/src/web_socket/web_socket.ts:521; packages/core/src/web_socket/reconnect.ts:20-35
- Sources: P03a-core-sse-codex-06
- Summary: `delayMs * factor ** (attempt - 1)` 先算指数。`factor ** 1024` 溢出为 `Infinity`，乘以 0 得到 `NaN`；`Math.min(NaN, maxDelayMs)` 仍是 `NaN`，随即抛出 `Reconnect delay must be finite`。
- Failure scenario: `withSSEReconnect({ attempts: 1026, delayMs: 0, factor: 2, maxDelayMs: 50 })` 的每个值都合法且有限，预期延迟恒为 0。但第 1025 次失败后，流以 `NET_UNREACHABLE`（cause 为 `RangeError`）结束。服务端发 `retry: 0` 把基数置 0 时同理。由于预算和指数都按整条流累计（见 P03a-core-sse-02），这里的 1025 次是整条流生命周期内的累计次数。
- Evidence:
  - 复跑 codex 探针，Bun 与 Node 均 exit 0：`finite-zero-delay-overflow {"attempts":1026,"delayMs":0,"factor":2,"maxDelayMs":50,"calls":1025,"code":"NET_UNREACHABLE","cause":"Reconnect delay must be finite"}`。配置 `{ delayMs: 0, factor: 1e308, attempts: 4 }` 时 3 次即终止。
  - WebSocket 的 `normalizeReconnectConfig` 允许 `delayMs: 0`，`attempts` 可到安全整数上限，并直接调用同一个函数，所以同样受影响。
  - 现实中要累计超过 1024 次重试才会触发，因此列为本分区最低优先级。
- Fix direction: 基数为 0 时直接返回 0；指数溢出时饱和到 `maxDelayMs`（或计时器上限）。只对原始输入本身非法的情况报错。
- Tags: cross-partition（backoff.ts 属 P04；WebSocket 共用）, runtime=both

#### F042

**文档仍宣称已删除的 packed-consumer 与 ES2022 基线验证**

- 复核编号：P11-ops-04（合并：P09a-doc-guides-05）
- Verdict: CONFIRMED
- Severity: P2
- Category: docs
- Location: docs/releases/0.4.0.md:66; packages/core/README.md:65; doc/content/en-US/docs/sse.mdx:99; package.json:49-50; tsconfig.base.json:3-4; packages/core/README.md:71-74; tsconfig.base.json:11; doc/content/ar/docs/sse.mdx:99; doc/content/de-DE/docs/sse.mdx:99; doc/content/es-ES/docs/sse.mdx:99; doc/content/fr-FR/docs/sse.mdx:99; doc/content/ja-JP/docs/sse.mdx:99; doc/content/ko-KR/docs/sse.mdx:99; doc/content/ru-RU/docs/sse.mdx:99; doc/content/zh-Hans/docs/sse.mdx:99; doc/content/zh-Hant-HK/docs/sse.mdx:99; doc/content/zh-Hant-TW/docs/sse.mdx:99
- Sources: P11-ops-codex-04
- Summary: 发布说明、随 tarball 发布的 core README 和 SSE 文档都以现在时声称有 tarball 消费者验证或 ES2022 lib 基线的联合验证，但仓库里已经没有任何对应机制。
- Failure scenario: 读者或维护者依据“Packed-consumer verification installs all four tarballs…”或“The gate is pinned to TypeScript 7”，以为每次发布都验证过声明在 ES2022 基线下可用。实际上没有任何检查；一旦基线回归，不会有任何东西报警。
- Evidence:
  - `docs/releases/0.4.0.md:66` 原文：“Packed-consumer verification installs all four tarballs outside the workspace, typechecks their public declarations, and runs a Bun 1.4 smoke test.” 该文件在删除 gate 之后的 `c0024006`（2026-10-12）还被修改过。
  - `packages/core/README.md:65` 原文：“The gate is pinned to TypeScript 7 … This supported set is verified together”。
  - `sse.mdx:99` 原文：“These four entries are verified together as one baseline”。
  - 对照：`git ls-files scripts` 为空；`git grep -E "npm pack|bun pm pack|verify-packed"` 只命中 README 中的 npm 徽章；tracked 的 json/ts 配置中没有 `ES2022`/`ESNext.Disposable`；`tsconfig.base.json` 是 `ESNext` 且 `skipLibCheck: true`。
  - 宣称的契约本身目前成立：本人用按序构建的四个 dist 搭建消费者（`scratch/consumer-all`，ES2022 + `ESNext.Disposable` + DOM + DOM.Iterable，`types: []`，`skipLibCheck: false`，包含 `await using`），tsc exit 0，Bun 和 Node 的 smoke 都 exit 0（`smoke ok 40,1,2,3`）。所以错的是文档，不是产物。
- Fix direction: 把这三处改为如实描述（基线目前没有持续验证）；如果要恢复 gate，就把消费者检查接入脚本和 CI。
- Tags: cross-partition（文字归 P12）

<details><summary>合并项 P09a-doc-guides-05 的复核记录</summary>

##### P09a-doc-guides-05 SSE 指南称最低 lib 集合是"仓库验证"的，验证门禁已删除，仓库内无任何配置使用该 lib 集合

- Verdict: CONFIRMED
- Severity: P3
- Category: docs
- Location: doc/content/en-US/docs/sse.mdx:99; packages/core/README.md:65; tsconfig.base.json:3; tsconfig.base.json:11
- Sources: P09a-doc-guides-grok-06（codex 在 H1 中否定"类型不可用"，但未否定过程陈述；争议见 notes）
- Summary: 原文写 "The repository-validated and supported minimum lib contract is `ES2022`, `ESNext.Disposable`, `DOM`, and `DOM.Iterable` … These four entries are verified together as one baseline"。仓库已不再验证这组 lib；目前这组 lib 对 core 公开声明仍能通过。
- Failure scenario: 将来 `@defjs/core` 的 `.d.ts` 若用到 ES2022 + ESNext.Disposable 之外的类型，仓库 CI 不会失败，文档仍声称该基线由仓库验证。读者依此选 lib 配置，会在升级后才在消费者侧编译失败。
- Evidence:
  - 门禁已删除：`git log --oneline --diff-filter=D -- scripts/verify-packed-consumer.ts` 输出 `77a75294`；工作区中 `scripts/` 目录不存在。
  - 仓库内无配置使用该 lib 集合：`git ls-files | grep tsconfig | xargs grep '"lib"'` 只命中 `tsconfig.base.json:3` 的 `["ESNext","DOM","DOM.Iterable"]`，且 `:11` 为 `skipLibCheck: true`。除文档和历史计划外，没有 tracked 文件使用 `ESNext.Disposable`。
  - 声明本身今天仍成立：本次重建 `packages/core/dist/index.d.ts` 后，用 `tsc` 7.0.2、`target ES2022`、上述四项 lib、`skipLibCheck:false`，对一个覆盖 HTTP、SSE `await using`、WS `await using` 的消费者执行 `tsc -p /tmp/zen-audit/verified/P09a-doc-guides/scratch/minlib/tsconfig.json --noEmit`，exit 0。
  - 负对照：去掉 `ESNext.Disposable` 后 exit 1（`TS2318 Cannot find global type 'AsyncDisposable'`、`TS2304`、`TS2550`），证明该检查确实在验证这组 lib。
  - 定级说明：审计者报 P2，此处降为 P3。用户今天不受影响，错的只是"仓库验证"这一过程陈述。
- Fix direction: 要么把这组 lib 的消费者检查恢复到 CI，要么删掉 "repository-validated"/"verified together" 措辞，改为"支持承诺（当前未自动验证）"；README 同句一并修改。
- Tags: cross-partition（`packages/core/README.md:65` 属 P12；门禁删除属 P11；其余 locale 属 P10）

</details>

#### F043

**Core 与 OTel 发布包 README 的文档站链接全部失效**

- 复核编号：P12-project-docs-01
- Verdict: CONFIRMED
- Severity: P2
- Category: docs
- Location: packages/core/README.md:83-87; packages/opentelemetry-server/README.md:356-359; doc/app/routes.ts:2-11; doc/app/lib/routes.ts:10-15
- Sources: P12-project-docs-codex-05, P12-project-docs-codex-06, P12-project-docs-grok-02, P12-project-docs-grok-03
- Summary: 两份随 tarball 发布的 README（tsdown `copy: ['../../LICENSE', './README.md']`）仍链接 Fumadocs 迁移前的 `/guide/getting-started`、`/core/{client,http,sse,web-socket}`、`/plugins/opentelemetry-server`，当前站点没有这些路由，也没有 redirect。
- Failure scenario: npm 上 `@defjs/core` 或 `@defjs/opentelemetry-server` 的读者点击 Documentation 下任一链接。路径不存在于当前路由表，静态站对未知路径渲染 404；目前域名本身也无法解析。
- Evidence:
  - README 原文：core:83-87 为 `https://defjs.org/guide/getting-started`、`/core/client`、`/core/http`、`/core/sse`、`/core/web-socket`；OTel:356-359 为 `https://defjs.org/plugins/opentelemetry-server`、`/core/client`、`/core/sse`、`/core/web-socket`。
  - 路由表：`git ls-files 'doc/content/en-US/*' | sed …` 只有 `/docs/start`、`/docs/client`、`/docs/http`、`/docs/sse`、`/docs/web-socket`、`/docs/integrations/opentelemetry-server` 等 `/docs/*` 页面。`doc/app/routes.ts` 只有 index、sitemap、search、llms、`404` 和 `*`→`routes/page.tsx`；`doc/app/lib/routes.ts:10-15` 由内容路径生成 URL。
  - redirect：`git grep -n -E 'getting-started|/core/client|plugins/opentelemetry|redirect' -- doc ':!doc/content'` 无相关命中。
  - 外部（只读）：`curl https://defjs.org/...` 五个 URL 均 exit 35；Cloudflare DoH `name=defjs.org&type=A` 和 `type=NS` 返回 `"Status":3`；Google DoH 的 A 和 `www` CNAME 也是 `"Status":3`；firecrawl 报 `DNS resolution failed for hostname "defjs.org"`。GitHub API `repos/defjs/defjs` 的 `homepage` 为 `https://defjs.org`。
  - 两条结论分开看：路径错误不依赖外网，可在仓库内修复；域名不可解析是外部问题。
- Fix direction: 改为 `/docs/start`、`/docs/client`、`/docs/http`、`/docs/sse`、`/docs/web-socket`、`/docs/integrations/opentelemetry-server`。另需确认 `SITE_URL` / 域名实际可用，这属于仓库外运维。
- Tags: cross-partition（路由属 P08；域名与部署属运维）

#### F044

**design.md 关于 subprotocol token 的说明与实现相反**

- 复核编号：P03b-core-ws-06
- Verdict: CONFIRMED
- Severity: P2
- Category: docs
- Location: packages/core/design.md:237; packages/core/src/web_socket/web_socket.ts:417; packages/core/src/web_socket/web_socket.ts:572-592; doc/content/en-US/docs/web-socket.mdx:26
- Sources: P03b-core-ws-codex-05, P03b-core-ws-grok-04
- Summary: `design.md` 写 "token 放进 subprotocol 属于 `beforeConnect` 或 interceptor"，但子协议列表在会话开始前复制一次，`beforeConnect` 与 interceptor 都无法影响构造器收到的 protocols。
- Failure scenario: 读者按 `design.md` 在 `beforeConnect` 中刷新 token 并修改 protocols 来源数组，或在 WebSocket interceptor 中加入 token；握手仍用旧列表或不含 token，依赖 subprotocol 鉴权的服务端拒绝连接。
- Evidence: `design.md:237` 原文 "token 放进 subprotocol 属于 `beforeConnect` 或 interceptor，不属于 builder。"；`docs/web-socket.mdx:26` 原文 "the builder, `beforeConnect`, and interceptors cannot change them, so a token-in-subprotocol is passed as the execute `protocols` option for that call."。`web_socket.ts:417` 在 `run()` 启动前 `const baseProtocols = [...(protocolsOption ?? clientConfig.webSocket.protocols ?? endpoint.protocols ?? [])]`；`:574` 只以 `{ attempt, signal }` 调用 `beforeConnect` 且不读返回值；`:590` 始终返回 `baseProtocols`。`web_socket.server.spec.ts:430-447` "should snapshot configured protocols before beforeConnect mutates their source" 锁定 socket 仍用 `'snapshot-protocol'`（复核基线 305/305 中通过）。`design.md` 不在发布目录（`publishConfig.directory: "dist"`）；按 `_shared.md` §4 "A stale design.md statement is a valid P2 docs finding" 定级。
- Fix direction: 将 `design.md:237` 改为与 `web-socket.mdx:26` 一致：子协议只来自 execute `protocols`、`withWebSocketProtocols` 与定义，短期 token 在执行前取得并经该次 execute 的 `protocols` 传入。
- Tags: cross-partition（design.md 不在本分区清单）

#### F045

**CODE_OF_CONDUCT 举报渠道为空，执行流程不可用**

- 复核编号：P12-project-docs-02
- Verdict: CONFIRMED
- Severity: P2
- Category: docs
- Location: CODE_OF_CONDUCT.md:61-63
- Sources: P12-project-docs-codex-10, P12-project-docs-grok-05
- Summary: “reported to the community leaders responsible for enforcement at” 之后一行只有 `.`，全文没有任何邮箱、表单或私密渠道。
- Failure scenario: 遭遇骚扰的贡献者按准则举报，找不到受理方。紧接着的“保护举报者隐私”和分级处理条款都以这次举报为前提，因此全部无法执行。
- Evidence: `sed -n 58,68p CODE_OF_CONDUCT.md | cat -vet` 第 61-63 行为 `Instances of abusive, …may be$` / `reported to the community leaders responsible for enforcement at$` / `.$`。`grep -n '@\|mailto\|http' CODE_OF_CONDUCT.md` 只命中第 119-128 行的 contributor-covenant 和 mozilla 引用。`git show be554c00:CODE_OF_CONDUCT.md` 显示首次提交（2024-07-08）就是这个空占位。仓库里没有 SECURITY / CONTRIBUTING / SUPPORT 文件可作替代渠道。
- Fix direction: 由维护者填入实际可用、满足隐私承诺的私密渠道。不要猜测或编造联系人。
- Tags: —

#### F046

**abort 监听器回归测试只比次数，移除错误回调仍全绿**

- 复核编号：P05-core-tests-01
- Verdict: CONFIRMED
- Severity: P2
- Category: test
- Location: packages/core/test/regression/abort-listeners.spec.ts:15-27; packages/core/src/internal/abort.spec.ts:31-41; packages/core/src/internal/abort.ts:246; packages/core/src/internal/abort.ts:104
- Sources: P05-core-tests-codex-01
- Summary: `watch().expectReleased()` 和 `abort.spec.ts` 里的 merge 用例都只数调用次数，不核对被移除的回调是否就是加上的那个；监听器身份回归后，HTTP/SSE/WS 的清理契约实际上没有测试守护。
- Failure scenario: 有人把 `mergeAbortSignals` 的 `release()` 改成移除另一个函数，例如内联新闭包这种常见写法。之后每次带调用方 signal 的成功请求都会在这个长寿命 signal 上留下一个监听器；监听器又引用 combined controller，形成按请求数增长的泄漏。`abort.ts:112-115` 的 JSDoc 明确说要防止这种情况（"a caller's long-lived signal would otherwise hold every request that ever used it"）。CI 仍是绿的。
- Evidence:
  - `abort-listeners.spec.ts:20-22` 只做 `expect(add...filter(type==='abort')).toHaveLength(remove...filter(type==='abort').length)`。`abort.spec.ts:40` 的 merge 用例只有 `expect(remove).toHaveBeenCalledOnce()`。同文件 `:111` 的 deadline 用例用 `toHaveBeenCalledExactlyOnceWith('abort', add.mock.calls[0]?.[1])` 核对了身份。
  - 变异 m1：`abort.ts:246` 改为 `source.removeEventListener('abort', () => undefined)`，用 `scratch/probe.py` 跑完整 core-server。Bun 结果 `exit=0 total=1757 passed=1757 failed=0`，Node 结果相同。
  - 变异 m1b：`abort.ts:104`（`awaitWithSignal`）做同样改动，Bun 上 `exit=0 passed=1757`。
  - 对照变异 m1c：`abort.ts:152`（deadline）做同样改动，Bun 上 `exit=1`，失败的是 `abort.spec.ts > should remove its release listener when the deadline is released`。可见只有带身份断言的那一处被锁住。
  - 后果探针 `bun scratch/listener-repro.ts`：原代码输出 `{"activeAbortListenersAfterSuccess":0}` 和 `{"activeAfter1000":0}`；m1 变异下输出 `1` 和 `{"activeAfter1000":1000}`。
  - 所有变异都已经 `git checkout` 还原。
- Fix direction: `expectReleased()` 和 `abort.spec.ts` 的 merge 用例改成按 `(type, listener)` 成对核对（与 `:111` 的 deadline 用例写法一致）；或者在受控 signal 上维护活动监听器集合，断言结束后为空。
- Tags: cross-partition, runtime=both

#### F047

**WebSocket attempt 清理的两处移除无任何测试锁定**

- 复核编号：P03b-core-ws-03
- Verdict: CONFIRMED
- Severity: P2
- Category: test
- Location: packages/core/src/web_socket/web_socket.ts:640; packages/core/src/web_socket/web_socket.ts:654; packages/core/src/web_socket/web_socket.server.spec.ts:1115-1147; packages/core/src/web_socket/web_socket.lifecycle.spec.ts:22-33
- Sources: P03b-core-ws-codex-04, P03b-core-ws-grok-05
- Summary: 删除 `clearTimeout(errorCloseTimer)` 或 `signal.removeEventListener('abort', handleAbort)` 后，core-server 全部 1757 个测试在 Node 与 Bun 上仍全部通过，而这两处回归都会产生可观察的错误行为。
- Failure scenario: (a) `:640` 回归丢失：物理 socket 先 `error` 再在宽限期内 `close`，替换连接成功 open 后，旧的 1 s 计时器仍调用 `finish({ kind: 'error' })`，健康会话约 1 s 后变为 `error`。(b) `:654` 回归丢失：每个物理 attempt 的 `handleAbort` 闭包（持有旧 socket）留在会话内部合并 signal 上直到会话结束；3 次重连后存活 4 个。现有 `web_socket.server.spec.ts:1115-1147` 在替换连接 open 后只推进 0 ms 即手动关闭；`web_socket.lifecycle.spec.ts:22-33` 的源码正则只覆盖 message 监听器。
- Evidence: 复核者变异，每次后 `git checkout` 还原、`git status --short` 为空。删除 `:640` 或 `:654` 后运行完整 core-server 项目（`bunx vitest run --config vitest.config.ts --project core-server --coverage.enabled=false`，Bun 用 `bun --bun vitest`，无路径过滤）：`:640 node PROBE_EXIT=0 Tests 1757 passed`；`:640 bun PROBE_EXIT=0 Tests 1757 passed`；`:654 node PROBE_EXIT=0 Tests 1757 passed`；`:654 bun PROBE_EXIT=0 Tests 1757 passed`。同一变异下运行复核探针的两条行为断言：`:640` node/bun `PROBE OLDGRACE ... sockets=2 generation=2 stateAfter1100ms=error`（断言 'open' 失败，exit 1）；`:654` node/bun `PROBE ABORTLISTENERS ... sockets=4 state=open liveHandleAbort=4`（断言 1 失败，exit 1）；HEAD 上两者分别为 `open` 与 `1`。浏览器规格已阅读：`should reconnect in real browsers` 由服务端关闭触发、不经 error 事件、不跨 1 s 宽限期，同样无法发现 (a)。同轮扫描中 `:647`、`:650`、`:652`、`:653` 的变异被现有测试检出；`:645`、`:646`、`:648`、`:649`、`:838` 单行删除也存活，但各有冗余的同等清理路径（如 `:645` 与 `:838` 互为备份），不据此报告。
- Fix direction: 在现有 error→close→replacement 用例中推进超过 `SOCKET_CLOSE_GRACE_MS` 并断言会话仍 open；另加一条跨多次重连的用例，用 fake signal 或监听计数断言每个 attempt 结束后 `handleAbort` 已移除。
- Tags: runtime=both

#### F048

**SSE 退避参数测试只断言次数，去掉接线后仍全绿**

- 复核编号：P03a-core-sse-07
- Verdict: CONFIRMED
- Severity: P2
- Category: test
- Location: packages/core/src/sse/transport/event_stream.advanced.spec.ts:1355-1373; packages/core/src/sse/transport/event_stream.advanced.spec.ts:1393-1438; packages/core/src/sse/transport/event_stream.advanced.spec.ts:1440-1457; packages/core/src/sse/transport/event_stream.advanced.spec.ts:1459-1476; packages/core/src/sse/transport/event_stream.ts:464-470
- Sources: P03a-core-sse-codex-08, P03a-core-sse-grok-04
- Summary: `should use exponential backoff with factor`、`should cap delay with maxDelayMs`、`should apply jitter to retry delay` 三例只断言 `fetchCount`。`should clamp the final retry delay after applying a factor…` 的第一次重试指数为 0（`factor ** 0 === 1`），它断言的钳制值单靠 parser 的 `Math.min(…, 2_147_483_647)` 就能产生，因此也没有检验 factor。
- Failure scenario: 某次回归把 SSE 的 `factor`、`maxDelayMs`、`jitter` 接线全部丢掉，退避退化为常数延迟、无上限、无抖动，CI 依然全绿。
- Evidence:
  - 复核者变异探针，在 Node 26.11.1 和 Bun 1.4.3 上运行。每次之后都执行 `git checkout -- packages/core/src/sse/transport/event_stream.ts`，`git status --short` 为空。
  - M1：把 `:470` 改成 `computeReconnectDelay({ delayMs: 0, factor: 1, jitter: 0, maxDelayMs: 0 }, retryCount)`，只跑这四例。Node 和 Bun 都是 `1 failed | 3 passed | 112 skipped`：只有断言计时器值的钳制例失败，三个以退避参数命名的用例全部通过。
  - M2：只改成 `const factor = 1`，跑同样四例，结果 `4 passed | 112 skipped`，exit 0。
  - M3：`factor` 固定为 1、`maxDelayMs` 固定为 `+Infinity`、传入 `jitter: 0`，跑完整 core-server 项目。Node 为 `Test Files 90 passed (90)`、`Tests 1757 passed (1757)`，exit 0；Bun 同样 1757 passed，exit 0。
  - 在 `sse.spec.ts`、`sse.fault.spec.ts`、`sse.browser.spec.ts` 中 grep `factor|jitter|maxDelayMs` 无结果。`computeReconnectDelay` 只在 `web_socket/reconnect.spec.ts` 有单测，SSE 的参数接线没有任何保护。
  - `:1355` 的测试注释自己承认 "we verify attempts work"。
- Fix direction: 用 fake timers 断言每次重试的计划延迟：factor 为 2 时第二次长于第一次；`maxDelayMs: 5` 时恰为 5；固定 `Math.random` 后验证 jitter 确实生效。钳制用例改用指数 ≥ 1 的那次重试。原有的次数断言保留，作为预算检查。
- Tags: runtime=both

#### F049

**responseHook 先于 span 结束的测试检不出顺序倒置**

- 复核编号：P06-otel-server-04
- Verdict: CONFIRMED
- Severity: P2
- Category: test
- Location: packages/opentelemetry-server/src/interceptor/http.spec.ts:409-425, packages/opentelemetry-server/src/test-utils.ts:130-154, packages/opentelemetry-server/src/interceptor/http.ts:63-64
- Sources: P06-otel-server-codex-05（grok-03 的 Evidence 中也做了同样的变异）
- Summary: 该测试的 hook 是一个空的 `vi.fn()`，只断言它被调用过，以及拦截器返回后 `ended === true`。mock span 在 `end()` 之后仍然接受 `setAttribute`/`addEvent`，所以测试名声称锁定的顺序实际没有被锁定。
- Failure scenario: 有人把 `http.ts:63-64` 两行互换，变成先 `setSpanHttpResponse`（结束 span）再调 `responseHook`。真实 SDK 会丢弃同步 hook 写入的属性，但 CI 中整个 OTel 套件仍然通过。
- Evidence: 变异探针：用 python 互换 `http.ts:63-64`，运行整个套件 `bunx vitest run --config vitest.config.ts --coverage.enabled=false`，Node exit 0，`Test Files 11 passed`、`Tests 288 passed`（日志 `scratch/mutation-swap-node.log`）。随后 `git checkout -- packages/opentelemetry-server/src/interceptor/http.ts`（exit 0），`cmp` 与备份一致。真实 SDK 确实丢弃 span 结束后的写入，见 P06-otel-server-02 探针中的 `appAfter:null`。
- Fix direction: 在测试的 hook 内断言 `span.isRecording() === true`，或让 mock span 在 `end()` 后拒绝写入并断言 hook 写入的属性存在。重跑同一顺序变异，确认它会让测试失败。
- Tags: runtime=node

#### F050

**checkLinks 把无 index.html 的目录当作有效链接目标**

- 复核编号：P08-doc-site-02
- Verdict: CONFIRMED
- Severity: P2
- Category: correctness
- Location: doc/scripts/check-links.ts:41-44；doc/scripts/check-links.ts:46；doc/scripts/build.ts:13；doc/test/check-links.test.ts:6
- Sources: P08-doc-site-codex-03（grok 在 coverage 中称“本次产物未观察到”，已裁定）
- Summary: 目标路径不对应任何已解析的 HTML 页面时，检查器只做 `existsSync(path)`。目录满足 existsSync，于是被放行，同时也跳过了第 46 行的锚点校验。
- Failure scenario: 作者在 MDX 中写了一个很自然的链接，例如 `[Core API](/api/core)` 或 `/zh-Hans/docs/integrations`。这些目录因为有子页面而存在，但自身没有 index.html。构建门禁输出 "Documentation links verified"；上线后 GitHub Pages（不提供目录列表）和 `preview.ts` 都返回 404。`/api/core#anything` 这类锚点也不会被检查。
- Evidence:
  - 代码：`check-links.ts:41` 为 `const target = [path, resolve(path, 'index.html')].find((candidate) => pages.has(candidate))`；第 43-44 行为 `if (!existsSync(path)) failures.add(...)` 后直接 `continue`。
  - 夹具复现：`bun scratch/check-links-dir-probe.ts` exit 0，夹具是 `api/core/createclient/index.html` 加一个链接 `/api/core` 与 `/api/core#anything` 的页面。输出 `Documentation links verified across 2 generated pages` / `checker accepted /api/core and /api/core#anything (directory without index.html)`。对照组 `/api/nothing` 被正确拒绝。
  - 真实产物：`bun scratch/dir-links-probe.ts` exit 0，扫描 2257 页、388876 个同源链接。当前没有链接指向这类目录，但产物中有 231 个无 index.html 的目录，包括 11 个语言下的 `/api/core`、`/docs/integrations`，以及 `/api/search`。
  - `preview.ts`：本机 Bun 1.4.3 下 `Bun.file(<dir>).exists()` 为 false（已实测），因此目录请求落入 404。
  - GitHub Pages 不返回目录列表属于公知行为，本次未联网验证。
  - 现有 `check-links.test.ts` 没有“目录存在、入口缺失”的负例。HEAD 没有实际死链，因此定 P2。
- Fix direction: 非页面目标必须是普通文件（`statSync().isFile()`）；目录只有在存在 `index.html` 页面时才算有效。补一个“保留目录、移走入口”的负例，同时覆盖页面链接和锚点链接。
- Tags: runtime=bun

#### F051

**搜索索引首次加载失败后被永久缓存，搜索静默失效**

- 复核编号：P08-doc-site-01
- Verdict: CONFIRMED
- Severity: P2
- Category: correctness
- Location: doc/app/components/search.tsx:16；doc/node_modules/fumadocs-core/dist/search/client/orama-static.js:40-47（fumadocs-core@16.17.1）；doc/node_modules/fumadocs-core/dist/use-search-Dy8lBrbN.js:29-35；doc/node_modules/fumadocs-ui/dist/components/dialog/search.js:229,272
- Sources: P08-doc-site-codex-01
- Summary: 站点的 `useStaticSearch({ locale, from: \`/api/search/${locale}.json\` })` 依赖一个以 URL 为键的模块级 promise 缓存。加载失败后缓存项不会被删除，此后该语言的每次搜索都拿到同一个 rejected promise。
- Failure scenario: 读者第一次打开搜索时，`/api/search/en-US.json`（1.75 MB）返回 503，或移动网络中断，或 JSON 解析失败。网络恢复后，读者继续输入、关闭再打开弹窗、通过客户端路由换页，都不会再请求索引。弹窗不显示结果，也不显示 "No results found" 或任何错误：`error` 没有被渲染，`items` 为 null 时列表被隐藏。只有整页刷新或切换语言（换了缓存键）才能恢复。
- Evidence:
  - `orama-static.js:40-47` 为 `const cached = cache$1.get(cacheKey); if (cached) return cached; const result = loadDB(from, ...); cache$1.set(cacheKey, result); return result;`。没有任何 reject 分支删除该键。第 9-10 行在非 2xx 时 throw。
  - `use-search-Dy8lBrbN.js:29-35` 把错误写入 `state.error`。`dialog/search.js:229` 为 `const items = itemsProp === void 0 ? data?.items ?? defaultItems : itemsProp`，defaultItems 是 null；第 272 行在 `!items` 时加 `hidden`。dialog 源码中没有任何 `error` 渲染。
  - 复现：`bun scratch/search-failure-probe.mjs` 和 `node scratch/search-failure-probe.mjs` 均 exit 0。探针在本次构建的 en-US 索引上运行，直接调用安装依赖的 `staticClient`，只替换边界 `fetch`：第一次返回 503，之后返回真实索引。两个运行时输出相同：`{"searchesIncludingRemount":4,"requestsBeforeFreshKey":1,"errors":4,"sameRejectedPromise":true,"freshCacheKeyResults":60}`。
  - 探针改编自 codex 的同名脚本，已审读，只改了路径。
  - 触发需要首次索引请求失败，属于窄边界，因此定 P2。
- Fix direction: 首选在上游修复，reject 时 `cache.delete(from)`。也可以在 `search.tsx` 侧包装一个失败后可重试的加载器。补一条回归检查：首次失败、恢复后同一 URL 第二次成功。
- Tags: runtime=both, upstream=fumadocs-core@16.17.1, needs-browser（仅 UI 呈现部分；缓存语义已在引擎层复现）

#### F052

**API 索引筛选在 tr/az 默认区域下大写 I 漏匹配**

- 复核编号：P08-doc-site-03
- Verdict: PLAUSIBLE
- Severity: P2
- Category: correctness
- Location: doc/app/data/api-catalog.ts:11；doc/app/data/api-catalog.ts:14；doc/app/components/api-index.tsx:16；doc/test/api-catalog.test.ts:10
- Sources: P08-doc-site-grok-02
- Summary: 查询和条目名都按宿主默认区域做小写折叠。在按 ECMA-402 规范实现的引擎中，默认区域为 tr/az 时 U+0049 会折成 U+0131，大小写不一致的查询因此匹配不到。
- Failure scenario: Firefox 或 Safari 的界面区域为 tr-TR，用户在 API 索引中输入 `interceptor`，此时 `withInterceptors`、`createHttpInterceptor` 等条目会折成 `withınterceptors` 等形式而消失。输入 `CREATECLIENT` 时查询折成 `createclıent`，匹配不到 `createClient`。168 条目录中有 27 条名字含大写 I（`withInterceptors`、`Infer`、`StructInput`、`StructIssue`、`ERR_TIMEOUT`、`createHttpInterceptor` 等）。
- Evidence:
  - `api-catalog.ts:11` 为 `query.trim().toLocaleLowerCase()`，第 14 行为 `entry.name.toLocaleLowerCase().includes(normalized)`。
  - Node 26 / V8 在 `LC_ALL=tr_TR.UTF-8` 下的结果是 `["ı","I","İ","tr-TR"]`，分别对应 `'I'.toLocaleLowerCase([])`、`'i'.toLocaleUpperCase()`、`'i'.toLocaleUpperCase([])` 和默认区域。也就是说，按规范走默认区域的路径会折成 ı。但同一进程中无参数调用 `'I'.toLocaleLowerCase()` 返回 `"i"`，V8 对 undefined 有快速路径，所以 Chromium 不受影响。
  - ECMA-402 TransformCase 在未给 locales 时使用 DefaultLocale()。SpiderMonkey 和 JSC 按此实现，这一点是推断，未实测。
  - 本机 Bun（JSC）默认区域固定为 en-US，无法切换，`bun scratch/tr-fold.ts` 在 en-US 下全部命中。grok 的复现是猴补 `toLocaleLowerCase` 强制 'tr'，只能证明折叠规则本身。
  - 现有单测的查询是 `CREATE`，不含 I；e2e `site.test.ts:82` 虽用 `CREATECLIENT`，但运行在 en 区域。两者都抓不到这个问题。
- Fix direction: 改用不依赖区域的 `toLowerCase()`，或显式传入 `'en-US'`。补一条查询含 `I`、条目含小写 `i` 的用例，例如在测试中直接调用 `toLocaleLowerCase('tr')` 的对照。
- Tags: needs-browser（确认方式：在 tr-TR 界面区域的 Firefox 或 Safari 中打开 `/api` 输入 `interceptor`，期望 `withInterceptors` 消失）

### P3

#### F053

**多处文档把已声明 body 一律视为 JSON 检查与解析**

- 复核编号：P09b-doc-api-04（合并：P09a-doc-guides-03）
- Verdict: CONFIRMED
- Severity: P3
- Category: docs
- Location: doc/content/en-US/api/opentelemetry-server.mdx:99; packages/core/src/http/transport/fetch.ts:273; packages/core/src/internal/inbound_representation.ts:16; packages/opentelemetry-server/src/interceptor/http.ts:72; doc/content/en-US/docs/integrations/opentelemetry-server.mdx:164; packages/opentelemetry-server/README.md:95; doc/content/en-US/docs/errors.mdx:90-92; doc/content/en-US/docs/design-decisions.mdx:104-106; doc/content/en-US/docs/integrations/opentelemetry-server.mdx:71; packages/opentelemetry-server/README.md:273
- Sources: P09b-doc-api-codex-05
- Summary: 页面说声明的 `output` / `error` body 只要媒体类型不是 JSON 就记一条 WARN，不论状态码。实际上媒体类型检查只在声明选择了 JSON representation 时执行；`struct.string()`、blob/file、arrayBuffer 声明会正常读取非 JSON 正文，不会记日志。
- Failure scenario: 声明 `output: struct.string()`，服务器返回 200 `text/plain`；或声明 `error: struct.string()`，服务器返回 404 `text/plain`。按页面描述应有 WARN，实际 LogRecord 数为 0。如果运维按这段文字配置告警或排障，会得到错误预期。
- Evidence: 页面原文是 “as does a declared `output` / `error` body whose media type is not JSON, whose read fails, or whose JSON does not parse, whatever the HTTP status”。`inbound_representation.ts:16` 对 `string` 返回 `'text'`；`fetch.ts:273` 只在 `response.body && responseType === 'json' && !isJsonMediaType(contentType)` 时抛 `BodyFailure`；OTel 拦截器只在 `next` reject 时于 `http.ts:72` 调用 `emitClientException`。复核探针 `/tmp/zen-audit/verified/P09b-doc-api/scratch/otel-nonjson.mjs` 使用新构建的 core 和 otel dist，Bun 与 Node 都 exit 0，输出相同：
  ```text
  text output; content-type=text/plain; fault=null; value=hello; logs=0
  text error; content-type=text/plain; fault=HTTP_STATUS; value=undefined; logs=0
  json output; content-type=text/plain; fault=RES_MEDIA_TYPE_INVALID; value=undefined; logs=1
  ```
  JSON 对照组证明注入的 logger 工作正常。定级理由：从 P2 降为 P3。实际行为正确，文档多承诺的日志对应的是合法的成功读取，不会掩盖真实故障。
- Fix direction: 把“媒体类型不是 JSON”和“JSON 解析失败”两个条件限定为声明选择 JSON representation 的情况，保留“读取失败”这一通用条件；指南和 OTel README 的同一句一起改。
- Tags: cross-partition（`docs/integrations/opentelemetry-server.mdx:164` 属 P09a，`packages/opentelemetry-server/README.md:95` 属 P12）, runtime=both

<details><summary>合并项 P09a-doc-guides-03 的复核记录</summary>

##### P09a-doc-guides-03 Errors / Design decisions 称内置 Fetch 对每个已声明 body 都做 JSON 解析，拦截器实际看到原始 text/Blob/bytes

- Verdict: CONFIRMED
- Severity: P3
- Category: docs
- Location: doc/content/en-US/docs/errors.mdx:90-92; doc/content/en-US/docs/design-decisions.mdx:104-106; packages/core/src/http/transport/fetch.ts:273; doc/content/en-US/docs/http.mdx:118-123
- Sources: P09a-doc-guides-grok-02（非 OTel 部分；OTel 部分并入 P09b-doc-api-04，见 rejected）
- Summary: 两处写道 "The built-in Fetch transport already reads and JSON-parses a declared body … so interceptors see that parsed `body`"。实际上只有 JSON representation 会做媒体类型检查和 JSON 解析；`struct.string()`、blob/file、arrayBuffer 声明会把原始值交给拦截器。
- Failure scenario: 一个作用于整个 transport 的拦截器作者按这两页，假定链上的 `response.body` 都是已解析的 JSON 值，例如解包 `response.body.data`。对于 `output: struct.string()` 的命令，它拿到的是原始字符串（`text/html` 下为 `<p>hi</p>`，`application/json` 下为带引号的 `"hi"`），相关逻辑会静默出错。
- Evidence:
  - 实现：`fetch.ts:273` 为 `if (response.body && responseType === 'json' && !isJsonMediaType(contentType))`，媒体类型检查只对 JSON representation 生效。
  - 权威描述 `http.mdx:118-123`："interceptors receive a response whose `body` is already the parsed JSON, text, `Blob`, or bytes"。
  - 复现（probe.mjs，Bun/Node 一致，exit 0）：
    `STRING_OUTPUT {"contentType":"text/html","fault":null,"data":"<p>hi</p>","chainSaw":{"type":"string","body":"<p>hi</p>"}}`
    `STRING_OUTPUT {"contentType":"application/json","fault":null,"data":"\"hi\"","chainSaw":{"type":"string","body":"\"hi\""}}`
  - 定级说明：审计者报 P2，此处降为 P3。HTTP 指南已写对；错误只出现在两段摘要中。与 P09b-doc-api-04 的定级一致。
- Fix direction: 把两段改为与 `http.mdx:118-123` 相同的表示种类说法：JSON representation 做媒体类型检查和解析，text/blob/bytes 原样交给拦截器。
- Tags: related P09b-doc-api-04（同一"已声明 body 等于 JSON"误写，OTel 侧），runtime=both

</details>

#### F054

**OTel 文档称 execute timeout 总记一条日志，链外超时不记**

- 复核编号：P12-project-docs-03
- Verdict: CONFIRMED
- Severity: P3
- Category: docs
- Location: packages/opentelemetry-server/README.md:95; doc/content/en-US/api/opentelemetry-server.mdx:99; packages/core/src/http/http.ts:247-249; packages/core/src/http/http.ts:300-303; packages/core/src/http/http.ts:372; packages/core/src/http/http.ts:436-441; packages/opentelemetry-server/src/interceptor/http.ts:70-73
- Sources: P12-project-docs-codex-03
- Summary: Core 的 deadline 覆盖 parse、builder、整个拦截器链以及链后的声明体转换，而 OTel 只在 `next` reject 时记录日志。因此 timeout 落在 transport 之外时，命令返回 `NET_TIMEOUT`，却没有 LogRecord。
- Failure scenario: 应用拦截器在 `await next(req)` 之后还有异步工作（例如审计写入），execute 设了 `timeout: 20`，服务器立即返回 204。命令得到 `NET_TIMEOUT`，OTel 记 0 条日志，与 OTel 拦截器排在前面还是后面无关。builder/parse 超时或链后 struct 转换超时也一样。按 README 用 timeout 日志计数或告警的运维会漏掉这些 timeout。
- Evidence:
  - README:95 原文 “An execute timeout is a transport rejection and logs once.”；API:99 写 “An HTTP execute timeout is a rejection and logs once”。
  - 源码：`http.ts:247` 注释写 “The deadline covers parse, the builder, the transport, and declared-body conversion”；`:300-303` 在拦截器之前就可能返回；`:372` 用 `awaitWithSignal(() => chainPromise, requestSignal)` 等待整条链；`:436-441` 在链结束后转换时再检查一次 deadline。OTel `interceptor/http.ts:70-73` 只在 `next` 的 catch 中调用 `emitClientException`。
  - 本人探针 `scratch/timeout-after-next.ts`（真实计时器；`bun --tsconfig-override REPO/tsconfig.json …`，以及 `bun build --target=node` 后用 `node` 运行），Bun 1.4.3 与 Node 26.11.1 都 exit 0，均输出 `{"order":"otel-first","fault":"NET_TIMEOUT","logs":0}` 和 `{"order":"app-first","fault":"NET_TIMEOUT","logs":0}`，判定前另外等待了 80ms。
  - 对照 `scratch/timeout-control.ts`：transport 内超时得到 `{"fault":"NET_TIMEOUT","logs":1}`，两个运行时一致，说明 logger 本身正常。
  - 复跑 codex 的 `integration-probes.ts`（路径改到本 clone，用 Date.now 模拟同步耗时）：`post_interceptor_conversion_timeout … logs:0` 和 `pre_interceptor_builder_timeout … logs:0, handleCalls:0`，两个运行时一致。
  - 定级：codex 报 P2，此处降为 P3。README 的 “Transport span boundary” 一节已经说明 span 只反映 transport，并建议在 `client.execute` 外包一层应用 span；业务结果不受影响。与 P09b-doc-api-04（同一段的另一处过度承诺）定级一致。
- Fix direction: 改为“在拦截器链 / transport 中观察到的 timeout rejection 记一条”，并说明 builder/parse 阶段、`next()` 之后的拦截器工作以及链后转换中的超时不会记录，需要由外层命令观测。
- Tags: cross-partition（API 页属 P09b）, runtime=both

#### F055

**简中与港繁 OTel 页把“已声明 body 缺失”译成“未声明”**

- 复核编号：P10a-i18n-cjk-01
- Verdict: CONFIRMED
- Severity: P3（复核定级 P2，终审调整）
- Category: i18n
- Location: doc/content/zh-Hans/docs/integrations/opentelemetry-server.mdx:71；doc/content/zh-Hans/docs/integrations/opentelemetry-server.mdx:169；doc/content/zh-Hant-HK/docs/integrations/opentelemetry-server.mdx:71；doc/content/zh-Hant-HK/docs/integrations/opentelemetry-server.mdx:169；对照 doc/content/en-US/docs/integrations/opentelemetry-server.mdx:71、169；运行时依据 packages/core/src/http/http.ts:487-504、packages/opentelemetry-server/src/interceptor/http.ts:58-79
- Sources: P10a-i18n-cjk-codex-01、P10a-i18n-cjk-codex-02（grok 未报，属于漏报）
- Summary: en-US 说"已声明 body 缺失（例如 204）"的失败发生在 interceptor 之后、不记日志；简中和港繁都译成"未声明 body"，把"已声明"这个限定条件反了过来，并且与同段"未声明的 body 不会被读取"一句自相矛盾。
- Failure scenario: 读者给 GET 声明了 JSON `output`，服务端返回无 body 的 204。命令得到 `RES_DECODE_FAILED`，OTel interceptor 正常返回，span 不是 `BodyFailure`，日志 0 条。按简中/港繁译文，读者会以为这条例外只针对"未声明 body"，进而把表格中"声明 body 读取失败 → 一条 WARN"套用到 204 上，误以为这个 fault 能在 OTel 日志里看到。
- Evidence:
  - en-US:71："Only Struct validation (`RES_STRUCT_MISMATCH`), an absent declared body (for example 204) and the `HTTP_STATUS` conversion happen afterwards…"；en-US:169："A body that is not declared is never read and cannot log. Only Struct validation (`RES_STRUCT_MISMATCH`), an absent declared body such as 204, and the `HTTP_STATUS` conversion happen after the interceptor and do not log."
  - zh-Hans:71："只有 Struct 校验（`RES_STRUCT_MISMATCH`）、未声明 body 的情况（例如 204）和 `HTTP_STATUS` 转换发生在之后…"。回译："an undeclared body (e.g. 204)"。zh-Hans:169 先说"未声明的 body 不会被读取，也就不会产生日志"，紧接着又写"只有…未声明 body 的情况（例如 204）…发生在 interceptor 之后"。
  - zh-Hant-HK:71/169："只有 Struct 驗證（`RES_STRUCT_MISMATCH`）、冇聲明 body（例如 204）同 `HTTP_STATUS` 轉換…"。回译："not-declared body (e.g. 204)"。同一段前一句是"冇聲明嘅 body 永遠唔會被讀"，读者只会理解为同一个概念。
  - 其他 locale 译对了：zh-Hant-TW 为"已宣告的 body 不存在（例如 204）"，ja-JP 为"宣言されたボディが無い場合"，ko-KR 为"선언된 body의 부재"。
  - 代码依据：`http.ts:421-432` 处理未声明的一侧时直接结束，不读 body，不可能出现"body 缺失后置失败"；`http.ts:499-503` 中 `if (absent) { … throw new TypeError('Response body is absent') }` 发生在 interceptor 返回之后，并在 `http.ts:456` 转成 `RES_DECODE_FAILED`；OTel `interceptor/http.ts:59-69` 拿到 response 后正常返回，只有 `:73` 的 catch 分支才 emit 日志。
  - 复现：先在本 clone 执行 `cd packages/core && bun --bun run build`（exit 0）和 `cd packages/opentelemetry-server && bun --bun run build`（exit 0）；然后把 codex 的 `absent-body.mjs` 改指向本 clone，存为 `/tmp/zen-audit/verified/P10a-i18n-cjk/scratch/absent-body.mjs`，运行 `bun absent-body.mjs`（exit 0）和 `node absent-body.mjs`（exit 0），每个场景 2 个断言，共 6 个，全部通过。关键输出：`{"runtime":"Bun 1.4.3","case":"declared output, absent body (204)","fault":"RES_DECODE_FAILED","logs":0,"steps":["interceptor returned status=204, body=undefined"]}`，Node 26.11.1 结果相同；对照组"已声明 + 200 畸形 JSON"为 `RES_DECODE_FAILED`，`logs:1`。
  - 定级 P2 而非 P1：错误只影响可观测性文档对一个窄例外的描述，不会让用户写出错误代码；但它确实把技术条件反转了，符合 brief 中"改变技术含义 → P2"的规定。
- Fix direction: 两个 locale 的第 71、169 行都改成"已声明的 body 缺失（例如 204）"，可参照 zh-Hant-TW 的"已宣告的 body 不存在"；运行时无需改动。
- Tags: runtime=both

#### F056

**解码结果表对 SSE 握手 error struct 失配不成立**

- 复核编号：P09a-doc-guides-02
- Verdict: CONFIRMED
- Severity: P3
- Category: docs
- Location: doc/content/en-US/docs/errors.mdx:79-81; doc/content/en-US/docs/errors.mdx:133-135; doc/content/en-US/docs/design-decisions.mdx:111-115; doc/content/en-US/docs/design-decisions.mdx:146; packages/core/src/sse/transport/event_stream.ts:596-606; packages/core/src/sse/sse.spec.ts:1158; packages/core/design.md:212; packages/opentelemetry-server/README.md:97
- Sources: P09a-doc-guides-grok-01
- Summary: 两张表无传输限定地写 "The value is not that struct → `RES_STRUCT_MISMATCH`"。SSE 握手中，已声明 `error` struct 的 JSON body 形状不符时，公开码是 `RES_DECODE_FAILED`（cause 为 `StructError`）。
- Failure scenario: `defineEventStream({ …, error: struct.object({ reason: struct.string() }) })`，服务端返回 403、`application/json`、`{"reason":1}`。按表写 `fault.code === 'RES_STRUCT_MISMATCH'` 的分支不会命中，实际得到 `RES_DECODE_FAILED`。同形状的 HTTP `error` 则是 `RES_STRUCT_MISMATCH`。
- Evidence:
  - 实现：`event_stream.ts:596-606` 中 `try { … decodeJson(handshakeError, raw) … } catch (error) { … throw new EventStreamFatalError('RES_DECODE_FAILED', …, { cause: error }) }`，注释为 "a declared handshake body that cannot be read is RES_DECODE_FAILED"。
  - 该行为由测试锁定：`sse.spec.ts:1158` 'should report a declared handshake body that fails its struct as RES_DECODE_FAILED'。
  - 文档：`errors.mdx:81` 与 `design-decisions.mdx:115` 未限定传输；`errors.mdx:133-135` 的 SSE 专节只列 non-2xx、媒体类型和缺 body 三种情况；`design-decisions.mdx:146` 称 SSE 握手 body "follows the same kind rule as an HTTP body"。
  - `sse.mdx:32`（"a body that cannot be read as the declared kind is `RES_DECODE_FAILED`"）只能算部分覆盖。
  - 复现（probe.mjs，Bun/Node 一致，exit 0）：
    `HTTP_ERROR_SHAPE {"code":"RES_STRUCT_MISMATCH","status":403,"cause":"StructError"}`
    `SSE_HANDSHAKE_SHAPE {"code":"RES_DECODE_FAILED","status":403,"cause":"StructError","stream":null}`
  - 定级说明：审计者报 P2，此处降为 P3。理由：行为是有意设计且被测试锁定；SSE 指南 `:32` 已大致说明；类前缀同为 `RES`，cause 仍是 `StructError`；命中面仅限"SSE + 声明 error struct + JSON 可解析但形状不符"。
- Fix direction: 在两张表注明 `RES_STRUCT_MISMATCH` 仅适用于 HTTP；在 errors.mdx 的 SSE 专节补一行"声明的握手 body 解析或 struct 失败 → `RES_DECODE_FAILED`，`StructError` 在 cause"。
- Tags: cross-partition（行为在 P03a），runtime=both

#### F057

**withTimeout JSDoc 仍写不存在的 ABORTED/TIMEOUT**

- 复核编号：P02-core-http-client-10
- Verdict: CONFIRMED
- Severity: P3
- Category: docs
- Location: packages/core/src/client/option.ts:49, packages/core/src/error/types.ts:31, packages/core/src/error/types.ts:33, doc/content/en-US/api/core/withtimeout.mdx:17
- Sources: P02-core-http-client-codex-07, P02-core-http-client-grok-08
- Summary: `option.ts:49` 写的是 “abort → `ABORTED`, timer → `TIMEOUT`”，但 `FaultCode` 里只有 `NET_ABORTED`/`NET_TIMEOUT`。
- Failure scenario: JS 使用者按 IDE 悬停文档写 `fault.code === 'TIMEOUT'`，这个分支永远不会命中。
- Evidence:
  - `option.ts:49` 原文如上。
  - `error/types.ts:23-40` 的闭集不含这两个码。
  - `withtimeout.mdx:17` 写的是正确的 `NET_*`。
  - 在本分区非 spec 源码里 grep，旧码只出现这一处。
  - 由 P2 降为 P3：API 页是正确的；TypeScript 用户与闭集字面量比较会直接报类型错误，只有 JS 用户会被误导。
- Fix direction: 删除 `ABORTED`/`TIMEOUT`，替换为 `NET_ABORTED`/`NET_TIMEOUT`。

#### F058

**struct.object 页称 .alias 按 wire key 读取**

- 复核编号：P09b-doc-api-02
- Verdict: CONFIRMED
- Severity: P3
- Category: docs
- Location: doc/content/en-US/api/core/struct-object.mdx:16
- Sources: P09b-doc-api-grok-01
- Summary: 对象页写的是 “`.alias(name)` reads and writes the field under a different wire key.”。但默认 `struct.parse` 按逻辑名读取，只有 `{ aliases: true }` 和 HTTP/JSON 编解码才读 wire key。
- Failure scenario: 读者按对象页定义 `struct.object({ displayName: struct.string().alias('display_name') })`，再调用 `struct.parse(User, { display_name: 'Ada' })`，结果是 `missing_key`，path 为 `displayName`。
- Evidence: 复核探针 `/tmp/zen-audit/verified/P09b-doc-api/scratch/alias-default.mjs`，Bun 和 Node 都 exit 0：
  ```text
  bun 1.4.3 default: [ [ "missing_key", "displayName" ] ] undefined | aliases:true: null {"displayName":"Ada"}
  node 26.11.1 default: [ [ 'missing_key', 'displayName' ] ] undefined | aliases:true: null {"displayName":"Ada"}
  ```
  同一分区内其他页面写对了：`struct-parse.mdx:18`（“`options.aliases` defaults to `false`: object keys are read by their **logical** names”）、`structmethods-type.mdx:20`、`api/struct.md:53`。定级理由：从 P2 降为 P3。这句话在 wire 语境下成立，算误导而不是明确写错；正在调用的 `struct.parse` 页写对了；失败会立刻以带 path 的 `missing_key` 暴露，不会静默出错。
- Fix direction: 把该句改成和 `StructMethods` 页相同的表述：`.alias(name)` 设置 wire key，`struct.parse` 默认读逻辑名，`{ aliases: true }` 和 JSON 编解码才读 wire key。
- Tags: runtime=both

#### F059

**HttpRequestShape.body 在模块页误写为 unknown**

- 复核编号：P09b-doc-api-03
- Verdict: CONFIRMED
- Severity: P3
- Category: docs
- Location: doc/content/en-US/api/http.mdx:160; doc/content/en-US/api/core/httprequestshape-type.mdx:10; packages/core/src/internal/builder_types.ts:53
- Sources: P09b-doc-api-codex-04, P09b-doc-api-grok-02
- Summary: 同一个 `HttpRequestShape`，模块页写的是 `body?: Uppercase<M> extends 'GET' | 'HEAD' ? never : unknown`；符号页和源码是 `... ? never : BodyValue`，后者是受限的 wire/JSON 值联合。
- Failure scenario: 读者按模块页写一个接受 `unknown` 并返回 `{ body: value }` 的 POST builder 辅助函数，以为任意值都可以当 body；class 或 `interface` 实例不展开就传入。实际导入的 `HttpRequestShape<'/items', 'POST'>` 会报 TS2322。
- Evidence: `http.mdx:160` 原文为 `body?: Uppercase<M> extends 'GET' | 'HEAD' ? never : unknown`；`builder_types.ts:53` 为 `body?: Uppercase<M> extends 'GET' | 'HEAD' ? never : BodyValue`，`BodyValue` 定义在 `builder_types.ts:30-40`。复核 `node_modules/.bin/tsc -p /tmp/zen-audit/verified/P09b-doc-api/scratch/tsconfig.body.json --pretty false`，基于新构建的 dist，exit 1，唯一诊断是 `http-body-signature.ts(8,12): error TS2322: Type 'unknown' is not assignable to type 'BodyValue | undefined'.`；同文件按文档写的 `{ body?: unknown }` 版本没有报错。定级理由：从 P2 降为 P3。规范符号页写对了，偏差在编译期就会被发现，不会造成运行时错误；这与 P02-core-http-client-10（API 页正确、旁路描述错误）的 P3 定级一致。
- Fix direction: 模块页改用 `BodyValue` 并链接到符号页的取值说明，或者删掉这段手写签名，只链接 `HttpRequestShape` 符号页。

#### F060

**OTel README 把 server.port 列为必记属性**

- 复核编号：P12-project-docs-04
- Verdict: CONFIRMED
- Severity: P3
- Category: docs
- Location: packages/opentelemetry-server/README.md:230-232; packages/opentelemetry-server/README.md:267; packages/opentelemetry-server/src/telemetry/url.ts:22; packages/opentelemetry-server/src/interceptor/http.ts:39; packages/opentelemetry-server/src/telemetry/metrics.ts:112-114
- Sources: P06 verifier 侧注（审计员均未单独立项）
- Summary: README 的 span 属性列表无条件写着 `server.port`。指标表把 `defjs.operation`、`http.response.status_code`、`error.type` 标为 optional，`server.port` 却没有标。实现对默认端口（如 `https://host`、`https://host:443`、`http://host`）不写这个属性。
- Failure scenario: 应用 endpoint 是 `https://api.example.com`，运维按 README 用 `server.port` 做仪表盘分组或告警维度，结果 span 和 `http.client.request.duration` 上都没有这个属性。
- Evidence:
  - `url.ts:22` 为 `serverPort: Number.parseInt(parsed.port) || undefined`（WHATWG URL 对默认端口返回 `''`）；`http.ts:39` 为 `...(serverPort ? { 'server.port': serverPort } : {})`；`metrics.ts:112-114` 为 `if (serverPort) { attributes['server.port'] = serverPort }`。
  - 现有测试 `http.spec.ts:536` “should set server.address and server.port from URL” 只断言 `server.address`；`:545` 只在 `:8443` 时断言端口。
  - API 页 `api/opentelemetry-server.mdx:91` 写的是 “`server.port` (when known)”，集成指南 :99 写的是 “server address/port when available”，与实现一致。README 是唯一的例外。
  - 本人探针 `scratch/server-port-probe.ts` 在 Bun 和 Node 下都 exit 0：`https://api.example.com`、`https://api.example.com:443`、`http://api.example.com` 的 `server.port` 均为 `null`，`https://api.example.com:8443` 为 `8443`。
- Fix direction: 在 README:232 注明 “only when the URL has an explicit non-default port”，并在 :267 指标表中把 `server.port` 标为 optional，与 API 页保持一致。
- Tags: runtime=both

#### F061

**Errors 指南称 data.status 通过 struct 即证明来自后端**

- 复核编号：P09a-doc-guides-04
- Verdict: CONFIRMED
- Severity: P3
- Category: docs
- Location: doc/content/en-US/docs/errors.mdx:124-126; packages/core/src/http/http.ts:436; packages/core/src/http/http.ts:462-467
- Sources: P09a-doc-guides-codex-02
- Summary: struct 校验只证明 body 形状符合声明，不能证明来源。网关、代理或 CDN 生成的同形状 body 同样能通过。
- Failure scenario: 网关未访问后端，直接返回 502 和 `{"status":429,"retryAfter":5}`，与 `narrow-by-status.ts` 的 discriminated union 匹配。调用方得到 `HTTP_STATUS`，其中 `fault.data.status === 429`。读者若按文档把它当作已证实来自后端的限流信号，就会信任一个由中间层生成的值。
- Evidence:
  - 原文："`fault.status` is the HTTP-layer number, which a proxy, gateway, or CDN can rewrite; `data.status` was decoded from the body your `error` struct asserted, so reaching it is proof the backend produced it."
  - 实现中没有任何来源校验：`http.ts:436` 只调用 `decodeDeclaredBody(struct, settledResponse, requestSignal)`，`:466` 处 `const decodedResponse = { ...meta, body: decoded }`，`:467` 处 `return fail(createHttpStatusFault(decodedResponse))`。
  - 复现（probe.mjs，Bun/Node 一致）：`PROVENANCE {"code":"HTTP_STATUS","status":502,"dataStatus":429,"backendCalls":0}`。
  - 定级说明：审计者报 P2，此处降为 P3。文档的建议本身（优先用 body 判别）仍然合理，错误只在"proof"这一来源断言；不涉及库的安全边界。
- Fix direction: 把 "so reaching it is proof the backend produced it" 改为"它通过了你声明的 error struct 校验"，同时提醒中间层也可能生成匹配形状的 body。
- Tags: runtime=both

#### F062

**send 内同步派发的心跳 ACK 被随后新建的超时覆盖**

- 复核编号：P03b-core-ws-07
- Verdict: CONFIRMED
- Severity: P3
- Category: correctness
- Location: packages/core/src/web_socket/heartbeat.ts:69; packages/core/src/web_socket/heartbeat.ts:78-82; packages/core/src/web_socket/heartbeat.ts:37-40; packages/core/src/web_socket/web_socket.ts:758-766
- Sources: P03b-core-ws-codex-03
- Summary: 心跳在 `socket.send(serialized)` 返回后才创建 `ackTimer`；若 handle 在 `send` 内同步派发 ACK，`markAck()` 清除的是尚不存在的计时器，随后新建的超时仍把健康会话判为 error。
- Failure scenario: 注入在 `send` 中同步回送 `"pong"` 的 handle（典型为进程内回环测试替身），`heartbeat: { intervalMs: 5, timeoutMs: 10, message: () => 'ping', isAck: (m) => m === 'pong' }`；`isAck` 被调用一次并返回 true，10 ms 后 `closed` 为 `{ kind: 'error', cause: Error('WebSocket heartbeat timeout') }`。
- Evidence: `heartbeat.ts:69` `socket.send(serialized)`；字符串帧在 `web_socket.ts:743` 同步解码，`:760-765` 同一调用栈执行 `heartbeat.markAck()`，`heartbeat.ts:37-39` 此时 `ackTimer` 为 undefined；send 返回后 `:78-81` 新建超时。复核探针：`PROBE SYNCACK node=26.11.1 acks=1 sent=1 closed=error cause=WebSocket heartbeat timeout`；bun=1.4.3 相同。定级说明（codex 报 P2，降为 P3）：平台 WebSocket 的 message 事件按任务异步派发，浏览器、undici、Bun、`ws` 都不会在 send 内同步回送，触发限于自定义同步替身，且在首个心跳周期即确定性暴露。
- Fix direction: 在 send 之前建立该周期的 ACK 截止期（send 抛错时清除），或用周期序号记录 "本周期已确认"，避免为已确认周期重新计时。
- Tags: runtime=both

#### F063

**injectClient() 在注入上下文外报错时误称未安装插件**

- 复核编号：P07-react-vue-01
- Verdict: CONFIRMED
- Severity: P3
- Category: correctness
- Location: packages/vue/src/core.ts:44-48（主）；packages/vue/src/core.ts:37（JSDoc `@throws If no client was provided (plugin not installed)`）；packages/vue/test/core.spec.ts:16-18、packages/vue/src/core.browser.spec.ts:284-303（只锁定“未安装插件”这一条路径）
- Sources: P07-react-vue-grok-01（codex 在 coverage.md 的 H3 中判为“非适配器错误”，争议在此裁定）
- Summary: `injectClient()` 只要拿到 `inject(HTTP_CLIENT)` 返回的 `undefined` 就抛同一句话，因此“插件已装，只是调用时不在注入上下文”也会被说成“忘记调用 `app.use(createClientPlugin(client))`”。
- Failure scenario: 应用已经执行 `app.use(createClientPlugin(client))`，但以下三种写法会在注入上下文外调用 `injectClient()`：手写的 `async setup() { await x; injectClient() }`；在事件处理函数、watch 回调或挂载后的回调里调用；在模块作用域里调用。这时 Vue 的 `inject()` 返回 `undefined`，适配器抛出“Did you forget to call app.use(createClientPlugin(client))?”。开发构建会同时打印 Vue 自己的正确警告；生产构建删掉了这条警告，线上错误报告里只剩这句会把排查引向错误方向的文案。
  - 以下写法不受影响：同步的 `setup()`；`<script setup>` 顶层 `await` 之后（编译器会用 `withAsyncContext` 恢复实例）；`app.runWithContext(() => injectClient())`。
- Evidence: 源码 `packages/vue/src/core.ts:44-48`：
  ```ts
  export function injectClient(): Client {
    const client = inject(HTTP_CLIENT)
    if (!client) {
      throw new Error('No Defjs client provided. Did you forget to call app.use(createClientPlugin(client))?')
    }
  ```
  本人 probe 为 `/tmp/zen-audit/verified/P07-react-vue/scratch/vue-context-probe.mjs`。运行时复制到 `packages/vue/.audit-tmp/`，用完已删除。环境为 Vue 3.5.43、Bun 1.4.3、Node 26.11.1，每种模式都在 Bun 和 Node、开发和 `NODE_ENV=production` 下运行。
  - `outside`（插件已装，在组件外调用）：Bun 和 Node 结果一致，均为 `"thrown":"No Defjs client provided. Did you forget to call app.use(createClientPlugin(client))?","blamesPlugin":true,"inRunWithContext":true`。开发构建的 `warnings` 是 `["[Vue warn]: inject() can only be used inside setup() or functional components."]`，生产构建是 `[]`。
  - `asyncAfter`（手写 `async setup`，`await` 之后调用）：两个运行时、两种构建下的 SSR HTML 都是 `<p>No Defjs client provided. Did you forget to call app.use(createClientPlugin(client))?</p>`。
  - `scriptSetupAwait`（用 `vue/compiler-sfc` 真实编译的 `<script setup>`，顶层 `await` 之后调用）：两个运行时、两种构建下都是 `<p>APP</p>`，无警告。
  - `sync`：`<p>APP</p>`。
  - React 一侧对照（`scratch/react-context-probe.mjs`，Bun 和 Node 各退出 0）：在组件外调用 `useClient()`，React 先打印 “Invalid hook call”，再抛出 `dispatcher.useContext` 相关的 TypeError，`outsideIsAdapterMessage:false`。React 不会走到适配器文案，所以这个问题只存在于 Vue。
  - 定为 P3 的理由：支持的用法（同步 setup、`<script setup>`）行为正确；开发构建下 Vue 会给出正确诊断；契约文档 `doc/content/en-US/api/vue/injectclient.mdx:12` 已要求在允许调用 `inject` 的位置使用。问题仅在于误用时、尤其是生产环境下，错误信息的诊断质量。
- Fix direction: 把单一原因的错误文案改成同时点明两种原因，例如“必须在 setup() 中同步调用，并确认已安装插件或执行了 `provide(HTTP_CLIENT, …)`”，同步修改 JSDoc 的 `(plugin not installed)`。不要直接引入 `hasInjectionContext()`：v3.0.0 的 `apiInject.ts` 中没有这个函数，用它会破坏声明的 `vue >=3.0.0` peer 范围，除非同时提高最低版本。
- Tags: runtime=both

#### F064

**Struct README 四条文档链接失效，构造器表行重复**

- 复核编号：P01-core-struct-08
- Verdict: CONFIRMED
- Severity: P3
- Category: docs
- Location: packages/core/src/struct/README.md:383; packages/core/src/struct/README.md:392-393; packages/core/src/struct/README.md:56; packages/core/src/struct/README.md:60
- Sources: P01-core-struct-codex-09, P01-core-struct-grok-06
- Summary: README 仍然链接 `../../../../doc/core/{http,errors,struct,commands}.md`，这些文件在 Fumadocs 重建后已不存在。另外，构造器表第 56 行和第 60 行都是"二进制值 | `blob`、`file`、`arrayBuffer`"。
- Failure scenario: 读者在这份源码契约 README 里点击"HTTP 文档""错误文档"、`doc/core/struct.md` 或 `doc/core/commands.md`，都会打开不存在的文件。
- Evidence:
  - **链接目标：** 逐个检查文件是否存在，`doc/core/http.md`、`errors.md`、`struct.md`、`commands.md` 全部 MISSING；对应的 `doc/content/en-US/docs/{http,errors,struct,commands}.mdx` 全部存在。
  - **重复行：** 第 56 行的说明是"浏览器平台值"，第 60 行是"值 Struct。作为 body 根时按字节发送；作为入站声明时选择对应表示"。
  - **降级理由（两位审计员的 P2 → P3）：** 这份 README 面向维护者，不存在行为描述错误，修复只是清理。
- Fix direction: 删除第 56 行，把它的说明并入第 60 行；四个链接改指 `../../../../doc/content/en-US/docs/{http,errors,struct,commands}.mdx`。

#### F065

**DESIGN-builder.md 仍自称现行契约且与代码相反**

- 复核编号：P12-project-docs-05
- Verdict: CONFIRMED
- Severity: P3
- Category: docs
- Location: DESIGN-builder.md:3; DESIGN-builder.md:403; DESIGN-builder.md:415; DESIGN-builder.md:98; DESIGN-builder.md:106; packages/core/src/internal/builder_types.ts:29-40; packages/core/src/internal/builder_types.ts:53; packages/core/src/http/transport/body.ts:36-38
- Sources: P12-project-docs-codex-07, P12-project-docs-grok-08（部分）
- Summary: 这份设计稿曾被当作活契约维护：`77a75294` 的提交说明写 “See DESIGN-builder.md … for the full contract and rationale”，`43081465`（2026-10-10）也随契约更新过它。之后 `c0024006`（2026-10-12）把 body 改为 `BodyValue` 时没有同步。现在它的状态行、body `unknown` 的承诺和 FormData Content-Type 规则都与 HEAD 不符。
- Failure scenario: 维护者按该稿第 5.3 节的说法，让 POST builder 直接返回 `{ body: user }`（`user: User` 是 interface）。该稿预期可以通过，当前类型检查却报 TS2322，必须改成 `{ ...user }`。按 3.4 节给 FormData 设置 `content-type` 的人以为 header 会保留，实际会被删除。
- Evidence:
  - 原文：:3 为 “状态：已实施（工作区未提交；codex 第十五轮审计 Ready，`bun run verify` 通过）”；:403 为 `body?: Uppercase<M> extends 'GET' | 'HEAD' ? never : unknown`；:415 为 “`body` 取 `unknown`：…精确的 `JsonValue` 会拒绝用户自己的 `interface User`”；:98 的 FormData 行写 “同上”，没有清头例外；:106 为 “覆盖 content-type：在 `headers` 中声明 `content-type`”。
  - 现行代码：`builder_types.ts:53` 为 `body?: … : BodyValue`，`:29` 的 JSDoc 写 “An `interface` value or class instance needs `{ ...value }`”；`body.ts:36-38` 为 `if (isFormData(body)) { headers.delete('Content-Type'); return }`。
  - 本人类型探针 `scratch/body-type/`，经公开 `defineRequest` 的 builder：`CLAUDECODE= bun check --project …/tsconfig.interface.json --no-pretty --all` exit 1，报 `Type 'User' is not assignable to type 'BodyValue | undefined' … Index signature for type 'string' is missing in type 'User'`；spread 版本 exit 0，`No type errors in 77 files`。
  - 历史：`git log -S'BodyValue' -- builder_types.ts` 指向 `c0024006`；`git log -- DESIGN-builder.md` 只有 `77a75294` 和 `43081465`。
  - 现行引用：`git grep DESIGN-builder` 在 tracked 文件中无引用，只有上述提交说明。
  - 定级：文件不进 tarball，现行文档不链接它，读者是维护者，因此为 P3。
  - 相关：P09b-doc-api-03（API 页同样把 body 写成 `unknown`）。
- Fix direction: 在文件头标明这是 2026-09-28 的历史设计记录，并指向 `packages/core/design.md`；删去“工作区未提交”的状态行；把 5.3 节的 body 类型和 3.4 节的 FormData 例外改为现行规则，或明确标为已被取代。
- Tags: —

#### F066

**根 README 的 Codecov 徽章停在 2025-03-14 快照**

- 复核编号：P12-project-docs-06
- Verdict: CONFIRMED
- Severity: P3
- Category: docs
- Location: README.md:12; .github/workflows/ci.yml:10-19
- Sources: P12-project-docs-grok-07（codex 将同一假设列为证据不足而未立项）
- Summary: `6e9f1aa6`（2026-06-13）在本分支的 CI 中删除了 Codecov 上传，徽章却保留至今。Codecov 上的数据停在 2025-03-14，覆盖的只是 13 个文件、619 行。
- Failure scenario: 读者通过徽章评估项目的测试状况，点进去看到的是 2025 年 13 个文件的旧报告，与当前代码库无关，而且任何 CI 运行都不会刷新它。徽章显示的数字（100%）恰好等于当前强制的 100% 阈值，所以错的是数据新鲜度和链接目标，不是数值本身。
- Evidence:
  - `README.md:12` 为 `<a href="https://codecov.io/gh/defjs/defjs"><img src="https://img.shields.io/codecov/c/gh/defjs/defjs…`。
  - HEAD 的 `ci.yml` 只有 `bun ci`、安装 Playwright、`bun run verify`；`git log -S'codecov' -- .github/workflows/ci.yml` 的最近一次为 `6e9f1aa6`。
  - 只读请求 `https://api.codecov.io/api/v2/github/defjs/repos/defjs/` 返回 `"updatestamp":"2025-03-14T18:45:42Z"`、`"files":13`、`"lines":619`、`"coverage":100.0`；shields 徽章 `<title>coverage: 100%</title>`。
  - 当前阈值见 `packages/core/test/shared.ts:20-25`（四项均为 100）。
- Fix direction: 删除 README.md:12 这一行徽章。如需展示覆盖率，就在 `ci.yml` 恢复上传后再加回。
- Tags: —

#### F067

**港繁 interceptors 指南有一整句英文未翻译**

- 复核编号：P10a-i18n-cjk-02
- Verdict: CONFIRMED
- Severity: P3
- Category: i18n
- Location: doc/content/zh-Hant-HK/docs/interceptors.mdx:83；对照 doc/content/en-US/docs/interceptors.mdx:86
- Sources: P10a-i18n-cjk-codex-03
- Summary: "参考"小节的引导句 "Factories return tagged transport values：" 只把冒号换成了全角，其余原样保留英文；其他四个 locale 都已翻译。
- Failure scenario: 港繁读者读到 Reference 小节时，这句说明（工厂函数返回带 transport 标签的值）只能靠英文理解。技术含义没有变，紧随其后的代码列表完整。
- Evidence: `grep -n Factories` 的结果：zh-Hant-HK:83 为 `Factories return tagged transport values：`；zh-Hant-TW:85 为 `Factories 回傳帶 tag 的傳輸值：`；ja-JP:85 为 `ファクトリはタグ付きトランスポート値を返します。`；ko-KR:86 为 `팩토리는 태그가 달린 전송 값을 돌려줘요.`。我用自写的 `scratch/english.py` 扫了五个 locale 的全部正文，另外只有两条港繁要点是全英文术语短语：`docs/design-decisions.mdx:63` 的 "logical session + startup connection snapshot" 和 `docs/start.mdx:125` 的 "Fetch fail / cancel / timeout"。它们是名词短语，符合港繁页面普遍保留英文术语的写法，不计入本项。
- Fix direction: 把第 83 行译成港繁说明句，参照 zh-Hant-TW 第 85 行。
- Tags: —

#### F068

**types.type.test.ts 的 Equal 接受 any**

- 复核编号：P04-core-infra-07
- Verdict: CONFIRMED
- Severity: P3
- Category: test
- Location: packages/core/src/error/types.type.test.ts:5, packages/core/src/error/types.type.test.ts:119, packages/core/src/error/types.type.test.ts:120, packages/core/src/error/types.ts:47
- Sources: P04-core-infra-grok-08
- Summary: `Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false` 对 `any` 两个方向都成立，而 `FaultClass` 只在这个文件里被断言。
- Failure scenario: 公开类型 `FaultClass<FaultCode>` 若退化为 `any`，`ClassCases` 和 `NetworkClass` 两条断言照样通过，消费者失去类名联合的收窄，却没有任何测试报警。
- Evidence:
  - 变异 1：把 `types.ts:47` 改为 `C extends string ? any : never`，运行 `CLAUDECODE= bun check --no-pretty --project tsconfig.json`，结果 `✓ No type errors in 265 files`，exit 0。
  - 变异 2：改为 `C extends string ? string : never`，结果在 `types.type.test.ts(119,26)` 和 `(120,28)` 报 TS2344，exit 1。
  - 每次变异后都执行了 `git checkout -- packages/core/src/error/types.ts`；还原后 clean，exit 0，265 files。
  - `git grep FaultClass` 显示除这个测试外没有其他断言。
  - 从 P2 降为 P3 的理由：只有退化为 `any` 能逃过检查；同仓库 `interceptor.type.test.ts` 已有拒绝 any 的 `StrictEqual`/`IsAny`，可以直接复用。
- Fix direction: 用拒绝 any 的比较替换本文件的 `Equal`，可以复用 `StrictEqual`，或改用 `expectTypeOf<FaultClass<FaultCode>>().toEqualTypeOf<…>()`。

#### F069

**被 ignore 的 discriminatedUnion 守卫无测试**

- 复核编号：P05-core-tests-03
- Verdict: CONFIRMED
- Severity: P3
- Category: test
- Location: packages/core/src/struct/constructors.ts:314-317; packages/core/src/struct/constructors.discriminated_union.spec.ts
- Sources: P05-core-tests-codex-05（grok coverage H7 认为“需类型谎言才可达、不记”，本项一并裁定）
- Summary: `/* istanbul ignore next -- type-safe */` 标记的 guard 对 JavaScript 调用方和用 `as` 绕过类型的调用方都可达，但没有任何测试锁定它，覆盖率也因为这条注释不会提示。
- Failure scenario: 有人按注释的意思把这个“不可达”分支删掉。之后 JS 用户调用 `struct.discriminatedUnion('type', [struct.string()])` 时，抛出的不再是可操作的 `discriminatedUnion options must be object structs`，而是 `undefined is not an object (evaluating 'optionDef.cache.declaredDescriptors')`。如果改成 `return undefined as never`，定义会直接返回 `undefined`。
- Evidence:
  - 可达性：类型层面，string、`struct.or(a,a)`、`struct.intersection(a,b)` 作为 option 都是 TS2322（`scratch/tsdu/du.ts`，tsc 7 exit 1）。运行时，`bun scratch/du-runtime.ts` 对三种输入都抛出 guard 的 TypeError。
  - 删除 guard 后同一脚本输出 `TypeError undefined is not an object (evaluating 'optionDef.cache.declaredDescriptors')`。
  - 完整 core-server（Bun）：m5a（throw 改为 `return undefined as never`）结果 `exit=0 passed=1757`；m5b（删除整个 if）结果 `exit=0 passed=1757`。
  - 对照 m5c：删除相邻同样标注 "type-safe" 的 literal guard，结果 `exit=1`，失败的是 `constructors.discriminated_union.spec.ts > rejects discriminator field that is not literal`。可见 ignore 注释和实际测试覆盖不一致。
  - 降为 P3：自然回归（删除 guard）仍会在定义期抛 TypeError，只是错误信息变差，影响限于 JS 或绕过类型的误用。
- Fix direction: 删除 `constructors.ts:314` 的 `istanbul ignore next` 注释，在 `constructors.discriminated_union.spec.ts` 里加一条非 object option 抛出该 TypeError 的用例。
- Tags: cross-partition (P01), runtime=both

#### F070

**五个 Content-Length 测试只断言 duplex**

- 复核编号：P02-core-http-client-11
- Verdict: CONFIRMED
- Severity: P3
- Category: test
- Location: packages/core/src/http/transport/fetch.spec.ts:467, packages/core/src/http/transport/fetch.spec.ts:495, packages/core/src/http/transport/fetch.spec.ts:518, packages/core/src/http/transport/fetch.spec.ts:540, packages/core/src/http/transport/fetch.spec.ts:563, packages/core/src/http/transport/fetch.ts:207
- Sources: P02-core-http-client-codex-08
- Summary: 这五个用例名称都承诺验证长度解析，但唯一的断言是 `init.duplex === 'half'`。其中 `Infinity` 用例连 `uploadProgress` 都没有设置。
- Failure scenario: 把 `fetch.ts:207` 传入的长度改成 `0`，五个用例仍然全部通过。
- Evidence:
  - 变异探针（已还原）：
    - `-t "Content-Length"` 在 Node 上：`Tests 5 passed | 31 skipped (36)`，exit 0。
    - `bun --bun` 同样 `5 passed`。
  - 同一变异下跑完整 core-server（Node）：`Tests 3 failed | 1754 passed (1757)`，失败的是 `fetch.streaming.spec.ts` 里的三个 “should call uploadProgress for a … body”。所以行为本身另有保护，`utils.spec.ts` 也单测了 `getContentLength`。
  - 由 P2 降为 P3：没有回归会因此漏掉，问题只是这五个用例名不副实，且样板重复。
  - 还原：`git checkout -- packages/core/src/http/transport/fetch.ts` exit 0，`git status --short` 为空。
- Fix direction: 删除这五个重复用例，或者合并成一个表驱动用例，读取包装后的流并断言 `loaded`/`total`/`lengthComputable`。
- Tags: runtime=both

#### F071

**文档构建指纹不含依赖版本，升级后旧产物仍判新鲜**

- 复核编号：P08-doc-site-04
- Verdict: CONFIRMED
- Severity: P3
- Category: test
- Location: doc/scripts/build-state.ts:3-12；doc/package.json:42-48；package.json:20-31（根 `workspaces.catalog`）；doc/e2e/*.test.ts（`assertFreshBuild` 调用处）
- Sources: P08-doc-site-grok-01（catalog/lockfile 部分）；同条的 SITE_URL 部分与 P08-doc-site-codex-02 见 rejected
- Summary: 指纹只散列 `{app,content,examples,public}/**` 加七个 `doc/` 内具名文件。文档依赖全部写成 `"catalog:"`，实际版本只存在于根 `package.json` 的 catalog 和 `bun.lock` 中，两者都不在指纹里。
- Failure scenario: 维护者在根 catalog 中把 `fumadocs-ui`、`fumadocs-core` 或 `react-router` 升一个版本，`bun install` 后直接运行 `bun run --cwd doc test:site` 而不重建。所有 e2e 的 `assertFreshBuild` 都判定为新鲜，于是在旧依赖构建的产物上通过，给出“升级无回归”的错误结论。CI 的 `verify` 和 release docs job 都先构建再验收，所以最终会被拦下，因此定 P3。
- Evidence:
  - `build-state.ts:3-12` 的输入列表不含 `../package.json` 与 `../bun.lock`。
  - `doc/package.json:42-48` 为 `"fumadocs-core": "catalog:"` 等写法。
  - `bun scratch/fingerprint-probe.ts`（exit 0）显示，指纹在当前产物上为 `ab7615af…8833`，并被 `assertFreshBuild` 接受。依赖部分是由输入列表直接推得的；未实际改版本重建，因为那需要 `bun install`，本次禁止。
  - 其他 doc 内跟踪文件已全部覆盖：`git ls-files` 中 glob 之外只有这七个具名文件，以及不影响产物的 `check-site-url.ts`、`preview.ts`。
- Fix direction: 把文档构建会解析的依赖版本纳入指纹，例如根 `package.json` 的 catalog 段或 `bun.lock` 的内容哈希；`build-state.test.ts` 补一条“只改依赖版本时指纹必须变化”的用例。
- Tags: runtime=bun

#### F072

**exports.test.ts 对 export type * 等纯类型导出失明**

- 复核编号：P08-doc-site-05
- Verdict: CONFIRMED
- Severity: P3
- Category: test
- Location: doc/test/exports.test.ts:13-37；doc/test/exports.test.ts:53-55
- Sources: P08-doc-site-grok-07（codex 认为当前无遗漏而未报，二者结论不冲突）
- Summary: `sourceExports` 只识别花括号导出、`export type|interface|class|enum|function|const` 声明和 `export * from`。纯类型的 `export type * from`、`export type * as ns from`、`export declare namespace` 在扫描结果和运行时命名空间中都不出现，三条双向断言因此对它们恒为通过。
- Failure scenario: 某个包的公开入口新增 `export type * from './types'`，其中导出类型 `Hidden`。目录缺少 `Hidden`，测试 "catalog matches its public exports, in both directions" 仍然通过。
- Evidence:
  - `bun scratch/exports-scan-probe.ts`（exit 0）原样取出测试文件第 13-37 行的 `sourceExports` 函数体执行。夹具 `index.ts` 含 `export type * from './types'`、`export declare namespace Ns {...}`、`export type * as T2 from './types'`、`export { visible } from './types'`。输出 `scanner names: ["visible"]`。
  - HEAD 目前没有这些语法：`packages/{core,react,vue,opentelemetry-server}/src` 中只匹配到 `opentelemetry-server/src/test-utils.ts:97` 的 `export let`，而该文件不在公开入口。`bun test ./test` 49 pass。
  - 测试注释本身承认，运行时命名空间只能兜住值导出。
  - 简报 H3 明确允许以 P3 报告这一类脆弱性。
- Fix direction: 让扫描器 fail closed，遇到无法识别的 `export` 语句直接报错，不要静默跳过。注意仓库的 TypeScript 是 7.0.2 原生版，`node_modules/typescript/lib` 只有 `tsc.js` 包装，没有 JS 编译器 API，因此 grok 建议的 `getExportsOfModule` 不能直接使用。
- Tags: runtime=bun

#### F073

**进程级 miss 日志使 http.e2e 同进程重跑误报失败**

- 复核编号：P05-core-tests-04
- Verdict: CONFIRMED
- Severity: P3
- Category: test
- Location: packages/core/test/e2e-routes.ts:12-23; packages/core/test/http.e2e.spec.ts:651; packages/core/test/http.e2e.spec.ts:665; packages/core/test/http.e2e.spec.ts:680; packages/core/test/http.e2e.spec.ts:690
- Sources: P05-core-tests-grok-01
- Summary: `/e2e/miss/` 的命中记在 globalSetup 进程里一个从不清空的数组中，而两条用例用固定的控制路径断言过滤后的列表“恰好一条”，所以在同一个 globalSetup 生命周期里第二次执行必然失败。
- Failure scenario: 开发者用 `vitest --repeats`，或在 watch 模式下重跑 `http.e2e.spec.ts`（globalSetup 只启动一次服务器）。产品行为完全正确，但控制路径的历史命中变成两条，`toEqual` 失败，看起来像请求打到了不该到的地方。
- Evidence:
  - `bun --bun vitest run --config vitest.config.ts --project core-server --coverage.enabled=false --repeats=1 test/http.e2e.spec.ts -t "does not reach the server"` 结果 exit 1，`Tests 2 failed | 20 skipped`，差异为 `+ "GET /e2e/miss/build-failed-control"`，另一条 `input-invalid-control` 同样多一条。
  - 不加 `--repeats` 时 exit 0，`2 passed`。
  - 同一套夹具的浏览器用例（`sse.browser.spec.ts:114`、`http.upload_progress.browser.spec.ts:120`）已经用 `Date.now()` 生成唯一路径来规避这个问题，server spec 没有这样做。
  - 从 P2 降为 P3：CI 只跑一次，不影响产品和 CI，只影响本地重跑。
- Fix direction: 两条 server 用例的控制路径也加上每次运行唯一的后缀（复用浏览器用例的 `Date.now()` 做法），不用改服务器夹具。
- Tags: runtime=both

#### F074

**teardown 端口探测在端口被他进程重绑时误报失败**

- 复核编号：P05-core-tests-05
- Verdict: CONFIRMED
- Severity: P3
- Category: test
- Location: packages/core/test/setup.ts:653-659; packages/core/test/setup.ts:692-714; packages/core/test/regression/hono-test-server.spec.ts:37-42
- Sources: P05-core-tests-grok-04（codex coverage H6 认为是静态风险但未提交）
- Summary: `assertLoopbackPortClosed` 在 `server.close()` 回调成功之后再连一次该端口，只要连上就抛错。这一步分辨不出连上的是自己的服务器，还是别的进程刚绑上的同一个端口。
- Failure scenario: 机器上并行进程很多时（本次审计有 24 个 agent 并行，`_shared.md` §2.2 也提到了这一现象），某个进程在服务器关闭后、探针连接前绑定了同一个端口。结果所有测试都通过，Vitest 却以 `Test server teardown failed` 结束、exit 1。
- Evidence:
  - `node scratch/g4-port-race.mjs` 启动真实的 `bun --bun vitest run --config vitest.config.ts --project core-server ... test/make_fake_handler.spec.ts`，从 stdout 读出端口后，另起进程每 1ms 尝试 `listen` 同一端口，模拟繁忙机器上的端口复用。
  - 输出：`BINDER took port 58292`，`VITEST exit 1`，`Tests 4 passed (4)`，`AggregateError: Test server teardown failed`，`Loopback port close verification failed: Loopback port 58292 still accepts connections`。
  - 这一步的检测价值有限：`server.close()` 的回调本身已经表示监听 socket 关闭完成。
  - `hono-test-server.spec.ts:38-40` 在关闭后用 `connect` 期待 `ECONNREFUSED`，存在同样的误判窗口。
  - 本次两次完整基线运行没有自然撞上，评为 P3。
- Fix direction: 删掉 `assertLoopbackPortClosed` 及其调用，依赖 `server.close()` 回调。如果要保留它来防 Bun 兼容问题，连上时就不能直接判失败，要先确认对端确实是本服务器（例如请求一个只有本服务器才有的标记路由）。
- Tags: runtime=both

#### F075

**preview.ts 三处路径边界与静态托管不一致**

- 复核编号：P08-doc-site-06
- Verdict: CONFIRMED
- Severity: P3
- Category: test
- Location: doc/scripts/preview.ts:8；doc/scripts/preview.ts:10；doc/scripts/preview.ts:13
- Sources: P08-doc-site-grok-03, P08-doc-site-grok-04, P08-doc-site-grok-05（codex 以“无当前影响”未报，已裁定合并为一条 P3）
- Summary: `startPreview` 是 e2e 用来模拟 GitHub Pages 的服务器，但有三处行为与静态托管不同：
  - 第 8 行对畸形 `%` 调用 `decodeURIComponent`，抛出未捕获的 URIError，返回 500；
  - 第 10 行 `relative(root, path).startsWith('..')` 把根下名为 `..hidden.txt` 的合法文件判成 403；
  - 第 13 行 `(await file.exists()) && file.size` 把 0 字节文件当作缺失，返回 404。
- Failure scenario: 在临时根目录下请求以下路径：
  - `/empty.js` 返回 404 和 404 页内容（GitHub Pages 会返回 200 空正文）；
  - `/..hidden.txt` 返回 403；
  - `/%` 返回 500 和 Bun 错误页。

  当前构建有 5 个 0 字节 JS chunk（`assets/{search,sitemap,mdx,index,full}-BvRk9kiK.js`），它们都对应 `hasDefaultExport:false` 的资源路由。客户端不会导入这些 chunk，所以对读者和当前 e2e 都没有影响。

- Evidence:
  - `bun scratch/preview-edges-probe.ts`：端口 0，与 `doc/test/preview.test.ts` 相同。输出 `/empty.js 404 "not-found-page"`、`/..hidden.txt 403 "Forbidden"`、`/% 500 "<!doctype html>…"`、`/%2e%2e/etc/passwd 404`（目录穿越仍被拦住）。
  - 进程 exit 1，原因是 Bun.serve 把处理函数中未捕获的 URIError 记录下来；四个响应都已打印。
  - 本机 `Bun.file(<dir>).exists()` 为 false，因此 `file.size` 这一判断并不是用来排除目录的，删掉它不影响 `index.html` 回退。
- Fix direction: 解码失败时返回 400 或走 404 页；越界判断改为 `rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)`；存在性只用 `exists()`。
- Tags: runtime=bun

#### F076

**fillUrl 数组取首项分支在公开执行链上不可达**

- 复核编号：P04-core-infra-06
- Verdict: CONFIRMED
- Severity: P3
- Category: over-engineering
- Location: packages/core/src/internal/url.ts:17, packages/core/src/internal/url.spec.ts:33, packages/core/src/internal/outbound_request.ts:270, packages/core/src/internal/transport_request.ts:56, packages/core/src/web_socket/build.ts:20
- Sources: P04-core-infra-codex-06, P04-core-infra-grok-09
- Summary: `fillUrl` 在生产中只有 `transport_request.ts:56` 和 `web_socket/build.ts:20` 两个调用者，二者传入的都是 `materializePath`（`outbound_request.ts:270-287`）的产物 `{ [key: string]: string }`。`materializePath` 已经拒绝 null 和任何对象（含数组），所以 `url.ts:17-26` 的“数组只取第一项”分支，以及其后的非标量检查，只有直接单测才能走到。`url.spec.ts:33-38` 还把这种静默截断锁成了期望行为。
- Failure scenario: 没有用户可见的失败。代价在维护上：两套相反的规则并存（公开链拒绝数组，底层测试要求截断）；将来若有新调用者绕过 `materializePath`，得到的是静默截断而不是报错。
- Evidence: `git grep -n "fillUrl("` 的非测试结果只有上述两处。`outbound_request.ts:282-283` 对对象抛出 `path value for "${key}" must be a scalar`。`misc.mjs` 在两个运行时都输出 `public path array {"code":"REQ_BUILD_FAILED","msg":"path value for \"id\" must be a scalar"}`。
- Fix direction:
  - 删除 `url.ts:17-26` 的数组分支，以及 `url.spec.ts:33-38` 的截断断言。
  - 把 `fillUrl` 与 `createWebSocketRequest` 的 `params` 类型收窄为 `{ [key: string]: string }`。
  - 保留空段、点段和缺失参数的校验。
  - `appendRecordToHeaders` 的 Headers 分支和元组分支经 `materializeHeaders` 原样透传，确实可达，不要删除。
- Tags: cross-partition

#### F077

**@types/react-dom 版本在两处各自固定**

- 复核编号：P11-ops-05
- Verdict: CONFIRMED
- Severity: P3
- Category: over-engineering
- Location: package.json:34-35; packages/react/package.json:27-28; bun.lock:683; bun.lock:1559
- Sources: P11-ops-grok-03
- Summary: catalog 中 `@types/react-dom` 为 `19.2.3`，`packages/react` 绕过 catalog 写了 `^19.3.0`，导致锁文件同时解析出 `@types/react-dom@19.3.0` 和 `doc/@types/react-dom@19.2.3`。
- Failure scenario: 目前没有失败（基线 typecheck 和 frozen dry-run 都通过）。这是为同一类型包维护的两套版本来源，doc 与 react 包的 React DOM 类型今后可能分叉。
- Evidence: 已读 `package.json:34-35`（`"@types/react": "19.3.0"`、`"@types/react-dom": "19.2.3"`）、`packages/react/package.json:27-28`（两项都是 `^19.3.0`）、`bun.lock:683` 和 `bun.lock:1559`。`bun install --frozen-lockfile --dry-run` exit 0。
- Fix direction: 删除 `packages/react/package.json` 中这两项写死的版本，改为 `catalog:`；把 catalog 中的 `@types/react-dom` 升到 `19.3.0`，锁文件里的 `doc/@types/react-dom@19.2.3` 随之消失。

## 附录 A：终审裁决

##### 分歧裁决

- **P04-core-infra-05 与 P02 rejected grok-07（HTTP 拦截器解析为非 `HttpResponse`）**
  - 裁决：维持 P04 复核者结论，CONFIRMED P2（F022）。
  - 理由：`errors.mdx:145` 无条件承诺 HTTP "execute promise settles once, with the tuple"。README:46 的 "can still throw" 指拦截器本身可以抛错，按同一张表会转成 `EXT_INTERCEPTOR_FAILED`，并不是允许 execute reject。SSE/WS 把同类误用收敛为 `EXT_INTERCEPTOR_FAILED`。另外，原生 `Response` 被误报为服务端的 `RES_STRUCT_MISMATCH`，P02 的驳回没有涉及这一点。
  - 不升 P1：TypeScript 用户在编译期就会被拦下。
- **P03a-core-sse-01 与 P04-core-infra-03**
  - 裁决：保持为两条（F003、F012），不合并。
  - 理由：两者是不同模块中的两份数据结构（`errorOpenInfoMap` WeakMap 与 transport-origin WeakSet），症状不同（跨请求返回他人响应快照 vs 拦截器故障分类翻转），后果等级也不同（P1 vs P2）。修复其中一个不会修复另一个。
  - 两者在摘要中归入同一系统性主题，并建议在同一次改动中修复。

##### 跨分区合并（主条目选择）

| 被并入             | 主条目                    | 理由                                                                                            |
| ------------------ | ------------------------- | ----------------------------------------------------------------------------------------------- |
| P01-core-struct-01 | P03b-core-ws-01（F010）   | 同为 `codec.ts:11` 缺少 `rejectNonJson`；主条目覆盖排队与心跳路径。                             |
| P01-core-struct-02 | P04-core-infra-02（F007） | 同一消息链；主条目还覆盖 `RES_DECODE_FAILED` 在 Node 上的解析器片段，以及 `api/errors.mdx:63`。 |
| P09b-doc-api-01    | P03a-core-sse-02（F009）  | 同一 `retryCount` 语义，参考页位置并入主条目。                                                  |
| P09a-doc-guides-05 | P11-ops-04（F042）        | 同一"已删除门禁仍被称为验证"的陈述；主条目覆盖发布说明、发布包 README 与指南。                  |
| P09a-doc-guides-03 | P09b-doc-api-04（F053）   | 同一"已声明 body 等同 JSON"误写，修复同为补上 JSON representation 前提。                        |

##### 不合并（相关但分立）

- **P03b-core-ws-02 与 P03a-core-sse-02**：两份独立实现；WS 条目另有 `factor` JSDoc 与实现矛盾的证据。两条分列，但建议共同决策预算语义。
- **P03a-core-sse-05 与 P09a-doc-guides-02**：触发条件不同，前者是重连握手的非 2xx，后者是启动握手的 error struct 失配。
- **P12-project-docs-03、P09b-doc-api-04、P10a-i18n-cjk-01**：同一 OTel 日志段落中的三处不同条件，宜在一次文档改动中处理。
- **P05-core-tests-02 与 P11-ops-03**：分别对应 CI 与发布流水线。
- **P01-core-struct-08 与 P12-project-docs-01**：分别是维护者用的源码 README 和随 npm 发布的 README。
- **P02-core-http-client-06**：并入 P04-01 复核旁注与 P03a 复核旁注中的位置，只追加 extra_locations。

##### 严重度确认与调整

- **P0 确认：F001。** `_shared.md` §5 明确把"发布产物不合规"列为 P0，且问题已出现在已发布的 `0.4.0-beta.1` 中。运行时零影响，修复只需一行。
- **P1 确认：**
  - **F002**：不升 P0，因为触发需要开发者自写的路径或拦截器改写，占位符中的不可信值会被编码；但它绕过了文档声明的唯一同源防线。
  - **F003**：不升 P0，因为泄露的前提是调用方读取或记录第三槽，泄露的是响应元数据；类别保持 contract，摘要中注明其隐私影响。
  - **F004**：文档声明默认 handle 是全局 fetch，导入后替换无效是常见用法下的行为偏差。
  - **F005**：违背 README 关于 timeout/abort 可界定的承诺，且会导致内存放大或永不返回。
  - **F006**：文档明确承诺的组合必然失败。
- **调整：**
  - **P10a-i18n-cjk-01：P2 → P3（F055）。** 与 P09b-doc-api-04、P12-project-docs-03 同类，都是 OTel 日志条件在窄场景下的文档偏差，运行时正确，也不会导致读者写出错误代码。按"同类同级"取低。
  - **F042 合并组定为 P2**（P09a-doc-guides-05 原为 P3）：该陈述出现在随 npm 发布的 README、发布说明及 11 个语言的指南中，声称存在一个已不存在的保证。
- **考虑过但未调整：**
  - **P03a-core-sse-02、P03b-core-ws-02 不升 P1**：文档没有承诺"成功后重置"，两名复核者都明确否决了 P1，按两级取低。它们在 P2 中排在前列。
  - **P03b-core-ws-01 维持 P2**：两名审计员原报 P1，复核者以"WS 文档写明 `JSON.stringify` 机制"下调。
  - **P11-ops-02 维持 P2**：尚未出现在线上，只有一个推断类型退化。
  - **P12-project-docs-02 维持 P2**：属于治理文档，但流程完全不可用。
  - **P06-otel-server-05 保留**：项目明确支持多副本（`parse.protocol.spec.ts:771`）。
  - **P08-doc-site-03 以 PLAUSIBLE 保留在 P2**，标注 needs-browser。

##### 全局校准口径

- **文档类**：权威页面（API/指南）写错，且读者照做会写出错误代码或漏掉失败的，定 P2。以下情况定 P3：
  - 权威页正确、只有旁路摘要或 JSDoc 写错；
  - 偏差在编译期即暴露；
  - 文件只面向维护者；
  - 文件属于历史记录。
  - `design.md` 按 `_shared.md` §4 视为叙述性契约，过期即定 P2。
- **测试类**：存在现实回归能逃过完整套件、且有用户可见后果的，定 P2。完整套件仍能抓住、只退化为错误信息、只影响本地重跑，或回归方式极窄的，定 P3。

##### 删除

- 无。82 条全部保留为主条目或并入条目。

## 附录 B：终审移除的发现

| 复核 ID | 处理 | 理由                                                                             |
| ------- | ---- | -------------------------------------------------------------------------------- |
| —       | —    | 本阶段未删除任何复核条目；82 条全部作为主条目保留或并入其他条目（见 plan.tsv）。 |

## 附录 C：复核阶段驳回的候选

### P01-core-struct

#### P01-core-struct 驳回项

| 来源                              | 标题                                                                       | 驳回理由                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P01-core-struct-codex-07          | `format()` 中 `_errors` 的转义与真实名为 `\_errors` 的字段碰撞             | 转义是公开文档写明的行为（`api/core/formattedstructerror-type.mdx:15`："A path segment literally named `_errors` is stored as `\_errors`"）。碰撞要同时满足两个条件：字段名字面上就是 `\_errors`，并且存在手工构造的多 issue `StructError`。`struct.parse` 是 fail-fast，只产生一条 issue。复现属实，但没有现实的失败场景。                                                                   |
| P01-core-struct-grok-05           | `struct.date` API 页写的是 `new Date(value)`，运行时却返回同一个 Date 引用 | 同一引用是设计行为，有两处测试锁定：`constructors.primitives.spec.ts:60` 的 `expect(v1).toBe(d)` 和 `constructors.browser.spec.ts:88`。`struct-date.mdx:12` 那句话描述的是 timestamp/string 的转换，`struct-parse.mdx:21` 承诺的 "the input is not modified" 依然成立。只有在 parse 之后修改输入 Date 时才看得出差异，不是现实缺陷。codex 也驳回了 H2 的同一点，这个分歧按 codex 的结论处理。 |
| P01-core-struct-grok-04（子论点） | errorMap 返回非字符串真值时被写入 `message`                                | `ErrorMap` 的公开类型是 `string \| undefined`，只有绕过类型检查的回调才会这样返回。该项的空字符串主体已并入 P01-core-struct-06。                                                                                                                                                                                                                                                              |

### P02-core-http-client

| Sources                      | Title                                                                         | Reason                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P02-core-http-client-grok-07 | 拦截器 resolve 非 `HttpResponse` 时 execute 抛 TypeError 或归为 `HTTP_STATUS` | 现象已复现：`undefined` 导致 reject，`{}` 得到 `HTTP_STATUS`，两个运行时都是如此。但这是拦截器违反了类型契约和文档契约：`interceptors.mdx` 写着 “you must return the expected result type”，`interceptor.type.test.ts:110` 用类型锁定了返回值，`README.md:46` 写着 “custom interceptors … can still throw”。TS 用户在编译期就会被拦下，JS 用户得到的是一个明确的 reject，不是静默错误。这与 codex 对 H7a 的反驳一致。 |

### P03a-core-sse

#### P03a-core-sse 已拒绝候选

| 来源                                   | 标题                                                    | 理由                                                                                                                                                                                                                                                               |
| -------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 协调者交叉项 (b)，对应 P03b-core-ws-04 | `maxDelayMs` 在 jitter 之前生效，SSE 实际等待可超过上限 | SSE 侧不另立项。`docs/sse.mdx:62` 写明 "`maxDelayMs` caps the base"，与运行时一致；`withssereconnect.mdx:34`、`clientsseoptions-type.mdx:36` 都没有承诺硬上限。唯一不一致的 SSE JSDoc 是 `client/config.ts:107`，已列在 P03b-core-ws-04 的 Location 中，属于重复。 |

没有完全拒绝任何审计者发现。定级调整如下：P03a-core-sse-grok-01 由 P1 降为 P2（并入 03）。P03a-core-sse-grok-03 的类别由 docs 改为 contract，严重度 P2 不变（即 02），与 P03b-core-ws-02 一致。

### P03b-core-ws

#### P03b-core-ws 复核：被驳回的候选

本分区两位审计者共提交 10 项（codex 5、grok 5），按根因合并为 7 个候选，全部 CONFIRMED，没有被驳回的候选。

调整而非驳回的项（记录在案）：

- P03b-core-ws-codex-01 / P03b-core-ws-grok-01：P1 → P2（WS 文档明写 `JSON.stringify` 机制，未违反书面契约；narrow 边界）。
- P03b-core-ws-codex-03：P2 → P3（仅自定义同步替身可触发，首个心跳周期即暴露）。
- P03b-core-ws-codex-04 与 P03b-core-ws-grok-05：同为 `connectOnce` 物理 attempt 清理的测试缺口，合并为 P03b-core-ws-03。
- P03b-core-ws-codex-05 与 P03b-core-ws-grok-04：同一 `design.md:237` 文档问题，合并为 P03b-core-ws-06。

两位审计者均已否定、复核者抽查后同意不立项的假设（非候选，仅备查）：H2（WS 重连参数在 `reconnect.ts:20-35` 启动前校验）、H8（`validateWebSocketClose` 用 `Number.isInteger` 与 `TextEncoder` 字节数，`web_socket.ts:1329-1336`）、H9（URL 构建复用 HTTP 规则）、H10（headers/body 不传构造器，文档已声明）、H11（原始帧与解析队列分别按条数限制，文档未承诺合计或字节上限）、H12（execute 级 heartbeat payload 受类型约束）。

### P04-core-infra

#### P04-core-infra 已否决候选

| 来源 ID                                                         | 标题                                                                            | 否决理由                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P04-core-infra-codex-03（原因丢失部分）, P04-core-infra-grok-06 | 调用方 abort reason 被共享哨兵 `ERR_ABORTED` 替代，且哨兵可变、会影响后续 fault | 属文档化设计：`err-aborted-type.mdx:12` 写明 “Shared `cause` and message value for caller cancellation”，`errors.mdx:171` 把 “Abort reason and stack” 列为通常不出现/敏感。调用方仍持有 `signal.reason`（`misc.mjs`：`reasonStillOnSignal: "UserNavigatedAway"`）。“可变单例”场景要求用户代码去改库导出的共享常量，没有给出现实的使用方。 |
| P04-core-infra-grok-02                                          | `makeResponse({ request })` 把请求的凭证头和 Content-Type 复制成响应头          | 属文档化且有测试锁定的行为：`makeresponseoptions-type.mdx:19`、`http_response.ts:58` 的 JSDoc、`http_response.spec.ts:65-86`。`makeresponse.mdx:14` 与 `interceptors.mdx:56` 要求为 JSON 显式设置 content-type，设置了 headers 就不会复制。`errors.mdx:177` 已把 response headers 列为敏感。官方示例都不传 `request`。codex 同样否决。    |
| P04-core-infra-grok-04                                          | 非法 UTF-8 被替换为 U+FFFD 而非 `RES_DECODE_FAILED`，且忽略 charset             | 与平台 Fetch 的 `Response.json()`/`text()` 完全一致，后者同样是 WHATWG 的非致命 UTF-8 解码并忽略 charset。`utf8-platform.mjs` 在两个运行时输出相同的 `[99,97,102,65533]`。没有任何文档承诺致命解码或按 charset 解码；WebSocket 文档写明按 UTF-8 读取。codex 同样否决。                                                                    |
| P04-core-infra-grok-07                                          | 以 Headers 实例提供多个 `set-cookie` 时只保留最后一个                           | `Set-Cookie` 是响应头，在 Fetch 规范中属于禁止的请求头名，浏览器会丢弃，作请求头也没有 HTTP 语义。其他头名在 `Headers.forEach` 中给出的是合并后的值，`set` 不丢信息。Headers 实例“替换”、元组“追加”的语义已在 `withheaders.mdx` 中写明。没有具体失败场景。                                                                                |

### P05-core-tests

| Source IDs              | 标题                                             | 拒绝理由                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P05-core-tests-codex-02 | 生成式 intersection 测试允许零个样本进入编码比较 | 所说的回归在完整套件中存活不下来：codex 的变异（`introspection.ts:54` 一律返回 StructError）在 Bun 完整 core-server 上 107 项失败；更细的 intersection 变异（`utils.ts:50` 让非空数组合并失败）22 项失败。“被拒绝”这条通道有大量确定性 intersection 用例兜底，单文件弱点没有可观察后果。                                                                                                  |
| P05-core-tests-codex-03 | 双向可赋值 Equal 检查接受公开类型退化成 any      | 重复：`error/types.type.test.ts` 部分已由 P04-core-infra-07（P3，CONFIRMED）报告；`client.type.test.ts` 部分已记在 P02 map 中，其返回元组的严格类型由 `http.type.test.ts` 锁定。不在 P05 重复立项。                                                                                                                                                                                       |
| P05-core-tests-grok-02  | Firefox macOS 目录规避没有被测试锁住             | 测试名只声称“隔离 env，非 macOS 分支不变”，这两点都已锁住。删除 `mkdirSync` 在完整套件上确实存活（g2：exit 0，1757 passed），但后果链（Firefox 因目录不存在而报 "Could not find profile folder."）需要在 macOS 上跑浏览器才能证实，没有复现。目录在 `tmpdir()` 中跨运行持久存在，而且这是 brief 列为 known-by-design 的临时开发绕过，有删除清单，不影响发布包用户。没有可证实的失败场景。 |
| P05-core-tests-grok-03  | 单独跑 server 配置不会启动测试服务器             | 有意设计：commit c0024006 把 `globalSetup` 从 `vitest.config.server.ts` 移到聚合配置，让 server/browser 两个项目共享一台服务器。`package.json` 的 `test`、根 verify 和 CI 都走聚合配置，没有现行文档或脚本单独运行该项目文件，只有 `docs/superpowers/` 里早于该提交的历史计划命令。grok 提议的“每个项目各放一份”会让全量运行起两台服务器，推翻刚做的设计却没有现实消费者获益。            |

### P06-otel-server

| Sources                            | Title                                              | Reason                                                                                                                                                                                                             |
| ---------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P06-otel-server-codex-02（子论点） | HTTP 异步 responseHook 在 await 之后写入的属性丢失 | 属于已文档化的行为：HTTP 选项页第 15 行写明 “the hook is not awaited, so only its synchronous part can still change the span”。本条剩下的 rejection 记录丢失问题已并入 P06-otel-server-02。                        |
| P06-otel-server-grok-03（子论点）  | HTTP requestHook 的 rejection 未被记录             | 取决于时序。在本次探针中，立即 reject 的 requestHook 在 Node 和 Bun 上都被记录了；只有 hook 在 await 之后才 reject、而 `next()` 又在同一轮就返回（短路或 mock handle）时才会丢。真实网络往返下不构成用户可见缺陷。 |
| P06-otel-server-codex-01（严重度） | 外层重试导致 span 父子关系错误（P1）               | 不是驳回，是下调为 P2：trace id 不变，下游的父子关系正确，指标和日志不受影响，只是客户端树形结构错误，没有数据丢失。                                                                                               |
| P06-otel-server-codex-02（严重度） | 异步 responseHook 的承诺未兑现（P1）               | 不是驳回，是下调为 P2：业务结果不受影响，丢的只是应用自身 hook 的诊断信息，且 HTTP 选项页已限制异步定制。                                                                                                          |

### P07-react-vue

| 来源 ID                | 标题                                               | 拒绝理由                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P07-react-vue-codex-01 | 声明的最低 React/Vue peer 版本没有进入兼容性验证   | 没有具体的失败场景（原发现自己也写明“不声称当前最低版本已经运行失败”）。本人用 `tsc` 检查构建出的 `packages/react/dist/index.d.ts`，类型来自 @types/react 18.3.23，退出 0；反向对照（把 ReactNode 时代断言改成 react19）退出 1，说明沙箱确实用的是 18 版类型。v3.0.0 源码已有非泛型 `Plugin`、`InjectionKey<T>`、`inject` 和 `app.provide`，正是适配器运行时和声明用到的全部内容；React 运行时只用 `createContext`/`createElement`/`useContext`，React 18 都有。剩下的只是 CI 流程没有覆盖最低版本，不构成缺陷。                                                                                                   |
| P07-react-vue-grok-02  | Vue README 顶层 `provide()` 不会把 client 交给子树 | 这段代码原样放进 `<script setup>` 就是正确写法，`doc/examples/vue/inject-and-override.vue:2-16` 用的也是同样几行。本人 probe 用 compiler-sfc 编译 `<script setup>` 版本，在 Bun 和 Node、开发和生产下，子组件都得到 override client（`OTHER`），兄弟节点仍得到 app client（`APP`），与 README `:96` 的描述一致。把它放到组件外是误用 Vue 的 `provide()` API，Vue 开发构建会提示 `[Vue warn]: provide() can only be used inside setup().`；标题“For a subtree override”本身就意味着在组件内使用。没有符合文档用法的失败场景。可以作为 P12 的文案润色（改用 `vue` 代码块并补上 `<script setup>` 外层），不作为发现。 |

### P08-doc-site

#### P08-doc-site 被驳回的候选

| Source IDs                                                       | 标题                                                   | 驳回理由                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P08-doc-site-codex-02；P08-doc-site-grok-01（SITE_URL 部分）     | 构建指纹不含 SITE_URL，旧产物仍被判为新鲜              | 没有“错误结果未被发现”的场景。`siteUrl` 在 bun test 下读取进程环境（已实测 `SITE_URL=https://docs.example.test` 时 `siteUrl` 即为该值），`e2e/site.test.ts:74` 会把 llms origin 与之比较，构建和测试的 SITE_URL 不一致时 e2e 会失败。其余 e2e 断言与 origin 无关。release docs job 每次都带 SITE_URL 全量重建。grok-01 的依赖版本部分保留为 P08-doc-site-04。 |
| P08-doc-site-grok-06                                             | 每种语言的搜索索引内嵌整页 Markdown，单文件 1.7–2.5 MB | 全文索引是设计取舍。codex 实测 gzip 后为 0.40–0.52 MB，没有测到可感知的延迟或失败。建议的“标题加摘录”会把全文检索降级为标题检索，不是可直接删除的冗余，属于产品选择。                                                                                                                                                                                         |
| （codex coverage，非 finding）官方构建“Port 0 is already in use” | 文档预渲染无法启动 Vite preview                        | 沙箱伪影。本次在克隆中 `bun run --cwd doc build` exit 0，预渲染完成，链接检查覆盖 2257 页；`bun test ./test` 49/0，包括绑定端口 0 的 `preview.test.ts`。grok 的环境同样 49/0。                                                                                                                                                                                |

### P09a-doc-guides

| 来源                                 | 标题                                                                       | 理由                                                                                                                                                                                                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P09a-doc-guides-codex-03             | SSE 指南称 post-open 重连非 2xx 以 `HTTP_STATUS` 结束                      | duplicate of P03a-core-sse-05（同为 `docs/sse.mdx:64`）                                                                                                                                                                                                        |
| P09a-doc-guides-codex-04             | 重连指南未说明 attempts 是逻辑资源的累计预算                               | duplicate of P03a-core-sse-02（SSE，`docs/sse.mdx:62`）与 P03b-core-ws-02（WS，`docs/web-socket.mdx:52`）                                                                                                                                                      |
| P09a-doc-guides-grok-03              | attempts 预算贯穿整次逻辑流或会话，成功重连不重置                          | duplicate of P03a-core-sse-02 / P03b-core-ws-02。额外位置请协调者补入 P03a-core-sse-02：`doc/content/en-US/recipes/consume-sse.mdx:22`                                                                                                                         |
| P09a-doc-guides-grok-05              | 路径占位符名字吃到下一个斜杠，文档未写文法                                 | duplicate of P04-core-infra-04（已列 `docs/http.mdx:22`、`docs/commands.mdx:44`）                                                                                                                                                                              |
| P09a-doc-guides-grok-02（OTel 部分） | OTel 集成页把已声明 body 写成一律 JSON 检查/解析                           | duplicate of P09b-doc-api-04（已列 `integrations/opentelemetry-server.mdx:164`）。额外位置：`:71` 同样省略 JSON representation 前提。`:169` 按 JSON 声明理解时成立，不再追加。非 OTel 部分（errors.mdx:90、design-decisions.mdx:104）保留为 P09a-doc-guides-03 |
| P09a-doc-guides-grok-04              | design-decisions:142 用 JSON.stringify 判据划分 body，可迭代对象字面量不符 | 无现实失败场景。只有带 `Symbol.iterator` 的普通对象字面量会触发（带 `toJSON` 的可迭代类实例照常编码）；触发时请求在发送前失败关闭，并给出可操作的 `REQ_BUILD_FAILED` 消息（probe `ITERABLE_LITERAL` 已复现）。精确规则已写在 `http.mdx:86`                     |

### P09b-doc-api

| Sources                                                       | 标题                                                                      | 驳回理由                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P09b-doc-api-codex-01                                         | `withEndpoint` 页声称支持相对基址，但三种传输都会拒绝                     | 与 P02-core-http-client-07 重复：位置同为 `api/core/withendpoint.mdx:14` 和 `client/option.ts` JSDoc，根因相同。                                                                                                                                                                                                                                                                                                                 |
| P09b-doc-api-grok-03                                          | WebSocket 重连公式把 `maxDelayMs` 说成最终等待上限                        | 与 P03b-core-ws-04 重复：同一 `withwebsocketreconnect.mdx:26` 和 `backoff.ts:11-12`，根因相同。                                                                                                                                                                                                                                                                                                                                  |
| P09b-doc-api-codex-03、P09b-doc-api-grok-04（WebSocket 部分） | WebSocket `attempts` 是整个会话的累计预算，文档未说明                     | 与 P03b-core-ws-02 重复（部分重复）。SSE 部分保留为 P09b-doc-api-01。本分区另有三处同根 WS 位置未列入 P03b-core-ws-02，建议追加：`api/core/clientwebsocketoptions-type.mdx:34`、`api/core/websocketexecuteoptions-type.mdx:30`、`api/web-socket.mdx:106`。                                                                                                                                                                       |
| P09b-doc-api-codex-02                                         | `struct.parse` 的“Invalid input never throws”漏掉 getter 和 errorMap 异常 | 属设计行为，且找不到读者会因此受误导的场景。异常传播已列入 `_shared.md` §4，并由 `parse.protocol.spec.ts:526-560` 锁定。会抛出的路径只有调用方自己的代码：自己传入的 `errorMap`，或调用方构造的带抛错 getter 的对象。core 没有公开的自定义 decode hook。所有校验失败都按页面描述返回 `[StructError, undefined]`。这句话里的“invalid input”指校验失败，没有让读者对自身回调异常产生错误预期。只有 codex 报了这条，grok 没有涉及。 |

### P10a-i18n-cjk

| 来源                               | 标题                                                                                                                                                                                                                                                                                                                      | 驳回理由                                                                                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| grok coverage #2 / codex coverage  | zh-Hans `docs/http.mdx`、`docs/struct.mdx` 行内 ts 围栏的两行注释被翻译                                                                                                                                                                                                                                                   | 只翻译了注释，代码本体字节相同。"根匿名：发出 id"和"根带类型，row 字段声明了 alias：发出 wire_id"与英文含义一致。按 brief 列入 map 例外，不构成发现                              |
| grok #3 / codex coverage           | `api/core/withwebsockethandle.mdx`（ja-JP、ko-KR、zh-Hans、zh-Hant-TW）两个链接顺序对调                                                                                                                                                                                                                                   | 语序调整（定语前置）导致顺序变化；目标集合和锚文本一致，每个链接都指向正确页面                                                                                                   |
| codex coverage（"5 页首页尾斜线"） | `docs/index.md` 首页链接 `/` 对应 `/<locale>`                                                                                                                                                                                                                                                                             | 实际是 1 页 × 5 个 locale；en-US 的 `/` 映射为 `/<locale>` 正是预期的本地化目标，不是差异                                                                                        |
| grok #4                            | ko-KR `recipes/cancel-http.mdx` 少一个 `NET_TIMEOUT`；zh-Hans 多出 `HTTP_STATUS`                                                                                                                                                                                                                                          | 前者是脚本中 `\b` 对谚文的匹配误报，代码 span 实际都在（我的独立脚本没有报出）；后者见 zh-Hans `api/core/executehttpcommand.mdx:24`，是把同一个 `HTTP_STATUS` 再提一次，含义一致 |
| grok #5 / codex coverage           | 日文等新增数字（共 68 页，`1`×108 等）                                                                                                                                                                                                                                                                                    | 我的独立脚本确认 5 个 locale 都没有删除 en-US 中的任何数字；新增的 2/3/4/10 在 en-US 中都能找到对应的数词（two/three/four/decimal），没有改值                                    |
| grok #7                            | zh-Hant-HK/TW `api/core/withssereconnect.mdx` 第 4、5 条要点顺序对调                                                                                                                                                                                                                                                      | 两条要点都在，默认值 `1000`、`1`、`0` 和 0–1 范围都一致，只是相邻顺序不同                                                                                                        |
| grok #12 / codex coverage          | ja-JP、zh-Hans `api/core/structerror-type.mdx` 把占位符 `<first message>` 翻译了                                                                                                                                                                                                                                          | 尖括号本来就是说明性占位符，前缀 `N struct issues:` 未改；运行时 `packages/core/src/struct/errors.ts` 生成的消息格式与文档一致                                                   |
| grok #13                           | zh-Hans `docs/interceptors.mdx:34` 去掉了 `` `Headers` `` 代码标记                                                                                                                                                                                                                                                        | "改 headers 前先 clone"仍然是同一条操作规则，含义不变                                                                                                                            |
| grok #14                           | `docs/errors.mdx` 把 `` `fault.cause instanceof StructError` `` 拆成两个 span（ko、zh 三种）                                                                                                                                                                                                                              | 句子仍是"调用 format/flatten/prettify 前先把 `fault.cause` 收窄为 `StructError`"，含义不变                                                                                       |
| grok #5 附带                       | ja-JP/ko-KR `api/core/websocketdefinition-type.mdx` 重复写了默认值 `0`                                                                                                                                                                                                                                                    | 默认值仍是 `0`，`0` 时不排队，与 en-US 一致                                                                                                                                      |
| grok #15                           | zh-Hant-HK 与 zh-Hant-TW 有 8 个文件字节相同                                                                                                                                                                                                                                                                              | 全部是 `meta.json`，标题在两地写法相同；按 brief 只作信息项                                                                                                                      |
| 核验时新增候选                     | ja-JP `docs/integrations/opentelemetry-server.mdx:73` 少了 `` `close` `` 代码标记                                                                                                                                                                                                                                         | 只是 "close の前に" 没加反引号，Bun/Node 的 1006 行为描述完整且正确                                                                                                              |
| 核验时新增候选                     | 共 67 页行内代码多重集新增（`statusText`、`HttpExecuteOptions`、`request`、`bigint`、`builder`、`attempts`、`Content-Type`、`TRACE`/`Tracer`、`error.type`、`JSON.parse`、`outgoing`、`FaultCode`、`kind`、`export`、`execute`、`close`、`output`/`error`、`invalid_type`、`Error`/`path`、`binaryType`/`'arraybuffer'`） | 我逐条对照了 en-US 原句（`scratch/show.py`），全部是把已有标识符再提一次、给原文英文词加了代码标记，或拆分表达式；没有新增错误的标识符、默认值或 fault code                      |
| 核验时新增候选                     | ko-KR、zh-Hant-TW、zh-Hant-HK `api/http.mdx:16` 中 "optional `output`/`error`/`operation`" 只在 `input` 前写了一次"可选/選填/선택"                                                                                                                                                                                        | 并列结构有歧义，但 en-US 第 76 行本身也是这种写法；同页第 21 行明确说"省略一边则不读该 body"；类型系统也会提示，不构成含义反转                                                   |
| brief Part 1 #2                    | 根 `meta.json` 缺 `title`                                                                                                                                                                                                                                                                                                 | en-US 同样缺；Fumadocs schema 中 `title` 是可选字段（codex 已核对 `fumadocs-core/dist/source/schema.js`）                                                                        |
| brief Part 1 #12                   | 简繁混用                                                                                                                                                                                                                                                                                                                  | 我的独立脚本 `scratch/variant.py` 统计：zh-Hans 中出现繁体专用字的页 0；zh-Hant-TW、zh-Hant-HK 中出现简体专用字的页 0                                                            |
| 已在别处 CONFIRMED                 | en-US 层面的 `docs/sse.mdx:64` HTTP_STATUS 表述、累计重连预算、`sse.mdx:99` "repository-validated"、`maxDelayMs` "capped"、`withEndpoint` 相对 base                                                                                                                                                                       | 本分区没有审计者把它们当 i18n 发现报告；即使有，也是 en-US 继承来的问题，按 i18n 重复项驳回                                                                                      |
| codex coverage                     | `bun test ./test`（doc）中 `preview.test.ts` 报 `EADDRINUSE`                                                                                                                                                                                                                                                              | 属于环境问题，不在本分区范围，也不是 i18n 发现                                                                                                                                   |
| grok #1、#6、#8、#9、#10、#11      | 文件集合漂移、SSE/WS 默认值对调、安全建议说反、Struct 矩阵对调等                                                                                                                                                                                                                                                          | grok 已经驳回，我复核认同：文件集合一致；inline code 和数字与 en-US 对齐；我抽读的 zh-Hant-HK `docs/sse.mdx`、zh-Hans OTel 全页中关键段落含义一致                                |

### P10b-i18n-other

#### P10b-i18n-other 驳回清单

两位审计者都没有正式 finding ID。下面按机械检查的类别列出候选，来源写作"审计者:检查项"。

| 来源                                                              | 候选                                                                                                                                                                                                                                                                                                                                                                                       | 驳回理由                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| grok:inline-code ×39；codex:inline-code 39 页                     | 行内代码多重集差异（ar 15、de-DE 4、es-ES 4、fr-FR 10、ru-RU 6）                                                                                                                                                                                                                                                                                                                           | 只是加或去反引号、或等义改写，标识符和取值没变。抽查了风险最高的几条：es-ES OTel 页 `HTTP_STATUS` 在正文第 162 行表格和第 169 行加了反引号，语义相同；ar `docs/http.mdx:130` 和 fr-FR `docs/http.mdx:137` 把 interceptor `throw` 译成动词，`EXT_INTERCEPTOR_FAILED` 以及 `ERR_ABORTED`/`ERR_TIMEOUT` → `NET_ABORTED`/`NET_TIMEOUT` 的例外都保留；ar `docs/http.mdx:144` 多出的 `cause` 对应 en "the cause message"；ru-RU `docs/web-socket.mdx:58` 多出的 `jitter` 是 "SSE jitter" 加了反引号，默认值行逐字一致（`jitter: 0`，`0.2` → `0.8x`–`1.2x`）；fr-FR `faultclass-type.mdx:12` 重复点名 `FaultCode`；ar `docs/errors.mdx:113` 把 `code` 译为"错误码"；ar `recipes/get-declared-404.mdx:22` 和 fr-FR 第 22 行用代词替代 `error`，同句仍写明 `error.data` 为 `undefined`、body 不读 |
| grok:number ×1 + number-section ×1；codex:numbers 1 页            | ar `docs/errors.mdx:77` 少一个数字 `0`                                                                                                                                                                                                                                                                                                                                                     | en "no status-0 response" 写成 "لا توجد استجابة بحالة صفر"，回译为"不存在状态为零的响应"，含义相同                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| grok:number ×1 + number-section ×1；codex:numbers 1 页            | ar `docs/interceptors.mdx:66` 少一个数字 `0`                                                                                                                                                                                                                                                                                                                                               | 同上，"وليس استجابة بحالة صفر" 回译为"而不是状态为零的响应"；`NET_*` 归因句保留                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| codex:link-target ×5                                              | 五种语言 `docs/index.md:8` 的 `/` 译成 `/<locale>`                                                                                                                                                                                                                                                                                                                                         | `doc/app/lib/i18n.ts` 的 `localePrefix(locale)` 为 `/${locale}`，正是该语言首页的规范路由；页面没有指向英文页或其他语言                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| grok:untranslated-frontmatter ×6                                  | ar、ru-RU 的 `api/opentelemetry-server.mdx`、`api/react.mdx`、`api/vue.mdx` 的 title 与英文相同                                                                                                                                                                                                                                                                                            | title 是包名 `@defjs/...`，按设计保留                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| codex:frontmatter-identical（非标识符 8 条）                      | ar、ru-RU 的 `docs/integrations/{opentelemetry-server,react,vue}.mdx`、`index.mdx`                                                                                                                                                                                                                                                                                                         | 是产品名 OpenTelemetry/React/Vue/Defjs。另外 ar 171 条、ru-RU 172 条是 API 标识符标题。五种语言都没有与 en-US 相同的 description（逐页 `grep` 比对为 0）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| codex:leftover-english ×8；grok:leftover-english ×5（两者有重叠） | ar `api/client.mdx:99`、`opentelemetryserveroptions-type.mdx:24`、`opentelemetryservertransportoptions-type.mdx:17`；ru-RU `fetchhandler.mdx:12`、`websocketrequestshape-type.mdx:21`、`opentelemetryserveroptions-type.mdx:24`、`opentelemetryservertransportoptions-type.mdx:17`、`docs/client.mdx:36`、`docs/design-decisions.mdx:78`、`docs/integrations/opentelemetry-server.mdx:105` | 都是本地语句，ASCII 比例高只是因为夹着 Fetch、WebSocket、W3C 等术语。核对了凭据建议（ru/ar `websocketrequestshape-type.mdx:21`：credentials 放 `beforeConnect` 或 interceptor），与 en 一致                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| verify:extra-parity strong                                        | 加粗数差异：`api/errors.mdx`（ar/de-DE/fr-FR/ru-RU 多加粗）、`docs/design-decisions.mdx`（ar/de-DE/fr-FR 多加粗）、OTel 页 "Options and hooks" 节（ar/de-DE/es-ES/fr-FR 丢了 `**not**` 的加粗）                                                                                                                                                                                            | 只是强调样式不同。OTel 那一句的否定在四种语言里都还在："ولا يوقف العملية" / "stoppt die Operation nicht" / "sin detener la operación" / "sans arrêter l'opération"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| verify:extra-parity 未译标题/单元格                               | ar `api/opentelemetry-server.mdx` 的标题 "OpenTelemetry server" 和单元格 "W3C Trace Context + Baggage"；ru-RU 同页单元格；ru-RU `docs/client.mdx` 单元格 "HTTP XSRF cookie → header"；ru-RU `docs/sse.mdx` 标题 "Server-Sent Events"                                                                                                                                                       | 都是协议、规范或技术名，属于已知设计                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### P11-ops

- **P11-ops-grok-04 — 四个包的 `npm publish` 没有 provenance / `id-token: write`。** 驳回原因：这是加固建议，HEAD 上没有缺陷或失败场景。auditor 已确认 token 没有泄漏（printf 使用单引号，由 npm 在运行时展开）。rubric 的 P3 指清理或过度设计，不包括加固项。如需加固，具体改动是：四个包 job 增加 `permissions: { contents: read, id-token: write }` 并改用 `npm publish --provenance`，或改为 npm trusted publishing（dist 中的 `repository.url` 为 `defjs/defjs`，与 upstream remote 一致）。codex 也明确把它当作可选加固，没有报告。
- **（协调者请求的去重核对）P05-core-tests-02（CI 只在 Bun 上运行测试）。** 两位 P11 auditor 都没有报告同一问题，本分区没有重复条目，无需合并。

### P12-project-docs

| 来源 ID                                             | 标题                                                                                                  | 拒绝理由                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P12-project-docs-codex-01, P12-project-docs-grok-01 | 已删除的 packed-consumer / ES2022 门禁仍被写成当前验证                                                | duplicate of P11-ops-04（`docs/releases/0.4.0.md:66`、`packages/core/README.md:65` 已在其 Location 中）。P12 补充位置：`packages/core/README.md:71-74`，“the repository-tested command is: `bun run dist/index.js`” 没有任何 tracked 文件执行，已删除的 gate 当年跑的是 `runtime-smoke.ts`。grok 列的 10 个 locale `docs/sse.mdx:99` 属于 P09a-doc-guides-05 / P10                                                                         |
| P12-project-docs-codex-02                           | OTel README 把所有声明响应都描述为 JSON 媒体校验                                                      | duplicate of P09b-doc-api-04（README:95 已是其已知位置）。P12 补充位置：`packages/opentelemetry-server/README.md:273`（Transport span boundary 一节的同一错误前提）。本人复跑探针：`struct.string()` 配 `text/html`，200 时 fault=null、logs=0，502 时 `HTTP_STATUS`、logs=0                                                                                                                                                               |
| P12-project-docs-codex-04                           | SSE 文档把非 2xx 握手错误一概归为 HTTP_STATUS                                                         | duplicate of P09a-doc-guides-02（同一根因：SSE 握手已声明的 `error` body 失败得到 RES_*，文档未说明），相关 P03a-core-sse-05。P12 补充位置：`packages/core/design.md:212`（“非 2xx 启动是 `HTTP_STATUS`”；同页 HTTP 段已写明条件，SSE 段“同样按 kind”，所以实际偏差只在 struct 不匹配一项）；`packages/opentelemetry-server/README.md:97` 仅限从句，其“总记一条”的主张实测成立（RES_DECODE_FAILED / RES_MEDIA_TYPE_INVALID 握手各 logs=1） |
| P12-project-docs-codex-08                           | Content-Type 总则遗漏 FormData 必须清除 header 的例外                                                 | 拒绝：`design.md:152` 与 `http.mdx:77` 在同一张表中已写明 FormData 清除 `Content-Type`，总则句是对“检测结果”的概括；与 P02 H4（两名审计员及 P02 verifier 一致驳回）同一裁定；FormData 手写 Content-Type 会缺少 boundary，正是清除行为所保护的情形，没有现实失败场景                                                                                                                                                                        |
| P12-project-docs-codex-09, P12-project-docs-grok-06 | THIRD_PARTY_NOTICES 指向已不存在的 SSE parser 路径                                                    | 并入 P11-ops-01：其 Location 已含 `packages/core/THIRD_PARTY_NOTICES.md:5`，Evidence 写明旧路径，Fix direction 写明“修正其中的源码路径”。不另立条目                                                                                                                                                                                                                                                                                        |
| P12-project-docs-grok-04                            | OTel 文档把 GitHub 默认分支上不存在的路径写成可点击链接                                               | 拒绝：brief 要求对照本分支的 tracked 路径核对 GitHub 链接，而这些路径在 HEAD 上都存在（`doc/content/en-US/docs/integrations/opentelemetry-server.mdx` 的锚点 `#logs-and-third-party-loggers` 正确，`doc/examples/opentelemetry-logging` 也被跟踪）。`main` 上 404 只是 feat/up（领先 171 个提交）尚未合并的暂态，合并后即可解析                                                                                                            |
| P12-project-docs-grok-08（部分）                    | DESIGN-builder.md 引用已删除的 `internal/request_builder.ts:463`、`doc/guide/design-decisions.md:137` | 该部分拒绝：这些引用位于 §1“问题”一节，描述的是被本设计替换掉的旧 `build` 实现，本身就是历史坐标，不构成误导。状态行与 FormData 部分已并入 P12-project-docs-05                                                                                                                                                                                                                                                                             |
| P12-project-docs-grok-09                            | 热点分析仍要求把已合入的补丁 git apply 到当前树                                                       | 拒绝：`hotspot-analysis.md:5` 的横幅写明 “10 个 patch 已全部应用到工作区 … 第 1–8 节保留第一轮原文”。§7 是有日期的第一轮原文，没有任何 tracked 文件链接 `docs/perf/`（`git grep 'hotspot-analysis\|docs/perf' -- . ':!docs/perf'` 无结果），符合 `_shared` §4 和 brief 中历史记录不报的规则                                                                                                                                                |
| P07 verifier 侧注                                   | `packages/vue/README.md:88-94` 的 `provide()` 缺少 `<script setup>` 外壳                              | 拒绝（仅润色）：`provide()` 只能在 setup 中调用是 Vue 自己文档化的规则，同一 README 的 `app.use` 片段同样是片段写法；与 P07 verifier 裁定一致                                                                                                                                                                                                                                                                                              |
