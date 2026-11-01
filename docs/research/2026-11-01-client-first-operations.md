# Defjs 操作优先、显式客户端调用范式研究

日期：2026-11-01。

本地基线：`main`，`a3d38bc0b922a1cd2120c65ef1e5eb07e71c47a6` 及读取时工作区。研究不修改现有实现，不安装依赖，不提交。既有文档与国际化改动保持原状。

本报告延续[跨语言范式研究](2026-10-31-api-paradigms.md)，但仅评估用户提出的直接调用，不重新讨论 Struct、alias 或响应表示。来源事实、设计建议与本地实验分别标明。所有新 `defineRequest` 调用示例均为提案，不是当前包已支持的 API。

## 1. 结论

**推荐把 `getUser(client, input, options)` 作为下一版主调用入口的优先候选。** 相较上一轮推荐的“执行器接收定义和输入”，它更符合当前目标：让业务操作成为调用中心，同时保留显式客户端依赖与独立 SDK 定义。

这不是因为它更纯，也不是因为网络执行机制发生了根本变化，而是因为公共 API 把用户关注的对象放对了位置。

建议独立作出以下决定：

| 问题                                      | 建议                             |
| ----------------------------------------- | -------------------------------- |
| 操作是否直接接收客户端并执行              | 推荐                             |
| SDK 定义是否捕获应用客户端                | 不捕获，仍由应用传入             |
| 普通调用是否必须先创建公开 Command        | 不必                             |
| 内部是否必须删除 command / runner         | 不必，先复用现有执行链           |
| 是否改成成功值或异常返回                  | 不改，继续错误优先元组           |
| 是否同时引入 `client({ abort })`          | 暂不作为默认入口；单独评估其语义 |
| 是否引入柯里化、bind 工厂或 Effect 运行时 | 没有必要                         |

正式替换仍需生命周期回归和真实消费者迁移验证。当前证据支持设计方向与局部可行性，不证明发布兼容性、性能提升或所有使用场景都更自然。

## 2. 为什么不只是隐藏 execute

### 2.1 调用中心发生变化

当前真实用法：

```ts
const command = getUser({ id: 1 });
const [error, user] = await client.execute(command);
```

上一轮候选：

```ts
// 提案。
const [error, user] = await client.execute(getUser, { id: 1 });
```

用户本轮提案：

```ts
// 提案。
const [error, user] = await getUser(client, { id: 1 });
```

| 形式                         | 阅读中心             | 未执行的单次操作 | 开始执行的位置 |
| ---------------------------- | -------------------- | ---------------- | -------------- |
| endpoint 生成 command        | 描述与执行的分步协议 | 显式 command     | execute        |
| execute 接收定义与输入       | 通用执行器           | 默认没有         | execute        |
| operation 接收 client 与输入 | 业务操作             | 默认没有         | operation 调用 |

后两者可以共享同一个执行机制，但阅读体验不同。连续阅读业务代码时，`getUser`、`updateProfile`、`watchChanges` 直接成为动词，不再都包在通用 execute 后面。

另一个收益是每个导出操作本身具有完整调用签名。编辑器在业务操作处显示 input、options、结果和错误关系，不必先理解通用执行器的多个协议重载。

**判断：**这是有价值的关注点移动。不能因内部仍会调用执行器就把它贬为纯粹换名字，也不能因外观改善就宣称内部复杂度已经消失。

### 2.2 定义独立与公开 Command 是两个设计决策

新的定义工厂仍可以只保存协议声明，返回一个不捕获应用 client 的函数。导入 SDK 不发请求；应用选择什么时候调用，以及传入哪个客户端。

```ts
// 提案：同一个 SDK 操作，两个应用环境。
const first = await getUser(testClient, { id: 1 });
const second = await getUser(productionClient, { id: 1 });
```

示例只表达依赖选择，不建议真实测试访问生产环境。

应用对 endpoint、凭据、拦截器和传输的所有权不取决于 execute 是否写在调用现场。只要操作委托传入 client，而不是自行硬编码 fetch 或捕获全局实例，边界就仍成立。

