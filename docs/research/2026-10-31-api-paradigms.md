# Defjs 从零重设的 API 范式研究

研究日期：2026-10-31。

研究基线：本地 `main`，提交 `a3d38bc0b922a1cd2120c65ef1e5eb07e71c47a6`，以及读取时的工作区。已有文档站、国际化和 AI 栏目改动不属于本研究，不作修改。

研究范围：SDK 作者与应用开发者的代码表达、公共 API、类型推导、组合边界和生命周期。不做缓存、离线、响应式数据库等功能对标。允许挑战全部现有契约，但不授权实施重写。

证据标记：**事实**来自本地代码、实际探针或一手资料；**判断**是对事实的设计综合；**提案**是尚未实现的 API。提案代码不是现有 Defjs 用法，不应复制进生产项目。

## 1. 结论与评价方式

**优先验证“可独立发布的操作契约 + 显式执行器 + 普通业务值 + 显式编解码边界”。不应预先保留 Command、内置 Struct 独占、错误优先元组或 functional options，也不应仅因允许推翻代码就全部删除。**

核心判断如下：

- 定义与执行分离值得保留，但不等于必须有公开的中间 Command。执行器可以直接接收定义和输入。
- 最应挑战的是隐藏的编码来源语义。数据对象如何被复制，不应在没有显式 codec 变化时悄悄改变协议字段。
- 结构、双向转换、传输表示应分别表达。把字符串结构改成字符串字面量，不应顺带改变文本和 JSON 的读取方式。
- 类型推导应服务重构，而不仅服务 README。提取配置、跨模块导出、包裹函数和发布声明文件之后，关联仍应存在。
- 可恢复故障、程序缺陷、取消和流终止不能靠一个“统一结果”口号抹平。
- 组合的价值在于可预测。配置覆盖、中间件顺序、值转换和异步执行不是同一种组合。
- 不建议把 Defjs 变成通用 Effect 运行时，也不建议仅为请求字段映射创建表达式语言。

这里的“现代”不表示链式更多、泛型更多或抽象更新，而表示：**普通场景直接，复杂场景边界清楚，代码经过重构后仍可理解，失败时能定位。**

### 1.1 设计空间

| 维度     | 需要决定的问题                             | 不应混为一谈的概念             |
| -------- | ------------------------------------------ | ------------------------------ |
| 定义值   | SDK 发布的是函数、契约对象还是计算程序？   | 可传递不等于可序列化           |
| 执行点   | 调用方法、调用执行器，还是交给专用运行时？ | 延迟执行不等于不可变或可重放   |
| 类型关联 | 输入、输出、错误和环境如何保持关系？       | 静态推导不等于运行时验证       |
| 数据转换 | 什么负责结构检查、别名、Date 和 bigint？   | 单向转换不等于双向 codec       |
| 组合     | 覆盖、追加、顺序调用、并行调用如何区分？   | 类型兼容不等于顺序无关         |
| 生命周期 | 谁打开、谁取消、谁等待结束、谁释放？       | 发出取消不等于已完成清理       |
| 发布边界 | 消费方需要整个实现类型图，还是稳定契约？   | 源码中推导正常不等于发布后正常 |

### 1.2 版本与资料边界

下表是研究时读取的版本，不保证读者后来看到的 `latest` 页面仍相同。

| 项目                  | 核验版本或资料    | 状态与用途                                      |
| --------------------- | ----------------- | ----------------------------------------------- |
| TanStack Query        | `5.105.0`         | 正式版本；配置值与类型关联                      |
| TanStack DB           | `1.0.0-rc.1.1`    | 候选发布版；不能因 npm 标签叫 latest 就称正式版 |
| Effect                | `4.1.1`，v4 文档  | 正式版本；计算描述、错误与依赖类型              |
| oRPC                  | `1.16.1`          | 使用 v1 契约文档；不混用 v2 语义                |
| oRPC beta             | `2.0.0-beta.47`   | 只用于确认迁移边界，不作为稳定设计承诺          |
| Zod                   | `4.6.7`           | 正式版本；双向 codec 与单向 transform           |
| Valibot               | `1.5.0`           | 正式版本；函数管道与 Schema 互操作              |
| Tower                 | `0.5.3` 固定文档  | 服务、Layer、类型擦除与就绪契约                 |
| Axum                  | `0.8.9` 固定文档  | 缺失依赖的类型表达                              |
| reqwest               | `0.13.5` 固定文档 | 构建、发送、克隆与流式请求                      |
| SQLx                  | `0.9.0` 固定文档  | 编译期检查的证据来源和限制                      |
| Connect-Go            | `v2.0.2`          | Go module proxy 核验；结合官方 v2 发布说明      |
| Go 标准库、Ent、Serde | 官方文档          | 借鉴稳定机制，不宣称其思想首次出现于近期        |

TypeScript 包版本由 npm 注册表直读确认。Connect-Go 的版本由 Go module proxy 确认。未安装这些库，也未运行外部库的示例。

## 2. 当前 Defjs 的真实范式

### 2.1 当前代码并不只是一个请求函数

当前最小使用链如下，来自[基本示例](../../doc/examples/http/basic-setup.ts)：

```ts
const getUser = defineRequest({
  method: "GET",
  path: "/users/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), name: struct.string() }),
});

const client = createClient(withEndpoint("https://api.example.com"));

async function main() {
  const command = getUser({ id: 1 });
  const [error, user] = await client.execute(command);
  if (error) {
    console.error(error.code);
    return;
  }
  console.log(user.name);
}
```

**事实：**SDK 发布独立 endpoint；调用 endpoint 创建 command；执行器才验证输入、构建请求、调用传输并解码。[定义实现](../../packages/core/src/http/http.ts:259)会浅拷贝顶层定义，但 command 保存传入 input 的引用。

**判断：**当前架构已经拥有可借鉴的核心，不需要靠增加缓存或 Hook 来证明完整性。但定义、endpoint、command、builder、Struct、Client 都成为用户需要理解的概念，每个概念都应证明自己的必要性。

### 2.2 输入对象不仅携带业务数据，还携带编码规则

