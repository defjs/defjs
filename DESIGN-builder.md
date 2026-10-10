# 设计稿：`builder` 取代 `build`，删除 `struct.request`

状态：已实施（工作区未提交；codex 第十五轮审计 Ready，`bun run verify` 通过）
日期：2026-09-28（2026-09-29 修订：类型设计、query 编码、`protocols` 归属、alias 定位、body 分流规则与附录 A、4.3 逐层引导）
范围：`@defjs/core` 的端点定义层（`defineRequest` / `defineEventStream` / `defineWebSocket`）与 `struct` 的请求相关部分。开发期设计，不保留兼容层。

---

## 1. 问题

### 1.1 `build(request, input)` 是伪装成 JS 函数的符号 DSL

- `input` 不是值，而是 `createBoundView` 生成的绑定视图（`internal/request_builder.ts:463`）。`request.setJson(...)` 等调用先录成 `BuildPlan`（`:361`），再由 `materializeBuildPlan`（`:405`）用真实 input 回放。
- 后果（`doc/guide/design-decisions.md:137` 明文限制）：
  - 不能按值分支：`if (input.draft)` 恒为 truthy 的视图。
  - 不能注入字面量：`setHeaders({ 'x-api-version': '2' })` 运行时抛 `binding values must come from build input`。
  - 不能用模板字符串、`??`、`.filter`、`String(x)`。
  - 类型失真：`input.q` 的类型是 `BuildBoundRef`，不是 `string`。
- 13 个 `setXxx` / `addXxx` 方法和 add/set 语义，只是在重新发明"拼一个对象"。

### 1.2 当初的理由在实现里不存在

历史合同（`6cd5ec7:packages/core/research/defjs-build-options.md`）写的是"定义期执行一次 `build`，存下 `BuildPlan`；请求期只 materialize"。实际 `buildRequest` 在每次 execute 时调用（`http.ts:274` → `transport_request.ts:39` → `request_builder.ts:176-180`），每次都新建 owner symbol、Proxy 树、plan 并回放。plan 从未被缓存，也没有任何消费者读取它。只剩成本。

### 1.3 视图机制唯一真实的收益

记住"值来自哪个 struct"，从而按该 struct 编码：alias 改写线上 key、`Date` 转 ISO、`bigint` 转字符串。本设计保留这一收益，换掉实现手段。

### 1.4 `struct.request` 放错了层

- 它描述的是端点的线上形状，不是数据类型，却占用 `request`、`requestBody` 两种 Struct kind，在 `parse`、`encode`、`match`、`guards`、`utils`、`constructors`、`types` 中形成约 50 处特判；WebSocket 还要在运行时断言"不许有 headers/body"。
- 输入结构只描述调用参数；请求放置由显式 `builder` 完成，不需要额外的 Struct kind。

---

## 2. 原则

1. **struct 是 Go struct。** 类型加 tag，双向：入站解码（`output` / `error` / 事件 / 消息），出站编码（`input`）。`.alias(name)` 就是 `json:"name"`。
2. **struct 决定值怎么编码；builder 决定值放在哪里。**
3. **值带着自己的 struct。** 来自 input 的对象携带其 struct，编码由 struct 驱动；builder 中新写的对象是匿名的，所见即所得。
4. **原生类型是一等公民。** builder 返回的 `URLSearchParams`、`Headers`、`BodyInit` 原样使用，不重新编码。
5. **失败要大声。** 冲突、非扁平值、非法标量一律成为 `REQ_BUILD_FAILED`，不静默覆盖或丢弃。

---

## 3. API

### 3.1 定义字段

| 字段        | 说明                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `input`     | 可选。struct，校验并解析调用方参数（保留 `REQ_INPUT_INVALID`）。                                                                     |
| `builder`   | 声明 `input` 时必填，否则可选。`(input: BuilderInput<TInput>) => …`，同步、纯函数，execute 时惰性执行，抛错成为 `REQ_BUILD_FAILED`。 |
| `protocols` | 仅 WebSocket，可选。静态子协议列表，属于端点契约（如 `graphql-transport-ws`），不进入 builder。                                      |

- builder 只有一个参数：**真实的解析值**。没有 ctx，没有 setter。
- 返回值就是请求本身，不引入 "parts" 之类的新概念。返回类型只用于对象字面量的上下文推导，用户无需书写其名字。
- 只要声明了 `input`，就必须显式提供 `builder`，即使输入已经是请求形状也一样。只有没有 `input` 的定义可以省略 `builder`，或使用 `() => ({ headers: … })` 构造静态请求。

### 3.2 builder 返回形状

| 字段      | HTTP | SSE | WebSocket | 规则                                                                                           |
| --------- | ---- | --- | --------- | ---------------------------------------------------------------------------------------------- |
| `path`    | ✔    | ✔   | ✔         | 编码后必须是扁平标量记录；填入 `:name`，沿用 `fillUrl` 的编码和 dot-segment 校验               |
| `query`   | ✔    | ✔   | ✔         | `URLSearchParams` 原样使用；普通对象 / 带类型对象经编码后交给 query 序列化（3.3）              |
| `headers` | ✔    | ✔   | ✘         | `HeadersInit`（含 `Headers`）原样使用；普通对象 / 带类型对象经编码后必须扁平；`undefined` 省略 |
| `body`    | ✔    | ✔   | ✘         | 见 3.4；`GET` / `HEAD` 不允许 body（类型层禁止）                                               |