### 2.3 它是显式依赖函数，不是纯函数

更准确的描述是：**操作优先、显式客户端依赖的异步函数**。

它具有函数式的使用风味：函数是一等值，依赖通过参数传递，可以组合和替换。但执行网络操作有副作用，相同参数不保证相同结果，所以不具有纯函数的引用透明性。

这个术语区别不构成反对理由。改善调用表达不需要先满足数学上的纯度。

也不要把 client-first 自动理解为柯里化或 data-last。存在第三个 options 参数时，业务数据甚至不是最后一个参数。需要固定依赖时，普通闭包已经足够。

## 3. 真实先例与非同构对照

### 3.1 Firebase：真正相似的自由函数

**来源事实：**模块化 Auth API 提供：

```ts
signInWithEmailAndPassword(auth, email, password);
```

它不是 auth 实例方法。固定提交中的函数接收 Auth，调用凭据登录过程，再返回 Promise 链。[Firebase 源码][firebase-source]

与提案相似之处：操作函数在前，服务实例显式传入，调用者不需要再执行 command。

不同之处：Firebase 的结果是成功值 Promise，错误走 rejection；Defjs 应继续自己的错误优先元组。源码也不能单独证明网络字节在函数调用后的哪个微任务发出。

**启示：**显式实例与自由函数是成熟、可用的 API 组织方式，不必先绑定整个客户端方法树。

### 3.2 AWS / Smithy：公开包装可以消失，内部命令仍然存在

**来源事实：**AWS SDK v3 同时展示以下用法：[AWS README][aws-readme]

```ts
bareBonesS3.send(new GetObjectCommand(input));
aggregatedS3.getObject(input);
```

聚合方法内部仍使用命令执行机制。Smithy 的 send 关联命令输入与输出，传递调用级 options，并把工作交给 handler。[Smithy Client][smithy-client]

这不是自由函数的同构先例。它证明的是：**减少公开 command/send 写法，并不要求删除内部执行机制。**

也不能直接复制聚合客户端。它把操作挂到实例原型上，导入结构与自由函数不同。不能据此声称 Defjs 的新形式一定拥有相同包体积或 tree shaking 行为。

### 3.3 SQLx：操作在前，执行依赖显式提供

**来源事实：**SQLx 查询对象提供 `execute(executor)`、`fetch(executor)` 等方法，并关联数据库与执行器类型。[SQLx Query][sqlx-query]

它不是 `operation(client, input)` 自由函数，Rust Future 和 Stream 也不是 JavaScript Promise。

借鉴点是分工：操作保持自己的输入和结果关系，执行资源显式传入。是否使用对象方法或自由函数，应服从宿主语言与用户任务，而非把某种点号位置奉为标准。

## 4. 推荐的调用契约

### 4.1 有输入操作：客户端、输入、单次选项

以下完整示例是提案；definition 内容沿用现有设计，只改变返回函数的调用方式。

```ts
import { createClient, defineRequest, struct, withEndpoint } from "@defjs/core";

export const getUser = defineRequest({
  method: "GET",
  path: "/users/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({
    id: struct.number(),
    name: struct.string(),
  }),
});

const client = createClient(withEndpoint("https://api.example.com"));

async function main() {
  const controller = new AbortController();
  const [error, user, response] = await getUser(
    client,
    { id: 1 },
    { signal: controller.signal, timeout: 10_000 },
  );
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(user.name, response.status);
}

void main();
```

用户注释中的 `Promise<User>` 与错误元组示例不一致。本报告按实际调用保留元组，HTTP 签名可概括为：

```ts
// 提案类型；不是当前 defineRequest 的返回类型。
type GetUser = (
  client: Client,
  input: { id: number },
  options?: HttpExecuteOptions,
) => Promise<HttpAwaitResult<{ id: number; name: string }>>;
```

只解构前两项不意味着删除成功响应元数据。声明了业务 error schema 时，也应保留其 fault 数据类型。

### 4.2 无输入与可选输入

推荐根据定义是否声明 input 决定签名，不根据实参字段猜测。