**事实：**[输入解析](../../packages/core/src/internal/endpoint_input.ts:12)启用对象标记；[出站编码](../../packages/core/src/internal/outbound_request.ts:143)会读取对象自身的结构信息及父级 guide。

隔离探针使用同一个输入结构：

```ts
const User = struct.object({
  displayName: struct.string().alias("display_name"),
});

const Input = struct.object({ user: User });
```

仅改变 builder 返回值，得到以下真实请求体：

| builder 的 body                                  | 实际发送的 JSON          |
| ------------------------------------------------ | ------------------------ |
| `input.user`                                     | `{"display_name":"Ada"}` |
| `{ ...input.user }`                              | `{"display_name":"Ada"}` |
| `Object.fromEntries(Object.entries(input.user))` | `{"displayName":"Ada"}`  |

直接传递和展开保留元数据，枚举字符串键后重建对象不保留。这符合当前契约，不是本报告声称的实现缺陷。

**设计代价：**看起来相同的业务字段，因对象来源而拥有不同编码含义。单独测试普通映射函数与在执行器中运行它也未必等价。历史 [builder 设计记录](../../DESIGN-builder.md:600)已经明确承认直接单测 builder 的差异。

**建议：**编码规则跟随显式 codec 或协议声明，不跟随任意业务对象的隐藏来源。应允许开发者复制、重组和单测普通数据，而不必理解 symbol 与父级 guide 的优先级。

### 2.3 响应结构与传输表示发生耦合

**事实：**[表示选择器](../../packages/core/src/internal/inbound_representation.ts:14)根据 Struct kind 决定读取 text、blob、arraybuffer 或 JSON。

探针让服务端返回相同响应：

```text
Content-Type: application/json

"ready"
```

| output 声明               | 成功值                     |
| ------------------------- | -------------------------- |
| `struct.string()`         | 包含引号的字符串 `"ready"` |
| `struct.literal("ready")` | 不含引号的字符串 `ready`   |

**判断：**结构收窄同时改变协议解释，说明这两个维度不正交。当前设计减少了一个配置入口，但把成本转移给了推理和例外规则。

**建议：**显式区分“JSON 中的字符串”与“原始文本”。结构精化只应改变接受的数据集合，不应自动更换字节解释方式。

### 2.4 Command 是延迟输入引用，不是不可变请求快照

以下行为已通过假传输探针确认：

```ts
const input = { id: 1 };
const command = getUser(input);

input.id = 2;
await client.execute(command);

input.id = 3;
await client.execute(command);
```

| 观察点                      | 结果       |
| --------------------------- | ---------- |
| command 创建时 builder 调用 | 未调用     |
| 首次执行路径                | `/users/2` |
| 再次执行路径                | `/users/3` |
| 两次执行的 builder 调用总数 | `2`        |

**判断：**惰性可以有价值，但“命令是数据”不足以说明复制、重放和时间语义。当前 command 还带有内部执行函数，因此不能宣称它天然支持 JSON 序列化或跨进程传输。

不要直接以深拷贝解决问题。Blob、ReadableStream、用户函数及其他资源并不服从统一的深拷贝规则。应先决定需要的是一次操作描述、输入快照，还是可重新构造请求的工厂。

### 2.5 类型体验在配置提取处出现台阶

**事实：**内联定义能够推导 builder 输入，但公开的 [RequestDefinition](../../packages/core/src/http/http.ts:181)使用宽化后的内部 builder 形态。用它给原始配置提供上下文时，builder 参数会落到 `never`。

实际类型探针：

```ts
const extracted = {
  method: "GET",
  path: "/users/:id",
  input: Input,
  builder: (input) => ({ path: { id: input.id } }),
} satisfies RequestDefinition<typeof Input>;
```

```text
TS2339: Property 'id' does not exist on type 'never'.
```

只补输入类型仍不够，method/path 的字面量宽化还会丢失路径参数信息。显式 builder 参数类型加 `as const` 后通过。

必须保留反证：**把 `defineRequest(...)` 本身提取为 endpoint 工厂可以通过，且错误输入仍被拒绝。**所以结论不是“Defjs 无法复用”，而是“原始配置值的可复用性弱于类型化构造结果”。

### 2.6 表面统一不等于生命周期统一

**事实：**HTTP、SSE、WebSocket 都经 `execute`，但结果并不完全同构：

| 边界                         | HTTP                   | SSE / WebSocket                      |
| ---------------------------- | ---------------------- | ------------------------------------ |
| 初始失败元组的第三槽         | `undefined`            | 可能保留握手或连接信息               |
| 初始成功后是否还有运行期失败 | 普通已解码请求通常结束 | 有，经过迭代、观察器和 closed 等边界 |
| 资源所有者                   | 执行器管理普通请求     | 应用拥有长连接并负责关闭或释放       |
| timeout 的含义               | 请求及解码期限         | SSE 使用启动期限                     |

见 [HTTP 结果](../../packages/core/src/http/http.ts:202)、[SSE 结果](../../packages/core/src/sse/sse.ts:170)、[WebSocket 结果](../../packages/core/src/web_socket/web_socket.ts:277)。

**判断：**可以统一操作入口，不应假装一次返回值描述了长连接的完整生命。命名和类型应让“打开一个资源”与“取得一个值”的区别保持可见。

## 3. TypeScript：值得借鉴的不是语法外形

### 3.1 TanStack Query：配置值也可以成为类型关联的载体

**事实：**官方 `queryOptions` 的实现最终直接返回传入对象。它不执行 queryFn，也不在运行时写入类型标签。[固定版本源码][query-source]

官方用法可缩减为：

```ts
function groupOptions(id: number) {
  return queryOptions({
    queryKey: ["groups", id],
    queryFn: () => fetchGroups(id),
    staleTime: 5_000,
  });
}

useQuery(groupOptions(1));
useSuspenseQuery(groupOptions(5));
```

类型层把 queryKey 与查询数据、错误关联起来。它解决的不是“少写几行配置”，而是**配置被提取后仍能保留关系**。[Query options][query-options]、[TypeScript 指南][query-types]

对 Defjs 的借鉴：

- 构造辅助器应该把输入、结果、错误等关联封装到一个值上。
- 使用端从操作值推导，不要求用户重新填写相互依赖的泛型。
- 公开构造配置类型不能只是内部存储类型的别名。
- 声明、消费、提取类型三个入口应围绕同一个契约，而非维护平行 interface。

