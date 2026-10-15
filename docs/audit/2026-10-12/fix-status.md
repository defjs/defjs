# zen-kit 审计修复状态

- 审计基线：`feat/up` @ `6b0b0c1e`；审计报告见 [findings.md](findings.md)
- 第一轮范围：全部 P0/P1，以及执行摘要中的 9 类系统性根因；另含浏览器实测确认的 F014、F052，共修复 61 项
- 第二轮范围（2026-10-15）：重新复现并按 TDD 修复 F022、F027、F029、F035、F036，含同根路径与补丁回归复核
- 第三轮范围（2026-10-15）：全部剩余项 F028、F030、F031、F051、F062、F063、F073、F074、F075、F076、F077，含独立复核发现的同根回归
- 当前结果：76 项已修复，F051 按项目维护者决定接受上游行为，未决项为 0；定制补丁及配套逻辑已移除，调整后的完整本地门禁通过。此结论不代表已完成远端 CI、发布或生产部署
- 第二轮及第三轮基线：`feat/up` @ `93b6fb45`；以下保留各轮本地验收结果，提交与推送状态以 Git 历史和远端分支为准

## 维护者决定

- F001：不随包附带第三方许可声明。SSE 解析器按 WHATWG 规范重写，删除改编署名与 `THIRD_PARTY_NOTICES.md`
- 重连预算：SSE 与 WebSocket 均按每次掉线计算，连接成功后预算与退避指数清零；连上即断的连接会以基础延迟持续重连，可用 `shouldReconnect` 终止
- 日志安全：默认消息只描述收到的类型，不含原值；record 的 key 属于路径，会出现在消息中
- HTTP Content-Type：推断类型只存于 `request.bodyContentType`，库不再写入 headers；显式 `content-type` header 永远优先；替换 body 后重新检测
- 服务端运行时下 FormData 搭配 `onUploadProgress` 改为分块发送，不带 `Content-Length`；需要长度的端点请省略 `onUploadProgress`
- 新增公开导出 `isAbortCause`、`isTimeoutCause`，取消哨兵带 `Symbol.for` 品牌，可跨 Core 实例识别
- 文档域名改为 `https://defjs.lyz.cloud`；删除 `CODE_OF_CONDUCT.md`；移除 Codecov 徽章
- F051（2026-10-15 策略调整）：接受 Fumadocs 官方默认搜索缓存行为，撤回本地依赖补丁和同页恢复扩展。保留现有 `16.17.1` 版本，不以缓存恢复能力作为必须修复的生产门槛；索引加载失败后可刷新页面重新加载

## 发布与仓库外操作（本轮未执行）

- GitHub 仓库变量 `SITE_URL` 与仓库主页需改为 `https://defjs.lyz.cloud`（域名解析就绪后，另行授权执行）
- 已发布的 `@defjs/core@0.4.0-beta.1` 无法原地修改；本轮未发布新版本。本文记录本地验证，远端 CI 和部署结果需另行确认

## 逐项状态