| 定义                           | 推荐调用                                           |
| ------------------------------ | -------------------------------------------------- |
| 必填 input                     | `getUser(client, { id: 1 }, options)`              |
| 无 input                       | `health(client)` 或 `health(client, options)`      |
| 整个 input 允许 undefined      | `search(client)` 或 `search(client, { q: "Ada" })` |
| 省略可选 input，但需要 options | `search(client, undefined, options)`               |

这里选择让无输入操作省去无意义的占位。另一种可行设计是所有操作始终固定 options 在第三位置；它便于位置统一，但会增加 `health(client, undefined, options)` 的样板。

本报告不认为避免这个占位必须引入运行时猜测：无 input 是定义时已知事实，生成的函数可以拥有确定签名。局部声明实验也验证了这种形态。

必须禁止如下猜测：看到对象有 signal 或 timeout，就把它当 options。业务输入可能恰好具有这些字段。声明了可选 input 的操作仍保留该输入位置。

对象中每个字段可选，也不等于整个输入参数可省略；后者由 schema 是否接受 undefined 决定。

### 4.3 固定依赖与提取类型

```ts
// 提案中的 getUser 已由具体 schema 确定签名。
type GetUserInput = Parameters<typeof getUser>[1];

const getUserHere = (input: GetUserInput) => getUser(client, input);
```

普通 bind 对这个已具体化的函数也可以保留输入检查，本地实验已通过。但不需要因此新增官方 bind API。

**来源事实：**Parameters、ReturnType 对重载函数只提取最后一个签名；对未实例化泛型也可能得到 unknown 或约束类型。[TypeScript Utility Types][ts-utilities]

因此不要先把操作擦宽成通用函数，再试图通过工具类型恢复全部关联。定义工厂应直接从 schema 生成具体操作签名。不同操作组成的异构集合，仍需要正确表达每个操作与输入的配对，不会因 client-first 自动解决。

## 5. 单独裁决 client({ abort })

### 5.1 它不是错误设计，但不只是简写

用户提出：

```ts
// 提案。
await getUser(client({ abort }), { id: 1 });
```

它可能表达“给这个执行环境叠加一次调用政策”，也可能表达“创建一个共享取消作用域”。这两种含义不能混用。

**公平的判断：**如果它只返回不可变、无计时器、无监听器的选项视图，那么它不必导致共享状态污染或资源泄漏。新对象身份本身也不是缺陷。

但它仍需要定义以下可观察规则：

| 问题                    | 必须明确的契约                                          |
| ----------------------- | ------------------------------------------------------- |
| 是否改变原 client       | 不应修改，避免并行调用互相影响                          |
| timeout 从何时开始      | 视图创建时的共享期限，还是每次调用的预算                |
| 信号如何叠加            | 替换、拒绝冲突，或组合；不能无文档地任选                |
| 被取消后能否复用        | 原 AbortSignal 不会重置，不能偷偷恢复                   |
| 协议专属选项放在哪里    | HTTP progress、WebSocket heartbeat 等不能全部擦成宽对象 |
| 视图是否拥有资源        | 若只是选项，不应暗示会自动释放 SSE / WebSocket          |
| 原始 options 后续被修改 | 快照还是借用，需要与执行器规则一致                      |

**来源事实：**AbortSignal 一旦取消，不会通过再次调用恢复为未取消状态。[WHATWG DOM][abort-signal]

**建议：**本轮先采用操作的 options 参数，暂不把 callable client 作为主 API 的必要组成。不要同时再加入 withOptions 等等价入口。

### 5.2 共享取消已经可以自然表达

```ts
// 提案：共享的是显式取消信号，不是可变客户端状态。
async function loadPair(client: Client, signal: AbortSignal) {
  const options = { signal };
  const results = await Promise.all([
    getUser(client, { id: 1 }, options),
    getUser(client, { id: 2 }, options),
  ]);
  return results;
}
```

如果真实代码反复需要“一组操作共享同一执行政策”，不可变作用域视图值得再验证。那时应作为独立概念评估，而不是为省掉第三参数顺带发明。