不能照搬的部分：queryKey 是缓存系统中的身份，Defjs 的 operation 字符串并不因此获得相同语义。相同字符串不会自动证明两次调用的类型或业务意义相同。

反例：Query 官方指出，匹配异构结果的 `getQueriesData` 不能自动获得同等推导。局部 `select` 的成功推导也不能推广为任何包装、批量组合都有效。

### 3.2 TanStack DB：DSL 必须有语言之外的收益

**事实：**标准查询的回调接收表达式引用，不是在遍历普通业务对象：

```ts
.where(({ user }) => eq(user.active, true))
```

其链条描述查询，随后编译执行。官方同时提供真实 JavaScript 回调的 functional API，但明确说明该变体不能由查询优化器优化，也不能使用 collection indexes。[DB Live Queries][db-queries]

这是一项明确交换：限制表达能力，换取可分析性。

对 Defjs 的借鉴：

- 普通 builder 应继续接收普通值，让 `if`、`switch`、模板和对象操作按 JavaScript 语义工作。
- 若未来真的需要可静态分析的请求映射，应明确把它命名为表达式，而不是伪装成普通值。
- 复用可以先发生在小片段。DB 官方推荐接收 `Ref<T>` 的过滤回调，不强迫用户封装整个 QueryBuilder。

反例：当前历史记录已经说明旧式 symbolic builder 为什么难用。不能仅因 TanStack DB 的表达式成功，就重新引入同一种隐藏代理语义。DB 有查询规划需求，简单 SDK 字段映射未证明需要它。

### 3.3 Zod、Valibot、Standard Schema：互操作不等于全部编解码统一

**事实：**Zod codec 明确提供两个方向：[Codecs][zod-codecs]

```ts
const stringToDate = z.codec(z.iso.datetime(), z.date(), {
  decode: (value) => new Date(value),
  encode: (value) => value.toISOString(),
});
```

单向 transform 则不能自动反转。Zod 文档指出，含单向 transform 的 schema 执行 encode 会抛出运行时错误。

Valibot 用函数管道组织验证和转换，输入类型可以是 string，输出类型可以是 number。两端不能被一个 `T` 粗暴合并。[Valibot pipe][valibot-pipe]

**事实：**Standard Schema 的 validate 接收 unknown，返回带输出值或 issues 的结果，也允许 Promise。规范区分 Input 和 Output，但没有统一的逆向 encode、字段别名或 HTTP media type 协议。[Standard Schema][standard-schema]

对 Defjs 的具体建议：

| 职责         | 建议边界                     | 示例                                         |
| ------------ | ---------------------------- | -------------------------------------------- |
| 输入验证     | 接受标准验证协议或窄适配器   | 校验调用参数，得到 builder 的真实输入        |
| 双向表示转换 | 显式 codec                   | `display_name` 与 `displayName`，ISO 与 Date |
| 传输表示     | HTTP / 消息边界              | JSON、文本、字节、FormData                   |
| 业务校验     | 用户选用的 schema 或业务代码 | 不必由 Defjs 自己实现 `.min()`               |

这不是建议直接让任意 Standard Schema 充当双向 codec。一个把字符串变为长度的 transform 不可能从数字还原原字符串。

也不要求 Defjs 引入运行时 schema 依赖。消费结构接口和依赖某个具体验证库是两件事。标准接口若进入发布声明，应随包可解析，不能只在开发安装时存在。

**重要细节：**接纳异步 schema 后，执行器需要等待验证并处理取消竞争。builder 仍可以同步。取消外层等待不保证用户提供的异步验证器已经停止。

### 3.4 Effect：类型记录计算，而不是只记录返回值

**事实：**Effect 以成功值、预期错误和上下文需求描述计算：

```ts
Effect.Effect<Success, Error, Requirements>;
```

创建计算描述与运行计算分开。预期错误属于错误通道，defects 和中断不能简单等同于该通道。[Effect type][effect-type]、[错误分类][effect-errors]

真正值得借鉴的是：

- 组合前可以看出需要哪些依赖。
- 预期错误不会在每次包装后变成不明来源的异常。
- 资源获取与释放可以在同一作用域内表达。
- 程序可由应用选择的执行环境运行。

反例：

```ts
Effect.succeed(i++);
Effect.suspend(() => Effect.succeed(i++));
```

前者的实参在 JavaScript 求值时已经发生副作用，后者才延迟这一步。惰性描述不能自动证明周围代码纯净。[Creating Effects][effect-create]

对 Defjs 的判断：可以学习成功、错误、依赖的关联，但不能据此要求每个 SDK 消费者采用完整 Effect 运行时。只有当主要任务变成跨操作程序组合、依赖供给和资源作用域管理时，该路线才可能抵得上学习与集成成本。

### 3.5 oRPC：在叶子上放强契约，在组织层保留普通对象

**事实：**oRPC 的 contract-first 路线允许先声明 input/output，再由另一个阶段提供实现。嵌套普通对象即可组织契约。[oRPC v1 契约][orpc-contract]

```ts
const getUserContract = oc.input(InputSchema).output(UserSchema);

const contract = {
  users: {
    get: getUserContract,
  },
};
```

这个片段沿用真实 API 形态，schema 变量是示意。它不表示已经存在服务实现或客户端。

对 Defjs 的借鉴：操作叶子可以复杂，模块组织不必复杂。ESM 导出、普通对象和普通函数通常足以组织 SDK，无需额外创建 group、module、registry 等平行语言。

边界：契约树仍有合法叶子和保留名称约束，不能把“普通对象”理解成“任意对象”。大树的递归映射还需要发布后类型成本验证。

## 4. Rust：借鉴能力关系，不伪造所有权保证

### 4.1 Tower：一个小接口承载输入、输出、错误关系

**事实：**Service 的核心关系如下：[Tower Service][tower-service]

```rust
pub trait Service<Request> {
    type Response;
    type Error;
    type Future: Future<Output = Result<Self::Response, Self::Error>>;

    fn poll_ready(&mut self, cx: &mut Context<'_>)
        -> Poll<Result<(), Self::Error>>;
    fn call(&mut self, req: Request) -> Self::Future;
}
```

