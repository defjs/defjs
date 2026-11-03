# 端点负载均衡第二期甲：实施说明

- 规格：`docs/design/2026-11-02-endpoint-balancer.md` 第七稿修订十六，第 2.3 节的决定覆盖与之冲突的旧条文。
- 设计依据：`docs/design/2026-11-03-endpoint-balancer-phase2-redesign.md` 的 P1 至 P5 与 P7。本文把它们落成可实施的细节；本文与提案冲突时以本文为准，并在报告里指出。
- 基线：当前工作区。第一期与三个缺陷修复都还没有提交，不要回滚、格式化或改写它们。
- 先读 `AGENTS.md`，它的契约与六道闸门都适用。按测试驱动开发：每一项先写回归测试，跑出失败，再实现，再跑通过。

## 1. 范围

做：P1 同一次 HTTP 调用内换台、P2 pick_first 网关错误前进、P3 单次尝试超时与握手超时、P4 离线不归因、P5 `failbackMs`、P7 `durationMs`。

不做：健康过滤、`outlierDetection`、`p2cBalancer`、P6 默认值（都在二乙）；`ringHashBalancer`、`hashKey`（第三期）；版本号、发布与标签。

## 2. 公开 API

### 2.1 `withEndpointFailover`

```ts
export type EndpointFailoverCondition =
  "connect-failure" | "gateway-error" | "attempt-timeout";

export interface EndpointFailoverOptions {
  readonly attempts?: number;
  readonly retryOn?: readonly EndpointFailoverCondition[];
  readonly methods?: readonly string[];
  readonly attemptTimeoutMs?: number;
}

export function withEndpointFailover(
  options?: EndpointFailoverOptions,
): ClientOption;
```

- 放在 `client/option.ts`，配置写入 `ClientConfig.endpointFailover`。`createClientConfig()` 放入默认值，所以默认就启用。
- 默认值：`attempts` 为 1，`retryOn` 为 `["connect-failure"]`，`methods` 为 `["GET", "HEAD", "OPTIONS", "TRACE"]`，`attemptTimeoutMs` 不设。
- `withEndpointFailover()` 不带参数等于默认值。后写的覆盖先写的，不合并。省略的字段取默认值。
- 关闭：`attempts: 0` 或 `methods: []`。
- 按 AGENTS.md 捕获配置：逐字段赋值，复制数组。
- 选项校验在执行时进行，不合法时调用得到 `REQ_OPTIONS_INVALID`，与重连选项的现有做法一致：`attempts` 是非负安全整数；`retryOn` 每项是三个条件之一；`methods` 每项是非空字符串；`attemptTimeoutMs` 是有限正数。
- 方法比较不区分大小写。

### 2.2 `EndpointDoneInfo.durationMs`

```ts
readonly durationMs?: number;
```

只对 HTTP：从结果被采用的那次尝试调用传输层 `fetch` 开始，到 `fetch` 返回响应为止，用 `Date.now()` 相减。没有响应时不填。SSE 与 WebSocket 不填。

### 2.3 `pickFirstBalancer({ failbackMs })`

`failbackMs` 是有限正数，选项错误按第一期的内部品牌处理，调用得到 `REQ_OPTIONS_INVALID`。

### 2.4 握手超时 `connectTimeoutMs`

加在 SSE 与 WebSocket 的重连配置块里，经过 `internal/reconnect_options.ts` 规范化。有限正数，否则 `REQ_OPTIONS_INVALID`。

## 3. 行为

### 3.1 P1 换台，只用于 HTTP

1. 一次调用的第一次尝试照第一期执行。
2. 这次尝试结束后，下列条件全部成立时换台：
   - 已尝试次数不超过 `attempts`；
   - 请求方法在 `methods` 里；
   - 请求体不是 `ReadableStream`；
   - 调用方的信号没有取消，也没有超过截止时间；
   - 结果命中 `retryOn`：`connect-failure` 指尝试结果为 `NET_UNREACHABLE`；`gateway-error` 指这次尝试的结果不带故障码、状态码为 502、503 或 504，并且最终元组是 `HTTP_STATUS` 或处理同一个响应时产生的 `RES_*` 故障。网关通常返回 HTML 错误页，声明的 JSON 错误结构会解码失败，所以 `RES_*` 也要算。拦截器把结果改成成功，或调用以 `EXT_*` 故障结束时，不换台；`attempt-timeout` 指 3.3 的单次尝试超时；
   - 不处于 3.4 的离线状态；
   - 还有没试过的候选。
3. 换台时重新 `pick`，`info.endpoints` 去掉这次调用已经试过的端点。每次尝试各自调用 `done`，各自遵守第一期的「恰好一次」。
4. 每次尝试从头开始：`pick`、`builder`、整条拦截器链、传输层。拦截器看到这次尝试的 `baseEndpoint`。
5. 调用方的截止时间覆盖整个调用，不按尝试重置。
6. 用户拿到最后一次尝试的元组。
7. `gateway-error` 换台时，前一次尝试的响应体要取消或读完，不能泄漏连接。

### 3.2 P2 pick_first 前进条件

`done` 收到下列任一结果，且粘住的端点仍是这次返回的端点时，前进到下一台：

- `{ attempted: true, code: "NET_UNREACHABLE" }`；
- `attempted` 为 `true`、没有 `code`、`status` 是 502、503 或 504。

带 `code` 的结果都不看 `status`，例如 `NET_BODY_INCOMPLETE` 带 503 时不前进。其余规则不变。

### 3.3 P3 超时