Go Context 强调显式传播取消与期限，但 Context 不等于拥有 endpoint 和传输的客户端。Effect Scope 则管理 finalizer，也不是一袋 options。不能借用它们的名称就宣称拥有相同生命周期保证。[Go context][go-context]、[Effect v3 Scope][effect-scope]

### 5.3 不顺带改变已有取消语义

当前 abort 与 timeout 互斥，signal 可与其中之一组合。本次调整调用入口不应偷偷合并字段含义。

HTTP 的执行期限与长连接启动期限也不能因参数位置改变而统一成一个新的规则。同步 JavaScript 不会被计时器抢占；取消外层等待不证明任意用户回调已经停止。

取消要求停止工作，但不证明远端业务回滚，也不证明物理连接已经关闭。资源完成应由既有 closed 或 disposer 边界确认。

## 6. 顺序、并行与延迟的实际含义

### 6.1 调用启动，await 等待

```ts
// 提案：此时已经进入执行流程。
const pending = getUser(client, { id: 1 });

// 等待已有执行结果，不是启动按钮。
const result = await pending;
```

本地适配实验观察到 builder 在调用时进入，假传输随后在没有 await 该操作 Promise 的情况下被调用。不能把“调用启动”进一步夸大为“网络字节必定同步发送”。

第一次探针曾错误地断言传输计数应在函数返回后立即增加，因此失败。改成等待真实传输事件后通过。这正好说明两种时序不能混为一谈。

参数表达式在进入操作函数前求值。若 `makeInput()` 自己抛错，操作尚未被调用，不能要求 Defjs 把它转成故障元组。

### 6.2 顺序组合仍是普通控制流

```ts
// 提案片段，沿用前文 getUser。
async function loadRelated(client: Client, signal: AbortSignal) {
  const [firstError, first] = await getUser(client, { id: 1 }, { signal });
  if (firstError) {
    console.error(firstError.code);
    return;
  }

  const [secondError, second] = await getUser(
    client,
    { id: first.id + 1 },
    { signal },
  );
  if (secondError) {
    console.error(secondError.code);
    return;
  }
  console.log(first.name, second.name);
}
```

### 6.3 Promise.all 负责汇合，不负责把函数变成任务

```ts
// 提案片段。
async function loadMany(client: Client, ids: number[]) {
  const results = await Promise.all(ids.map((id) => getUser(client, { id })));
  for (const [error, user] of results) {
    if (error) {
      console.error(error.code);
      continue;
    }
    console.log(user.name);
  }
}
```

这些操作在 map 回调调用函数时启动。普通请求失败仍是 fulfillment 的错误元组，Promise.all 不会自动因为元组首项有 fault 就 fail-fast。

不要直接把多参数 getUser 交给 Array.map。数组回调会提供 value、index 和 array，这不是客户端、业务输入和 options。

### 6.4 简单延迟不需要另一个 DSL

```ts
// 提案片段：创建函数不执行请求。
const later = () => getUser(client, { id: 1 });

// 这里才启动一次执行。
const pending = later();
```

如果还要延迟输入准备，把 makeInput 放进闭包。`() => alreadyStartedPromise` 不会把已经启动的工作变冷。

重复 await 同一个 Promise 不重发请求。重复调用 later 会重新进入操作，但不代表重试安全：闭包可能捕获已消费的流、已取消的 signal 或变化后的输入。幂等性仍依赖远端契约。

闭包不能替代所有 Command 能力。若调用者需要读取操作元数据、持久化任务、统一调度或晚绑定客户端，不透明闭包不足以表达这些关系。现有 command 也不自动支持序列化或安全重放，应根据真实需要决定是否保留独立的高级描述能力。

## 7. SSE 与 WebSocket：入口改变，所有权不变

以下是完整的提案调用示例。沿用现有资源接口，不把打开成功等同于整个生命周期成功。