Layer 再把服务变成另一个服务。重要的是组合前后类型关系明确，不是把所有策略塞入一个巨型配置对象。

对 Defjs 的借鉴：可以在执行边界保留一个窄契约，把 Request、Response、Fault 的关系固定下来。编解码器和中间件不应迫使消费方理解整个内部配置。

**不能误读：**Tower 要求 call 前 poll_ready 成功，但这是调用协议，不是该接口本身提供的完整 typestate 保证。官方允许违反协议时 panic。TypeScript 更不能仅靠 `ReadyService` 这个名字就保证远端连接一直就绪。

### 4.2 Tower：公开组合顺序，同时允许隐藏内部类型图

**事实：**ServiceBuilder 先加入的 layer 先收到请求。官方用 buffer 与并发限制交换顺序展示不同结果：[ServiceBuilder][tower-builder]

```rust
ServiceBuilder::new()
    .buffer(100)
    .concurrency_limit(10)
    .service(svc);
```

```rust
ServiceBuilder::new()
    .concurrency_limit(10)
    .buffer(100)
    .service(svc);
```

| 顺序                   | 官方示例允许的在途请求上限 |
| ---------------------- | -------------------------- |
| buffer 在外            | `110`                      |
| concurrency_limit 在外 | `10`                       |

Defjs 中同理：retry 包住 telemetry 与 telemetry 包住 retry，分别可能观察每次尝试或整个逻辑调用。两者不该通过“不重要的配置排列”表达。

Tower 还提供 boxed 与 check_service。前者隐藏组合后的具体实现类型，同时保留请求、响应、错误；后者帮助检查复杂服务栈的类型。

**设计判断：**Defjs 的发布类型也应保留用户关心的关联，而不是泄露全部 builder、schema 或 middleware 实现历史。TypeScript 中的简化声明不具有 Rust trait object 的相同运行时语义，但“在稳定边界截断实现复杂度”值得借鉴。

### 4.3 Axum：泛型可以表达尚未满足的义务

**事实：**`Router<S>` 的 S 表示缺少的 state，而不是已经拥有的 state。提供状态后，可以得到不再缺失依赖的 `Router<()>`。[Axum Router][axum-router]

```rust
let router: Router<AppState> = routes();
let router: Router<()> = router.with_state(AppState {});
```

价值是让错误出现在组装阶段，而不是首次请求时。

对 Defjs 的借鉴：必要配置可以在构造边界要求提供，例如显式 endpoint，或者某个需要传输能力的执行器。无需为了表达一个必填 endpoint 就建立任意服务依赖图。

边界：动态凭据、运行期失效的连接、远端协议兼容性仍需要运行时检查。构造完成不是永久有效证明。

### 4.4 reqwest：可构建、可发送、可克隆是不同能力

**事实：**reqwest 同时提供 build、send 和 build_split。build 返回 Request，build_split 还返回其内嵌 Client。因此它的 RequestBuilder 不是与客户端无关的协议定义。[RequestBuilder][reqwest-builder]

更重要的是：try_clone 返回 Option，请求体是流时可能无法克隆。

对 Defjs 的借鉴：

- 不把所有 command 都说成可重复执行的纯数据。
- 不因为输入是 readonly，就推断底层流能重新消费。
- 重试需要可重建的请求体，还需要应用语义允许。
- 相同命令本地只调度一次，仍不等于服务端业务 exactly-once。

TypeScript 无法提供 Rust move 的等价保证。即使设计 SingleUseCommand，也需要运行时消费状态，或通过作用域缩小误用空间。

### 4.5 Serde 与 SQLx：类型系统的收益来自明确证据

**事实：**Serde 区分数据结构如何映射到数据模型，以及数据格式如何把模型映射到具体表示。[Serde data model][serde-model]

这支持把 Defjs 的逻辑结构与 JSON、表单等表示分开，但不要求复制 Serde 的全部 trait 或 data model。

**事实：**SQLx 的 query! 编译检查需要构建时数据库 schema，或离线元数据；动态查询不具有同等检查能力，部分可空性推断仍可能在运行时失败。[SQLx query][sqlx-query]

对 Defjs 的反向约束：类型模板只能检查本地声明之间的一致性，无法证明服务器确实返回了声明形状。任何“端到端类型安全”主张都必须说明契约来自哪里、何时更新，以及边界验证是否仍执行。

## 5. Go：少包装，但不省略边界

### 5.1 Connect-Go v2：删除包装可以是一次成熟的 API 创新

**事实：**官方 v2 发布说明明确承认泛型请求和响应包装不适合多数调用，并改成直接接收与返回消息。[Connect-Go v2][connect-v2]

```go
// v1
Say(context.Context, *connect.Request[SayRequest]) (*connect.Response[SayResponse], error)

// v2
Say(context.Context, *SayRequest) (*SayResponse, error)
```

元数据仍可从调用上下文中的 CallInfo 获取。HTTP 被拆到 connecthttp，生成的客户端与 handler 不必绑定 net/http 语义。

**对 Defjs 最重要的启示：定义独立和调用包装是不同问题。**可以继续独立发布操作契约，同时删除普通调用必须构造 Command 的仪式。

不能夸大：Connect 的包装是附带元数据的请求，Defjs 的 command 还是惰性执行描述。删除两者的损失并不完全相同。Connect 的生产经验提供了反例，不是 Defjs 必须删除 command 的证明。

发布说明中的 Go 二进制体积收益不外推为 TypeScript 包体积或速度收益。

### 5.2 Connect-Go：统一发生在执行模型，而不是统一命名

v2 用 ClientInterceptor 和 ServerInterceptor 函数类型覆盖 unary 与 streaming，并调整服务端介入阶段，使拒绝可以发生在解压与解码之前。[发布说明][connect-v2]、[迁移指南][connect-migration]

**判断：**真正的统一必须回答“拦截哪个阶段、拥有哪个资源、是否能再次调用 next”。只给 HTTP、SSE、WebSocket 相同的注册函数，不会自动统一这些语义。

这不意味着 Defjs 应立即公开一个万能拦截器。普通 HTTP 的重复发送与长连接的重复打开有不同所有权风险。可以复用内部组合机制，同时保留协议特有约束。

