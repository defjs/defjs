# Struct

`Struct` 是 Defjs 用来描述协议边界的结构合同：它声明字段、字段的外部 wire name，以及值在边界上的结构解析和基础类型转换。它采用严格的字段存在性规则；Go 中“先定义目标结构体再解码”的做法可以帮助理解类型合同，但 Struct 不会在解析失败时返回零值或部分结果，也不是通用的业务 validation DSL。

Struct 主要回答三个问题：

1. 输入或响应应当有哪些结构字段？
2. 外部字段名如何映射到 TypeScript 属性名？
3. 缺失值、`null`、基础类型转换和结构错误应当如何得到稳定、可中止的结果？

它不回答邮箱是否合法、金额是否为正、用户是否有权限、订单状态能否流转等应用问题。

## 快速开始

从根入口导入 `struct`、`Infer` 和 endpoint API：

```typescript
import { createClient, defineRequest, struct, type Infer, type StructInput, withEndpoint } from '@defjs/core'

const User = struct.object({
  id: struct.number(),
  displayName: struct.string().alias('display_name'),
})

type User = Infer<typeof User>

const getUser = defineRequest({
  method: 'GET',
  path: '/users/:id',
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: User,
})

const client = createClient(withEndpoint('https://api.example.com'))
const [error, user] = await client.execute(getUser({ id: 1 }))
if (error) throw error

console.log(user.id, user.displayName)
```

`Infer<typeof User>` 是解析后的输出类型。`alias('display_name')` 只改变外部协议中的字段名，不把 TypeScript 属性 `displayName` 改成 `display_name`。

Struct 实例本身没有 `.parse()`、`validate`、`parseAsync` 或 `encode` 方法。需要独立解析时使用 facade 上的 `struct.parse(User, input)`；HTTP、SSE、WebSocket endpoint 会在各自边界使用同一份 Struct metadata。出站编码由 builder 交出的带类型值驱动，没有公开的 `struct.encode`。

## 公共构造器

`struct` facade 当前提供以下构造器。这里按用途分组，不对应内部实现的全部 definition kind。

| 用途        | 构造器                                     | 说明                                                                   |
| ----------- | ------------------------------------------ | ---------------------------------------------------------------------- |
| 基础值      | `string`、`number`、`boolean`、`null`      | 字符串、数字、布尔值和显式 `null`                                      |
| 不透明值    | `any`、`unknown`                           | 接受不受 Struct 约束的值；`any` 的输出类型也不提供静态保证             |
| 固定值      | `literal`、`enum`                          | 单个字面量或非空枚举；枚举支持字符串数组和含字符串/数字值的对象        |
| 平台/转换值 | `date`、`bigint`                           | 输入可来自 wire 表示，输出分别是 `Date` 和 `bigint`                    |
| 二进制值    | `blob`、`file`、`arrayBuffer`              | 浏览器平台值                                                           |
| 复合值      | `object`、`array`、`tuple`、`record`       | 对象、列表、固定长度序列和任意 key 的记录                              |
| 组合值      | `or`、`intersection`、`discriminatedUnion` | 普通 union、交集和按 discriminator 路由的 union                        |
| 表单 codec  | `urlencoded`、`formData`                   | 仍是 object struct，只多一个 codec tag；tag 只在该值作为 body 根时生效 |
| 二进制值    | `blob`、`file`、`arrayBuffer`              | 值 Struct。作为 body 根时按字节发送；作为入站声明时选择对应表示        |

普通 object、数组、number、boolean、`null` 作为 body 根时按 JSON 发送。`string` 作为 body 根或入站 `string` struct 时保持原文。`struct.urlencoded(shape)` 与 `struct.formData(shape)` 不是包装 kind。

常见组合示例：