| ID   | 严重度 | 标题                                                     | 状态         | 处理                                                                                             |
| ---- | ------ | -------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------ |
| F001 | P0     | core 发布包遗漏 fetch-event-source 的 MIT 声明           | 已修复       | 按 WHATWG 规范重写 SSE 解析器，删除改编署名与 `THIRD_PARTY_NOTICES.md`（WP-SSE）                 |
| F002 | P1     | 定义路径校验可被反斜杠或空白绕过，认证头发往他域         | 已修复       | 解析后校验 origin 与目录前缀，构建阶段报 `REQ_BUILD_FAILED`；三浏览器复测通过（WP-A、WP-FIXUP）  |
| F003 | P1     | SSE errorOpenInfoMap 键为共享哨兵，跨请求泄露响应快照    | 已修复       | 删除模块级 `errorOpenInfoMap`，打开信息限定在单次执行（WP-A）                                    |
| F004 | P1     | 默认 fetch 在模块求值时固定，之后替换的全局 fetch 被绕过 | 已修复       | 默认 fetch 改为发送时解析，导入时无 fetch 不再抛错（WP-HTTP、WP-FIXUP）                          |
| F005 | P1     | Node 上 FormData 带进度时整体缓冲，无视超时与取消        | 已修复       | FormData 上传进度改为流式转换并响应取消（WP-HTTP）                                               |
| F006 | P1     | Bun 上 FormData 带进度上传丢失 boundary                  | 已修复       | 保留 multipart boundary（WP-HTTP）                                                               |
| F007 | P2     | String(fault) 含响应字段原值，与“可直接记录”相冲突       | 已修复       | 默认消息只写类型；解码失败消息固定为 `Response body could not be decoded`（WP-STRUCT、WP-FIXUP） |
| F008 | P2     | WebSocket 重连 attempts 为整个会话累计预算，文档未说明   | 已修复       | WebSocket 重连预算按每次掉线计算（WP-WS）                                                        |
| F009 | P2     | SSE 重连 attempts 为整条逻辑流累计预算，文档未说明       | 已修复       | SSE 重连预算按每次掉线计算并写入文档（WP-SSE、DOCS2/3）                                          |
| F010 | P2     | WebSocket 出站 JSON 静默改写非 JSON 值，HTTP 同值拒绝    | 已修复       | WebSocket 文本帧复用 HTTP 非 JSON 守卫（WP-WS、WP-FIXUP）                                        |
| F011 | P2     | endpoint 或路径配置错误被报告为 NET_UNREACHABLE          | 已修复       | 配置/URL 错误在传输前报 `REQ_BUILD_FAILED`，不再重试（WP-A）                                     |
| F012 | P2     | transport-origin 标记永久记住共享哨兵，拦截器故障误分类  | 已修复       | 删除进程级 transport-origin WeakSet，改为单次执行跟踪（WP-A）                                    |
| F013 | P2     | withSSEReconnect 数值参数不校验，NaN 预算导致无限重连    | 已修复       | SSE 重连参数预检，非法时报 `REQ_OPTIONS_INVALID`（WP-SSE）                                       |
| F014 | P2     | Worker 中 XSRF token 会附加到跨源请求                    | 已修复       | Worker 同源判断改用 `location.origin`；三浏览器复测通过（WP-HTTP）                               |
| F015 | P2     | 非 ASCII 事件 ID 致 Last-Event-ID 重连失败或编码错误     | 已修复       | Last-Event-ID 按 UTF-8 发送并纳入每轮错误边界（WP-SSE）                                          |
| F016 | P2     | 发布 job 不运行 typecheck、lint 或测试                   | 已修复       | 发布 job 增加构建配置类型检查与打包清单断言（WP-OPS、WP-FIXUP）                                  |
| F017 | P2     | 适配器单独发布时 ClientProvider 返回类型退化为 any       | 已修复       | 适配器发布 job 先构建 core（WP-OPS）                                                             |
| F018 | P2     | CI 只在 Bun 上运行测试，Node 运行时行为无守卫            | 已修复       | CI 新增 Node 测试 job 与 Deno 冒烟 job（WP-OPS）                                                 |
| F019 | P2     | SSE 打开后 TimeoutError 中止抛错，文档称为 aborted       | 已修复       | 文档修正（DOCS1）                                                                                |
| F020 | P2     | SSE 重连非 2xx 的终止码与文档 HTTP_STATUS 不符           | 已修复       | 文档修正（DOCS1）                                                                                |
| F021 | P2     | withEndpoint 文档称接受相对 base，实际只接受绝对 URL     | 已修复       | 文档与 JSDoc 修正（WP-A、DOCS1）                                                                 |
| F022 | P2     | HTTP 拦截器结果非 HttpResponse 时 reject 或误报          | 已修复       | 校验三种传输的链尾结果并清理失败资源；HTTP 响应品牌兼容跨副本（第二轮 TDD）                      |
| F023 | P2     | binaryType 写入抛错时已建 socket 被遗留且不关闭          | 已修复       | binaryType 赋值失败时关闭已建 socket（WP-WS）                                                    |
| F024 | P2     | onUploadProgress 覆盖显式指定的 Content-Type             | 已修复       | 显式 Content-Type 优先于检测值（WP-HTTP）                                                        |
| F025 | P2     | 拦截器替换 body 后无法指定 Content-Type，空 body 留旧头  | 已修复       | 推断类型只存于 `bodyContentType`，显式 header 永远优先（WP-HTTP，按 linus 复审规则重做）         |
| F026 | P2     | 下载进度把压缩后的 Content-Length 当作解码总量           | 已修复       | 压缩响应与跨源兜底均报 `lengthComputable: false`（WP-HTTP、WP-FIXUP）                            |
| F027 | P2     | 递归 Struct 遇深层或循环输入抛 RangeError                | 已修复       | parser、matcher、交集合并共享 256 层容器预算，保留逻辑路径与调用者异常（第二轮 TDD）             |
| F028 | P2     | 外层重试复用 Headers，后续 span 挂在已结束的 span 下     | 已修复       | 第三轮：修复与验证详见下方记录                                                                   |
| F029 | P2     | queryPropagation 只追加不替换同名键，接收方读到旧上下文  | 已修复       | 替换实际注入字段的同名参数；保留无关键的字节与字面问号，保持两种 query 表示同步（第二轮 TDD）    |
| F030 | P2     | HTTP responseHook 的 rejection 未被记录                  | 已修复       | 第三轮：修复与验证详见下方记录                                                                   |
| F031 | P2     | SSE 元组第三槽读 live open，链尾异步期间可被重连覆盖     | 已修复       | 第三轮：修复与验证详见下方记录                                                                   |
| F032 | P2     | maxDelayMs 只约束 jitter 前的基数，实际等待可超上限      | 已修复       | `maxDelayMs` 改为 jitter 后的硬上限（WP-A）                                                      |
| F033 | P2     | 路径占位符文法未文档化，含冒号的静态段无法表达           | 已修复       | 路径占位符文法写入文档（DOCS1）                                                                  |
| F034 | P2     | GraphQL 配方拒绝 data: null，应用错误被误报              | 已修复       | GraphQL 配方 `data` 改为 `.nullish()` 并补夹具（DOCS1）                                          |
| F035 | P2     | 嵌套 intersection 展平时丢弃内层 nullable                | 已修复       | 带 nullable 的内层交集不再展平；保留非 null、alias 与 tag 行为（第二轮 TDD）                     |
| F036 | P2     | 单成员 intersection 的公开类型丢失 optional              | 已修复       | 条件返回类型覆盖单成员、多成员和可变长度 tuple；对象字段保守推导 optional（第二轮 TDD）          |
| F037 | P2     | errorMap 返回空字符串时不替换默认消息                    | 已修复       | `errorMap` 返回 `''` 时替换消息（WP-STRUCT）                                                     |
| F038 | P2     | 跨包副本的 bigint/date 转换失败绕过本次 errorMap         | 已修复       | 跨副本转换失败也应用本次 `errorMap`（WP-STRUCT）                                                 |
| F039 | P2     | 两份 @defjs/core 实例并存时调用方取消被记为 WARN         | 已修复       | 取消哨兵增加 `Symbol.for` 品牌，新增 `isAbortCause`/`isTimeoutCause`（WP-OTEL）                  |
| F040 | P2     | SSE 按行和按字段值剥离 BOM，偏离规范                     | 已修复       | 随解析器重写修复 BOM 处理（WP-SSE）                                                              |
| F041 | P2     | 退避基数为 0 时第 1025 次重试抛 RangeError               | 已修复       | 退避基数为 0 或指数溢出时饱和而非 NaN（WP-A）                                                    |
| F042 | P2     | 文档仍宣称已删除的 packed-consumer 与 ES2022 基线验证    | 已修复       | 删除已失效的门禁声明，改写为实际运行的检查（DOCS1/3）                                            |
| F043 | P2     | Core 与 OTel 发布包 README 的文档站链接全部失效          | 已修复       | README 链接改为现行路由，域名改为 `defjs.lyz.cloud`（DOCS1）                                     |
| F044 | P2     | design.md 关于 subprotocol token 的说明与实现相反        | 已修复       | design.md 修正（DOCS1）                                                                          |
| F045 | P2     | CODE_OF_CONDUCT 举报渠道为空，执行流程不可用             | 已修复       | 按维护者决定删除 `CODE_OF_CONDUCT.md`（DOCS1）                                                   |
| F046 | P2     | abort 监听器回归测试只比次数，移除错误回调仍全绿         | 已修复       | 监听器清理测试断言回调身份（WP-A）                                                               |
| F047 | P2     | WebSocket attempt 清理的两处移除无任何测试锁定           | 已修复       | 两处 WebSocket 清理行加测试（WP-WS）                                                             |
| F048 | P2     | SSE 退避参数测试只断言次数，去掉接线后仍全绿             | 已修复       | SSE 退避参数测试断言实际延迟（WP-SSE）                                                           |
| F049 | P2     | responseHook 先于 span 结束的测试检不出顺序倒置          | 已修复       | responseHook 顺序测试锁定顺序（WP-OTEL）                                                         |
| F050 | P2     | checkLinks 把无 index.html 的目录当作有效链接目标        | 已修复       | checkLinks 目录必须有 index.html（WP-SITE）                                                      |
| F051 | P2     | 搜索索引首次加载失败后被永久缓存，搜索静默失效           | 接受上游行为 | 项目维护者决定撤回定制补丁及同页恢复扩展，采用官方默认行为（2026-10-15 策略调整）                |
| F052 | P2     | API 索引筛选在 tr/az 默认区域下大写 I 漏匹配             | 已修复       | 改用与区域无关的小写折叠；三浏览器 tr-TR 复测通过（DOCS1）                                       |
| F053 | P3     | 多处文档把已声明 body 一律视为 JSON 检查与解析           | 已修复       | 文档修正（DOCS1）                                                                                |
| F054 | P3     | OTel 文档称 execute timeout 总记一条日志，链外超时不记   | 已修复       | 文档修正（DOCS1）                                                                                |
| F055 | P3     | 简中与港繁 OTel 页把“已声明 body 缺失”译成“未声明”       | 已修复       | 译文修正（L10N）                                                                                 |
| F056 | P3     | 解码结果表对 SSE 握手 error struct 失配不成立            | 已修复       | 文档修正（DOCS1）                                                                                |
| F057 | P3     | withTimeout JSDoc 仍写不存在的 ABORTED/TIMEOUT           | 已修复       | JSDoc 故障码修正（协调者）                                                                       |
| F058 | P3     | struct.object 页称 .alias 按 wire key 读取               | 已修复       | 文档修正（DOCS1）                                                                                |
| F059 | P3     | HttpRequestShape.body 在模块页误写为 unknown             | 已修复       | 文档修正（DOCS1）                                                                                |
| F060 | P3     | OTel README 把 server.port 列为必记属性                  | 已修复       | 文档修正（DOCS1）                                                                                |
| F061 | P3     | Errors 指南称 data.status 通过 struct 即证明来自后端     | 已修复       | 文档修正（DOCS1）                                                                                |
| F062 | P3     | send 内同步派发的心跳 ACK 被随后新建的超时覆盖           | 已修复       | 第三轮：修复与验证详见下方记录                                                                   |
| F063 | P3     | injectClient() 在注入上下文外报错时误称未安装插件        | 已修复       | 第三轮：修复与验证详见下方记录                                                                   |
| F064 | P3     | Struct README 四条文档链接失效，构造器表行重复           | 已修复       | Struct README 链接与重复行修正（DOCS1）                                                          |
| F065 | P3     | DESIGN-builder.md 仍自称现行契约且与代码相反             | 已修复       | 标为历史设计记录（DOCS1）                                                                        |
| F066 | P3     | 根 README 的 Codecov 徽章停在 2025-03-14 快照            | 已修复       | 删除 Codecov 徽章（DOCS1）                                                                       |
| F067 | P3     | 港繁 interceptors 指南有一整句英文未翻译                 | 已修复       | 补译（L10N）                                                                                     |
| F068 | P3     | types.type.test.ts 的 Equal 接受 any                     | 已修复       | 类型测试改用严格比较（WP-A）                                                                     |
| F069 | P3     | 被 ignore 的 discriminatedUnion 守卫无测试               | 已修复       | 去掉 istanbul ignore 并补测试（WP-STRUCT）                                                       |
| F070 | P3     | 五个 Content-Length 测试只断言 duplex                    | 已修复       | 改为读取流的表驱动测试（WP-HTTP）                                                                |
| F071 | P3     | 文档构建指纹不含依赖版本，升级后旧产物仍判新鲜           | 已修复       | 构建指纹纳入 `bun.lock` 与根 `package.json`（WP-SITE、WP-FIXUP）                                 |
| F072 | P3     | exports.test.ts 对 export type * 等纯类型导出失明        | 已修复       | 导出扫描器遇到未知语法即失败（WP-SITE）                                                          |
| F073 | P3     | 进程级 miss 日志使 http.e2e 同进程重跑误报失败           | 已修复       | 第三轮：修复与验证详见下方记录                                                                   |
| F074 | P3     | teardown 端口探测在端口被他进程重绑时误报失败            | 已修复       | 第三轮：修复与验证详见下方记录                                                                   |
| F075 | P3     | preview.ts 三处路径边界与静态托管不一致                  | 已修复       | 第三轮：修复与验证详见下方记录                                                                   |
| F076 | P3     | fillUrl 数组取首项分支在公开执行链上不可达               | 已修复       | 第三轮：修复与验证详见下方记录                                                                   |
| F077 | P3     | @types/react-dom 版本在两处各自固定                      | 已修复       | 第三轮：修复与验证详见下方记录                                                                   |

