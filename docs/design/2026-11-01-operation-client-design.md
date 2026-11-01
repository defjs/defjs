# Defjs 操作函数与可调用客户端设计

- 日期：2026-11-01。
- 状态：设计已逐项确认；TypeScript 声明原型已编译检查；生产实现尚未变更。
- 基线：`main`，`a3d38bc0b922a1cd2120c65ef1e5eb07e71c47a6` 及当前工作区。
- 交付范围：设计文档、声明原型与类型验收附录。不修改生产实现、不提交、不发布。
- 授权范围：用户明确允许破坏性重构，并允许一次性大面积删除 `timeout` 相关代码，无需二次确认。

## 1. 已确认的设计

唯一主调用形式：

```ts
const [error, user] = await getUser(client({ abort }), { id: 1 });
```

| #   | 决定                                                                                                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `defineRequest`、`defineEventStream`、`defineWebSocket` 返回的就是接收 client 的操作函数。`endpoint(input)` 生成冷命令的用法消失。                                           |
| 2   | client 的定位本质是 Symbol 身份，内部藏有配置。类型上是可调用值，同时携带 `[CLIENT]`。                                                                                       |
| 3   | `client(options?)` 的入参可选，每次返回一个全新的 client，只影响本次请求，不影响原 client。                                                                                  |
| 4   | client 内部分两份配置：基础配置（`createClient` 产生）与请求配置（`client(options)` 叠加）。请求配置按字段叠加，后来者覆盖前者。                                             |
| 5   | `RequestOptions` 是当前 `execute` 单次选项的合集，扁平，共 7 个字段。操作只读取自己认识的字段，其余忽略。                                                                    |
| 6   | 删除 `timeout` 选项与全部相关机制，删除重复的 `signal`，取消统一使用 `abort`。`NET_TIMEOUT`、`ERR_TIMEOUT`、`isTimeoutCause` 保留，用于识别 `AbortSignal.timeout()` 等原因。 |
| 7   | 没有第三个 options 参数。无 input 时只接收 client，不占位。                                                                                                                  |
| 8   | 操作被调用即进入执行链，`await` 只是等待。不做冷命令、thenable 或另一个启动步骤。                                                                                            |
| 9   | 错误优先元组、输入解析、builder、拦截器、传输、流与会话的生命周期沿用现有逻辑。                                                                                              |
| 10  | `Client` 不带泛型，不做协议专属的编译期拦截，不从操作反推心跳回调的消息类型。                                                                                                |

被用户否决、不属于备选方案的做法：第三参数 options、`undefined` 占位、冷命令加 `await` 启动、把 `client(options)` 做成独立的 Scope 或 ExecutionContext、在 Client 上携带 Options、Incoming、Outgoing 泛型。

## 2. 目标体验

以下代码描述目标 API，不表示当前已发布实现已经支持。

### 2.1 定义保持原样

```ts
import { createClient, defineRequest, struct, withEndpoint } from "@defjs/core";

export const getUser = defineRequest({
  method: "GET",
  path: "/users/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
});

const client = createClient(withEndpoint("https://api.example.com"));
```

定义仍是可独立发布的 SDK 契约，不捕获应用 client。端点、凭据、拦截器和传输仍由应用决定。

### 2.2 调用

```ts
async function main(abort: AbortSignal) {
  const [error, user] = await getUser(client({ abort }), { id: 1 });
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(user.name);
}
```

不需要单次配置时直接传 client：

```ts
const [error, user] = await getUser(client, { id: 1 });
```

### 2.3 无输入与可选输入

```ts
const health = defineRequest({
  method: "GET",
  path: "/health",
  output: struct.object({ ok: struct.boolean() }),
});

await health(client);
await health(client({ abort }));
```

整个 input 可选时：

