# zen-kit 审计修复状态

- 审计基线：`feat/up` @ `6b0b0c1e`；审计报告见 [findings.md](findings.md)
- 修复范围（维护者确认）：全部 P0/P1，以及执行摘要中的 9 类系统性根因；另含浏览器实测确认的 F014、F052
- 结果：77 项中 61 项已修复，16 项不在本轮范围
- 工作区状态：全部改动未提交

## 维护者决定

- F001：不随包附带第三方许可声明。SSE 解析器按 WHATWG 规范重写，删除改编署名与 `THIRD_PARTY_NOTICES.md`
- 重连预算：SSE 与 WebSocket 均按每次掉线计算，连接成功后预算与退避指数清零；连上即断的连接会以基础延迟持续重连，可用 `shouldReconnect` 终止
- 日志安全：默认消息只描述收到的类型，不含原值；record 的 key 属于路径，会出现在消息中
- HTTP Content-Type：推断类型只存于 `request.bodyContentType`，库不再写入 headers；显式 `content-type` header 永远优先；替换 body 后重新检测
- 服务端运行时下 FormData 搭配 `onUploadProgress` 改为分块发送，不带 `Content-Length`；需要长度的端点请省略 `onUploadProgress`
- 新增公开导出 `isAbortCause`、`isTimeoutCause`，取消哨兵带 `Symbol.for` 品牌，可跨 Core 实例识别
- 文档域名改为 `https://defjs.lyz.cloud`；删除 `CODE_OF_CONDUCT.md`；移除 Codecov 徽章

## 仓库外待办

- GitHub 仓库变量 `SITE_URL` 与仓库主页需改为 `https://defjs.lyz.cloud`（域名解析就绪后）
- 已发布的 `@defjs/core@0.4.0-beta.1` 无法原地修改；新版本发布即生效
- F051（搜索索引首次失败后被缓存）为上游 `fumadocs-core@16.17.1` 缺陷，需向上游报告或在站点侧包装

## 逐项状态