```typescript
const Point = struct.object({
  x: struct.number(),
  y: struct.number(),
})

const UserId = struct.or(struct.string(), struct.number())
const Coordinates = struct.tuple([struct.number(), struct.number()])
const Headers = struct.record(struct.string())
const Combined = struct.intersection(struct.object({ id: struct.string() }), struct.object({ displayName: struct.string() }))
```

## 严格解析与显式零值

`struct.parse(schema, input)` 返回固定的 error-first 二元组：

```typescript
type ParseResult<T> = [error: null, value: T] | [error: StructError, value: undefined]
```

解析失败时第二项固定为 `undefined`，不会构造整个 Struct 的零值，也不会暴露此前已成功解析的兄弟字段。

```typescript
const DailySummary = struct.object({
  orders: struct.number(),
  acceptingOrders: struct.boolean(),
  adjustmentIds: struct.array(struct.string()),
  operatorMessage: struct.string(),
})

const [missingError, missingSummary] = struct.parse(DailySummary, {})
// missingError.issues[0] 指向 orders；missingSummary 是 undefined。

const [error, summary] = struct.parse(DailySummary, {
  orders: 0,
  acceptingOrders: false,
  adjustmentIds: [],
  operatorMessage: '',
})
// error 是 null；0、false、[]、'' 是调用方显式提供的合法值。
```

`date`、`bigint` 以及 JSON codec 仍会做边界转换：例如 `date` 接受 `Date`、字符串或数字并输出 `Date`，`bigint` 接受 `bigint` 或字符串并输出 `bigint`。无效日期或不符合 `bigint` 输入规则的值产生结构错误。

`struct.object(shape)` 只遍历声明的 shape，未知 key 会被丢弃。`array`、`record`、`tuple`、object 和 intersection 都在第一个确定错误处停止；tuple 输入长度必须与声明长度完全一致。解析后的 object 和 record 使用 null prototype；依赖 `Object.prototype` 方法时，应使用 `Object.keys`/`Object.entries`，或显式复制为普通对象。

`intersection` 深合并每个成员的输出：`Object.is` 相等的值以及时间相同的 `Date` 保留该值，普通对象按自有 key 递归合并，等长数组按元素合并，其余冲突记为 `invalid_intersection`，path 指向冲突的 key 或下标。`unknown` 和 `any` 仍会执行，但不向合并结果贡献任何字段；成员全部是 `unknown` / `any` 时，结果就是输入本身。

Node 的 strict deep equality 会比较 prototype，因此 Struct 解析结果不会与字段相同的 object literal 深度相等。测试应显式断言这个边界，或只在断言处做 shallow copy：

```typescript
import assert from 'node:assert/strict'

const [profileError, profile] = struct.parse(struct.object({ name: struct.string() }), { name: 'Ada' })
assert.equal(profileError, null)
assert.equal(Object.getPrototypeOf(profile), null)
assert.deepEqual({ ...profile }, { name: 'Ada' })
```

Spread 只适用于这里的浅层断言；嵌套 Struct object 仍使用 null prototype。不要仅为迎合测试 matcher 而在生产路径增加全局 normalize 或 clone。

## 缺失、`null` 与修饰符

`optional()`、`null()` 和 `nullish()` 会返回带有新 flags 的 Struct，不会改变原 Struct。实际行为取决于 Struct 位于对象字段位置还是作为顶层 value：

| 输入情况                   | 普通 Struct   | 对象字段 `.optional()` | 对象字段 `.null()` | 对象字段 `.nullish()` |
| -------------------------- | ------------- | ---------------------- | ------------------ | --------------------- |
| 字段缺失或值为 `undefined` | `StructError` | 省略 key               | `StructError`      | 省略 key              |
| 显式 `null`                | `StructError` | `StructError`          | 保留 `null`        | 保留 `null`           |
| 存在且类型正确             | 解析后的值    | 解析后的值             | 解析后的值         | 解析后的值            |
| 存在但类型错误             | `StructError` | `StructError`          | `StructError`      | `StructError`         |

具体规则如下：