## F051 策略调整与验证（2026-10-15）

- 项目维护者明确选择官方默认行为，不再要求首次索引失败后原页面内重试恢复。F051 因接受上游行为而关闭，不计为已修复；其他 76 项修复保持不变。
- 移除范围为依赖 patch 及 `patchedDependencies` 登记、自定义搜索 runner／重试状态／错误界面／焦点及 ARIA 覆盖、仅供该界面使用的 11 语言文案、补丁专项单测和 e2e，以及没有其他使用者的 `patches/**` 构建指纹扫描。
- 恢复官方 `useStaticSearch` 直接用法与原有搜索测试；保留 F071 的根 manifest／lock 指纹校验、F075 的 preview 修复、F077 的 React 类型版本统一，不升级 Fumadocs。
- 实际安装依赖已恢复官方 `fumadocs-core@16.17.1`。删除登记后普通安装曾保留本地旧补丁，因此备份并精确重装该包；实际解析路径及 `.bun` 内两份搜索模块均与 npm 官方发布文件逐字节一致，而不只是移除了 patch 文件。
- 调整后完整 `bun run verify` **退出码 0**：lint、格式、类型检查（主项目 278 文件、文档站 155 文件、示例 178 文件）、四包测试与构建、文档构建、站点 e2e 全部完成。
- core **2324 项通过、2 项仅在 Node 运行**；OTel **332 项**、React **12 项**、Vue **18 项**通过；四包四项覆盖率仍全部为 **100%**，未改变阈值或忽略规则。
- 文档单测 **63 项**、根测试 **5 项**、站点 e2e **23 项**通过，包含 Chromium/Firefox；**2279 个生成页面**的链接校验通过。相较历史记录减少的 7 项文档单测、8 项 e2e 只针对已撤回的定制功能；原有 6 项搜索 e2e 全部保留并通过。
- 六份原有搜索／文案／构建指纹源码及测试与 HEAD 逐字节一致；manifest 和 lock 仅移除补丁登记。除该范围及本状态文件外，其余 **2896 个基线文件**逐字节未变，其他审计修复均保留。该阶段未发布或升级依赖，提交前完整验证结果如上。