标量：`string`、`number`、`bigint`、`boolean`、`Date`（按叶子规则编码）。`null` 进入 `path` / `query` / `headers` 报 `REQ_BUILD_FAILED`；嵌套对象进入 `path` / `headers` 报 `REQ_BUILD_FAILED`。

### 3.3 query 编码

query 的嵌套约定（`a[b]=1`、`a.b=1`、`a=1,2`……）是**后端 API 的全局约定**，不属于端点，也不属于值。defjs 中"一个后端"对应 client，因此钩子放在 client 上：

```ts
createClient(
  withEndpoint('https://api.example.com'),
  withQuerySerializer((query) => qs.stringify(query)),
)
```

- 参数 `query` 是**编码后的线上对象**：alias 已生效、`Date` 已转 ISO、`bigint` 已转字符串，普通对象，可嵌套。序列化器看到的是线上 key，alias 不会断。
- 返回值为字符串，原样作为 query string。
- 未配置时：原生 `URLSearchParams`，数组展开为重复 key，嵌套对象报 `REQ_BUILD_FAILED`（提示需配置序列化器）。
- builder 直接返回 `URLSearchParams` 时原样使用，跳过序列化器。
- defjs 不实现、不依赖 qs。

与现状的差异：现有 `withQueryParamsSerializer((params, rawParams) => string)` 拿到的是编码前的原始值，交给 qs 会丢失 alias；合同改为只接收编码后的线上对象，并更名为 `withQuerySerializer`。`allowComplex` 分支删除。

### 3.4 body 表示

按以下顺序分流，命中即止：

| builder 返回的 `body`                                                       | 发送方式                                                                | 默认 content-type                              |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------- |
| `undefined` / 不写                                                          | 不发送 body                                                             | —                                              |
| 带 `urlencoded` / `formData` codec tag 的带类型对象（**仅限作为 body 根**） | 编成 `URLSearchParams` / `FormData`，key 用线上名，数组展开为同名多字段 | 表单类型 / 由平台生成 boundary                 |
| `FormData`、`URLSearchParams`                                               | 原样                                                                    | 同上                                           |
| `Blob` / `File`                                                             | 原样                                                                    | `blob.type`，为空时 `application/octet-stream` |
| `BufferSource`（`ArrayBuffer`、`Uint8Array` 等 TypedArray、`DataView`）     | 原样                                                                    | `application/octet-stream`                     |
| `ReadableStream`                                                            | 原样，流式发送（transport 已设置 `duplex: 'half'` 并探测运行时能力）    | `application/octet-stream`                     |
| `string`                                                                    | 原样                                                                    | `text/plain;charset=UTF-8`                     |
| 其他（对象、数组、number、boolean、`null`）                                 | 按第 4 节编码后 `JSON.stringify`                                        | `application/json`                             |

- 默认 content-type 与现有 `resolveHttpBodyContentType`（`http/transport/body.ts`）一致；`BufferSource` 分支需由现有的 `ArrayBuffer` 判断扩展而来。
- 覆盖 content-type：在 `headers` 中声明 `content-type`。
- **codec tag 只在 body 根生效。** `body: { meta: input.form }` 按 JSON 发送，`form` 的字段作为普通 JSON 字段编码。
- **字符串默认按原文发送。** 发送 JSON 字符串（如 `"abc"`）需自行 `JSON.stringify(s)` 并声明 `application/json`。
- **`undefined` 与 `null` 语义分离。** `undefined` 字段被省略；`nullable` 字段传 `null` 时发送 `null`。body 本身为 `undefined` 表示无 body。
- **自行序列化即离开 struct 编码路径。** `JSON.stringify`、qs、protobuf 等由用户完成的序列化看到的是逻辑名，alias 不生效。若此类需求增多，可提供与 `struct.parse` 对称的 `struct.encode(S, value)`（对应 Go 的 `json.Marshal`）；当前不加。
- 各场景示例见附录 A。

### 3.5 示例