- `.optional()` 在对象字段位置对缺失或 `undefined` 省略字段；作为顶层 value 的缺失结果是 `undefined`。显式 `null` 仍失败。
- `.null()` 只接受显式 `null`，不会让字段变成 optional；缺失或 `undefined` 仍失败。
- `.nullish()` 同时设置 optional 和 nullable：缺失时省略对象字段，显式 `null` 时保留 `null`；作为顶层 value 时，缺失结果是 `undefined`。
- `.null()` 或 `.nullish()` 不会让任意非 null 值免于类型解析；错误类型仍然失败。

Object input 属性默认必填；只有 `.optional()` 或 `.nullish()` 字段可以省略。启用 `exactOptionalPropertyTypes` 时，推导出的 object input 使用 exact optional property：调用方应省略 optional 或 nullish key，而不是显式赋值 `undefined`。

```typescript
const OptionalProfile = struct.object({
  nickname: struct.string().optional(),
})

type OptionalProfileInput = StructInput<typeof OptionalProfile>

const omitted: OptionalProfileInput = {}
// @ts-expect-error With exactOptionalPropertyTypes, omit optional keys instead.
const explicitUndefined: OptionalProfileInput = { nickname: undefined }
```

运行时面对 unknown input 时仍会防御性地接受 optional/nullish 字段的显式 `undefined`，并从解析结果中省略该 key；这项 normalization 不会放宽静态调用方的 input 类型。

## 结构解析与应用校验

Struct 的“validation”语境指结构边界失败，不是返回布尔值的业务验证器。它会：

- 读取声明的字段并丢弃未知 object key；
- 要求普通字段存在，并按 optional、nullable、nullish 修饰符处理缺失或 `null`；
- 检查基础类型、literal、enum、数组、tuple、record 和对象结构；
- 对 `date`、`bigint` 等支持的 wire/runtime 类型做转换；
- 在第一个结构问题处停止并产生一个 `StructIssue`。

当前 Struct 没有 `.min()`、`.max()`、`.int()`、`.nonempty()`、`.refine()`、`.transform()`、`.default()`、`.strip()`、`.passthrough()`、`.pick()` 或自定义 predicate。以下规则应放在 service、router 或专用 validator 层：

- 字符串非空、邮箱/正则格式和标识符前缀；
- 数字必须为整数、有限值、正数、金额精度或处于某个范围；
- 权限、租户归属、库存上限和不可变字段；
- 跨字段约束，例如结束时间必须晚于开始时间；
- 订单状态流转和安全授权。

Struct 会区分“没有传字段”和“显式传入合法的 `0`、`false`、`''` 或 `[]`”：前者对必填字段失败，后者正常解析。它仍不判断这些显式值是否满足业务规则；业务约束应由 service、router 或专用 validator 负责。

## Alias 与 wire key

`.alias(name)` 只改变 wire key，不改变逻辑字段名或 `Infer`。带类型对象在出站编码、JSON 响应、SSE 事件和 WebSocket 帧上使用同一个 alias。匿名对象的 key 按字面量发送，alias 不参与。

```typescript
import { createClient, defineRequest, struct, withEndpoint, withHTTPHandle } from '@defjs/core'

const UserBody = struct.object({
  id: struct.number().alias('user_id'),
  displayName: struct.string().alias('display_name'),
})

const [logicalError, logicalUser] = struct.parse(UserBody, { id: 1, displayName: 'Ada' })
if (logicalError) throw logicalError

const [wireKeyError] = struct.parse(UserBody, { user_id: 1, display_name: 'Ada' })
if (!wireKeyError) throw new Error('struct.parse must read logical keys')

let requestWireBody: unknown
const echoUser = defineRequest({
  method: 'POST',
  path: '/users',
  input: struct.object({ user: UserBody }),
  builder: (input) => ({ body: input.user }),
  output: UserBody,
})
const client = createClient(
  withEndpoint('https://example.test'),
  withHTTPHandle(async (input, init) => {
    requestWireBody = await new Request(input, init).json()
    return Response.json({ user_id: 1, display_name: 'Ada' })
  }),
)

const [requestError, responseUser] = await client.execute(echoUser({ user: { id: 1, displayName: 'Ada' } }))
if (requestError) throw requestError
```