## 第三轮原实现与验证（2026-10-15，历史记录）

以下是策略调整前的实现与验证记录，其中 F051 的定制方案现已撤回，不能作为当前同页恢复能力的承诺；当前状态以上节为准。

### 剩余 11 项处理结果

| ID   | 处理                                                                                                                                                                                                                                            |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F028 | HTTP/SSE 传播注入使用独立 `Headers`，外层重试保持同父兄弟 span，不污染调用方载体；SSE 在同步 `requestHook` 后复制，保留更新认证头、删除敏感头等原有行为。                                                                                       |
| F030 | recording span 仍记录 hook 失败事件；已结束或未采样 span 通过 `diag.error` 报告，需配置 `diag.setLogger(...)`。不等待异步 hook、不延长 span；诊断仅含 hook 名、错误类型及 trace/span ID，不含原始错误消息、堆栈或请求数据。                     |
| F031 | 每条所属 SSE 连接保留首次成功握手，原生及透传同一 `open` 对象的 wrapper 返回该快照。显式转换元数据的 wrapper 保留自己的公开 `open`，不因共享 `closed` 绕过 URL 或 header 过滤。                                                                 |
| F051 | 固定版本 `fumadocs-core@16.17.1` 的 Bun 受控补丁在加载失败时删除 rejected cache；成功缓存及并发去重保留。搜索错误有 11 语言提示，可原查询重试、继续输入或重开恢复；键盘焦点与错误态 combobox ARIA 均有双浏览器回归。构建指纹包含 `patches/**`。 |
| F062 | 心跳 ACK deadline 在 `send()` 前建立，支持同步 ACK；发送异常和生命周期重入只清理所属 runtime，不误停替换后的心跳。                                                                                                                              |
| F063 | Vue 错误同时说明有效注入上下文与 client provider 两项要求，保留 `vue >=3.0.0` 兼容，不引入 `hasInjectionContext`。同步 setup、支持版本的 `app.runWithContext` 与编译器恢复的上下文仍有效。                                                      |
| F073 | 每次执行生成唯一 miss/control 路径，保留精确的未触达及唯一控制命中断言，同一 globalSetup 下重复运行不读取旧记录。                                                                                                                               |
| F074 | 删除关闭后重新连接端口的 TOCTOU 探测，依赖所属 server 的关闭回调、错误与超时处理。回归验证实际端口被另一服务器复用时不会误报，同时验证真实关闭失败、活跃连接清理和重复 teardown。                                                               |
| F075 | preview 的非法 URL 转义返回 400，合法点前缀和零字节文件可访问；真正目录越界仍拒绝，目录入口和 404 回退保留。                                                                                                                                    |
| F076 | `fillUrl` 与 WebSocket 构建 params 收窄为 materialized string map，删除不可达的数组截断及矛盾测试，保留公开路径标量校验、缺失参数、空段和点段保护。                                                                                             |
| F077 | React 两项类型依赖统一使用 catalog，`@types/react-dom` 对齐 `19.3.0`；锁文件移除旧重复版本，无其他包版本升级。                                                                                                                                  |