### 5.3 net/http：小接口不等于无状态或没有策略

**事实：**RoundTripper 表示一次 HTTP 事务，接口很窄：[net/http][go-http]

```go
type RoundTripper interface {
    RoundTrip(*Request) (*Response, error)
}
```

更高层的 Client 处理重定向等策略。Transport 可以拥有连接状态，官方因此建议复用 Client。

对 Defjs 的借鉴是接口分层和易替换测试边界，不是机械复制 Go 的客户端生命周期。当前 FetchHandle 已经比完整 `typeof fetch` 更窄，这是值得保留的实践。

还有一个重要反例：Go 的 Client.Do 遇到非成功 HTTP 状态不会仅因此返回 error。Defjs 把非成功状态变成 Fault 是自己的 API 策略，不是“采用 Go 风格错误”自动推出的结果。

Go 使用结果在前、error 在后；Defjs 的错误优先元组也不是 Go 返回形式的原样移植。

### 5.4 context：取消属于调用作用域，不是配置垃圾桶

**事实：**Go 官方要求显式传播 Context，并建议不要把它长期存进结构体，不把 Context values 用作普通可选参数。[context][go-context]

CancelFunc 发出停止要求，但不等待任务结束。

对 TypeScript 的借鉴：

- 使用调用级 AbortSignal，并传播到真正的 I/O 和必要等待。
- endpoint、重试策略等配置不要塞进无结构的上下文 bag。
- 生命周期结束以 closed 或 disposer 的完成为证，不能以 abort 调用完成为证。
- 对长连接分别命名启动期限、运行期取消及释放等待，避免一个 timeout 具有难以预测的含义。

没有证据要求 Defjs 仿造整套 Go Context。原生 AbortSignal 已覆盖很多必要表达。

### 5.5 Functional options 与 Ent：可以借鉴思想，不必照搬承载形式

当前 Defjs 的 [ClientOption](../../packages/core/src/client/option.ts:21)是修改 ClientConfig 的函数。普通选项覆盖，interceptors 追加。

**判断：**在 TypeScript 中，固定标量配置可以直接使用对象；有顺序的行为组合使用独立列表。这样不必为 endpoint、timeout 等每个字段维护一个 setter 函数。

```ts
// 提案形态，不是现有 API。
createClient({
  endpoint: "https://api.example.com",
  timeout: 10_000,
  middleware: [telemetry, authentication],
});
```

保留反例：函数选项可以封装插件安装并避免深层配置耦合。若改成普通对象，必须为当前 OTel 等扩展保留窄而稳定的安装边界，不能让插件重新依赖内部配置结构。

**事实：**Ent 从 schema 生成具体客户端、实体和 CRUD builders，并要求生成器与库版本协调。[Ent code generation][ent-codegen]

借鉴不是“Defjs 应新增代码生成”，而是：**类型复杂度可以选择在哪个阶段支付。**大型 SDK 可以预先产出稳定声明，而不让每个消费应用重新遍历整个实现类型图。只有实际规模实验显示有必要，才考虑生成器；本研究不建议为了现代感新增构建链。

## 6. 值得形成 Defjs 自身风格的原则

### 6.1 契约应该携带关联，业务值不应该携带隐藏编码历史

两者都可能使用 symbol 或品牌，但目的完全不同：

| 承载位置           | 合理用途             | 不应暗示的保证                             |
| ------------------ | -------------------- | ------------------------------------------ |
| 操作描述的类型品牌 | 关联输入、结果、错误 | 不能代替远端验证                           |
| 显式 codec 对象    | 声明双向转换         | 不自动具有逆变换定律                       |
| 普通业务对象       | 存放业务数据         | 不应要求复制时保留内部 symbol 才能正确编码 |

建议以显式编解码表达别名。例如同一个 codec 无论接收展开复制还是重建后的普通对象，都应产生相同 wire 字段。

### 6.2 API 的“重构稳定性”比首次调用简短更重要

应把以下行为视为设计验收，而不是事后类型补丁：

- 内联配置提取到变量之后，错误仍在正确位置。
- endpoint 放进普通对象、导出到包之后，推导仍可用。
- 包装一层业务函数，不要求重复定义输入和输出 interface。
- schema 精化，不意外改变传输表示。
- 对象复制，不意外改变字段名。
- 多个 SDK 共存，不需要争抢全局错误注册。

这比单独比较对象 API 与 fluent API 更有裁决力。

### 6.3 统一错误的数据关系，不统一所有故障发生时刻

推荐实验采用轻量判别联合：

```ts
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
```

理由是字段含义明确，便于跨函数传递及附加 metadata。不是因为元组不安全：现有元组也能表达关联并被 TypeScript 收窄。

错误应至少保留以下区分：

| 类别                 | 可观察含义           | 建议处理                             |
| -------------------- | -------------------- | ------------------------------------ |
| 业务或 HTTP 失败     | 远端返回可解释结果   | 结构化数据，供应用分支               |
| 输入、构建、解码失败 | 某个协议阶段没有完成 | 阶段、稳定 code、原始 cause          |
| 取消                 | 所有者要求停止       | 不默认视为可重试故障                 |
| 扩展代码异常         | 用户回调或插件失约   | 保留 unknown cause，不伪装为业务错误 |
| 流运行期终止         | 发生在打开成功之后   | 由资源的终止接口表达                 |

Query 集成需要 reject 才识别失败，这可以在适配边界显式转换。当前[查询函数示例](../../doc/examples/react/own-query-work.tsx)已经这样处理，不应为了某个消费者把全部核心调用改成异常式。

### 6.4 类型状态只编码能稳定维持的义务

适合在类型中表达：必填构造参数、允许的 HTTP body、schema 输入与输出、已提供的固定依赖。

不适合仅用静态类型承诺：连接持续在线、token 尚未过期、流未被外部消费、请求绝不会重复到达服务端。

TypeScript 的 readonly 不等于深度冻结，也没有 Rust 的线性所有权。公开类型必须与运行时约束共同工作。

### 6.5 资源沿用原生协议，但错误边界不能消失

当前 AsyncIterable 与 AsyncDisposable 是值得保留的方向。