`logicalUser` 和 `responseUser` 使用 `{ id, displayName }`；`wireKeyError` 指向缺失的逻辑 `id`；`requestWireBody` 则是 `{ user_id, display_name }`。公开 `struct.parse` 读取逻辑值，transport JSON 编解码才会应用 wire alias。

| 概念              | 示例                      | 结果                                                |
| ----------------- | ------------------------- | --------------------------------------------------- |
| TypeScript 属性名 | `displayName`             | 调用方和解析后对象使用 `displayName`                |
| wire key          | `display_name`            | JSON/query/path/headers/表单编码使用 `display_name` |
| 解析后的值        | `{ displayName: 'Ada' }`  | 不会变成 `{ display_name: 'Ada' }`                  |
| 编码后的值        | `{ display_name: 'Ada' }` | 发到协议边界的 key                                  |

同一 object shape 内的 wire key 必须唯一；两个字段不能通过 alias 解析成同一个外部 key。path、query、headers、body 是不同对象，所以彼此可以重用同一个 wire key。

builder 拿到的是解析后的真实值，对象节点带有产生它的 struct。把带类型的值交出去，alias 会生效；在匿名对象里手写 key，则 key 就是线上名：

```typescript
builder: (input) => ({ body: { name: input.user.displayName } })
```

这里的 `name` 不会再套用 `display_name`。`body: input.user` 才会按 `UserBody` 的 alias 编码。展开 `{ ...input.user, role: 'admin' }` 仍保留类型；同时写入逻辑名和它的 wire key 会在执行时成为 `REQ_BUILD_FAILED`。

## Union 与 discriminated union

### 普通 union

`struct.or(a, b, ...)` 按声明顺序尝试 option，第一条成功的分支胜出：

```typescript
const Identifier = struct.or(struct.string(), struct.number())
type Identifier = Infer<typeof Identifier> // string | number
```

顺序是合同的一部分。重叠分支会让前面的分支吸收后面的分支；`struct.any()` 或 `struct.unknown()` 这类宽泛分支也可能让后续分支永远没有机会。每个 option 内部都 fail-fast；第一个成功 option 立即返回。所有 option 都失败时只产生一个外层 `invalid_union` issue，不聚合候选分支的错误。

解析失败的 issue code 是 `custom`、`invalid_enum`、`invalid_intersection`、`invalid_literal`、`invalid_type`、`invalid_union`、`missing_key`。`format()`、`flatten()` 和 `prettify()` 按 path 与 message 呈现这些 code。

### 判别联合

对象事件等需要稳定路由时，优先使用 `discriminatedUnion`：

```typescript
const Event = struct.discriminatedUnion('type', [
  struct.object({
    type: struct.literal('parcel_packed'),
    orderId: struct.string(),
    parcels: struct.number(),
  }),
  struct.object({
    type: struct.literal('delivery_delayed'),
    orderId: struct.string(),
    reason: struct.string(),
  }),
])

type Event = Infer<typeof Event>

function summarize(event: Event): string {
  if (event.type === 'parcel_packed') return `${event.parcels} parcels packed`
  return `${event.orderId} delayed: ${event.reason}`
}
```

每个 option 必须是 object Struct，必须含同名 discriminator 字段，且该字段必须是 required `struct.literal(...)`；除纯 `literal(null)` 外，不能用 modifier 扩大 discriminator 的取值。discriminator value 必须唯一。这些是定义时约束，违反时抛 `TypeError`。解析时：