### 独立复核与完整门禁

- 行为缺陷先取得失败回归，再完成最小修复；F076 另有类型红测，F077 使用 manifest/lock 断言。独立复核发现的 SSE wrapper 元数据覆盖、SSE hook 头修改顺序、测试超时后的清理、Retry 键盘焦点及悬空 ARIA 问题均已修复并复验。
- 新测试通过 `onTestFinished` 与普通 `finally` 共享幂等清理。故意触发测试 watchdog 的探针仍以 1 项预期超时失败退出，但后续哨兵确认 fake timers、console mock 已恢复，保留的真实 server 引用已无监听；这不是把故障注入套件宣称为全绿。
- 最终集成版 `bun run verify` **退出码 0**：lint、格式、类型检查（主项目 284 文件、文档站 156 文件、示例 178 文件）、测试、四包构建、文档构建及站点 e2e 全部完成。
- core **2324 项通过、另 2 项仅在 Node 运行**；OTel **332 项**、React **12 项**、Vue **18 项**通过。四包语句、分支、函数、行覆盖率均为 **100%**；未降低阈值或新增覆盖率忽略。
- 文档单测 **70 项**、根 `test/` **5 项**、站点 e2e **31 项**通过；**2279 个生成页面**的链接与锚点校验通过。Chromium/Firefox 均实际运行，搜索错误恢复与无障碍用例包含在最终站点门禁内。
- Node v26.11.1 独立完整测试：core-server **100 文件、2168 项**；OTel **13 文件、332 项**，均退出码 0。最终集成版三份夹具测试在 Bun/Node 的 `--repeats=1` 下均 **26/26** 通过。
- 真实 OTel SDK 的父上下文、载体隔离、结束后异步诊断及 never-settle 非阻塞回归，在 Bun/Node 均 **8/8** 通过；永久严格 tracer 回归包含在完整 OTel 套件中。
- Deno 2.9.7 对实际构建产物的 HTTP、SSE、WebSocket、`struct.parse` 冒烟全部通过。四包发布构建配置类型检查和 `assert-pack` 均退出码 0；仅做打包清单检查，没有发布。
- 冻结锁文件校验通过；隔离目录从零 `node_modules` 执行 frozen/offline 安装（忽略生命周期脚本）后，受控依赖补丁自动生效，真实搜索客户端 **6/6** 回归通过。
- Vue、OTel、SSE 的 **11 类页面 × 11 语言，共 121 页**完成同步和独立语义核对；搜索提示也覆盖全部 11 语言。未重写无关译文。
- 最终 2907 个版本控制或未忽略文件与“本轮开始时完整工作区 + 全部审阅补丁”重建快照逐字核对，除本状态记录外一致；原有未提交改动保留。本轮改动 161 个文件，其中 6 个新增，主要文件数量来自契约的多语言同步。
- 工具链仍输出 TypeScript 7 实验性 API 警告；文档错误边界测试有意打印 `Original search failure`，对应测试及完整门禁通过。第二轮的 256 层容器限制保持不变；本轮未重新进行性能基准，也不作零开销声明。