```ts
import {
  createClient,
  defineEventStream,
  defineWebSocket,
  struct,
  withEndpoint,
} from "@defjs/core";

const watchUser = defineEventStream({
  method: "GET",
  path: "/users/:id/events",
  maxBufferSize: 64 * 1024,
  maxQueueSize: 100,
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  events: { message: struct.object({ text: struct.string() }) },
});

const room = defineWebSocket({
  path: "/rooms/:id",
  maxIncomingQueueSize: 100,
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  incoming: struct.object({ text: struct.string() }),
  outgoing: struct.object({ message: struct.string() }),
});

const client = createClient(withEndpoint("https://api.example.com"));

async function consume(signal: AbortSignal) {
  const [error, stream] = await watchUser(
    client,
    { id: 1 },
    { signal, timeout: 5_000 },
  );
  if (error) {
    console.error(error.code);
    return;
  }
  try {
    await using owned = stream;
    for await (const event of owned) {
      console.log(event.data.text);
      break;
    }
  } catch (runtimeOrCleanupError) {
    console.error(runtimeOrCleanupError);
  }
}

async function chat(signal: AbortSignal) {
  const [error, session] = await room(client, { id: 1 }, { signal });
  if (error) {
    console.error(error.code);
    return;
  }
  const unsubscribe = session.onRuntimeError((cause) => console.error(cause));
  try {
    await using owned = session;
    owned.send({ message: "Hello" });
    for await (const message of owned.receive) {
      console.log(message.text);
      break;
    }
  } catch (runtimeOrCleanupError) {
    console.error(runtimeOrCleanupError);
  } finally {
    unsubscribe();
  }
}
```

示例消费首条消息后释放。业务若需要结束原因，还应观察 closed。catch 只说明运行期与释放存在独立错误边界，不把普通请求故障改成异常式 API。

本地类型实验确认直接调用仍可保留：

- SSE 事件的类型化数据与 AsyncIterable。
- WebSocket outgoing 检查与协议专属 options。
- AsyncDisposable 约束。
- 打开失败后的元组收窄。

本轮没有实际启动 SSE / WebSocket 服务，也没有验证新入口的关闭与重连实现。类型通过不证明资源释放正确。

## 8. 实现边界与迁移代价

### 8.1 可以先隐藏公开仪式，不重写执行链

现有 [defineRequest](../../packages/core/src/http/http.ts:259)保存定义并生成带执行函数的 command。[Client](../../packages/core/src/client/client.ts:135)再委托给相应 runner。

本地运行实验使用了这样的具体操作适配器：

```ts
// 隔离实验形态，不是修改后的 defineRequest。
function getUser(
  client: Client,
  input: Parameters<typeof existingEndpoint>[0],
  options?: HttpExecuteOptions,
) {
  const command = existingEndpoint(input);
  return client.execute(command, options);
}
```

它证明可以复用现有解析、builder、传输和故障返回，不证明生产实现应公开这个适配器，也不证明已经减少 command 分配。

如果正式采纳，工厂可以直接生成操作函数，内部继续保留现有 runner。不要直接从操作函数调用全局 fetch，绕过应用 client 的策略。

### 8.2 公开操作不应访问客户端私有布局

SDK 定义包与应用可能加载不同的 Core 副本。当前客户端具有内部 symbol 成员，command 执行也有协议约定。

操作函数应通过受支持的执行协议委托，而不是把“传入 client”理解为可直接读取某个私有配置键。结构类型相容不证明不同版本拥有相同运行语义；全局 symbol 也不能自动解决版本不兼容。[Type compatibility][ts-compatibility]

本轮没有建立新的跨版本协议，也没有改变当前兼容版本范围。

### 8.3 测试替换仍有现成边界

显式 client 可以选择假传输，已在本地探针中验证。业务层也可以接收某个具体操作函数作为依赖。

不建议仅为语法改造新增通用 Executor 接口、第二套插件系统或大范围 mock 类型。泛型执行器不容易被随意对象准确模拟，复用已有 FetchHandle / interceptor 测试边界更可靠。

### 8.4 与 Query 集成仍需要显式错误适配

```ts
// 提案中的操作；这是 Query 集成政策，不是核心返回约定。
const queryFn = async ({ signal }: { signal: AbortSignal }) => {
  const [error, user] = await getUser(client, { id: 1 }, { signal });
  if (error) throw error;
  return user;
};
```