```ts
const searchUsers = defineRequest({
  method: "GET",
  path: "/users",
  input: struct.object({ q: struct.string().optional() }).optional(),
  builder: (input) => ({ query: input ?? {} }),
  output: struct.array(struct.object({ id: struct.number() })),
});

await searchUsers(client);
await searchUsers(client({ abort }), { q: "Ada" });
```

| input 契约      | 不附加请求配置                                    | 附加请求配置                                                            |
| --------------- | ------------------------------------------------- | ----------------------------------------------------------------------- |
| 无 input        | `operation(client)`                               | `operation(client({ abort }))`                                          |
| 必填 input      | `operation(client, input)`                        | `operation(client({ abort }), input)`                                   |
| 整个 input 可选 | `operation(client)` 或 `operation(client, input)` | `operation(client({ abort }))` 或 `operation(client({ abort }), input)` |

只要操作声明了 input，第二个实参就始终是 input。操作从不根据对象里有没有 `abort` 来猜测它是 input 还是配置。

## 3. Client

### 3.1 类型与职责

```ts
type RequestOptions = {
  abort?: AbortSignal;
  onUploadProgress?: HttpProgressFn;
  onDownloadProgress?: HttpProgressFn;
  beforeConnect?: ClientWebSocketOptions["beforeConnect"];
  protocols?: readonly string[];
  heartbeat?: WebSocketHeartbeatConfig;
  reconnect?: ClientWebSocketOptions["reconnect"];
};

interface ClientState {
  readonly config: ClientConfig; // 基础配置
  readonly options: RequestOptions; // 请求配置
}

interface Client {
  (options?: RequestOptions): Client;
  readonly [CLIENT]: ClientState;
}

declare function createClient(...options: ClientOption[]): Client;
```

完整、可编译的版本在[类型声明附录](2026-11-01-operation-client.types.ts)，正反用例在[类型验收附录](2026-11-01-operation-client.type.test.ts)。附录仅声明目标 API，不提供运行时实现，不从生产包导出。

`createClient(...options)` 保持现有构造选项，只是返回值从含 `execute` 的对象换成可调用的 Client。

### 3.2 两份配置

| 配置     | 来源                           | 生命周期                   | 例子                                     |
| -------- | ------------------------------ | -------------------------- | ---------------------------------------- |
| 基础配置 | `createClient(...withOptions)` | 创建后不变，所有派生共用   | endpoint、拦截器、传输句柄、重连默认策略 |
| 请求配置 | `client(options)`              | 随每次派生叠加，只影响本次 | `abort`、进度回调、心跳                  |

两者分开，是这个设计避免相互污染的根本办法：

- `client(options)` 只写请求配置，从不触碰基础配置。
- 原 client 的请求配置始终为空，不会因为任何派生而改变。
- 单次的 SSE 或 WebSocket 选项不再需要借用基础配置里的字段。

### 3.3 派生语义

```ts
const base = createClient(withEndpoint(url)); // options: {}
const a = base({ abort: s1 }); // options: { abort: s1 }
const b = a({ onDownloadProgress }); // options: { abort: s1, onDownloadProgress }
const c = b({ abort: s2 }); // options: { abort: s2, onDownloadProgress }
const d = base(); // options: {}，仍是新的 client
```

规则：

- 每次调用 client 都返回新的 client，不返回自己。
- 请求配置按字段叠加，后来者覆盖前者；未出现的字段保留。
- 字段的值是 `undefined` 时视为未提供，保留父级的值。例如 `a({ abort: undefined })` 仍保留 `a` 的取消信号。
- `abort` 不做信号组合：`a({ abort: s2 })` 的结果只有 `s2`，不是 `s1` 与 `s2` 的合并。需要组合时由应用使用 `AbortSignal.any`。
- 嵌套字段（`heartbeat`、`reconnect`、`protocols`）作为整体被替换，不做字段级合并。
- 无参调用合法。
- client 不是一次性令牌，同一个值可以反复传给多个操作；复用同一个 `abort` 表示共享同一个信号，信号取消后不会被替换或复活。

