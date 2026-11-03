# 端点负载均衡第一期：实施说明

- 规格：`docs/design/2026-11-02-endpoint-balancer.md`，第六稿修订十三。本文只划定第一期的范围与验收；行为以规格为准。两者冲突时以规格为准，并在报告里指出冲突。
- 基线：`main@ed1763e85cbe337917ddd1fa32d3f9b8d539af83`，`@defjs/core` 0.6.0。
- 仓库：`/Users/munmunmiao/Documents/web/zen-kit`。动手前先读 `AGENTS.md`，它的契约与六道闸门都适用。
- 工作区里已有两份未跟踪的设计文件（本文与规格），不要改动、格式化或删除它们。

## 1. 先读这些

| 规格章节      | 内容                                                |
| ------------- | --------------------------------------------------- |
| 第 3 节       | 公开 API、`pick` 的错误优先元组、`done` 的约定      |
| 第 4.2–4.4 节 | 共同规则、`pickFirstBalancer`、`roundRobinBalancer` |
| 第 6 节       | 三种传输的挂接、`done` 的所有权、结果映射表         |
| 第 7 节       | 选项取值范围（只看第一期涉及的选项）                |
| 第 9 节       | 公开面、文档、版本与插件                            |
| 第 10 节      | 分期与回归测试，「期」为「一」的行就是本期验收      |

## 2. 本期范围

做：

- `withEndpoint(...endpoints)`，配置字段从 `endpoint: string` 改为 `endpoints: readonly string[]`，按首次出现去重。
- `ClientConfig.endpointBalancer`，`createClientConfig()` 为每个客户端放一个新的 `pickFirstBalancer()`。
- `withEndpointBalancer`，以及类型 `EndpointBalancer`、`EndpointPickOutcome`、`EndpointTransport`、`EndpointPickInfo`、`EndpointPickResult`、`EndpointFaultCode`、`EndpointDoneInfo`。
- `ERR_NO_ENDPOINT` 与 `isNoEndpointCause`，品牌机制照 `error/cause.ts` 里的 `ERR_ABORTED`。
- `pickFirstBalancer`，本期只有 `shuffle` 选项。
- `roundRobinBalancer`，本期只有 `weights` 选项。不带健康过滤时省略 `done`。
- 三种传输的挂接与结果归因：HTTP（第 6.2 节）、SSE（第 6.3 节）、WebSocket（第 6.4 节），包括 `EventStreamFaultCode` 增加 `REQ_BUILD_FAILED` 与 `REQ_OPTIONS_INVALID`，以及 `createEventStreamFault` 原样返回这两个码。
- 新目录 `packages/core/src/balancer/`，带 `index.ts` 与 `public_api.ts`，接入 `src/public_api.ts`。
- 第 9.2 节「每一期都要做」与「第一期还要做」的全部文档改动，以及第 9.3 节列出的两个配置字面量：`packages/opentelemetry-server/src/option.spec.ts` 的 `makeConfig()`，`packages/core/src/client/client.type.test.ts` 的 `ClientOptions` 字面量与 `OptionsCases`。

不做，留给后面两期：

- `outlierDetection` 与任何工厂的 `outlierDetection` 选项、`failback`、`p2cBalancer`、`OutlierDetectionOptions`。
- `ringHashBalancer`、`XXH64`、`RequestOptions.hashKey`。`EndpointPickInfo.hashKey` 字段本期不加，第三期再加。
- 版本号、发布与标签。这些需要另外授权。

## 3. 必须守住的点

- 结果只取自传输边界上基址等于选中端点的那次尝试，不从最终元组归因（第 6.1 节）。
- `pick` 成功且结果带 `done` 时，`done` 恰好调用一次。第 6.1 节第 3 条划分了执行入口和传输层各自负责的出口，第 6.3、6.4 节写明了 SSE 与 WebSocket 的收尾标记和逐次尝试的标记。
- 初始选台在构建请求之前：HTTP 与 SSE 在 builder 之前，WebSocket 在 `buildOutbound` 之前。
- 每次 `pick` 都把定义里的 `operation` 放进 `EndpointPickInfo`，没有就是 `undefined`（第 6.1 节）。
- `pick` 返回错误、抛出或返回非法结果，都不能让调用点抛出（第 3.3 节）。
- SSE 只有第一次 `next()` 参与选台；重连选台放在 `wait` 成功返回之后、构造下一轮 `Request` 之前。
- 不新增运行时依赖，不导入 Node 专用模块，不创建计时器。
- 不改与本期无关的文件，不做无关的重构或格式化。

## 4. 文档闸门里写死的数字

| 位置                                                                | 现值 | 第一期之后 |
| ------------------------------------------------------------------- | ---- | ---------- |
| `doc/app/components/navigation.spec.ts` 第 98 行，每个语言的 URL 数 | 204  | 216        |
| `doc/scripts/api-slug.spec.ts` 第 7 行，目录条数                    | 165  | 177        |
| `doc/app/lib/api-html.spec.tsx` 第 170 行与第 196 行，目录条数      | 165  | 177        |

新导出共 12 个，按目录顺序追加到 `doc/scripts/api-order.ts`。最终以 `bun run --cwd doc extract-api` 的输出为准；若实际导出个数不是 12，按实际个数改这些数字，并在报告里说明原因。

## 5. 验收

1. 第 10 节回归表中「期」为「一」的每一行都有测试，并且在修复前失败、修复后通过。
2. 覆盖率保持 100%，包括第 10 节点名的选项校验、`pick` 的每种非法返回值、`done` 省略、`isNoEndpointCause` 跨副本识别。
3. 六道闸门按顺序全部通过，记录每条命令的退出码：

```bash
bun run lint
```

```bash
bun fmt --check
```

```bash
bun run typecheck
```

```bash
bun run test:unit
```

```bash
bun run build
```

```bash
bun run test:e2e
```

4. 改动开始前的闸门基线记录在 `/tmp/lbexp/baseline/summary.txt`：2026-11-03 在 `main@ed1763e8` 上，六道闸门全部以退出码 0 通过。所以本期之后任何一道闸门失败，都是本期改动引入的，必须修好，不能当作已有问题跳过。

## 6. 交付

- 不提交、不推送、不创建分支或 PR。
- 报告写明：改动的文件清单；每道闸门的命令、退出码，以及失败时的输出；与规格不一致或规格没写清的地方；本期没做完的事。
