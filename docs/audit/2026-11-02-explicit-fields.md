# 固定字段与嵌套配置捕获清理

日期：2026-11-02。

## 范围与判据

检查范围覆盖四个发布包的实现和测试、共享测试基础设施、文档站代码和工具、全部语言的当前指南、示例、仓库配置和技能说明。采用按目录扫描、独立反证和跨目录模式补查，合并重复发现后修正。

固定配置记录逐字段赋值，并继续处理其拥有的嵌套记录和数组容器。普通字段不额外区分“属性不存在”与“属性值为 undefined”，不为这种区别维护过滤器、键集合断言或专用示例。可选配置块未提供时保持 undefined，不制造空对象以启用默认行为。动态字典、输入验证、网络编码、错误判别和安全措施不适用机械替换。

回调、AbortSignal、Schema、SDK 句柄、实际业务数据和故障原因具有独立的身份或生命周期契约，不作通用深复制。不新增 deepClone、代理或延迟异常重放机制。

## 修正清单

| 范围                                                     | 修正                                                                                            | 保留的行为                                               |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `packages/core/src/client/client.ts`                     | 请求状态中的 options 可选；未提供时不创建请求配置；提供时显式捕获外层及嵌套配置                 | 共享基础配置、函数和信号身份、派生不执行 I/O             |
| `packages/core/src/client/capture.ts`                    | 显式映射 heartbeat 和 reconnect 字段，复制 protocols 数组容器                                   | 未提供块及原有运行时假值、操作期数值校验、整块覆盖语义   |
| `packages/core/src/client/option.ts`                     | 标准 option 应用时捕获心跳、重连、协议列表及 interceptor 包装记录                               | 注册顺序、后设置覆盖、undefined 清除、fn 身份            |
| `packages/core/src/client/config.ts`                     | 默认配置按固定字段构造                                                                          | 原生 Fetch 句柄身份、运行时全局 Fetch 查找、独立默认容器 |
| HTTP、SSE、WebSocket 执行入口                            | 安全消费缺省 RequestOptions                                                                     | 取消优先、错误优先元组、queue 校验及 listener 清理       |
| HTTP、SSE、WebSocket 定义入口                            | 显式映射固定定义字段；隔离 SSE 事件字典和 WebSocket 协议数组容器                                | builder、Schema 身份及既有默认值                         |
| `packages/core/src/http/request.ts`                      | 每个请求独立捕获 XSRF 字段                                                                      | tokenProvider 身份、请求可修改性及正文来源标记           |
| 客户端及协议测试                                         | 删除过滤形状专用用例，增加嵌套 mutation 和缺省选项回归；执行期测试通过自定义 option 安装 getter | 捕获期与执行期的独立验证、取消、心跳、重连和释放         |
| `packages/core/src/error/factory.ts`                     | 使用原生 Error cause；可选 response 直接赋值                                                    | cause 的引用及非枚举性、消息清洗、错误码和响应元数据     |
| `packages/core/src/internal/outbound_request.ts`         | 正文物化结果直接传递 defaultContentType                                                         | 实际 Content-Type 设置、正文编码和请求约束               |
| SSE 与 WebSocket 测试帮助函数                            | 直接传递可选配置，删除多余条件展开和客户端分支                                                  | observer 顺序、信号组合和资源清理                        |
| `packages/core/test/regression/`                         | 使用原生 CloseEvent，直接构造循环夹具                                                           | 关闭信息、生命周期和循环检测                             |
| `packages/opentelemetry-server/src/option.ts`            | 在公开入口捕获各传输配置块                                                                      | SDK 句柄和 hook 身份、禁用分支短路、应用时创建指标       |
| `packages/opentelemetry-server/src/telemetry/metrics.ts` | 每次直方图创建调用获得独立的桶边界数组                                                          | 边界数值、顺序、名称和单位；返回对象仍由 Meter/SDK 管理  |
| `packages/opentelemetry-server/src/telemetry/trace.ts`   | 可选 hook 直接调用，事件属性直接传参                                                            | 成功判别字段、throw undefined 失败处理、遥测隔离         |
| 四个包的 Vitest 配置                                     | 显式映射覆盖配置，复制 reporter/include/exclude 和 thresholds                                   | 原有测试范围、排除项及全部覆盖阈值                       |
| API 数据生成与测试夹具                                   | 固定记录直接赋值，保留 typeHref 规范化，创建节点时提供 position                                 | 字段顺序、JSON 输出、源码位置及节点引用                  |
| 当前文档与公开 TSDoc                                     | 同步客户端、错误、协议和遥测说明，通过提取器更新 API 数据                                       | 生命周期、错误约定、SDK 所有权和语言覆盖                 |
| `AGENTS.md`                                              | 明确逐层捕获固定配置与身份保留边界                                                              | 动态字典、编码和安全处理的必要例外                       |