Query 根据 throw / rejection 识别失败，不检查普通 fulfillment 元组。[Query functions][query-functions]

新的调用入口减少一层通用执行写法，但不会消除不同库之间的错误协议差异。

### 8.5 迁移是公共语义变更

必须检查以下消费方式：

- 原先 `getUser(input)` 被保存为 command，稍后执行。
- 使用 Parameters、ReturnType 或公开 RequestEndpoint 类型的封装。
- 读取 command 元数据、统一排队或替换执行器的工具。
- 只模拟 execute 的测试替身。
- SSE / WebSocket 取消、打开失败和资源释放路径。

不建议让同一个 endpoint 永久通过实参数量猜测“这次创建 command，那次直接执行”。若需要迁移兼容，应选择显式、有限期的方式，而非长期保留两种相反的启动语义。

正式采纳还需同步公共 TSDoc、生成 API 数据、设计契约、README、相关示例和全部语言指南。这是后续实施范围，不属于本次研究授权。

## 9. 本地证据与尚未验证的部分

### 9.1 已运行的实验

运行时实验使用现有 Core 与假 Fetch，不访问真实网络。类型实验使用现有构建出的公共声明，声明一个 client-first 签名适配器，生成 `.d.ts` 后由另一个文件消费。

| 检查                                | 结果 | 证明范围                         |
| ----------------------------------- | ---- | -------------------------------- |
| 同一操作显式使用不同 client         | 通过 | endpoint 和假传输由传入实例决定  |
| 调用后不 await 返回值，观察传输事件 | 通过 | await 不是启动器，不承诺同步发送 |
| 普通闭包延迟调用                    | 通过 | 未调用闭包时不启动操作           |
| 构造并行调用后再交给 Promise.all    | 通过 | 汇合之前操作已经进入流程         |
| 已取消信号不发送                    | 通过 | 复用当前预取消处理               |
| 一次取消不污染后续调用              | 通过 | 第三参数保持调用级隔离           |
| 执行中取消传到假传输                | 通过 | 当前取消链可被直接调用门面复用   |
| 必填、无输入、可选输入签名          | 通过 | 包括 options 位置与负面类型检查  |
| HTTP fault 数据与成功值收窄         | 通过 | 正常使用不需要调用方断言         |
| bind 后错误输入仍被拒绝             | 通过 | 仅适用于本次具体化的操作签名     |
| SSE / WebSocket options 和资源类型  | 通过 | 只是类型检查，未验证新运行实现   |

编译器与运行环境：

| 项目                 | 版本         |
| -------------------- | ------------ |
| TypeScript 声明输出  | `7.1.0-beta` |
| Bun 运行与消费方检查 | `1.4.4`      |

声明输出使用项目 TypeScript 编译器，并显式使用 `--ignoreConfig`、strict、Bundler 模块解析和 emitDeclarationOnly。消费方以 bun check 检查生成声明，不能把 bun check 当成声明生成命令。

调查中出现过以下工具使用失败，均已修正：

- 将“执行开始”误写成“传输计数同步增加”，改为等待可观察传输事件。
- 使用只检查类型的 bun check 期待输出声明，导致消费方找不到文件。
- TypeScript 新版本要求在显式指定文件时使用 ignoreConfig，补充后成功生成。

### 9.2 不能从实验推出的结论

- 类型适配器是声明，不是通用 defineRequest 的完整实现。
- 消费生成声明不等于完成 npm 打包、安装及跨版本兼容测试。
- SSE / WebSocket 的资源类型通过，不等于关闭、重连或 finalizer 已验证。
- 没有测量 bundle、分配次数、运行速度或编辑器响应。
- 没有用户任务对照，不能把“更自然”宣称为普遍实验事实。
- 没有实现 callable client，因此不能把它的潜在问题说成已经发生的缺陷。

### 9.3 实施前最有价值的补充验证