```ts
const health = defineRequest({ method: 'GET', path: '/health' })
health()

const getUser = defineRequest({
  method: 'GET',
  path: '/users/:user_id',
  input: struct.object({ userId: struct.number().alias('user_id') }),
  builder: (input) => ({ path: input }),
  output: User,
})
getUser({ userId: 7 })

// 主路：把带类型的值交出去，线上名由 alias 决定
const SearchQuery = struct.object({
  keyword: struct.string(),
  pageSize: struct.number().alias('page_size'),
})
const Meta = struct.object({ traceId: struct.string().alias('x-trace-id') })

const search = defineRequest({
  method: 'GET',
  path: '/orgs/:org_id/users',
  input: struct.object({
    orgId: struct.number(),
    query: SearchQuery,
    headers: Meta,
  }),
  builder: (input) => ({ path: { org_id: input.orgId }, query: input.query, headers: input.headers }),
  output: struct.array(User),
})

const NewUser = struct.object({
  displayName: struct.string().alias('display_name'),
  email: struct.string(),
})

const createBatch = defineRequest({
  method: 'POST',
  path: '/accounts/:account_id/users',
  input: struct.object({
    accountId: struct.number(),
    draft: struct.boolean().optional(),
    users: struct.array(NewUser),
  }),
  builder: (input) => ({
    path: { account_id: input.accountId },
    query: { draft: input.draft ? 1 : undefined },
    headers: { 'x-api-version': '2' },
    body: { users: input.users },
  }),
  output: struct.object({ accepted: struct.number() }),
})

// 原生类型原样使用
const tagSearch = defineRequest({
  method: 'GET',
  path: '/items',
  input: struct.object({ tags: struct.array(struct.string()) }),
  builder: (input) => {
    const query = new URLSearchParams()
    for (const tag of input.tags) query.append('tag', tag)
    return { query }
  },
})

const upload = defineRequest({
  method: 'POST',
  path: '/files/:id',
  input: struct.object({
    id: struct.string(),
    form: struct.formData({ file: struct.file(), title: struct.string().alias('t') }),
  }),
  builder: (input) => ({ path: { id: input.id }, body: input.form }),
})

// input 只声明调用参数，builder 明确决定发送位置
const updateUser = defineRequest({
  method: 'PATCH',
  path: '/users/:id',
  input: struct.object({
    id: struct.number(),
    user: struct.object({ displayName: struct.string().alias('display_name') }),
  }),
  builder: (input) => ({ path: { id: input.id }, body: input.user }),
})

const feed = defineEventStream({
  path: '/rooms/:room/events',
  input: struct.object({ room: struct.string(), since: struct.string().optional() }),
  builder: (input) => ({ path: { room: input.room }, query: { since: input.since } }),
  events: {
    message: struct.object({ text: struct.string() }),
    ping: struct.string(),
  },
  maxBufferSize: 1 << 20,
  maxQueueSize: 64,
})

const chat = defineWebSocket({
  path: '/ws/rooms/:room',
  protocols: ['chat.v1'],
  input: struct.object({ room: struct.string() }),
  builder: (input) => ({ path: input }),
  incoming: struct.discriminatedUnion('type', [
    struct.object({ type: struct.literal('said'), text: struct.string() }),
    struct.object({ type: struct.literal('pong') }),
  ]),
  outgoing: struct.discriminatedUnion('type', [
    struct.object({ type: struct.literal('say'), text: struct.string() }),
    struct.object({ type: struct.literal('ping') }),
  ]),
  maxIncomingQueueSize: 64,
})
```

---

## 4. alias 映射

### 4.1 alias 属于字段关系，不属于值

与 Go 相同：tag 写在 struct 字段上。`.alias` 记录在字段 struct 上，由父对象编码时经 `resolveStructFields` 得到 `wireKey`。一个 key 是否被改写，取决于它的父对象是否带类型。

### 4.2 类型如何跟着值走

- `parseEndpointInput` 解析 input 时，为每个产出的对象节点定义一个 **enumerable symbol 属性** `[STRUCT]`，值为该节点的 struct。
  - union：取命中的那个 option 的 struct。intersection：取参与合并各侧标签的合取集合（见 4.3）。
  - record 节点同样打标签（修订于 2026-09-30）。record 的 key 本身是数据：编码时 key 原样使用，value 按 record 的 value struct 编码。数组节点不打标签，每个元素各自带着自己的标签。`null` / `undefined` 不打标签。
  - 响应解码与公共 `struct.parse` 不挂，热路径零成本。
- 选择 enumerable symbol 而非 WeakMap 的依据（vitest 实测）：
  - 展开 `{ ...x }` 与 `Object.assign` 会复制它，展开后类型不丢失，消除"逻辑名静默上线"的陷阱。
  - `JSON.stringify`、`Object.keys` 不可见，不污染线上数据和常规代码。
  - 代价：vitest `toEqual` 会比较它，`console.log` 会显示它。类型成为值上可见的一部分，而非旁路表中的隐藏状态。

### 4.3 编码规则

出站编码器对 builder 返回值做一次递归（原生 `URLSearchParams` / `Headers` / `BodyInit` 不进入编码器）：

| 值         | 规则                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| 带类型对象 | struct 字段以 `alias ?? key` 为线上名，值按字段 struct 递归编码；非字段 key 按字面量保留；线上名冲突报 `REQ_BUILD_FAILED` |
| 匿名对象   | key 按字面量，值递归                                                                                                      |
| 数组       | 逐项递归                                                                                                                  |
| 叶子       | `Date` → ISO 字符串，`bigint` → 字符串，其余原样                                                                          |

沿用既有行为：optional 字段为 `undefined` 时省略；discriminator 的 alias 走 `discriminatorWireKeys`；字段 wireKey 重复在 struct 创建时报错（`struct/fields.ts:41`）。builder 输出不重新校验，类型由 TS 保证。

**逐层引导（实施中确定，2026-09-29）。** 上表在每一层都生效，不只作用于根。每个节点按以下优先级决定编码方式：

1. 值自身的 `[STRUCT]` 标签（object struct）。
2. 否则，父级带类型对象为该字段声明的 struct（引导 struct）：object 直接使用；array / tuple / record 按其 item / 位置 / value struct 继续引导；union / discriminated union 取能匹配该值的分支。
3. 否则（没有引导，或引导为 `unknown` / `any`），按匿名对象处理：key 按字面量，子节点仍按自身标签编码。

因此同一个新写的子对象，放在匿名根下与放在带类型根下，结果可能不同：

```ts
body: { row: { id: '42' } }              // 根匿名：发出 id
body: { ...input, row: { id: '42' } }    // 根带类型，row 字段声明了 alias：发出 wire_id
```

union 引导下若多个分支都能匹配，逐个分支按上述规则实际编码后比较：结果一致则采用（例如空数组），结果不同则报 `REQ_BUILD_FAILED`，绝不静默挑选。混合 intersection（包含非 object 部分）解析时，会以各匹配部分的标签组成的合取集合作为标签；未经解析、新写的混合 intersection 值按匿名对象处理。

**intersection 合并语义（对齐 zod `mergeValues` / valibot `_merge`，2026-09-29）。**