### 捕获边界与可观察变化

- ClientState 的 options 为可选字段。根工厂、client() 和 client(undefined) 没有 RequestOptions 值。client({}) 可以携带所有选项值均未设置的快照，不按键集合把它重新归一化。
- 请求配置在 client(options) 时捕获；标准 Core 配置 helper 在应用到客户端时捕获。原对象后续替换或修改不再改变已捕获的心跳、重连、协议数组和 interceptor 包装记录。
- 固定配置 getter 在相应捕获边界求值一次。配置调用期间抛出的异常同步离开该调用，不缓存或延迟重放。非法数值仍在操作执行阶段转换为现有故障。
- HTTP 请求的 XSRF 字段在请求构建阶段捕获。该阶段的 getter 失败由既有构建错误边界处理，取消保持优先，不能把它描述为公共 operation 同步抛错。
- SSE 动态事件字典隔离其容器，但 Schema 不复制。访问器保留消息处理时的惰性求值及原始 receiver；非枚举、自有保留名称和原型边界不丢失。
- OpenTelemetry 的传输配置在 withOpenTelemetryServer 调用时捕获。enabled:false 不读取该块的 hook 或 queryPropagation getter。Meter 的创建方法在每次应用 option 时调用，返回 instrument 和聚合状态是否共享由 Meter/SDK 决定。
- PreflightFault 的 response 值在没有传输元数据时为 undefined，不再承诺属性必须缺失。成功元组、失败元组及 HTTP/解码故障的 body/data 区分不变。
- 基础 ClientConfig 仍由派生值共享，不冻结。自定义 ClientOption 可以保留或修改其自己拥有的引用，这不等于标准 helper 的参数没有捕获。

## 有依据保留的处理

| 位置或类别                                       | 保留原因                                                             |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| Struct 的描述符、递归 getter、缓存和 schema 元素 | 已有独立容器与惰性求值契约；复制 Schema 会破坏递归、缓存和身份判断   |
| query、headers、表单和 JSON 编码                 | 条件处理决定真实请求字节，不是普通配置省略机制                       |
| `bodyContentTypeSource`                          | 使用身份和属性来源区分未设置与替换后的正文                           |
| SSE 事件名字典                                   | 动态名称及惰性访问器需要描述符处理，不能用固定字段表或只复制可枚举键 |
| OpenTelemetry 属性和传播载体                     | 每请求动态数据，受隐私、基数及外部协议约束                           |
| SDK、平台对象、流与会话                          | 属于应用或传输生命周期；复制会破坏方法 receiver、清理和身份          |
| 文档类型表、AST、Checker 和翻译字典              | 属于结构化内容或解析器状态；现有输出投影已处理需要隔离的容器         |
| 发布清单处理                                     | 保留未知的合法 npm 元数据，同时删除开发字段                          |
| Error.name 描述符及跨 realm 品牌                 | 非枚举性和错误分类需要这些机制                                       |

历史上已提交的设计、审计、性能及发布记录不追溯改写。本文件是当前未提交工作的合并记录。生成构建产物不手工修改，依赖、锁文件和版本号不变；没有提交、推送或发布。

## 验证范围

回归应观察修改来源对象之后的真实配置和执行结果，而不只检查引用不同。缺省配置、嵌套数组、callback/signal 身份、getter 时机、非法数值、默认回退、协议捕获和请求隔离都在验证范围内。捕获层新增后，执行期快照测试必须继续接触执行期的可变配置，避免因上游已复制而变成无效回归保护。

工具配置使用 mutation probe 验证四个包的嵌套容器独立，并对比修改前后完整覆盖策略值；包含范围、排除项和阈值不改变。

仓库验收按顺序运行，首个失败即停止：

1. `bun run lint`
2. `bun fmt --check`
3. `bun run typecheck`
4. `bun run test:unit`
5. `bun run build`
6. `bun run test:e2e`

另在 Node 26 下运行 Core server 与 OpenTelemetry 测试。Core 的网络测试必须通过带 globalSetup 的聚合配置启动，避免将缺少 testServerHost 的运行方式错误误报为产品失败。文档预览核对客户端、协议、遥测及生成 API 页面。全部语言进行技术语义和结构核对，不将其表述为母语级润色认证。