派生只记录配置：不发 I/O、不建立连接、不为尚未执行的操作注册取消监听器。

### 3.4 Symbol 是内部协议

Client 通过内部 `[CLIENT]` Symbol 属性携带 `ClientState`。业务代码只使用 `client(options)` 与操作函数。

实现需要满足：

- 不把 Symbol 的 description 当作身份比较依据。
- 不要求应用读取 Symbol、配置载荷或内部执行入口。
- 不引入全局默认 client 或按名称查询客户端的注册中心。
- 不把 `[CLIENT]` 载荷布局变成 SDK 消费方的公共依赖。

现有代码已有 `CLIENT = Symbol("Client")`，其值是 `ClientConfig`；新设计沿用该符号，值改为 `ClientState`。

## 4. RequestOptions

### 4.1 字段

| #   | 字段                 | 类型                                                                       | 认识它的协议  |
| --- | -------------------- | -------------------------------------------------------------------------- | ------------- |
| 1   | `abort`              | `AbortSignal`                                                              | HTTP、SSE、WS |
| 2   | `onUploadProgress`   | `(event) => void \| Promise<void>`                                         | HTTP          |
| 3   | `onDownloadProgress` | 同上                                                                       | HTTP          |
| 4   | `beforeConnect`      | `({ attempt, signal }) => void \| Promise<void>`                           | WebSocket     |
| 5   | `protocols`          | `readonly string[]`                                                        | WebSocket     |
| 6   | `heartbeat`          | `{ intervalMs, message?, isAck?, timeoutMs? }`                             | WebSocket     |
| 7   | `reconnect`          | `{ attempts?, delayMs?, factor?, jitter?, maxDelayMs?, shouldReconnect? }` | WebSocket     |

这些字段全部来自当前 `execute` 的单次选项，没有新增字段。字段 4 到 7 在 WebSocket 中覆盖基础配置里同名的设置。SSE 的重连策略和无效事件钩子是客户端级选项，不在单次选项中，沿用现状。

### 4.2 忽略不属于自己的字段

三个执行函数读取选项时都是按名字取字段，不会遍历或校验整个对象：

| 协议      | 读取的字段                                                      |
| --------- | --------------------------------------------------------------- |
| HTTP      | `abort`、`onUploadProgress`、`onDownloadProgress`               |
| SSE       | `abort`                                                         |
| WebSocket | `abort`、`beforeConnect`、`protocols`、`heartbeat`、`reconnect` |

因此扁平形态不需要新增任何过滤逻辑：HTTP 操作收到 `heartbeat` 就不读取它，WebSocket 操作收到进度回调同样不读取。类型层面也不拦截，见第 5.4 节。

### 4.3 为什么选扁平而不是分组

| 方案         | 取舍                                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| 扁平（采用） | 与现有 `execute` 选项一一对应，字段叠加规则只有一条，迁移成本最低。代价是拼错协议的字段不会被编译期发现。 |
| 按协议分组   | 字段归属一目了然，但引入新层级，叠加规则需要再定义，且偏离"当前 `execute` 配置"这个来源。                 |

## 5. TypeScript 类型设计

### 5.1 类型分工

| 类型或函数                                                      | 职责                                             |
| --------------------------------------------------------------- | ------------------------------------------------ |
| `Client`                                                        | 可调用值，携带 `[CLIENT]: ClientState`，无泛型   |
| `RequestOptions`                                                | 7 个扁平字段，由现有选项类型挑选，不重新定义     |
| `ClientState`                                                   | 基础配置与请求配置                               |
| `EndpointArgs<S>`                                               | 从 input Struct 决定没有参数、可选参数或必填参数 |
| `RequestEndpoint` / `EventStreamEndpoint` / `WebSocketEndpoint` | 三种操作函数的类型，第一个参数都是 `Client`      |

### 5.2 RequestOptions 的来源