- 解析：所有成员都执行，任一失败即失败；随后对各成员输出做深合并：`Object.is` 相等（或同一时刻的 `Date`）取该值；两个普通对象取 key 并集，同名 key 递归合并；等长数组逐项合并；其余一律视为冲突，报 issue `invalid_intersection`，path 指向冲突位置。不抛异常，不静默取某一侧。
- `unknown()` / `any()` 是交集单位元（`T & unknown = T`）：照常执行，但不参与合并；全部成员都是单位元时返回输入本身。
- 编码：对非单位元成员分别编码，按同一规则合并线上结果；冲突抛错，出站表现为 `REQ_BUILD_FAILED`。
- **不存在「别名冲突」这个概念（2026-09-29 第二次修订，取代此前的构造期检查和使用时检查）。** 成员之间互相独立，这正是 zod / valibot 的语义：某个成员把逻辑 key `name` 映射到 `a_name`，另一个成员映射到 `b_name`，那么解析时每个成员各读各的线上名（两者都必须存在，逻辑值再按深合并规则合并），编码时两个线上名都会发出。这与"逐成员编码再合并"得到的结果天然一致，因此无需任何额外的检测步骤，也不需要单独的 alias 遍历器。
  - 唯一的冲突只来自数据本身：同一个线上 key 被写入了不相等的值。编码时抛错（出站表现为 `REQ_BUILD_FAILED`），解析时报 `invalid_intersection`。
- 引导集合（guide set）：出站编码器的引导从「单个 struct」推广为「struct 的合取集合」，单个 struct 就是只有一个元素的集合。它在逐个节点上实现"逐成员编码再合并"：
  - 对象节点：已声明的 key 取各成员声明的并集，record 成员视为声明了该节点上的所有 key。对每个已声明的 key，按成员给出的线上名分组：每组的子引导取该组成员对应的字段 struct 或 record 的 value struct，子值按组编码后写到该组的线上名下（线上名全部相同时只有一组，等价于"子值只编码一次"）。这样与 `encode.ts` 的"逐成员编码再合并"结果严格一致。没有任何成员声明的 key 按字面量保留（这是出站相对 `encode.ts` 唯一允许的差异）。线上 key 上的值冲突报错。
  - 数组 / tuple：子节点的引导取各成员的 item / 对应位置的 struct。
  - union 引导：按 union 规则解析（匹配的分支都编码一遍再比较，结果不同就报错），不因为出现在集合里而改为"取第一个"。
  - 子节点自带的 `[STRUCT]` 标签优先于从父级下传的引导，但要先区分标签的来源：
    - 标签的成员与父级引导（union 先按值解析到具体分支）有交集时，说明它来自同一次解析，这时只使用交集部分。这样在按线上名分组编码时，子树不会把其他组的线上名带进来。
    - 标签的成员与父级引导不相交时，说明它是另外解析出来的替换值，这时整个子树只用它自己的标签。
  - `null` / `undefined` 叶子照常处理：optional 字段的 `undefined` 省略，nullable 的 `null` 原样发出。
- 解析标签：开启标签的解析会给**所有对象节点**打标签，record 节点也不例外（值为 `null` / `undefined` 时不打）。标签由实际完成解析的 struct 决定，union 取实际匹配的那个分支。intersection 在深合并的**每一层递归**里同步合并两侧的标签，得到合取集合，所以不需要在合并之后再单独补打标签。因此 builder 从合并结果中取出的任意子值（如 `input.profile`）都能独立得到正确的线上名。

### 4.4 推演

```ts
const Profile = struct.object({
  displayName: struct.string().alias('display_name'),
  birthday: struct.date(),
})
input: struct.object({ userId: struct.number().alias('user_id'), profile: Profile })
// 调用：{ userId: 7, profile: { displayName: 'Ada', birthday: new Date('1815-12-10') } }
```

| builder 写法                                     | 线上结果                                                       | 原因                          |
| ------------------------------------------------ | -------------------------------------------------------------- | ----------------------------- |
| `path: { user_id: input.userId }`                | `user_id=7`                                                    | 匿名对象                      |
| `path: input`                                    | `REQ_BUILD_FAILED`（类型层亦报错）                             | `profile` 非扁平              |
| `body: input.profile`                            | `{"display_name":"Ada","birthday":"1815-12-10T00:00:00.000Z"}` | 带类型                        |
| `body: { profile: input.profile }`               | `{"profile":{"display_name":"Ada",…}}`                         | 外层匿名、内层带类型          |
| `body: { ...input.profile, role: 'admin' }`      | `{"display_name":"Ada","birthday":"…","role":"admin"}`         | 展开保留类型，额外 key 字面量 |
| `body: { ...input.profile, displayName: 'Bob' }` | `{"display_name":"Bob",…}`                                     | 覆盖字段，alias 仍生效        |
| `body: { ...input.profile, display_name: 'x' }`  | `REQ_BUILD_FAILED`                                             | 线上名冲突                    |
| `body: { name: input.profile.displayName }`      | `{"name":"Ada"}`                                               | 父对象匿名，alias 不参与      |

### 4.5 alias 的定位

alias 的意义是：**线上名在类型上声明一次，所有引用该类型的位置、两个方向都自动生效**。手写 key 是例外的逃生口，不是主路。

| 场景                           | 例子                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| 响应解码                       | 每个 `output` / `error` / event / incoming，`display_name` → `displayName`                             |
| 嵌套 body                      | `body: input.order`，订单行数组、地址对象整棵树自动改写                                                |
| query / headers 交给带类型对象 | `query: input.query`（`pageSize` → `page_size`），`headers: input.headers`（`traceId` → `x-trace-id`） |
| 显式请求放置                   | `builder: (input) => ({ path: { id: input.id }, body: input.user })`                                   |
| WS outgoing                    | `session.send(msg)` 经 struct 编码                                                                     |
| 同一 struct 复用               | `User` 同时是 `createUser` 的 body 与 `getUser` 的 output，线上名只写一处                              |