| 实验                               | 裁决问题                                         |
| ---------------------------------- | ------------------------------------------------ |
| 同一组真实 SDK 调用的迁移          | 是否只是机械替换，还是存在真实 command 消费者    |
| 新工厂的类型与声明回归             | 本地可行签名能否完整进入公共 API                 |
| 流生命周期与故障注入               | 是否保持打开、运行、取消、释放的既有边界         |
| 重复 await 与重复调用、一次性 body | 是否把启动、等待和安全重试区分清楚               |
| 同功能打包对照                     | 独立导入是否保持传输隔离，不凭语法猜测体积       |
| 使用者任务                         | 业务作者是否更容易理解何时 I/O、谁拥有取消与资源 |

## 10. 最终判断与来源边界

**推荐操作函数作为主入口，把 client 视为应用显式提供的执行依赖。继续使用现有 Struct、builder、错误元组和资源接口，使本次决策只改变调用范式。**

相较上一轮的通用 execute 方案，本轮提案更好地解决了用户指出的视觉与认知问题。之前的推荐不应因先提出就拥有优先权。

内部 command、独立导出、应用所有权都可以保留，不需要把“隐藏公共执行仪式”误解成“删除执行架构”。

`client({ abort })` 可以成为不可变执行政策视图，但其收益应独立证明。默认先使用操作 options，避免把一次明确的 API 改进与作用域模型重设计捆绑。

外部研究提供了真实先例和语言、取消、执行语义。主会话额外核对了 Firebase、AWS、Smithy 固定提交及本地原型。来源使用固定提交或明确版本，不把仓库快照自动当成最新 npm 发布。

对抗核验覆盖并不完全均匀。合成阶段补读的生命周期规范没有继承之前的核验票数；票数本身也不是正确性的统计概率。本报告因此分别说明来源事实、已执行实验和未验证建议。

## Sources

- [Firebase 模块化密码登录文档][firebase-docs]
- [Firebase 自由函数固定提交][firebase-source]
- [AWS SDK v3 公开调用形式固定提交][aws-readme]
- [Smithy Client 执行机制固定提交][smithy-client]
- [SQLx Query 0.9.0][sqlx-query]
- [TypeScript Utility Types][ts-utilities]
- [TypeScript Variadic Tuple Types][ts-tuples]
- [TypeScript Functions][ts-functions]
- [TypeScript Type Compatibility][ts-compatibility]
- [WHATWG DOM AbortSignal][abort-signal]
- [Go context][go-context]
- [Effect v3 Scope][effect-scope]
- [ECMAScript 异步与 Promise 规范][ecma-promise]
- [TanStack Query v5 Query Functions][query-functions]

[firebase-docs]: https://firebase.google.com/docs/auth/web/password-auth
[firebase-source]: https://github.com/firebase/firebase-js-sdk/blob/fe5dd06c03ad6d5393b01590ec61bdd9be5e2839/packages/auth/src/core/strategies/email_and_password.ts#L345-L366
[aws-readme]: https://github.com/aws/aws-sdk-js-v3/blob/258c14447eefd8e028db1a50ab49aac8312c0af9/README.md
[smithy-client]: https://github.com/smithy-lang/smithy-typescript/blob/887a0945e2cf9c1a1bae98ecd5efa992b442fceb/packages/core/src/submodules/client/smithy-client/client.ts#L140-L195
[sqlx-query]: https://docs.rs/sqlx/0.9.0/sqlx/query/struct.Query.html
[ts-utilities]: https://www.typescriptlang.org/docs/handbook/utility-types.html
[ts-tuples]: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-0.html#variadic-tuple-types
[ts-functions]: https://www.typescriptlang.org/docs/handbook/2/functions.html
[ts-compatibility]: https://www.typescriptlang.org/docs/handbook/type-compatibility.html
[abort-signal]: https://dom.spec.whatwg.org/#interface-abortsignal
[go-context]: https://pkg.go.dev/context
[effect-scope]: https://effect.website/docs/v3/resource-management/scope
[ecma-promise]: https://tc39.es/ecma262/2026/multipage/control-abstraction-objects.html
[query-functions]: https://tanstack.com/query/v5/docs/framework/react/guides/query-functions