```ts
type RequestOptions = Pick<
  HttpExecuteOptions,
  "onUploadProgress" | "onDownloadProgress"
> &
  Pick<
    WebSocketExecuteOptions,
    "beforeConnect" | "protocols" | "heartbeat" | "reconnect"
  > & { abort?: AbortSignal };
```

删除 `timeout` 后，现有的 `abort` 与 `timeout` 互斥联合类型（`UseCancellationConfig`）不再需要，选项类型变成一个普通对象。这也是上一版需要 `MergeOptions` 处理联合分支的原因，现在整个类型层都不再需要它。

类型验收用例用 `keyof RequestOptions` 断言恰好是这 7 个字段，防止今后悄悄增减。

### 5.3 输入参数由一个元组类型决定

```ts
type EndpointArgs<S extends AnyStruct | undefined> = [S] extends [undefined]
  ? []
  : undefined extends StructInput<S>
    ? [input?: StructInput<S>]
    : [input: StructInput<S>];
```

每个定义生成后就拥有确定的参数元组，不是按实参数量猜测用途的重载：

| 定义                    | 生成的调用签名                      |
| ----------------------- | ----------------------------------- |
| 不声明 input            | `(client) => Promise<结果>`         |
| input 是普通对象 Struct | `(client, input) => Promise<结果>`  |
| 整个 input Struct 可选  | `(client, input?) => Promise<结果>` |

使用 `StructInput` 而不是 `Infer`：调用方可提供输入允许的表示，builder 仍接收解析后的 `BuilderInput`。

### 5.4 三种操作类型

```ts
type RequestEndpoint<
  Args extends unknown[],
  Data,
  ErrorData,
  Response extends HttpMeta,
> = (
  client: Client,
  ...args: Args
) => Promise<
  | [error: null, result: Data, response: Response]
  | [error: FaultOf<ErrorData>, result: undefined, response: undefined]
>;
```

`EventStreamEndpoint` 与 `WebSocketEndpoint` 同样以 `client: Client` 开头，结果仍是各自现有的元组。完整声明见附录。

Schema 类型只留在定义工厂里：工厂先把它们投影成参数元组、业务数据、错误数据和响应元数据，再生成操作类型。这有实际编译证据：让操作类型保留原始 Struct 时，导出可选输入的操作会触发 TS4023，因为内部的 `PreservedStruct` 无法从包外命名；投影成业务类型后，声明生成通过。

HTTP 的 `Response` 单独保留，不从 Data 是否含 `undefined` 猜测：声明了可选 output 与完全没有声明 output 并不相同，前者有已解码的 body，后者没有。

### 5.5 定义工厂

`defineRequest`、`defineEventStream`、`defineWebSocket` 的定义字段与推导方向沿用当前实现，仅返回类型改为上述操作函数。完整声明在类型附录。

### 5.6 已知的类型边界

这些是此设计主动接受的取舍，不是遗漏：

- **没有协议专属的编译期拦截。** `getUser(client({ protocols: ["chat.v1"] }), ...)` 类型上通过，运行时被 HTTP 忽略。
- **心跳回调的消息是 `unknown`。** `isAck(message)` 与 `message()` 不再从操作推导具体消息类型，需要自行收窄。这与基础配置里 `ClientWebSocketOptions.heartbeat` 当前的类型一致，不是回退。运行时心跳消息仍会按 `outgoing` 结构序列化，不匹配会让会话失败，这个行为沿用现有逻辑。
- **对象字面量的多余字段会被拒绝，变量传入则不会。** `client({ abrot })` 报错；先存入变量再传入时，TypeScript 的结构类型允许额外属性。
- **编译检查不证明运行时行为。** 配置隔离、监听器清理、资源释放仍由实现和验收保证。

## 6. 取消与期限：删除 timeout

### 6.1 取消只剩 abort

调用方通过 `abort` 传入 `AbortSignal`。需要期限时使用平台能力：

```ts
await getUser(client({ abort: AbortSignal.timeout(5_000) }), { id: 1 });
```