| ID   | 严重度 | 标题                                                     | 状态   | 处理                                                                                             |
| ---- | ------ | -------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------ |
| F001 | P0     | core 发布包遗漏 fetch-event-source 的 MIT 声明           | 已修复 | 按 WHATWG 规范重写 SSE 解析器，删除改编署名与 `THIRD_PARTY_NOTICES.md`（WP-SSE）                 |
| F002 | P1     | 定义路径校验可被反斜杠或空白绕过，认证头发往他域         | 已修复 | 解析后校验 origin 与目录前缀，构建阶段报 `REQ_BUILD_FAILED`；三浏览器复测通过（WP-A、WP-FIXUP）  |
| F003 | P1     | SSE errorOpenInfoMap 键为共享哨兵，跨请求泄露响应快照    | 已修复 | 删除模块级 `errorOpenInfoMap`，打开信息限定在单次执行（WP-A）                                    |
| F004 | P1     | 默认 fetch 在模块求值时固定，之后替换的全局 fetch 被绕过 | 已修复 | 默认 fetch 改为发送时解析，导入时无 fetch 不再抛错（WP-HTTP、WP-FIXUP）                          |
| F005 | P1     | Node 上 FormData 带进度时整体缓冲，无视超时与取消        | 已修复 | FormData 上传进度改为流式转换并响应取消（WP-HTTP）                                               |
| F006 | P1     | Bun 上 FormData 带进度上传丢失 boundary                  | 已修复 | 保留 multipart boundary（WP-HTTP）                                                               |
| F007 | P2     | String(fault) 含响应字段原值，与“可直接记录”相冲突       | 已修复 | 默认消息只写类型；解码失败消息固定为 `Response body could not be decoded`（WP-STRUCT、WP-FIXUP） |
| F008 | P2     | WebSocket 重连 attempts 为整个会话累计预算，文档未说明   | 已修复 | WebSocket 重连预算按每次掉线计算（WP-WS）                                                        |
| F009 | P2     | SSE 重连 attempts 为整条逻辑流累计预算，文档未说明       | 已修复 | SSE 重连预算按每次掉线计算并写入文档（WP-SSE、DOCS2/3）                                          |
| F010 | P2     | WebSocket 出站 JSON 静默改写非 JSON 值，HTTP 同值拒绝    | 已修复 | WebSocket 文本帧复用 HTTP 非 JSON 守卫（WP-WS、WP-FIXUP）                                        |
| F011 | P2     | endpoint 或路径配置错误被报告为 NET_UNREACHABLE          | 已修复 | 配置/URL 错误在传输前报 `REQ_BUILD_FAILED`，不再重试（WP-A）                                     |
| F012 | P2     | transport-origin 标记永久记住共享哨兵，拦截器故障误分类  | 已修复 | 删除进程级 transport-origin WeakSet，改为单次执行跟踪（WP-A）                                    |
| F013 | P2     | withSSEReconnect 数值参数不校验，NaN 预算导致无限重连    | 已修复 | SSE 重连参数预检，非法时报 `REQ_OPTIONS_INVALID`（WP-SSE）                                       |
| F014 | P2     | Worker 中 XSRF token 会附加到跨源请求                    | 已修复 | Worker 同源判断改用 `location.origin`；三浏览器复测通过（WP-HTTP）                               |
| F015 | P2     | 非 ASCII 事件 ID 致 Last-Event-ID 重连失败或编码错误     | 已修复 | Last-Event-ID 按 UTF-8 发送并纳入每轮错误边界（WP-SSE）                                          |
| F016 | P2     | 发布 job 不运行 typecheck、lint 或测试                   | 已修复 | 发布 job 增加构建配置类型检查与打包清单断言（WP-OPS、WP-FIXUP）                                  |
| F017 | P2     | 适配器单独发布时 ClientProvider 返回类型退化为 any       | 已修复 | 适配器发布 job 先构建 core（WP-OPS）                                                             |
| F018 | P2     | CI 只在 Bun 上运行测试，Node 运行时行为无守卫            | 已修复 | CI 新增 Node 测试 job 与 Deno 冒烟 job（WP-OPS）                                                 |
| F019 | P2     | SSE 打开后 TimeoutError 中止抛错，文档称为 aborted       | 已修复 | 文档修正（DOCS1）                                                                                |
| F020 | P2     | SSE 重连非 2xx 的终止码与文档 HTTP_STATUS 不符           | 已修复 | 文档修正（DOCS1）                                                                                |
| F021 | P2     | withEndpoint 文档称接受相对 base，实际只接受绝对 URL     | 已修复 | 文档与 JSDoc 修正（WP-A、DOCS1）                                                                 |
| F022 | P2     | HTTP 拦截器结果非 HttpResponse 时 reject 或误报          | 未处理 | 不在本轮范围（非 P0/P1、非系统性根因）                                                           |
| F023 | P2     | binaryType 写入抛错时已建 socket 被遗留且不关闭          | 已修复 | binaryType 赋值失败时关闭已建 socket（WP-WS）                                                    |
| F024 | P2     | onUploadProgress 覆盖显式指定的 Content-Type             | 已修复 | 显式 Content-Type 优先于检测值（WP-HTTP）                                                        |
| F025 | P2     | 拦截器替换 body 后无法指定 Content-Type，空 body 留旧头  | 已修复 | 推断类型只存于 `bodyContentType`，显式 header 永远优先（WP-HTTP，按 linus 复审规则重做）         |
| F026 | P2     | 下载进度把压缩后的 Content-Length 当作解码总量           | 已修复 | 压缩响应与跨源兜底均报 `lengthComputable: false`（WP-HTTP、WP-FIXUP）                            |
| F027 | P2     | 递归 Struct 遇深层或循环输入抛 RangeError                | 未处理 | 不在本轮范围（非 P0/P1、非系统性根因）                                                           |
| F028 | P2     | 外层重试复用 Headers，后续 span 挂在已结束的 span 下     | 未处理 | 不在本轮范围（非 P0/P1、非系统性根因）                                                           |
| F029 | P2     | queryPropagation 只追加不替换同名键，接收方读到旧上下文  | 未处理 | 不在本轮范围（非 P0/P1、非系统性根因）                                                           |
| F030 | P2     | HTTP responseHook 的 rejection 未被记录                  | 未处理 | 不在本轮范围（非 P0/P1、非系统性根因）                                                           |
| F031 | P2     | SSE 元组第三槽读 live open，链尾异步期间可被重连覆盖     | 未处理 | 不在本轮范围（非 P0/P1、非系统性根因）                                                           |
| F032 | P2     | maxDelayMs 只约束 jitter 前的基数，实际等待可超上限      | 已修复 | `maxDelayMs` 改为 jitter 后的硬上限（WP-A）                                                      |
| F033 | P2     | 路径占位符文法未文档化，含冒号的静态段无法表达           | 已修复 | 路径占位符文法写入文档（DOCS1）                                                                  |
| F034 | P2     | GraphQL 配方拒绝 data: null，应用错误被误报              | 已修复 | GraphQL 配方 `data` 改为 `.nullish()` 并补夹具（DOCS1）                                          |
| F035 | P2     | 嵌套 intersection 展平时丢弃内层 nullable                | 未处理 | 不在本轮范围（非 P0/P1、非系统性根因）                                                           |
| F036 | P2     | 单成员 intersection 的公开类型丢失 optional              | 未处理 | 不在本轮范围（非 P0/P1、非系统性根因）                                                           |
| F037 | P2     | errorMap 返回空字符串时不替换默认消息                    | 已修复 | `errorMap` 返回 `''` 时替换消息（WP-STRUCT）                                                     |
| F038 | P2     | 跨包副本的 bigint/date 转换失败绕过本次 errorMap         | 已修复 | 跨副本转换失败也应用本次 `errorMap`（WP-STRUCT）                                                 |
| F039 | P2     | 两份 @defjs/core 实例并存时调用方取消被记为 WARN         | 已修复 | 取消哨兵增加 `Symbol.for` 品牌，新增 `isAbortCause`/`isTimeoutCause`（WP-OTEL）                  |
| F040 | P2     | SSE 按行和按字段值剥离 BOM，偏离规范                     | 已修复 | 随解析器重写修复 BOM 处理（WP-SSE）                                                              |
| F041 | P2     | 退避基数为 0 时第 1025 次重试抛 RangeError               | 已修复 | 退避基数为 0 或指数溢出时饱和而非 NaN（WP-A）                                                    |
| F042 | P2     | 文档仍宣称已删除的 packed-consumer 与 ES2022 基线验证    | 已修复 | 删除已失效的门禁声明，改写为实际运行的检查（DOCS1/3）                                            |
| F043 | P2     | Core 与 OTel 发布包 README 的文档站链接全部失效          | 已修复 | README 链接改为现行路由，域名改为 `defjs.lyz.cloud`（DOCS1）                                     |
| F044 | P2     | design.md 关于 subprotocol token 的说明与实现相反        | 已修复 | design.md 修正（DOCS1）                                                                          |
| F045 | P2     | CODE_OF_CONDUCT 举报渠道为空，执行流程不可用             | 已修复 | 按维护者决定删除 `CODE_OF_CONDUCT.md`（DOCS1）                                                   |
| F046 | P2     | abort 监听器回归测试只比次数，移除错误回调仍全绿         | 已修复 | 监听器清理测试断言回调身份（WP-A）                                                               |
| F047 | P2     | WebSocket attempt 清理的两处移除无任何测试锁定           | 已修复 | 两处 WebSocket 清理行加测试（WP-WS）                                                             |
| F048 | P2     | SSE 退避参数测试只断言次数，去掉接线后仍全绿             | 已修复 | SSE 退避参数测试断言实际延迟（WP-SSE）                                                           |
| F049 | P2     | responseHook 先于 span 结束的测试检不出顺序倒置          | 已修复 | responseHook 顺序测试锁定顺序（WP-OTEL）                                                         |
| F050 | P2     | checkLinks 把无 index.html 的目录当作有效链接目标        | 已修复 | checkLinks 目录必须有 index.html（WP-SITE）                                                      |
| F051 | P2     | 搜索索引首次加载失败后被永久缓存，搜索静默失效           | 未处理 | 不在本轮范围（非 P0/P1、非系统性根因）                                                           |
| F052 | P2     | API 索引筛选在 tr/az 默认区域下大写 I 漏匹配             | 已修复 | 改用与区域无关的小写折叠；三浏览器 tr-TR 复测通过（DOCS1）                                       |
| F053 | P3     | 多处文档把已声明 body 一律视为 JSON 检查与解析           | 已修复 | 文档修正（DOCS1）                                                                                |
| F054 | P3     | OTel 文档称 execute timeout 总记一条日志，链外超时不记   | 已修复 | 文档修正（DOCS1）                                                                                |
| F055 | P3     | 简中与港繁 OTel 页把“已声明 body 缺失”译成“未声明”       | 已修复 | 译文修正（L10N）                                                                                 |
| F056 | P3     | 解码结果表对 SSE 握手 error struct 失配不成立            | 已修复 | 文档修正（DOCS1）                                                                                |
| F057 | P3     | withTimeout JSDoc 仍写不存在的 ABORTED/TIMEOUT           | 已修复 | JSDoc 故障码修正（协调者）                                                                       |
| F058 | P3     | struct.object 页称 .alias 按 wire key 读取               | 已修复 | 文档修正（DOCS1）                                                                                |
| F059 | P3     | HttpRequestShape.body 在模块页误写为 unknown             | 已修复 | 文档修正（DOCS1）                                                                                |
| F060 | P3     | OTel README 把 server.port 列为必记属性                  | 已修复 | 文档修正（DOCS1）                                                                                |
| F061 | P3     | Errors 指南称 data.status 通过 struct 即证明来自后端     | 已修复 | 文档修正（DOCS1）                                                                                |
| F062 | P3     | send 内同步派发的心跳 ACK 被随后新建的超时覆盖           | 未处理 | 不在本轮范围（非 P0/P1、非系统性根因）                                                           |
| F063 | P3     | injectClient() 在注入上下文外报错时误称未安装插件        | 未处理 | 不在本轮范围（非 P0/P1、非系统性根因）                                                           |
| F064 | P3     | Struct README 四条文档链接失效，构造器表行重复           | 已修复 | Struct README 链接与重复行修正（DOCS1）                                                          |
| F065 | P3     | DESIGN-builder.md 仍自称现行契约且与代码相反             | 已修复 | 标为历史设计记录（DOCS1）                                                                        |
| F066 | P3     | 根 README 的 Codecov 徽章停在 2025-03-14 快照            | 已修复 | 删除 Codecov 徽章（DOCS1）                                                                       |
| F067 | P3     | 港繁 interceptors 指南有一整句英文未翻译                 | 已修复 | 补译（L10N）                                                                                     |
| F068 | P3     | types.type.test.ts 的 Equal 接受 any                     | 已修复 | 类型测试改用严格比较（WP-A）                                                                     |
| F069 | P3     | 被 ignore 的 discriminatedUnion 守卫无测试               | 已修复 | 去掉 istanbul ignore 并补测试（WP-STRUCT）                                                       |
| F070 | P3     | 五个 Content-Length 测试只断言 duplex                    | 已修复 | 改为读取流的表驱动测试（WP-HTTP）                                                                |
| F071 | P3     | 文档构建指纹不含依赖版本，升级后旧产物仍判新鲜           | 已修复 | 构建指纹纳入 `bun.lock` 与根 `package.json`（WP-SITE、WP-FIXUP）                                 |
| F072 | P3     | exports.test.ts 对 export type * 等纯类型导出失明        | 已修复 | 导出扫描器遇到未知语法即失败（WP-SITE）                                                          |
| F073 | P3     | 进程级 miss 日志使 http.e2e 同进程重跑误报失败           | 未处理 | 不在本轮范围（非 P0/P1、非系统性根因）                                                           |
| F074 | P3     | teardown 端口探测在端口被他进程重绑时误报失败            | 未处理 | 不在本轮范围（非 P0/P1、非系统性根因）                                                           |
| F075 | P3     | preview.ts 三处路径边界与静态托管不一致                  | 未处理 | 不在本轮范围（非 P0/P1、非系统性根因）                                                           |
| F076 | P3     | fillUrl 数组取首项分支在公开执行链上不可达               | 未处理 | 不在本轮范围（非 P0/P1、非系统性根因）                                                           |
| F077 | P3     | @types/react-dom 版本在两处各自固定                      | 未处理 | 不在本轮范围（非 P0/P1、非系统性根因）                                                           |

## 验证

- `bun run verify` 退出码 0：lint、fmt、typecheck；core 2217 项测试通过（另 2 项仅在 Node 上运行），覆盖率 100%；OTel 297 项、React 12 项、Vue 14 项，覆盖率 100%；文档单测 56 项；根 `test/` 5 项；文档站 2279 页链接与锚点校验；文档站 e2e 23 项
- 删除全部 `packages/*/dist` 后：typecheck 通过，Node 上 core 2061 项、OTel 297 项通过
- Deno 2.9.7 冒烟：HTTP、SSE、WebSocket、`struct.parse` 通过
- 真实浏览器（Chromium 156、Firefox 157、WebKit 26.6）复测：F002 的 7 种绕过写法均为 `REQ_BUILD_FAILED` 且无请求发出；F014 Worker 跨源不再附带 XSRF 令牌；F052 tr-TR 下筛选结果与 en-US 一致
- 10 个语言：逐文件同步与对照审阅后，再经独立核验（机械一致性检查 + 改动段落逐段核对 + 抽样页面 + 抽查审阅修改），修正 52 处范围或限定语偏差