设计约束：文档与示例必须把"交出带类型的值"写成默认路径（3.5 的 `search`）。若用户普遍手写 key，说明设计失败。

---

## 5. 类型设计

以下类型已用模拟 struct 原型在 `tsc 7.0.2` 下验证（17 个用例，含 `@ts-expect-error` 负例，退出码 0）。实现时 `BuilderInput` 需按真实 struct 类型补齐 union / intersection / nullable 分支。

### 5.1 签名

```ts
declare function defineRequest<
  const M extends string,
  const P extends string,
  TInput extends AnyStruct | undefined = undefined,
  TOutput extends AnyStruct | undefined = undefined,
  TError extends AnyStruct | undefined = undefined,
>(
  definition: { method: M; path: P; input?: TInput; output?: TOutput; error?: TError; operation?: string } & BuilderField<
    NoInfer<TInput>,
    HttpRequestShape<NoInfer<P>, NoInfer<M>>
  >,
): RequestEndpoint<TInput, TOutput, TError>
```

- `const M` / `const P`：method 与 path 推导为字面量，供 path 参数检查与 GET/HEAD 禁 body 使用。
- `NoInfer`：builder 只消费已推导的类型，不参与推导。顺序固定为 `input` → TInput，`path` → P，再为 builder 提供上下文类型。
- SSE 签名同 HTTP（method 默认 `GET`）；WebSocket 无 `M`，返回形状为 `WebSocketRequestShape<P>`。

### 5.2 `BuilderInput`

```ts
type Typed = { readonly [STRUCT]: AnyStruct }

type BuilderInput<S> =
  S extends ObjectStruct<infer Shape>
    ? { [K in keyof Shape]: BuilderInput<Shape[K]> } & Typed
    : S extends ArrayStruct<infer Item>
      ? BuilderInput<Item>[]
      : S extends OptionalStruct<infer X>
        ? BuilderInput<X> | undefined
        : Infer<S>
```

- 与运行时一一对应：对象节点挂 `[STRUCT]`，类型上即 `& Typed`。
- TS 展开类型保留 unique symbol 属性，`{ ...input.profile, role }` 在类型上仍为 `Typed`，与运行时一致（原型已验证）。

### 5.3 标量、path、返回形状

```ts
type Scalar = string | number | bigint | boolean | Date
type FlatValue = Scalar | readonly Scalar[] | undefined
type FlatRecord = { readonly [key: string]: FlatValue }
type QueryValue = Scalar | readonly QueryValue[] | { readonly [key: string]: QueryValue } | undefined
type QueryRecord = { readonly [key: string]: QueryValue }

type PathParams<P> = P extends `${string}:${infer Name}/${infer Rest}`
  ? Name | PathParams<`/${Rest}`>
  : P extends `${string}:${infer Name}`
    ? Name
    : never

type PathValue<P> = [PathParams<P>] extends [never]
  ? never
  : // 匿名：key 必须与模板严格一致
    | ({ readonly [K in PathParams<P>]: Scalar } & { readonly [STRUCT]?: never })
    // 带类型：字段必须全为标量（alias 不在类型层，key 由运行时 Missing path param 兜底）
    | (Typed & { readonly [key: string]: Scalar })

type HttpRequestShape<P, M> = {
  path?: PathValue<P>
  query?: URLSearchParams | QueryRecord
  headers?: HeadersInit | FlatRecord
  body?: Uppercase<M> extends 'GET' | 'HEAD' ? never : unknown
}

type WebSocketRequestShape<P> = {
  path?: PathValue<P>
  query?: URLSearchParams | QueryRecord
  headers?: never
  body?: never
}
```

- `query` 允许嵌套：定义与 client 无关，类型层无法得知是否配置了序列化器，"嵌套需序列化器"退回运行时。`path` / `headers` 保持编译期扁平检查。
- `body` 取 `unknown`：TS 的 `interface` 没有隐式索引签名，精确的 `JsonValue` 会拒绝用户自己的 `interface User`；body 本就由运行时分类。
- method 为非字面量 `string` 时，GET/HEAD 检查自动放宽。

### 5.4 builder 何时可省略

```ts
type BuilderField<TInput, TShape> = [TInput] extends [undefined]
  ? { builder?: () => TShape }
  : { builder: (input: BuilderInput<TInput>) => TShape }
```

### 5.5 endpoint 调用签名

```ts
type EndpointArgs<TInput> = [TInput] extends [undefined]
  ? []
  : undefined extends StructInput<TInput>
    ? [input?: StructInput<TInput>]
    : [input: StructInput<TInput>]
```

调用方传 `StructInput`（逻辑名、未解析）；builder 收 `BuilderInput`（已解析、带类型）。

### 5.6 用例