`AbortSignal.timeout()` 触发时的 `signal.reason` 是名为 `TimeoutError` 的 `DOMException`。现有的 `isTimeoutCause` 已识别它，并经 `resolveAbortedCause` 把结果归为 `NET_TIMEOUT`，因此超时与主动取消在 `error.code` 上仍然可区分。该路径依赖现有代码，实施时用测试确认。

### 6.2 删除清单

以下是只读调查的结果，实施时以编译和测试为准：

| 类别         | 内容                                                                                                                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 公开选项     | 单次 `timeout`；`withTimeout`；`ClientConfig.timeout` 与对应的未解析配置字段（`config.ts`）                                                                                                                    |
| 公开类型     | `UseCancellationConfig` 的联合形态；`HttpExecuteOptions`、`EventStreamExecuteOptions`、`WebSocketExecuteOptions` 里的 `timeout` 与 `signal`                                                                    |
| 内部机制     | `armTransportDeadline`、`TransportDeadline`、`validateTransportTimeout`、`hasAbortTimeoutConflict`、`createAbortTimeoutConflictFault`、`ABORT_TIMEOUT_CONFLICT_MESSAGE`、`mergeAbortSignals` 的 `timeout` 参数 |
| 执行函数     | HTTP、SSE、WebSocket 执行函数中 `abort` 与 `timeout` 的冲突检查、`timeout` 的校验、截止时间的创建与释放（`releaseRequestTimeout`）                                                                             |
| 传输请求字段 | `http_request.ts`、`transport_request.ts`、`http/request.ts` 里传递的 `timeout` 字段。这些字段是否有传输层消费者，实施时核对后再删                                                                             |
| 文档与示例   | 各协议页面、`client.mdx`、`errors.mdx`、`recipes/cancel-http.mdx`、`doc/examples` 中的 `timeout` 示例，以及全部语言版本；TSDoc 与 `api-*.json` 重新生成                                                        |
| 测试         | 涉及 `timeout` 的单元、类型与 E2E 用例，约 45 个文件；需要逐个判断是删除还是改写为 `AbortSignal.timeout()`                                                                                                     |

### 6.3 保留清单

这些名字含 timeout，但不是请求期限，不应误删：

| 保留项                                                 | 原因                                               |
| ------------------------------------------------------ | -------------------------------------------------- |
| `NET_TIMEOUT`、`ERR_TIMEOUT`、`isTimeoutCause`         | 对 abort 原因分类，供 `AbortSignal.timeout()` 使用 |
| `heartbeat.timeoutMs`                                  | 心跳等待 ACK 的时间                                |
| 重连退避延迟（`backoff.ts`）                           | 重连策略的一部分                                   |
| WebSocket 释放时的 1 秒关闭事件等待及其 `TimeoutError` | 资源释放保护，不是请求期限                         |
| OpenTelemetry 中关于超时仍记录日志的行为               | 观测逻辑，仅文档措辞可能需要核对                   |

### 6.4 行为变化

这些是此决定的直接后果，不再另行确认：

| 变化                              | 说明                                                                                                                                                             |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SSE、WebSocket 不再有"仅启动期限" | 现在的 `timeout` 只管到连接建立。`AbortSignal.timeout(ms)` 到期会终止整个连接。想要仅启动期限，应用需要自己创建 `AbortController`，并在 `await` 返回后清除计时器 |
| 没有客户端级默认超时              | `withTimeout` 删除后不再有"每个 HTTP 请求默认 N 秒"                                                                                                              |
| `abort` 与 `timeout` 互斥故障消失 | 该互斥只因 `timeout` 存在才有意义                                                                                                                                |
| 同一次调用只有一个取消信号        | 不再有 `abort` 加 `signal` 的组合；需要多个信号时用 `AbortSignal.any`                                                                                            |

## 7. 内部执行衔接：替换入口，不替换流程

### 7.1 操作调用

操作函数接收 client 与业务输入，从 `client[CLIENT]` 取出基础配置与请求配置，再委托当前协议的执行入口，返回原有 Promise：