- 已知 discriminator 只路由到对应 option，再解析该分支；不会在其他 option 之间回退。
- 缺失或未知 discriminator 无法路由，会产生 `StructError`，issue path 指向 discriminator。
- 已选分支的字段错误会保留该字段路径。
- JSON codec 支持 discriminator 字段的 alias；按 option 声明顺序读取第一个实际存在的 wire discriminator，选中分支后不再访问其他 option 的 alias。

## 请求放置

path、query、headers、body 由 endpoint 的 `builder` 返回，不是一种 struct kind。input 本身已经是这个形状时可以省略 `builder`，等价于 `(input) => input`。字段是否必填只看它自己的 `.optional()` / `.nullish()`，没有“整段 section 可省略”的特判。

```typescript
const UpdateInput = struct.object({
  path: struct.object({
    userId: struct.number().alias('id'),
  }),
  query: struct.object({
    includeProfile: struct.boolean().optional().alias('include_profile'),
  }),
  headers: struct.object({
    traceId: struct.string().alias('x-trace-id'),
  }),
  body: struct.object({
    name: struct.string().alias('display_name'),
  }),
})

const updateUser = defineRequest({
  method: 'PATCH',
  path: '/users/:id',
  input: UpdateInput,
})

updateUser({
  path: { userId: 1 },
  query: { includeProfile: true },
  headers: { traceId: 'trace-1' },
  body: { name: 'Miao' },
})
```

`path` 和 `headers` 编码后必须是扁平标量。未配置 query 序列化器时，`query` 也必须是扁平标量：数组展开为重复 key，嵌套对象报 `REQ_BUILD_FAILED`。配置 `withQuerySerializer` 后 `query` 可以嵌套，序列化器收到的是 alias 已生效的线上对象（`Date` 为 ISO，`bigint` 为字符串）。`urlencoded` 和 `formData` 的 codec tag 只在该对象作为 body 根时把字段编成表单；嵌进别的对象里就按普通 JSON 字段编码。HTTP 和 SSE 可以有 body；`GET` / `HEAD` 在类型上禁止 body。WebSocket 的 builder 不能返回 headers 或 body。

Path placeholder 应传入原始 scalar；Core 对每个值恰好执行一次 `encodeURIComponent`。调用方不要预编码，否则 `%` 会再次编码为 `%25`。

builder 不负责应用层校验，也不改变 transport 的生命周期。校验失败仍是 `REQ_INPUT_INVALID`；builder 抛错或线上名冲突是 `REQ_BUILD_FAILED`，且不会从 endpoint 调用处抛出。

## StructError 与解析失败

定义时传入错误的构造参数，例如非法的 discriminated union option，会抛 `TypeError`。对一个已经定义的 Struct 解析错误类型值，则产生 `StructError`，其中每个 `StructIssue` 包含 `code`、`expected`、`message`、`path` 和 `received`。

公共 `struct.parse` 使用以下结果形状：

```text
成功: [null, parsedValue]
失败: [StructError, undefined]
```

对象、数组、record、tuple 等在第一个错误处停止；不会把部分成功 output 暴露给调用方。为了兼容错误展示 API，`StructError.issues` 仍是数组，但正常解析失败只包含当前第一个 issue。内部 `parseStructValue` 是 throwing adapter；应用应使用根入口的 `struct.parse`，不要依赖 `./introspection` 等内部路径。

在 endpoint runtime 中，Struct 错误会由对应 transport 再包装。例如 HTTP 输入结构失败成为 `REQ_INPUT_INVALID`，响应体不合声明成为 `RES_STRUCT_MISMATCH`。分流条件见下面的 HTTP 矩阵；这一步属于 endpoint 层，不属于 Struct 本身。

```typescript
import { StructError } from '@defjs/core'

const [error, result] = await client.execute(command)

if (error?.code === 'RES_STRUCT_MISMATCH') {
  if (error.cause instanceof StructError) {
    console.error(error.cause.flatten())
    console.error(error.cause.prettify())
  }
}
```