- HTTP `attemptTimeoutMs`：每次尝试开始调用 `fetch` 时计时，一直覆盖到这次尝试的响应体读完并解码为止，到期只中止这一次尝试。先发响应头、再卡住响应体的服务器也会触发它。这次尝试的 `done` 收到 `{ attempted: true, code: "NET_TIMEOUT" }`，不带状态码。`durationMs` 仍只量到响应头，两者用途不同：前者保护调用不被卡住，后者给延迟估计用。`retryOn` 含 `attempt-timeout` 时按 3.1 换台；否则调用以 `NET_TIMEOUT` 结束。计时器在尝试结束时清除，不留到调用之后。
- SSE `connectTimeoutMs`：从调用 `fetch` 到收到响应头。WebSocket：从构造套接字到 `open`。到期中止这次尝试，`done` 收到 `{ attempted: true, code: "NET_UNREACHABLE" }`，然后按现有重连规则重新选台。重连次数用完时，流或调用以 `NET_TIMEOUT` 结束。会话建立之后不再受它约束。
- 计时器用 `setTimeout`，并在所有出口清除。测试按 AGENTS.md 用假计时器。

### 3.4 P4 离线不归因

在 `balancer/runtime.ts` 的 `done` 包装里统一处理：结果是 `{ attempted: true, code: "NET_UNREACHABLE" }`，且 `globalThis.navigator?.onLine === false` 时，转成 `{ attempted: false }` 再交给均衡器。只认严格的 `false`，读取 `navigator` 时抛错按在线处理。P1 的换台也用同一个判断，离线时不换台。

### 3.5 P5 `failbackMs`

- 记下离开配置顺序第一台的时刻。
- 粘住的端点不是第一台、距离开时刻已达 `failbackMs`、且没有正在进行的试探时，这次 `pick` 返回第一台，作为一次试探。
- 试探的 `done` 不前进：粘住的端点改回第一台。试探的 `done` 满足 3.2 的前进条件：粘住的端点不变，离开时刻重设为现在。试探的 `attempted: false`：只结束试探，不改其他状态。
- 同一时刻最多一个试探，其他调用照常用粘住的端点。
- 不创建计时器，时刻在 `pick` 和 `done` 里用 `Date.now()` 判断。
- 开启 `shuffle` 时，「第一台」指这次排序后的第一台。

## 4. 回归测试

每条都要先失败、后通过。

| 测试                                                                                                                   | 来源            |
| ---------------------------------------------------------------------------------------------------------------------- | --------------- |
| 主区拒连，GET 当场换到备用区成功；POST 不换台                                                                          | 浏览器拒连 3/12 |
| 请求体是 `ReadableStream` 时不换台                                                                                     | 3.1             |
| 换台时拦截器看到新端点；每次尝试的鉴权头按各自端点生成                                                                 | 3.1 第 4 条     |
| 每次尝试各自 `pick`、各自 `done` 恰好一次；第二次 `pick` 的候选不含第一次的端点                                        | 3.1 第 3 条     |
| 配置 `gateway-error` 时 503 当场换台，前一次响应体被释放；不配置时下一次调用换台；500 不换台                           | 网关 15/15      |
| 网关返回 HTML 的 503、声明的 JSON 错误结构解码失败时，配置 `gateway-error` 仍换台；拦截器把 503 改成成功或抛出时不换台 | 实施中确认      |
| `NET_BODY_INCOMPLETE` 带 503 时 pick_first 不前进                                                                      | 3.2             |
| `attemptTimeoutMs` 到期换台成功；整体截止时间仍然生效                                                                  | 黑洞 15/15      |
| 响应头已到、响应体卡住时，`attemptTimeoutMs` 到期，`done` 不带状态码，配置 `attempt-timeout` 时换台                    | 实施中确认      |
| SSE 与 WebSocket 握手不完成，`connectTimeoutMs` 到期后重连到下一台；会话建立后不受它影响                               | WebSocket 黑洞  |
| `navigator.onLine` 为 `false` 时连接失败不推进 pick_first，也不换台；为 `true` 或不存在时行为不变                      | 断网误伤        |
| `failbackMs` 到期后回到第一台；第一台仍失败时前进并重新计时；并发时只有一个试探                                        | 回切 30/30      |
| `durationMs` 不包含拦截器耗时，换台后取被采用那次尝试的值                                                              | p2c 计时        |
| 每个新选项的非法取值得到 `REQ_OPTIONS_INVALID`                                                                         | 2.1、2.3、2.4   |
| 默认客户端不配置任何选项时，GET 在主区拒连后当场换台                                                                   | 决定 2          |

集成测试走 `packages/core/test/` 的夹具服务器。HTTP 换台另加一条 `*.browser.spec.ts`。

## 5. 文档

- 新导出写英文 TSDoc，`@group client`。
- 新导出按目录顺序追加到 `doc/scripts/api-order.ts`，然后运行 `bun run --cwd doc extract-api`。目录条数和每个语言的 URL 数按实际新增导出调整 `navigation.spec.ts`、`api-slug.spec.ts`、`api-html.spec.tsx` 与 AGENTS.md 里的数字。
- 更新 en-US 指南 `docs/client.mdx` 的「Multiple endpoints」一节：默认同一次调用内换台、范围与关闭方法、网关错误、超时、离线、`failbackMs`、长连接不再平衡与服务端设置连接最长寿命的建议。`api/client.mdx` 挂上新签名。SSE 与 WebSocket 指南写 `connectTimeoutMs`，并写明 SSE 正常结束不重连，长期订阅应监听 `closed` 带游标重新调用。
- 只改 en-US。其他 10 个语言由审查方另派人同步。
- 更新 `packages/core/design.md`。
- 示例放在 `doc/examples/`，通过类型检查。

## 6. 交付

- 不提交、不推送、不建分支。
- 不修改 `docs/` 下的设计文件。发现规格冲突时写进报告。
- 报告写明：每项的失败与通过输出、改动的文件、每条命令的退出码、与规格不一致或规格没写清的地方。