以下第二轮和第一轮结果作为历史记录保留，不替代上述最终集成验证。

## 第二轮修复与验证（2026-10-15）

- 五项缺陷均在当前基线重新确认，再补失败回归、最小修复与关键变异检查。F036 同时覆盖类型红测；没有取消单成员交集的对象身份，也没有增加虚假类型重载。
- 独立复核补齐了 HTTP 跨副本响应兼容、SSE 失败后的监听器清理、SSE/WebSocket 不完整 handle、query 字面 `?` 键及首项晋升、intersection 合并 opaque 值时的递归旁路。
- F027 使用 256 层容器预算。声明容器超限报告 `invalid_type`；交集合并超限报告 `invalid_intersection`，编码合并沿用 `TypeError`。union 仍可尝试后续候选；调用者 getter、`errorMap` 的异常原样传播，不泛捕获 `RangeError`。
- `any`/`unknown` 本身不递归验证，但两份不同容器值的交集合并受同一总预算限制；相同引用直接保留，包括共享循环值。
- F036 的固定单成员返回自身类型，确定多成员保留必填交集语义，可能单成员的 tuple 展开推导两种结果。未实例化的 `ReturnType<typeof struct.intersection>` 因而更保守；已知参数数量时应显式实例化。
- 最终集成版 Node v26.11.1：core-server 98 个文件、2140 项通过；OTel 12 个文件、311 项通过，均退出码 0。
- 英文六页契约已同步至全部十种其他语言（60 个译文文件）。
- 完整 `bun run verify` 退出码 0：lint、fmt、类型检查（主项目 279 文件、文档站 155 文件、示例 178 文件）；core 2296 项通过、2 项仅在 Node 运行；OTel 311 项、React 12 项、Vue 14 项通过；四包语句、分支、函数、行覆盖率均为 100%。
- 文档单测 56 项、根 `test/` 5 项、文档站 e2e 23 项通过；2279 个生成页面的链接与锚点检查通过。浏览器使用项目既有 Chromium/Firefox 配置，没有跳过 Firefox。
- 首次完整门禁曾因 `mergeIntersectionValues` 的无调用默认参数停在 99.95% 分支覆盖率。核对全部调用者后去掉默认值，强制显式传递标记和深度；既有根层测试显式传 `0`，断言不变。重跑恢复 100%，未降低阈值或添加 ignore。
- Deno 冒烟覆盖 HTTP、SSE、WebSocket、`struct.parse`，退出码 0；四个包的 `assert-pack` 均通过。构建产物的消费者类型检查通过，实际普通版与压缩版 bundle 的跨副本响应、单成员身份、nullable intersection 在 Bun/Node 均通过。
- 构建保留工具链关于 TypeScript 7 实验性 API 的警告；文档错误边界用例会主动打印 `Original search failure`，该用例及整套 e2e 均通过。未对当前未提交补丁触发远端 CI 或发布。