```text
getUser(client, input)
  → 读取 client[CLIENT]：config + options
  → 解析 input、运行 builder、按协议拼装请求
  → 运行拦截器链 → 使用 transport
  → 返回错误优先元组
```

不新增 Promise 子类、thenable 或额外运行时。执行顺序、异常来源归类和清理细节以现有协议执行代码为基线。

### 7.2 内部 command 可以保留

内部的命令类型和 runner 分派机制（`COMMAND_EXECUTE`）让 `client.execute` 不必导入未使用的传输。操作函数可以继续复用它们，也可以直接绑定各协议执行函数，由实现选择，只要满足：

- 每个协议的传输仍按需引入，普通 HTTP 调用不强制引入 WebSocket 或 SSE 代码。
- 不借此重排内部阶段或重写失败路径。

### 7.3 公开面的移除

用户允许破坏性重构。以下现有公开面随新入口移除或改为内部：

| 现有公开面                                              | 新设计                       |
| ------------------------------------------------------- | ---------------------------- |
| `client.execute(...)`                                   | 删除                         |
| `endpoint(input)` 返回命令                              | 删除，改为操作函数           |
| `HttpCommand`、`EventStreamCommand`、`WebSocketCommand` | 不再是公开概念               |
| `executeHttpCommand` 等低层执行导出                     | 默认移除，实施时随公开面核对 |
| `withTimeout`、`timeout`、`signal`                      | 删除，见第 6 节              |

不通过重载在同一个操作上混合"生成命令"和"直接执行"两种模式。

### 7.4 单次选项校验

单次选项的校验仍留在操作进入的执行链中，失败继续返回 `REQ_OPTIONS_INVALID` 等现有结果，不在 `client(options)` 中同步抛出。例如重连参数非法依旧在执行时返回故障，不因配置位置改变而提前。

普通 JavaScript 实参求值、用户 getter 等发生在进入 API 之前的异常，不在这里扩展为新的故障捕获机制。

## 8. 错误结果与流资源保持原样

| 协议      | 成功结果                      | 初始失败结果                                  |
| --------- | ----------------------------- | --------------------------------------------- |
| HTTP      | `[null, data, response]`      | `[fault, undefined, undefined]`               |
| SSE       | `[null, stream, open]`        | `[fault, undefined, open 或 undefined]`       |
| WebSocket | `[null, session, connection]` | `[fault, undefined, connection 或 undefined]` |

故障 code、cause、响应元数据和业务 error 数据沿用现有契约。只解构前两项不代表删除第三项。`await` 不改变这一切：例如输入解析失败仍是 `REQ_INPUT_INVALID`，builder 抛出仍是 `REQ_BUILD_FAILED`。

### 8.1 SSE

```ts
const notifications = defineEventStream({
  path: "/notifications",
  maxBufferSize: 64 * 1024,
  maxQueueSize: 100,
  events: { message: struct.object({ text: struct.string() }) },
});

async function consume(abort: AbortSignal) {
  const [error, stream] = await notifications(client({ abort }));
  if (error) {
    console.error(error.code);
    return;
  }
  await using ownedStream = stream;
  for await (const event of ownedStream) {
    console.log(event.data.text);
    break;
  }
}
```

### 8.2 WebSocket

```ts
const room = defineWebSocket({
  path: "/rooms/:id",
  maxIncomingQueueSize: 100,
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  incoming: struct.object({ text: struct.string() }),
  outgoing: struct.object({ message: struct.string() }),
});

async function chat(abort: AbortSignal) {
  const [error, session] = await room(
    client({
      abort,
      heartbeat: {
        intervalMs: 1_000,
        message: () => ({ message: "ping" }),
        isAck: (message) =>
          typeof message === "object" && message !== null && "text" in message,
      },
    }),
    { id: 1 },
  );
  if (error) {
    console.error(error.code);
    return;
  }
  await using ownedSession = session;
  ownedSession.send({ message: "Hello" });
  for await (const message of ownedSession.receive) {
    console.log(message.text);
    break;
  }
}
```