```ts
health() // ✔
health({}) // ✘ 无 input

builder: (input) => ({ path: { user_id: input.userId } }) // ✔
builder: (input) => ({ path: { usr_id: input.userId } }) // ✘ path key 拼错
builder: (input) => ({ path: input }) // ✔ 带类型、全标量
builder: (input) => ({ path: input }) // ✘ input 含嵌套对象
builder: (input) => ({ path: input }) // ✘ input 含 optional 字段
builder: (input) => ({ path: { user_id: input.userId }, query: input }) // ✔ Date、string[] 可进 query

defineRequest({ method: 'PATCH', path: '/users/:id', input: RequestShaped }) // ✘ 声明 input 就须写 builder
defineRequest({ method: 'POST', path: '/x', input: struct.object({ name: struct.string() }) }) // ✘ 须写 builder
defineRequest({ method: 'GET', path: '/x', builder: () => ({ body: { a: 1 } }) }) // ✘ GET 带 body
defineWebSocket({ path: '/ws/:room', input, builder: (i) => ({ path: { room: i.room }, headers: {} }) }) // ✘ WS 无 headers

search() // ✔ input 为 optional 时参数可省
```

### 5.7 原型暴露的两个坑（实现时须以 type test 锁定）

1. **结构类型放行嵌套。** path 匿名分支若只写 `{ id: Scalar }`，非新鲜的 `input` 多出的 `profile` 不触发多余属性检查而被放行。修法：匿名分支加 `[STRUCT]?: never`，带类型对象只能走"全标量"分支。
2. **上下文类型化的箭头函数返回值不做多余属性检查。** WS builder 返回 `headers` 不报错。修法：形状中显式声明禁止项 `headers?: never`、`body?: never`。

### 5.8 刻意不做

- 不把 alias 做进类型层（`alias<const N>` 字面量品牌需穿透 `.optional()` / `.nullable()` 整条链，复杂度翻倍）。由运行时 `Missing path param` 兜底。
- 对外只导出 `BuilderInput<S>` 与三种传输的返回形状类型，供抽取独立 builder 时复用。
- `STRUCT` 须能被 d.ts 引用，否则声明生成报 private name；作为 type 导出，文档标注内部使用。

---

## 6. 入站表示法

HTTP 的 `output` / `error`、SSE event data、WebSocket 帧统一按 struct kind 选择表示：

| kind            | 表示 |
| --------------- | ---- |
| `string`        | 原文 |
| `blob` / `file` | Blob |
| `arrayBuffer`   | 字节 |
| 其他            | JSON |

- 与现有 error 侧 `resolveParseResponseType`（`http/http.ts`）一致，output 侧对齐后删除 `responseType` 选项。
- SSE 不再需要 `struct.json` / `struct.text` 包装。
- 已知退化：服务端返回 JSON 字符串 `"abc"` 而 struct 为 `string`；SSE data 为裸文本但想用 `struct.literal`。接受。
- WebSocket：`incoming` 为单个 struct，文本帧 JSON 解析后断言，失败走运行时错误监听器（与 SSE `onInvalidEvent` 对称）。`outgoing` 为单个 struct，`session.send` 的类型为 `StructInput<outgoing>`，经 struct 编码后 `JSON.stringify`。

---

## 7. 命名

- 定义字段 `build` → `builder`。
- 现有术语中 "builder" 指 `defineXxx` 的返回值（`RequestCommandBuilder` 等）。为避免一词两义，返回值更名为 **endpoint**：`getUser` 是 endpoint，调用它得到 command。类型相应更名（如 `RequestEndpoint`、`EventStreamEndpoint`、`WebSocketEndpoint`；与现存内部类型名冲突时一并调整）。
- `withQueryParamsSerializer` → `withQuerySerializer`（合同变更见 3.3）。

---

## 8. 删除、改造、保留、新增

### 删除

| 项                                                                                                                                                                                             | 理由                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `internal/request_builder.ts` 的绑定视图、plan、materialize 全套及其 spec / type test                                                                                                          | 由 builder + 编码器取代                      |
| `struct.request` 与 `request` kind                                                                                                                                                             | 由普通 input struct 和显式 builder 取代      |
| `requestBody` kind、`struct.json`、`struct.text`                                                                                                                                               | 请求侧由 body 规则覆盖，入站由 kind 规则覆盖 |
| `responseType` 及其条件类型                                                                                                                                                                    | 由 kind 推导                                 |
| WS 的 `SocketStructs` 映射、`'default'` 键、type 信封约定、`normalizeIncoming` / `normalizeOutgoing`、`MissingWebSocketStructError`、`cloneStrictJsonValue`、`KnownOutgoingSocketUnion` 等类型 | 由 `incoming` / `outgoing` 单 struct 取代    |
| query 的 `allowComplex` 分支                                                                                                                                                                   | 由 3.3 的序列化合同取代                      |

### 改造

- `withQueryParamsSerializer` → `withQuerySerializer((query) => string)`，只接收编码后的线上对象。
- `struct.formData` / `struct.urlencoded`：改为 `ObjectDefinition` 上的 `codec` tag，不再是包装 kind。

### 保留

- `input` struct、`parseEndpointInput`、`REQ_INPUT_INVALID`。
- `encode.ts` 与出站 alias、primitive `encode` 钩子（date / bigint）。
- WebSocket 定义层 `protocols`。
- method、path 模板、`operation`、单 `error` struct、command 与 `client.execute` 管线、响应与 fault 模型。

### 新增

- 出站编码器（第 4.3 节），约百行以内。
- parse 的"挂类型"开关，仅 `parseEndpointInput` 使用。
- 共用的入站表示法解析函数。

---

## 9. 否决方案

### 9.1 向 builder 传入可变原生容器

形如 `builder(req, input) { req.headers.set(...); req.query.set(...); req.body = … }`。否决理由：