显式资源管理按作用域执行清理，但不提供 Rust borrow checker，也不证明资源没有逃逸。释放本身可以失败，不能把“execute 返回 Result”扩写成“整个程序从不抛出”。[显式资源管理][resource-management]

对于流，最低需要可描述：打开结果、事件读取、取消、正常关闭、异常关闭和最终释放。不要为追求整齐的 execute 签名省略其中任何阶段。

## 7. 从零构建的连贯候选

以下均为**提案**。`proposal:` 导入仅用于区分假想 API，不是可安装包。代码展示完整调用形态，但未实现、未编译，也未验证性能。

为了公平比较，候选使用同样的业务结构和 Result 约定。没有输入转换的示例不代表可以忽略 schema 的 Input/Output 区别。

### 7.1 候选 A：操作契约值，执行器直接接收输入

**推荐作为首个验证原型。**保留定义与执行分离，删除每次调用必经的 Command 构造步骤。

```ts
import { z } from "zod";
import { createClient, defineHttp, json } from "proposal:defjs-values";

const User = z.object({ id: z.number(), name: z.string() });

// SDK 模块：只声明契约，不捕获应用客户端。
export const getUser = defineHttp({
  operation: "User.get",
  method: "GET",
  path: "/users/:id",
  input: z.object({ id: z.number() }),
  request: ({ id }) => ({ path: { id } }),
  output: json(User),
});

// 应用模块：构造与凭据策略归应用所有。
const client = createClient({
  endpoint: "https://api.example.com",
  fetch,
});

async function loadName(id: number, signal: AbortSignal) {
  const result = await client.execute(getUser, { id }, { signal });
  if (!result.ok) return result;
  return { ok: true as const, value: result.value.name };
}

async function loadTwoNames(signal: AbortSignal) {
  const first = await loadName(1, signal);
  if (!first.ok) return first;
  const second = await loadName(2, signal);
  if (!second.ok) return second;
  return { ok: true as const, value: [first.value, second.value] };
}

async function main() {
  const controller = new AbortController();
  const result = await loadTwoNames(controller.signal);
  if (!result.ok) {
    console.error(result.error.code);
    return;
  }
  console.log(result.value);
}

void main();
```

提案语义：

- defineHttp 返回类型化操作描述，不是可调用 endpoint。
- json 明确表示响应按 JSON 读取。换成字面量 schema 不改变表示。
- 输入采用标准验证接口；执行器等待验证，request 接收验证后的普通值。
- request 只映射当前输入。认证与跨请求策略仍归客户端中间件。
- execute 才开始工作。定义和客户端构造不启动网络 I/O。
- 结果类型从操作描述推导，不要求调用方给 execute 填写泛型。
- 序列化不读取普通业务值上的隐藏结构标记。
- 输入在调用后到执行完成期间不得由调用者并发修改；运行时是否提供快照需要单独限定支持的数据类型，不假装 readonly 已解决。

**收益：**定义独立、执行点明确、少一个必经概念，仍能直接传递操作描述。

**代价：**无法仅通过 `getUser(input)` 取得已携带参数的冷命令。需要延迟调度时可以先使用普通 thunk；若真实消费者需要检查带参数的操作，再证明单独 plan/command API 的必要性。

**反证条件：**如果主要消费路径频繁需要跨层传递已绑定输入的操作，A 会把 Command 重新发明成零散闭包，应让候选 B 胜出。

### 7.2 候选 B：Command 是核心产品，而不是调用仪式

保留三阶段，但去掉隐式编码，并明确命令的时间与资源语义。

```ts
import { z } from "zod";
import { createClient, defineHttp, json } from "proposal:defjs-commands";

export const getUser = defineHttp({
  operation: "User.get",
  method: "GET",
  path: "/users/:id",
  input: z.object({ id: z.number() }),
  request: ({ id }) => ({ path: { id } }),
  output: json(z.object({ id: z.number(), name: z.string() })),
});

const client = createClient({ endpoint: "https://api.example.com", fetch });

async function loadName(id: number, signal: AbortSignal) {
  const command = getUser({ id });
  const result = await client.execute(command, { signal });
  if (!result.ok) return result;
  return { ok: true as const, value: result.value.name };
}

async function loadTwoNames(signal: AbortSignal) {
  const first = await loadName(1, signal);
  if (!first.ok) return first;
  const second = await loadName(2, signal);
  if (!second.ok) return second;
  return { ok: true as const, value: [first.value, second.value] };
}

async function main() {
  const controller = new AbortController();
  const result = await loadTwoNames(controller.signal);
  if (!result.ok) {
    console.error(result.error.code);
    return;
  }
  console.log(result.value);
}

void main();
```

**必须补齐的承诺：**命令至少让用户知道操作身份、输入借用期限和执行边界。它不是可持久化消息，不默认保证重放；流式输入可能是一次性资源。

输入失败和构建失败仍在 execute 结果中表达。若选择 command 创建时就解析并快照，必须承认这是另一个有失败可能的阶段，不能同时宣传“创建只装数据且绝不失败”。

**收益：**应用天然持有带输入的冷操作，可以跨层传递和交给不同执行器。

**代价：**每次立即请求仍多一个步骤。若除了 execute 没有其他真实消费者，这层的价值不足。

**反证条件：**若 SDK 与应用样本都只立即执行，且 Command 不改善测试或组合，应删除公开 Command，不以迁移成本为从零设计辩护。

### 7.3 候选 C：以 Effect 为计算协议

此路线不是自行复制一个简化 Effect，而是让已采用 Effect 的应用直接组合计算。