运行期错误、发送检查、重连、`close`、`closed` 和异步释放仍属于已有的流与会话契约。`client(options)` 不接管这些资源，也没有新增客户端释放步骤。

## 9. 框架、插件和测试替身

- **React / Vue**：Provider 与 inject 继续共享应用提供的 Client。取得 client 后可直接配置并传给操作，不需要新的 Hook 或 Composable。框架层仍不负责传输、缓存、取消策略或资源所有权。
- **中间件插件**：`withOpenTelemetryServer` 等通过客户端构造选项安装拦截器，派生请求配置不会重复安装，也不复制中间件链。认证、重试、ETag 和观测策略的介入位置不变。
- **测试替身**：继续使用 `withHTTPHandle`、`withSSEHandle`、`withWebSocketHandle` 和拦截器测试边界。业务代码可依赖具体操作函数类型，不另建通用 Executor 接口或全局 mock 注册器。

## 10. 变更清单

| 区域         | 必要变化                                               | 保持不变                             |
| ------------ | ------------------------------------------------------ | ------------------------------------ |
| Client       | 可调用，两份配置，派生返回新 client                    | 构造选项；应用拥有配置与传输         |
| 三种定义工厂 | 返回接收 client 的操作函数                             | 定义字段、Struct 与 builder 行为     |
| 单次选项     | 合并为扁平的 `RequestOptions`，7 个字段                | 字段含义与默认值                     |
| 取消与期限   | 删除 `timeout`、`signal`、`withTimeout` 及全部相关机制 | `NET_TIMEOUT` 等分类、心跳超时、退避 |
| 执行衔接     | 从 client 取出两份配置并委托                           | 解析、拦截、传输、结果流程           |
| 公开面       | 删除 `client.execute`、命令概念与低层执行导出          | 错误元组、业务错误数据               |
| 示例与指南   | 使用 `operation(client(options), input)`               | 错误分支、清理和业务结果处理         |

明确不包含：新 Schema 协议、编码规则重写、Result 对象替换、缓存、响应式状态、工作流 DSL、通用依赖注入容器、自动重试策略。

## 11. 兼容与文档衔接

这是破坏性变更，需要按项目版本策略处理，并在发布说明中列出迁移对应：

| 旧写法                                    | 新写法                                         |
| ----------------------------------------- | ---------------------------------------------- |
| `client.execute(getUser(input), options)` | `getUser(client(options), input)`              |
| `execute(cmd, { timeout: 5000 })`         | `client({ abort: AbortSignal.timeout(5000) })` |
| `execute(cmd, { signal })`                | `client({ abort: signal })`                    |
| `createClient(withTimeout(5000), ...)`    | 在调用处传入 `abort`，或封装一个应用自己的函数 |

实施时同步：

- `packages/core/design.md`、README、公共 TSDoc，并运行 `bun run --cwd doc extract-api` 提交三个生成文件。
- 三种协议的示例、SDK 发布示例、取消与错误示例，以及 `doc/examples`。
- React、Vue 与 OpenTelemetry 的相关示例与类型测试。
- 全部 11 个语言版本中受影响的指南。
- `AGENTS.md` 中关于调用链、`client.execute` 与示例风格的现行说明，以及 `Contracts that must not break` 里对应条目。
- 不改写历史的设计、审计和研究记录。

## 12. 验收标准

### 12.1 调用与类型

- `await getUser(client({ abort }), { id: 1 })` 不需要额外包装、泛型或断言。
- 无输入操作接受 `health(client)` 与 `health(client({ abort }))`，不要求占位。
- 必填输入不可省略，可选输入规则与 Struct 一致；操作不接受第三个参数；旧入口 `getUser(input)` 被类型拒绝。
- `client()` 无参合法；`client({ timeout })` 与 `client({ signal })` 被类型拒绝。
- `keyof RequestOptions` 恰好是 7 个字段。
- 错误分支不能使用成功值，业务 fault 数据类型不丢失。
- 生成声明后独立消费仍满足上述要求。