### 最终集成版性能对照

以 `93b6fb45` 为基线，核对 165 个基线源码文件；测量结果的源码差异指纹与最终工作树一致。Bun 1.4.3、Node v26.11.1 各运行五轮独立进程，每轮九个样本取中位数，再取五轮中位数，前后交替执行。单位为 ns/op。

| 路径                       | Bun：基线 → 修复              | Node：基线 → 修复             |
| -------------------------- | ----------------------------- | ----------------------------- |
| Matcher：union 第八项命中  | 137.5 → 201.4（+46.44%）      | 785.5 → 808.8（+2.98%）       |
| Matcher：1000 个对象的数组 | 35422.5 → 36881.4（+4.12%）   | 151452.9 → 153338.3（+1.24%） |
| Parser：十字段对象         | 295.0 → 293.6（−0.47%）       | 484.4 → 493.0（+1.79%）       |
| Parser：八分支交集         | 420.2 → 420.4（+0.06%）       | 615.9 → 656.0（+6.52%）       |
| Parser：200 层递归链       | 13379.7 → 13477.9（+0.73%）   | 22054.3 → 25581.7（+15.99%）  |
| Parser：递归树             | 276343.7 → 279337.6（+1.08%） | 341570.2 → 374137.4（+9.53%） |

保护带来可测成本，不能宣称性能无退化：Bun 小 union matcher 增加约 64 ns，Node 200 层解析增加约 3.53 μs。以上是局部微基准，不代表完整请求延迟；没有以更大的性能重构换取本轮修复，也没有取消深度保护。

以下第一轮结果仅作历史记录，不替代本轮检查。

## 第一轮验证（历史记录）

- `bun run verify` 退出码 0：lint、fmt、typecheck；core 2217 项测试通过（另 2 项仅在 Node 上运行），覆盖率 100%；OTel 297 项、React 12 项、Vue 14 项，覆盖率 100%；文档单测 56 项；根 `test/` 5 项；文档站 2279 页链接与锚点校验；文档站 e2e 23 项
- 删除全部 `packages/*/dist` 后：typecheck 通过，Node 上 core 2061 项、OTel 297 项通过
- Deno 2.9.7 冒烟：HTTP、SSE、WebSocket、`struct.parse` 通过
- 真实浏览器（Chromium 156、Firefox 157、WebKit 26.6）复测：F002 的 7 种绕过写法均为 `REQ_BUILD_FAILED` 且无请求发出；F014 Worker 跨源不再附带 XSRF 令牌；F052 tr-TR 下筛选结果与 en-US 一致
- 10 个语言：逐文件同步与对照审阅后，再经独立核验（机械一致性检查 + 改动段落逐段核对 + 抽样页面 + 抽查审阅修改），修正 52 处范围或限定语偏差