```ts
import { z } from "zod";
import { Effect } from "effect";
import { createClient, defineHttp, json } from "proposal:defjs-effect";

export const getUser = defineHttp({
  operation: "User.get",
  method: "GET",
  path: "/users/:id",
  input: z.object({ id: z.number() }),
  request: ({ id }) => ({ path: { id } }),
  output: json(z.object({ id: z.number(), name: z.string() })),
});

const client = createClient({ endpoint: "https://api.example.com", fetch });

// 本候选的 execute 返回 Effect，不启动 Promise。
const loadName = (id: number) =>
  client.execute(getUser, { id }).pipe(Effect.map((user) => user.name));

const program = Effect.gen(function* () {
  const first = yield* loadName(1);
  const second = yield* loadName(2);
  return [first, second];
});

const handled = program.pipe(
  Effect.match({
    onFailure: (error) => ({ ok: false as const, error }),
    onSuccess: (value) => ({ ok: true as const, value }),
  }),
);

async function main() {
  try {
    const result = await Effect.runPromise(handled);
    if (!result.ok) {
      console.error(result.error.code);
      return;
    }
    console.log(result.value);
  } catch (cause) {
    // 预期错误之外的缺陷或中断仍有独立边界。
    console.error(cause);
  }
}

void main();
```

这只是接入形态，假想适配器必须把中断连接到实际传输，并为长连接注册 finalizer。没有该连接，仅返回 Effect 类型不代表资源正确释放。

**收益：**跨操作组合、失败传播和资源作用域可以使用同一个计算体系。

**代价：**SDK 消费者承担运行时、上下文和错误模型。对只需要声明并执行 API 的用户可能过重。

**反证条件：**如果用户的核心任务没有程序级组合需求，或不使用 Effect，这条路线不应成为默认核心。

### 7.4 裁决与绑定式调用

| 评价               | 契约值直接执行             | Command 优先       | Effect 优先              |
| ------------------ | -------------------------- | ------------------ | ------------------------ |
| 定义独立发布       | 保留                       | 保留               | 保留，但与计算生态耦合   |
| 每次调用的必经概念 | 操作、输入、执行器         | 再加 Command       | 还需计算与运行时         |
| 带输入的冷操作     | 普通闭包或另行证明的计划值 | 原生               | 原生计算值               |
| 普通 async 接入    | 直接                       | 直接               | 需要运行边界             |
| 程序级组合         | 普通函数                   | 普通函数或命令组合 | 强                       |
| 推荐位置           | 默认原型                   | 有明确命令消费者时 | 已采用 Effect 的集成路线 |

绑定式 `sdk.users.get(input)` 也可从契约构建，但本轮不建议同时公开两套等价入口。先让应用用普通函数绑定客户端即可。

如果用户测试证明具名方法显著改善发现性，而且冷操作没有真实需求，可以直接选择绑定调用作为主 API。这仍然保留 SDK 契约与应用环境分离，不需要全局客户端。

## 8. 推荐路线的完整生命周期

以候选 A 为例：

1. SDK 作者声明 operation、输入协议、放置函数及响应表示。此时不发请求。
2. 应用提供 endpoint、传输和策略，形成执行器。必要配置在这里检查。
3. 应用把操作与普通输入传给 execute，并传递调用级取消信号。
4. 执行器验证输入，得到 request 函数可使用的输出类型。失败不发送。
5. 纯映射函数给出 path、query、headers、body。codec 在明确的编码位置处理别名与转换。
6. 中间件按公开顺序运行。实际传输边界接收已确定的协议表示。
7. 收到响应后先按明确格式读取，再验证或解码业务值。不能把类型声明当作远端事实。
8. 普通请求返回 Result；流打开则返回有所有权的资源，随后仍有读取和终止阶段。
9. 应用分支处理结果，或者在 Query、Effect 等集成边界转换失败风格。
10. 资源所有者取消或关闭后等待清理完成。服务端是否已执行副作用仍由远端契约决定。

边界结论：

- 本地 at-most-once 调度不证明远端 exactly-once。
- 取消网络等待不证明远端撤销了业务操作。
- 输入与响应验证失败应停止该操作，不返回伪造的成功数据。
- 丢弃无效流事件与终止连接是不同策略，必须显式声明，不能沿用“验证失败”四字含糊处理。
- 日志与公共错误信息应保留可诊断的 code，同时避免直接暴露原始凭据、响应体或 cause 内容。

## 9. 实验与验收标准

### 9.1 已执行的本地实验

仅使用假传输，没有访问真实服务，也没有安装依赖。

| 探针                                       | 真实结果                           | 结论范围                 |
| ------------------------------------------ | ---------------------------------- | ------------------------ |
| 直接传递、展开、重建输入对象               | 前两者应用 alias，重建后不应用     | 编码来源语义，非性能结论 |
| 相同 JSON 字符串搭配 string/literal schema | 返回值不同                         | schema 与表示耦合        |
| 创建命令后修改输入并重复执行               | 使用修改后的输入；builder 每次执行 | 引用语义，非不可变快照   |
| 提取原始配置并使用公开定义类型             | 编译失败                           | 特定提取方式存在推导台阶 |
| 显式标注并保留字面量                       | 编译通过                           | 存在可行但额外的标注路径 |
| 提取返回 endpoint 的工厂                   | 编译通过；负面输入断言有效         | 不能泛化为所有封装都失效 |

运行环境：Bun `1.4.4`。类型探针使用本地 `bun check`，并显式启用 strict、Bundler 模块解析、ESNext 和 noEmit。未把探针说成全仓测试通过。

运行记录中存在测试工具自身的失败：最初 `/dev/stdin` 调用未正确运行；随后命令探针的假 Fetch 把 Request 当成 URL 字符串，产生 Invalid URL。修正假传输接收完整 Request 输入后，命令探针通过。

类型探针初始控制组只加参数标注，仍因路径字面量宽化失败；加入 `as const` 后通过。这是调查过程中的真实发现，不应删掉后只报告成功。

### 9.2 尚未执行的裁决实验

| 实验           | 要否定或支持的假设             | 验收                                                  |
| -------------- | ------------------------------ | ----------------------------------------------------- |
| 跨包推导       | 操作值能否跨声明文件保留关联   | 只消费发布的 `.d.ts`，错误输入失败，不靠 any/断言补洞 |
| 重构稳定性     | 契约值比当前配置更易提取       | 内联、变量、工厂、对象导出、业务包装逐项比较          |
| codec 正交性   | 普通数据重构不影响协议         | 相同显式 codec 下，等值对象产生相同 wire 字段         |
| 表示正交性     | schema 收窄不更换传输格式      | string 与 literal 使用同一 json 包装时读取方式一致    |
| Command 必要性 | 冷命令是否有独立消费者         | 使用真实调用样本，不人为制造调度需求证明抽象          |
| 生命周期       | 打开、读取、取消、释放是否明确 | 打开前失败、打开后失败、重复释放、清理失败均可观察    |
| 类型成本       | 深层类型是否拖累消费项目       | 比较平铺、嵌套、包装深度及发布声明，不只看库内 tsc    |
| 使用者任务     | API 是否真的更易理解           | SDK 作者和应用作者分别完成定义、调用、取消与组合      |