`StructError` 还提供 `issues`、`format()`、`flatten()` 和 `prettify()`。`struct.parse(s, v, { errorMap })` 只在这一次 parse 里改写 issue message。`received`、message 和完整 cause 可能包含输入或响应 payload，不应在没有脱敏策略时写入日志。

### Struct 不提供 HTTP tuple

`[err, data, response]`、HTTP status、`HTTP_STATUS`、`DecodedResponse` 以及 fault 的 `data` 都是 endpoint/transport 层的合同。Struct 本身没有 status、response 或 HTTP tuple。

`ok` 是唯一的分流点：2xx 用 `output` 解码，其余用 `error` 解码，永不两者都试。省略某一侧意味着那个 body 根本不读。表示法由 struct kind 决定：`string` 是原文，`blob` / `file` 是 Blob，`arrayBuffer` 是字节，其余是 JSON。两侧都不声明时，底层会取消响应 body。没有 `responseType` 选项。

解码只发生一次，且在拦截器链之后——拦截器用 `makeResponse(...)` 短路返回的响应，和线上真实响应走同一条解码路径。

| HTTP 分支                               | 条件                                           | 当前包装                                                                              |
| --------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| 该侧未声明                              | 对应的 `output` 或 `error` 缺失，body 从不读取 | 2xx 是 success，`data` 为 `undefined`；非 2xx 是 `HTTP_STATUS`，`data` 为 `undefined` |
| media type 与声明的 representation 不符 | 在读取 body **之前**判定                       | `RES_MEDIA_TYPE_INVALID`；不读、不解析、不进 Struct                                   |
| representation 读不出来                 | 按 effective mode 解释字节失败                 | `RES_DECODE_FAILED`；无 body                                                          |
| Struct 校验失败                         | runtime 判定该值不被 Struct 接受               | `RES_STRUCT_MISMATCH`；无 body、无 `data`                                             |
| 2xx 且解码成功                          | representation 与 Struct 都成功                | success；`data` 与 `response.body` 都是 parsed value                                  |
| 非 2xx 且解码成功                       | representation 与 Struct 都成功                | `HTTP_STATUS`；typed parsed value 在 `err.data`                                       |

哲学第 5 条有一个容易忽略的推论：**未声明那一侧的 body 连「读失败」都不关心**。只声明 `output` 的 endpoint 遇到 500 且 body 是坏 JSON 时，结果是 `HTTP_STATUS` + `status: 500`，不是一个表示层错误。

解码失败不留 body：`RES_*` fault 的 `response` 是 `HttpMeta`，类型上就没有 `body` 字段。出错细节在 `cause`（Struct 不匹配时是 `StructError`）。传输失败是 fault 而不是响应，所以不存在代表传输失败的 status-0 响应。

HTTP 的详细结果和 response 可用性请看 [HTTP 文档](../../../../doc/core/http.md) 与 [错误文档](../../../../doc/core/errors.md)，不要把 endpoint tuple 语义反推成 Struct API。

## 现有实践与源码索引

以下源码与当前 public API 对齐，可作为实际用法参考：

- [`index.ts`](./index.ts) 与 [`facade.ts`](./facade.ts)：公共导出和 `struct` 构造器。
- [`parse.ts`](./parse.ts) 与 [`introspection.ts`](./introspection.ts)：严格 Struct 解析和内部 adapter 实现。
- [`errors.ts`](./errors.ts)：`StructError`、issue message 和错误视图。
- [`doc/core/struct.md`](../../../../doc/core/struct.md)：面向使用者的 Struct 文档。
- [`doc/core/commands.md`](../../../../doc/core/commands.md)：request input、默认构建和 transport 约束。

历史文档或研究材料中若出现 `tag.*`、`RuntimeStruct`、`TypeOf`、`InputOf` 或直接导入 `codec`/`introspection` 的示例，不代表当前 `@defjs/core` 公共 API；应以当前根入口导出、类型测试和上述源码为准。