### 12.2 客户端配置隔离

- 每次 `client(options)` 返回新值，原 client 与其他派生值的请求配置不变。
- 字段叠加、后来者覆盖、`undefined` 视为未提供并保留父级的值、嵌套字段整体替换，与第 3.3 节一致。
- 不发 I/O，不启动计时器，不注册取消监听器。
- 并行派生的不同信号不会串用。
- 复用已取消的信号保持原取消结果，不静默复活。

### 12.3 执行等价

使用同一组定义、输入和基础配置，对照旧路径与新入口（仅限未涉及 `timeout` 的行为）：

- 发送的 URL、headers、body 字节相同。
- builder、拦截器、传输的调用次数与顺序符合原契约。
- input、builder、transport、decode 失败的 code、cause 和元数据一致。
- 预取消不进入传输，执行中取消到达现有传输边界。
- 重试、ETag、重连、进度观察器与错误归属不因入口变化而重排。
- HTTP、SSE、WebSocket 收到不认识的字段时忽略，不产生故障。
- `AbortSignal.timeout()` 触发的取消返回 `NET_TIMEOUT`，主动取消返回 `NET_ABORTED`。

### 12.4 timeout 删除

- 全仓库不再有 `timeout` 选项、`withTimeout`、`armTransportDeadline`、`validateTransportTimeout`、`hasAbortTimeoutConflict` 的引用。
- 第 6.3 节的保留项行为不变，相关测试仍通过。
- 公共 API 提取数据与导出清单一致。

### 12.5 生命周期与集成

- SSE、WebSocket 打开前失败、打开后失败、提前退出和释放路径全部覆盖。
- React、Vue 只传递 Client，不增加执行副作用。
- 中间件插件不重复安装，观测边界不变。
- 打包产物保持协议传输的按需引入；不以调用语法直接推断体积或性能收益。

未来实现必须按 AGENTS.md 规定顺序完成 lint、格式、类型、单元测试、构建和 E2E，并在同一修订上全部通过。本文的目标签名与示例不是已落地的 API。

## 13. 本次验证范围与未验证项

已验证（本次编写时执行）：

- 类型声明与验收附录通过根 `tsc`。
- 附录中的导出声明可以生成 `.d.ts`。
- 三种协议的单次选项类型相交可以编译。
- 三个执行函数按名字读取字段，不遍历整个选项对象。

未验证：

- 运行时实现不存在，第 3、6、7 节的行为是设计，不是已通过测试的事实。
- `AbortSignal.timeout()` 经现有代码归类为 `NET_TIMEOUT`，是读取 `isTimeoutCause` 与 `resolveAbortedCause` 得出的，没有运行过。
- 传输请求里 `timeout` 字段有没有传输层消费者，以及 OpenTelemetry 中与超时有关的行为，实施时需要逐处核对。
- 依赖当前 `client.execute` 的下游代码，包括 React、Vue 与 OpenTelemetry 的类型和测试，尚未逐项迁移。

## 14. 实现参考

- [客户端与现有执行委托](../../packages/core/src/client/client.ts)
- [内部命令协议](../../packages/core/src/client/command.ts)
- [客户端构造选项](../../packages/core/src/client/option.ts)
- [基础配置及协议默认值](../../packages/core/src/client/config.ts)
- [HTTP 定义、结果与执行](../../packages/core/src/http/http.ts)
- [SSE 定义、结果与执行](../../packages/core/src/sse/sse.ts)
- [WebSocket 定义、结果与执行](../../packages/core/src/web_socket/web_socket.ts)
- [取消选项与校验](../../packages/core/src/internal/abort.ts)
- [超时原因的归类](../../packages/core/src/error/cause.ts)