1. builder 的产物是请求，对应 fetch 的 `RequestInit`——一个被返回的描述对象；服务端 Fetch 风格 handler 同样以返回值产出 response。可变容器是 XHR `setRequestHeader` 风格。
2. `URLSearchParams.set` / `Headers.set` 只收字符串，带类型的值无法经 struct 编码，alias、`Date`、`bigint` 全部要手写；为保 alias 再包一层就回到旧 `setQueryParams`。
3. 定义与 client 无关，client 默认 headers、XSRF、拦截器在 builder 之后合并，递进去的容器只能为空，只省一行 `new Headers()`。
4. 可变容器引入生命周期规则（返回后异步修改、冻结时机）；纯函数没有这类问题。

"拿到原生请求就地处理"的角色由**拦截器**承担：它收到的 `HttpRequest` 已是原生 `Headers` / `URLSearchParams` 并带 `next()`，形态与服务端中间件一致。

| 角色    | 归属     | 输入                             | 形式                      | 职责                   |
| ------- | -------- | -------------------------------- | ------------------------- | ---------------------- |
| builder | 端点定义 | 业务值                           | 纯函数，返回请求          | 放置 + 编码            |
| 拦截器  | client   | 原生请求（已合并 client 默认值） | 修改原生请求，调 `next()` | 鉴权、追踪、签名等横切 |

### 9.2 `protocols` 进入 builder 返回值

子协议是端点契约而非 input 的函数；HEAD 上已有 execute 选项 > client 配置 > 定义三个来源（`web_socket.ts:481`），加上 `beforeConnect`，再加 builder 即第五个入口。唯一的动态场景"token 塞进子协议"属于 `beforeConnect` / 拦截器。

### 9.3 删除 `input` struct、出站只用 TS 类型

struct 的定位是 Go struct：出站编码（alias、codec）是其核心价值，删除 input 即丢失这一半。

### 9.4 内置 qs 或自研嵌套 query 编码

query 嵌套格式变体众多，重做即重复造轮子；由 3.3 的序列化钩子接入用户选择的实现，defjs 零依赖。

---

## 10. 代价

1. **直接单测 builder 与运行时结果不同。** 以字面量调用 builder，值不带类型，编码结果不同。测试应走 command + fake handle（`doc/recipes/test-with-handle.md`）。不提供"给值打类型"的公共 API。
2. **`toEqual` 与日志可见 `[STRUCT]`。** 仅影响 builder 内部拿到的 input 值。
3. **parse 分两条路径**（挂类型 / 不挂），需测试锁定"响应解码不挂"。
4. **query 嵌套检查退回运行时**（见 5.3）。
5. **WS 类型推导重写。** 比现有 `KnownOutgoingSocketUnion` 简单，但属重写。
6. **迁移量集中在文档与测试**：多语言文档及大量 `struct.request(` 用例。

---

## 11. 待定

- **WebSocket 子协议来源收敛（建议，不影响 builder 设计）**：只保留定义层 `protocols`（静态）与 `beforeConnect`（动态），删除 client 级与 execute 级 `protocols`。理由：子协议按端点确定，不存在全 client 通用的默认子协议。

---

## 12. 测试要点

- 第 4.4 节推演表逐行成为回归用例（HTTP 为主，SSE / WS 覆盖 path、query）。
- 展开保留类型；线上名冲突报错；非扁平值报错；`null` 报错；`undefined` 省略。
- 原生 `URLSearchParams` / `Headers` / `BodyInit` 原样透传，不经编码器与序列化器。
- 3.4 body 分流表逐行覆盖（含 `Uint8Array` 等 `BufferSource`、默认 content-type 与 `headers` 覆盖）；codec tag 仅在 body 根生效；`undefined` 字段省略、`null` 发送。
- query：未配置序列化器时数组展开为重复 key、嵌套报错；配置后序列化器收到的是 alias 已生效的线上对象。
- 声明 input 却省略 builder 时类型报错；绕过类型检查则返回 `REQ_BUILD_FAILED`。无 input 的静态定义仍可省略 builder。
- 第 5.6 节用例与 5.7 节两个坑全部落为 type test。
- 响应解码与 `struct.parse` 不挂 `[STRUCT]`。
- 入站 kind 表示法四类；WS `incoming` 断言失败走错误监听器；`outgoing` 经 alias 编码。
- builder 抛错 → `REQ_BUILD_FAILED`，且不从 endpoint 调用处抛出。

---

## 13. 实施顺序

1. struct：删除 `request` / `requestBody` kind，`formData` / `urlencoded` 改为 codec tag，parse 增加挂类型开关。
2. 请求侧：出站编码器 + builder 替换 `build`，删除 `request_builder` 视图机制，endpoint 命名，类型设计与 type test。
3. query：`withQuerySerializer` 新合同，删除 `allowComplex`。
4. 入站侧：kind 表示法，删除 `responseType`，SSE 去包装。
5. WebSocket：`incoming` / `outgoing` 单 struct，删除信封与 normalizer；第 11 节若确认则收敛子协议来源。
6. 文档与多语言同步。

---

## 附录 A：body 场景示例

以下示例为设计推演，尚未经测试验证。注释为线上实际发出的 content-type 与内容。

### A.1 JSON

```ts
const User = struct.object({
  displayName: struct.string().alias('display_name'),
  birthday: struct.date(),
})

// 带类型对象直接交出：alias 生效，Date 转 ISO
builder: (input) => ({ body: input.user })
// application/json  {"display_name":"Ada","birthday":"1815-12-10T00:00:00.000Z"}

// 改造形状：外层匿名，内层带类型
builder: (input) => ({
  body: { members: input.users, invitedBy: input.inviterId, sendEmail: true },
})
// {"members":[{"display_name":"Ada",…}],"invitedBy":7,"sendEmail":true}

// 顶层数组
builder: (input) => ({ body: input.users })
// [{"display_name":"Ada",…},{"display_name":"Bob",…}]

// bigint 字段
builder: (input) => ({ body: { amount: input.amount } }) // amount: 12345678901234567890n
// {"amount":"12345678901234567890"}
```