规模实验可使用不同数量的操作和嵌套层级，记录检查时间、内存、声明文件大小和编辑器响应。预算应事前设定，不把未经测量的“零成本”写进设计。

**停止规则：**如果原型没有可观察优势，不重写。若删除 Command 造成真实能力损失，保留它。若通用依赖类型或工作流 DSL 没有真实使用者，停止扩张。

## 10. 证据质量、限制与最终判断

研究工作流完成了跨语言搜索和源页抽取，但对抗核验只覆盖其排序靠前的部分命题，偏重 TypeScript。不能把工作流完成理解为每个语言都获得相同验证深度。

主会话补读了 Rust、Go 官方文档、固定版本 API 和 Connect-Go 发布说明，并核对版本注册表。对大页面只读取与命题有关的段落，没有宣称整份参考手册已经审计。外部代码示例没有在本地执行。

抓取服务后续耗尽额度，补核改用官方站点直读。Query 官方网页的一次直读超时，其关键恒等函数事实由固定版本源码核对，文档示例由前序工作流读取提供。未把超时当作来源内容不存在。

未完成的工作是候选实现、跨包类型原型、性能测量和用户任务测试，而不是尚未交付的研究内容。本报告不声称任何候选已经证明更快、更小或普遍更易用。

**最终判断：Defjs 最有辨识度的方向，不是继续创造更多“声明式”语法，而是让协议契约可发布、执行环境可替换、普通值保持普通、转换发生在显式边界。**

允许推翻全部代码，应该用来解除旧实现的论证特权，不应该成为重写的理由。当前最值得改变的是隐藏语义和多余必经层，最值得保留的是应用所有权、真实边界验证与资源责任。

## Sources

### TypeScript 与标准

- [TanStack Query：Query Options][query-options]
- [TanStack Query：TypeScript][query-types]
- [TanStack Query：固定版本 queryOptions 源码][query-source]
- [TanStack DB：Live Queries 固定提交][db-queries]
- [Effect v4：The Effect Type][effect-type]
- [Effect v4：Creating Effects][effect-create]
- [Effect v4：Two Error Types][effect-errors]
- [oRPC v1：Define Contract][orpc-contract]
- [oRPC：v1 迁移边界](https://orpc.dev/docs/migrations/from-v1)
- [Zod：Codecs][zod-codecs]
- [Valibot：pipe][valibot-pipe]
- [Standard Schema 完整接口][standard-schema]
- [TC39：显式资源管理语义][resource-management]
- [TC39：已完成提案列表](https://github.com/tc39/proposals/blob/main/finished-proposals.md)

### Rust

- [Tower Service][tower-service]
- [Tower ServiceBuilder][tower-builder]
- [Axum Router][axum-router]
- [reqwest RequestBuilder][reqwest-builder]
- [Serde data model][serde-model]
- [SQLx query!][sqlx-query]

### Go

- [Connect-Go v2 发布说明][connect-v2]
- [Connect-Go v2 迁移指南][connect-migration]
- [Connect-Go 入门](https://connectrpc.com/docs/go/getting-started/)
- [Go net/http][go-http]
- [Go context][go-context]
- [Ent Code Generation][ent-codegen]

### 版本来源

- [Query npm latest](https://registry.npmjs.org/@tanstack/react-query/latest)
- [DB npm latest](https://registry.npmjs.org/@tanstack/db/latest)
- [Effect npm latest](https://registry.npmjs.org/effect/latest)
- [oRPC npm latest](https://registry.npmjs.org/@orpc/contract/latest)
- [oRPC npm beta](https://registry.npmjs.org/@orpc/contract/beta)
- [Zod npm latest](https://registry.npmjs.org/zod/latest)
- [Valibot npm latest](https://registry.npmjs.org/valibot/latest)
- [Connect-Go module proxy](https://proxy.golang.org/connectrpc.com/connect/v2/@latest)

[query-options]: https://tanstack.com/query/latest/docs/framework/react/guides/query-options
[query-types]: https://tanstack.com/query/latest/docs/framework/react/typescript
[query-source]: https://github.com/TanStack/query/blob/%40tanstack/react-query%405.105.0/packages/react-query/src/queryOptions.ts
[db-queries]: https://github.com/TanStack/db/blob/0531c50ad419a1b51ad3e27e3632e70be3c6bdb3/docs/guides/live-queries.md
[effect-type]: https://effect.website/docs/v4/getting-started/the-effect-type
[effect-create]: https://effect.website/docs/v4/getting-started/creating-effects
[effect-errors]: https://effect.website/docs/v4/error-management/two-error-types
[orpc-contract]: https://v1.orpc.dev/docs/contract-first/define-contract
[zod-codecs]: https://zod.dev/codecs
[valibot-pipe]: https://valibot.dev/api/pipe/
[standard-schema]: https://standardschema.dev/
[resource-management]: https://github.com/tc39/proposal-explicit-resource-management
[tower-service]: https://docs.rs/tower/0.5.3/tower/trait.Service.html
[tower-builder]: https://docs.rs/tower/0.5.3/tower/struct.ServiceBuilder.html
[axum-router]: https://docs.rs/axum/0.8.9/axum/struct.Router.html
[reqwest-builder]: https://docs.rs/reqwest/0.13.5/reqwest/struct.RequestBuilder.html
[serde-model]: https://serde.rs/data-model.html
[sqlx-query]: https://docs.rs/sqlx/0.9.0/sqlx/macro.query.html
[connect-v2]: https://buf.build/blog/connect-go-v2
[connect-migration]: https://github.com/connectrpc/connect-go/blob/main/docs/v2-migration.md
[go-http]: https://pkg.go.dev/net/http
[go-context]: https://pkg.go.dev/context
[ent-codegen]: https://entgo.io/docs/code-gen/