### A.2 PATCH 与特殊 JSON 媒体类型

```ts
const ProfilePatch = struct.object({
  displayName: struct.string().alias('display_name').optional(), // 不传即不发：不修改
  bio: struct.string().nullable().optional(), // 传 null：清空
})

const patchProfile = defineRequest({
  method: 'PATCH',
  path: '/me',
  input: ProfilePatch,
  builder: (input) => ({
    headers: { 'content-type': 'application/merge-patch+json' },
    body: input,
  }),
})
patchProfile({ bio: null })
// application/merge-patch+json  {"bio":null}
```

### A.3 GraphQL：常量 + 变量

```ts
const QUERY = /* GraphQL */ `
  query User($id: ID!) {
    user(id: $id) {
      display_name
    }
  }
`

const gqlUser = defineRequest({
  method: 'POST',
  path: '/graphql',
  input: struct.object({ variables: struct.object({ id: struct.string() }) }),
  builder: (input) => ({ body: { query: QUERY, operationName: 'User', variables: input.variables } }),
  output: GqlUserResult,
})
```

旧 `build` 禁止注入字面量，无法表达此场景。

### A.4 `application/x-www-form-urlencoded`

```ts
// codec tag：key 由 alias 决定
const login = defineRequest({
  method: 'POST',
  path: '/login',
  input: struct.object({
    form: struct.urlencoded({
      userName: struct.string().alias('username'),
      password: struct.string(),
      remember: struct.boolean().optional(),
    }),
  }),
  builder: (input) => ({ body: input.form }),
})
// username=ada&password=***&remember=true

// 原生：含常量字段，如 OAuth
const token = defineRequest({
  method: 'POST',
  path: '/oauth/token',
  input: struct.object({ clientId: struct.string(), scope: struct.array(struct.string()) }),
  builder: (input) => ({
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: input.clientId,
      scope: input.scope.join(' '),
    }),
  }),
})
```

### A.5 `multipart/form-data`

```ts
// codec tag：字段固定
const upload = defineRequest({
  method: 'POST',
  path: '/files',
  input: struct.object({
    form: struct.formData({
      file: struct.file(),
      title: struct.string().alias('t'),
      tags: struct.array(struct.string()), // 展开为多个同名字段
    }),
  }),
  builder: (input) => ({ body: input.form }),
})
// multipart：file、t、tags、tags；boundary 由平台生成

// 原生：多文件、自定义文件名、动态字段
const uploadMany = defineRequest({
  method: 'POST',
  path: '/albums/:id/photos',
  input: struct.object({ id: struct.string(), photos: struct.array(struct.file()) }),
  builder: (input) => {
    const body = new FormData()
    input.photos.forEach((photo, i) => body.append('photo', photo, `photo-${i}.jpg`))
    return { path: { id: input.id }, body }
  },
})
```

### A.6 文本、XML、CSV

```ts
builder: (input) => ({ body: input.note })
// text/plain;charset=UTF-8  原文

builder: (input) => ({
  headers: { 'content-type': 'application/xml' },
  body: `<order id="${escapeXml(input.id)}"/>`,
})

builder: (input) => ({
  headers: { 'content-type': 'text/csv' },
  body: input.rows.map((row) => row.join(',')).join('\n'),
})
```

### A.7 二进制与流

```ts
// 直传文件，content-type 取 file.type
builder: (input) => ({ path: { key: input.key }, body: input.file })

// protobuf：Uint8Array 属于 BufferSource，原样发送
builder: (input) => ({
  headers: { 'content-type': 'application/x-protobuf' },
  body: OrderMessage.encode(input.order).finish(),
})

// 流式上传大文件；运行时不支持流式请求体时由现有能力探测报错
builder: (input) => ({ body: input.file.stream() })
```

### A.8 同一端点按场景发送不同 body

```ts
const importData = defineRequest({
  method: 'POST',
  path: '/imports',
  input: struct.discriminatedUnion('source', [
    struct.object({ source: struct.literal('json'), records: struct.array(Record) }),
    struct.object({ source: struct.literal('file'), file: struct.file() }),
    struct.object({ source: struct.literal('url'), url: struct.string() }),
  ]),
  builder: (input) => {
    switch (input.source) {
      case 'json':
        return { body: input.records } // application/json
      case 'file':
        return { body: input.file } // 文件原样
      case 'url':
        return { body: new URLSearchParams({ source_url: input.url }) } // 表单
    }
  },
})
```

builder 收到的是真实值，TS 收窄直接可用。

### A.9 不发 body

```ts
defineRequest({ method: 'DELETE', path: '/users/:id', input, builder: (i) => ({ path: { id: i.id } }) })
// 不写 body 即不发送

defineRequest({ method: 'GET', path: '/x', builder: () => ({ body: {} }) })
// ✘ 类型层报错：GET 不允许 body
```

### A.10 离开 struct 编码路径的序列化

```ts
// NDJSON：JSON.stringify 看到的是逻辑名，alias 不生效
builder: (input) => ({
  headers: { 'content-type': 'application/x-ndjson' },
  body: input.events.map((e) => JSON.stringify(e)).join('\n'),
})
```

同理适用于 qs、protobuf 等用户自行完成的序列化。见 3.4 关于 `struct.encode` 的说明。
