# Design note: `builder` replaces `build`, and `struct.request` is removed

Status: historical design record from 2026-09-28; the current API contract is [packages/core/design.md](packages/core/design.md).
Date: 2026-09-28 (revised 2026-09-29: type design, query encoding, ownership of `protocols`, the role of alias, body dispatch rules and Appendix A, and the 4.3 layer-by-layer guidance)
Scope: the endpoint definition layer of `@defjs/core` (`defineRequest` / `defineEventStream` / `defineWebSocket`) and the request-related parts of `struct`. A design for the development period; no compatibility layer is kept.

---

## 1. Problem

### 1.1 `build(request, input)` is a symbolic DSL disguised as a JS function

- `input` is not a value, but a bound view produced by `createBoundView` (`internal/request_builder.ts:463`). Calls such as `request.setJson(...)` are first recorded as a `BuildPlan` (`:361`), then replayed by `materializeBuildPlan` (`:405`) against the real input.
- Consequences (explicit limits at `doc/guide/design-decisions.md:137`):
  - Cannot branch on values: `if (input.draft)` is always a truthy view.
  - Cannot inject literals: `setHeaders({ 'x-api-version': '2' })` throws `binding values must come from build input` at runtime.
  - Cannot use template strings, `??`, `.filter`, or `String(x)`.
  - Types are distorted: the type of `input.q` is `BuildBoundRef`, not `string`.
- Thirteen `setXxx` / `addXxx` methods and the add/set semantics are just reinventing "assembling an object".

### 1.2 The original rationale does not exist in the implementation

The historical contract (`6cd5ec7:packages/core/research/defjs-build-options.md`) says "run `build` once at definition time, store the `BuildPlan`; at request time only materialize". In reality `buildRequest` is called on every execute (`http.ts:274` → `transport_request.ts:39` → `request_builder.ts:176-180`), and each time it creates a new owner symbol, Proxy tree, and plan, then replays them. The plan is never cached, and no consumer reads it. Only the cost remains.

### 1.3 The only real benefit of the view mechanism

Remember "which struct a value came from", and encode according to that struct: alias rewrites the wire key, `Date` becomes ISO, `bigint` becomes a string. This design keeps that benefit and replaces the implementation.

### 1.4 `struct.request` sits on the wrong layer

- It describes the wire shape of an endpoint, not a data type, yet it occupies two Struct kinds, `request` and `requestBody`, and creates about 50 special cases across `parse`, `encode`, `match`, `guards`, `utils`, `constructors`, and `types`; WebSocket must also assert at runtime that "headers/body are not allowed".
- The input struct only describes call arguments; request placement is done by an explicit `builder`, and no extra Struct kind is needed.

---

## 2. Principles

1. **A struct is a Go struct.** Types plus tags, both directions: inbound decoding (`output` / `error` / events / messages) and outbound encoding (`input`). `.alias(name)` is `json:"name"`.
2. **The struct decides how a value is encoded; the builder decides where a value is placed.**
3. **A value carries its own struct.** Objects that come from input carry their struct, and encoding is driven by the struct; objects newly written in the builder are anonymous, and what you see is what you get.
4. **Native types are first-class.** `URLSearchParams`, `Headers`, and `BodyInit` returned by the builder are used as-is and are not re-encoded.
5. **Failures must be loud.** Conflicts, non-flat values, and illegal scalars all become `REQ_BUILD_FAILED`; nothing is silently overwritten or dropped.

---

## 3. API

### 3.1 Definition fields

| Field       | Description                                                                                                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `input`     | Optional. A struct that validates and parses caller arguments (keeps `REQ_INPUT_INVALID`).                                                                                              |
| `builder`   | Required when `input` is declared, otherwise optional. `(input: BuilderInput<TInput>) => …`, synchronous and pure, lazily executed at execute time; a throw becomes `REQ_BUILD_FAILED`. |
| `protocols` | WebSocket only, optional. A static subprotocol list that belongs to the endpoint contract (for example `graphql-transport-ws`) and does not enter the builder.                          |

- The builder has only one argument: **the real parsed value**. There is no ctx and no setter.
- The return value is the request itself; no new concept such as "parts" is introduced. The return type is used only for contextual inference of object literals; the user does not need to write its name.
- Whenever `input` is declared, `builder` must be provided explicitly. `input` only defines the arguments; where each value is placed is decided only by the builder; field names of input have no placement meaning. Only a definition without `input` may omit `builder`, or use `() => ({ headers: … })` to construct a static request.

### 3.2 Builder return shape

| Field     | HTTP | SSE | WebSocket | Rule                                                                                                                                    |
| --------- | ---- | --- | --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `path`    | ✔    | ✔   | ✔         | After encoding it must be a flat record of scalars; values fill `:name`, reusing `fillUrl` encoding and dot-segment checks              |
| `query`   | ✔    | ✔   | ✔         | `URLSearchParams` is used as-is; a plain object or a typed object is encoded and then handed to query serialization (3.3)               |
| `headers` | ✔    | ✔   | ✘         | `HeadersInit` (including `Headers`) is used as-is; a plain object or a typed object must be flat after encoding; `undefined` is omitted |
| `body`    | ✔    | ✔   | ✘         | See 3.4; `GET` / `HEAD` do not allow a body (forbidden at the type layer)                                                               |

Scalars: `string`, `number`, `bigint`, `boolean`, and `Date` (encoded by the leaf rules). `null` in `path` / `query` / `headers` reports `REQ_BUILD_FAILED`; a nested object in `path` / `headers` reports `REQ_BUILD_FAILED`.

### 3.3 Query encoding

Nested query conventions (`a[b]=1`, `a.b=1`, `a=1,2`, and so on) are a **global convention of the backend API**. They belong neither to the endpoint nor to the value. In defjs, "one backend" corresponds to a client, so the hook lives on the client:

```ts
createClient(
  withEndpoint("https://api.example.com"),
  withQuerySerializer((query) => qs.stringify(query)),
);
```

- The `query` argument is the **encoded wire object**: aliases have taken effect, `Date` has become ISO, `bigint` has become a string. It is a plain object and may be nested. The serializer sees wire keys, so alias does not break.
- The return value is a string and is used as-is as the query string.
- When not configured: native `URLSearchParams`, arrays expand to repeated keys, and a nested object reports `REQ_BUILD_FAILED` (with a hint that a serializer must be configured).
- When the builder returns `URLSearchParams` directly, it is used as-is and the serializer is skipped.
- defjs neither implements nor depends on qs.

Difference from the current state: the existing `withQueryParamsSerializer((params, rawParams) => string)` receives the raw values before encoding, so handing them to qs loses aliases; the contract changes to receive only the encoded wire object, and the name becomes `withQuerySerializer`. The `allowComplex` branch is deleted.

### 3.4 Body representation

Dispatch in the following order; the first match wins:

| `body` returned by the builder                                                                | How it is sent                                                                                                    | Default content-type                                                                               |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `undefined` / omitted                                                                         | Do not send a body                                                                                                | —                                                                                                  |
| A typed object with a `urlencoded` / `formData` codec tag (**only when it is the body root**) | Encoded as `URLSearchParams` / `FormData`, keys use wire names, arrays expand to repeated fields of the same name | The form type / a boundary generated by the platform; `formData` clears an existing `Content-Type` |
| `FormData`, `URLSearchParams`                                                                 | As-is                                                                                                             | Same as above; `FormData` clears an existing `Content-Type`                                        |
| `Blob` / `File`                                                                               | As-is                                                                                                             | `blob.type`, or `application/octet-stream` when empty                                              |
| `BufferSource` (`ArrayBuffer`, TypedArray such as `Uint8Array`, `DataView`)                   | As-is                                                                                                             | `application/octet-stream`                                                                         |
| `ReadableStream`                                                                              | As-is, sent as a stream (transport already sets `duplex: 'half'` and probes runtime capability)                   | `application/octet-stream`                                                                         |
| `string`                                                                                      | As-is                                                                                                             | `text/plain;charset=UTF-8`                                                                         |
| Anything else (object, array, number, boolean, `null`)                                        | `JSON.stringify` after encoding per section 4                                                                     | `application/json`                                                                                 |

- The default content-type matches the existing `resolveHttpBodyContentType` (`http/transport/body.ts`); the `BufferSource` branch must be extended from the existing `ArrayBuffer` check.
- Overriding the content-type: declare `content-type` in `headers`, but a native `FormData` and an object whose root carries a `formData` tag clear it so the runtime can generate the multipart boundary.
- **A codec tag takes effect only at the body root.** `body: { meta: input.form }` is sent as JSON, and the fields of `form` are encoded as ordinary JSON fields.
- **A string is sent as raw text by default.** To send a JSON string (such as `"abc"`), call `JSON.stringify(s)` yourself and declare `application/json`.
- **`undefined` and `null` have separate meanings.** An `undefined` field is omitted; a `nullable` field passed as `null` sends `null`. A body that is itself `undefined` means there is no body.
- **Serializing it yourself leaves the struct encoding path.** Serialization the user performs, such as `JSON.stringify`, qs, or protobuf, sees logical names, and alias does not take effect. If this need grows, a `struct.encode(S, value)` symmetric with `struct.parse` (corresponding to Go's `json.Marshal`) can be provided; it is not added now.
- Examples of each case are in Appendix A.

### 3.5 Examples

```ts
const health = defineRequest({ method: "GET", path: "/health" });
health();

const getUser = defineRequest({
  method: "GET",
  path: "/users/:user_id",
  input: struct.object({ userId: struct.number().alias("user_id") }),
  builder: (input) => ({ path: input }),
  output: User,
});
getUser({ userId: 7 });

// Main path: hand over the typed value; the wire name is decided by alias
const SearchFilter = struct.object({
  keyword: struct.string(),
  pageSize: struct.number().alias("page_size"),
});
const Trace = struct.object({ traceId: struct.string().alias("x-trace-id") });

const search = defineRequest({
  method: "GET",
  path: "/orgs/:org_id/users",
  input: struct.object({
    orgId: struct.number(),
    filter: SearchFilter,
    trace: Trace,
  }),
  builder: (input) => ({
    path: { org_id: input.orgId },
    query: input.filter,
    headers: input.trace,
  }),
  output: struct.array(User),
});

const NewUser = struct.object({
  displayName: struct.string().alias("display_name"),
  email: struct.string(),
});

const createBatch = defineRequest({
  method: "POST",
  path: "/accounts/:account_id/users",
  input: struct.object({
    accountId: struct.number(),
    draft: struct.boolean().optional(),
    users: struct.array(NewUser),
  }),
  builder: (input) => ({
    path: { account_id: input.accountId },
    query: { draft: input.draft ? 1 : undefined },
    headers: { "x-api-version": "2" },
    body: { users: input.users },
  }),
  output: struct.object({ accepted: struct.number() }),
});

// Native types are used as-is
const tagSearch = defineRequest({
  method: "GET",
  path: "/items",
  input: struct.object({ tags: struct.array(struct.string()) }),
  builder: (input) => {
    const query = new URLSearchParams();
    for (const tag of input.tags) query.append("tag", tag);
    return { query };
  },
});

const upload = defineRequest({
  method: "POST",
  path: "/files/:id",
  input: struct.object({
    id: struct.string(),
    form: struct.formData({
      file: struct.file(),
      title: struct.string().alias("t"),
    }),
  }),
  builder: (input) => ({ path: { id: input.id }, body: input.form }),
});

// input only declares call arguments; the builder explicitly decides where they are sent
const updateUser = defineRequest({
  method: "PATCH",
  path: "/users/:id",
  input: struct.object({
    id: struct.number(),
    user: struct.object({ displayName: struct.string().alias("display_name") }),
  }),
  builder: (input) => ({ path: { id: input.id }, body: input.user }),
});

const feed = defineEventStream({
  path: "/rooms/:room/events",
  input: struct.object({
    room: struct.string(),
    since: struct.string().optional(),
  }),
  builder: (input) => ({
    path: { room: input.room },
    query: { since: input.since },
  }),
  events: {
    message: struct.object({ text: struct.string() }),
    ping: struct.string(),
  },
  maxBufferSize: 1 << 20,
  maxQueueSize: 64,
});

const chat = defineWebSocket({
  path: "/ws/rooms/:room",
  protocols: ["chat.v1"],
  input: struct.object({ room: struct.string() }),
  builder: (input) => ({ path: input }),
  incoming: struct.discriminatedUnion("type", [
    struct.object({ type: struct.literal("said"), text: struct.string() }),
    struct.object({ type: struct.literal("pong") }),
  ]),
  outgoing: struct.discriminatedUnion("type", [
    struct.object({ type: struct.literal("say"), text: struct.string() }),
    struct.object({ type: struct.literal("ping") }),
  ]),
  maxIncomingQueueSize: 64,
});
```

---

## 4. Alias mapping

### 4.1 Alias belongs to the field relationship, not to the value

Same as Go: the tag is written on the struct field. `.alias` is recorded on the field struct, and the parent object obtains `wireKey` through `resolveStructFields` when encoding. Whether a key is rewritten depends on whether its parent object is typed.

### 4.2 How the type follows the value

- When `parseEndpointInput` parses input, it defines an **enumerable symbol property** `[STRUCT]` on every object node it produces, whose value is that node's struct.
  - union: take the struct of the option that matched. intersection: take the conjunction of the tags of each side that participated in the merge (see 4.3).
  - record nodes are tagged as well (revised 2026-09-30). A record's keys are themselves data: when encoding, keys are used as-is and values are encoded by the record's value struct. Array nodes are not tagged; each element carries its own tag. `null` / `undefined` are not tagged.
  - Response decoding and the public `struct.parse` do not attach it, so the hot path has zero cost.
- Reasons for choosing an enumerable symbol rather than a WeakMap (measured with vitest):
  - Spread `{ ...x }` and `Object.assign` copy it, so the type is not lost after spreading, which removes the trap of "a logical name silently going on the wire".
  - `JSON.stringify` and `Object.keys` cannot see it, so it does not pollute wire data or ordinary code.
  - Cost: vitest `toEqual` compares it, and `console.log` shows it. The type becomes a visible part of the value rather than hidden state in a side table.

### 4.3 Encoding rules

The outbound encoder walks the builder return value once (native `URLSearchParams` / `Headers` / `BodyInit` do not enter the encoder):

| Value            | Rule                                                                                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typed object     | Struct fields use `alias ?? key` as the wire name, and values are encoded recursively by the field struct; non-field keys are kept as literals; a wire-name conflict reports `REQ_BUILD_FAILED` |
| Anonymous object | Keys are literals, values are recursive                                                                                                                                                         |
| Array            | Recurse item by item                                                                                                                                                                            |
| Leaf             | `Date` → ISO string, `bigint` → string, everything else as-is                                                                                                                                   |

Existing behavior is kept: an optional field that is `undefined` is omitted; a discriminator's alias goes through `discriminatorWireKeys`; a duplicate field wireKey errors when the struct is created (`struct/fields.ts:41`). Builder output is not revalidated; types are guaranteed by TS.

**Layer-by-layer guidance (settled during implementation, 2026-09-29).** The table above applies at every layer, not only at the root. Each node decides how to encode by the following priority:

1. The value's own `[STRUCT]` tag (an object struct).
2. Otherwise, the struct the parent typed object declared for that field (the guide struct): an object is used directly; array / tuple / record continue guiding by their item / position / value struct; a union / discriminated union takes the branch that can match the value.
3. Otherwise (there is no guide, or the guide is `unknown` / `any`), treat it as an anonymous object: keys are literals, and child nodes are still encoded by their own tags.

Therefore the same newly written child object can produce different results under an anonymous root and under a typed root:

```ts
body: { row: { id: '42' } }              // anonymous root: emits id
body: { ...input, row: { id: '42' } }    // typed root, and the row field declared an alias: emits wire_id
```

Under union guidance, if several branches can all match, each branch is actually encoded by the rules above and the results are compared: if they agree, that result is used (for example an empty array); if they differ, `REQ_BUILD_FAILED` is reported, and a branch is never picked silently. When a mixed intersection (one that contains a non-object part) is parsed, the conjunction of the tags of each matched part is used as the tag; a mixed intersection value that was not parsed and was newly written is treated as an anonymous object.

**Intersection merge semantics (aligned with zod `mergeValues` / valibot `_merge`, 2026-09-29).**

- Parsing: every member runs, and any failure fails the whole parse; the outputs of the members are then deep-merged: values equal by `Object.is` (or `Date`s of the same instant) take that value; two plain objects take the union of keys, and keys of the same name are merged recursively; arrays of equal length are merged item by item; everything else is a conflict and reports issue `invalid_intersection`, with path pointing at the conflict. It does not throw, and it does not silently take one side.
- `unknown()` / `any()` are identity elements of intersection (`T & unknown = T`): they still run, but they do not participate in the merge; when every member is an identity element, the input itself is returned.
- Encoding: non-identity members are encoded separately, and the wire results are merged by the same rules; a conflict throws, which appears outbound as `REQ_BUILD_FAILED`.
- **There is no concept of an "alias conflict" (second revision on 2026-09-29, replacing the earlier construction-time check and use-time check).** Members are independent of each other, which is exactly the semantics of zod / valibot: one member maps the logical key `name` to `a_name`, another maps it to `b_name`, so when parsing each member reads its own wire name (both must be present, and the logical values are then merged by the deep-merge rules), and when encoding both wire names are emitted. This naturally agrees with the result of "encode each member, then merge", so no extra detection step is needed, and no separate alias walker is needed either.
  - The only conflict comes from the data itself: the same wire key was written with unequal values. Encoding throws (appearing outbound as `REQ_BUILD_FAILED`), and parsing reports `invalid_intersection`.
- Guide set: the outbound encoder's guide is generalized from "a single struct" to "a conjunction of structs"; a single struct is a set with one element. On each node it implements "encode each member, then merge":
  - Object node: declared keys are the union of what each member declares, and a record member is treated as declaring every key on that node. For each declared key, group by the wire name each member gives: each group's child guide is the field struct or the record's value struct of the members in that group, the child value is encoded per group, and the result is written under that group's wire name (when every wire name is the same there is only one group, which is equivalent to "the child value is encoded only once"). This agrees strictly with the "encode each member, then merge" result of `encode.ts`. A key declared by no member is kept as a literal (this is the only difference outbound encoding is allowed to have relative to `encode.ts`). A value conflict on a wire key is an error.
  - Array / tuple: a child node's guide is each member's item / the struct at the corresponding position.
  - Union guide: resolved by the union rules (every matching branch is encoded and then compared, and a difference is an error); it does not become "take the first" just because it appears inside a set.
  - A `[STRUCT]` tag the child node carries itself takes priority over the guide passed down from the parent, but the source of the tag must be distinguished first:
    - When the tag's members intersect the parent guide (a union is first resolved to a concrete branch by the value), the tag came from the same parse, and only the intersection is used. That way, when encoding grouped by wire name, the subtree does not bring in the wire names of other groups.
    - When the tag's members do not intersect the parent guide, it is a replacement value parsed separately, and the whole subtree uses only its own tag.
  - `null` / `undefined` leaves are handled as usual: `undefined` on an optional field is omitted, and a nullable `null` is emitted as-is.
- Parse tags: a parse that has tagging enabled tags **every object node**, and record nodes are no exception (a value of `null` / `undefined` is not tagged). The tag is decided by the struct that actually finished the parse; a union takes the branch that actually matched. An intersection merges the tags of both sides synchronously at **every recursive layer** of the deep merge, producing a conjunction, so tags do not need to be attached again after the merge. Therefore any child value the builder takes out of the merged result (such as `input.profile`) can independently get the correct wire name.

### 4.4 Walkthrough

```ts
const Profile = struct.object({
  displayName: struct.string().alias("display_name"),
  birthday: struct.date(),
});
input: struct.object({
  userId: struct.number().alias("user_id"),
  profile: Profile,
});
// call: { userId: 7, profile: { displayName: 'Ada', birthday: new Date('1815-12-10') } }
```

| Builder expression                               | Wire result                                                    | Reason                                                        |
| ------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------- |
| `path: { user_id: input.userId }`                | `user_id=7`                                                    | Anonymous object                                              |
| `path: input`                                    | `REQ_BUILD_FAILED` (the type layer also errors)                | `profile` is not flat                                         |
| `body: input.profile`                            | `{"display_name":"Ada","birthday":"1815-12-10T00:00:00.000Z"}` | Typed                                                         |
| `body: { profile: input.profile }`               | `{"profile":{"display_name":"Ada",…}}`                         | Outer layer anonymous, inner layer typed                      |
| `body: { ...input.profile, role: 'admin' }`      | `{"display_name":"Ada","birthday":"…","role":"admin"}`         | Spread keeps the type; the extra key is a literal             |
| `body: { ...input.profile, displayName: 'Bob' }` | `{"display_name":"Bob",…}`                                     | Overrides the field; alias still takes effect                 |
| `body: { ...input.profile, display_name: 'x' }`  | `REQ_BUILD_FAILED`                                             | Wire-name conflict                                            |
| `body: { name: input.profile.displayName }`      | `{"name":"Ada"}`                                               | The parent object is anonymous, so alias does not participate |

### 4.5 The role of alias

The point of alias is: **the wire name is declared once on the type, and it takes effect automatically at every place that references that type, in both directions**. A handwritten key is an escape hatch for exceptions, not the main path.

| Case                                  | Example                                                                                                         |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Response decoding                     | Every `output` / `error` / event / incoming, `display_name` → `displayName`                                     |
| Nested body                           | `body: input.order`; the order-line array and the address object, the whole tree, are rewritten automatically   |
| query / headers handed a typed object | `query: input.filter` (`pageSize` → `page_size`), `headers: input.trace` (`traceId` → `x-trace-id`)             |
| Explicit request placement            | `builder: (input) => ({ path: { id: input.id }, body: input.user })`                                            |
| WS outgoing                           | `session.send(msg)` is encoded through the struct                                                               |
| The same struct reused                | `User` is both the body of `createUser` and the output of `getUser`; the wire name is written in only one place |

Design constraint: docs and examples must write "hand over the typed value" as the default path (`search` in 3.5). If users generally handwrite keys, the design has failed.

---

## 5. Type design

The types below were verified under `tsc 7.0.2` with a simulated struct prototype (17 cases, including `@ts-expect-error` negative cases, exit code 0). During implementation, `BuilderInput` must be completed for the union / intersection / nullable branches of the real struct types.

### 5.1 Signature

```ts
declare function defineRequest<
  const M extends string,
  const P extends string,
  TInput extends AnyStruct | undefined = undefined,
  TOutput extends AnyStruct | undefined = undefined,
  TError extends AnyStruct | undefined = undefined,
>(
  definition: {
    method: M;
    path: P;
    input?: TInput;
    output?: TOutput;
    error?: TError;
    operation?: string;
  } & BuilderField<NoInfer<TInput>, HttpRequestShape<NoInfer<P>, NoInfer<M>>>,
): RequestEndpoint<TInput, TOutput, TError>;
```

- `const M` / `const P`: method and path are inferred as literals, for path-parameter checks and for forbidding a body on GET/HEAD.
- `NoInfer`: the builder only consumes types already inferred and does not participate in inference. The order is fixed: `input` → TInput, `path` → P, and only then is a contextual type provided to the builder.
- The SSE signature is the same as HTTP (method defaults to `GET`); WebSocket has no `M`, and the return shape is `WebSocketRequestShape<P>`.

### 5.2 `BuilderInput`

```ts
type Typed = { readonly [STRUCT]: AnyStruct };

type BuilderInput<S> =
  S extends ObjectStruct<infer Shape>
    ? { [K in keyof Shape]: BuilderInput<Shape[K]> } & Typed
    : S extends ArrayStruct<infer Item>
      ? BuilderInput<Item>[]
      : S extends OptionalStruct<infer X>
        ? BuilderInput<X> | undefined
        : Infer<S>;
```

- It corresponds one-to-one with the runtime: an object node carries `[STRUCT]`, which on the type is `& Typed`.
- A TS spread type keeps the unique symbol property, so `{ ...input.profile, role }` is still `Typed` on the type, matching the runtime (verified on the prototype).

### 5.3 Scalars, path, and return shape

```ts
type Scalar = string | number | bigint | boolean | Date;
type FlatValue = Scalar | readonly Scalar[] | undefined;
type FlatRecord = { readonly [key: string]: FlatValue };
type QueryValue =
  | Scalar
  | readonly QueryValue[]
  | { readonly [key: string]: QueryValue }
  | undefined;
type QueryRecord = { readonly [key: string]: QueryValue };

type PathParams<P> = P extends `${string}:${infer Name}/${infer Rest}`
  ? Name | PathParams<`/${Rest}`>
  : P extends `${string}:${infer Name}`
    ? Name
    : never;

type PathValue<P> = [PathParams<P>] extends [never]
  ? never
  : // anonymous: keys must match the template exactly
    | ({ readonly [K in PathParams<P>]: Scalar } & {
        readonly [STRUCT]?: never;
      })
    // typed: every field must be a scalar (alias is not at the type layer; keys fall back to the runtime Missing path param)
    | (Typed & { readonly [key: string]: Scalar });

type HttpRequestShape<P, M> = {
  path?: PathValue<P>;
  query?: URLSearchParams | QueryRecord;
  headers?: HeadersInit | FlatRecord;
  body?: Uppercase<M> extends "GET" | "HEAD" ? never : BodyValue;
};

type WebSocketRequestShape<P> = {
  path?: PathValue<P>;
  query?: URLSearchParams | QueryRecord;
  headers?: never;
  body?: never;
};
```

- `query` allows nesting: a definition is independent of the client, so the type layer cannot know whether a serializer was configured, and "nesting needs a serializer" falls back to runtime. `path` / `headers` keep the compile-time flatness check.
- `body` uses the current `BodyValue` (see `packages/core/src/internal/builder_types.ts`): it accepts only a supported wire value or data waiting to be encoded, and the runtime still checks that it can be sent. An `interface` value or a class instance must first be spread into `{ ...value }`; they cannot be passed as the body directly.
- When method is a non-literal `string`, the GET/HEAD check is automatically relaxed.

### 5.4 When the builder may be omitted

```ts
type BuilderField<TInput, TShape> = [TInput] extends [undefined]
  ? { builder?: () => TShape }
  : { builder: (input: BuilderInput<TInput>) => TShape };
```

### 5.5 Endpoint call signature

```ts
type EndpointArgs<TInput> = [TInput] extends [undefined]
  ? []
  : undefined extends StructInput<TInput>
    ? [input?: StructInput<TInput>]
    : [input: StructInput<TInput>];
```

The caller passes `StructInput` (logical names, not yet parsed); the builder receives `BuilderInput` (already parsed, typed).

### 5.6 Cases

```ts
health(); // ✔
health({}); // ✘ no input

builder: (input) => ({ path: { user_id: input.userId } }); // ✔
builder: (input) => ({ path: { usr_id: input.userId } }); // ✘ path key is misspelled
builder: (input) => ({ path: input }); // ✔ typed, all scalars
builder: (input) => ({ path: input }); // ✘ input contains a nested object
builder: (input) => ({ path: input }); // ✘ input contains an optional field
builder: (input) => ({ path: { user_id: input.userId }, query: input }); // ✔ Date and string[] may enter query

defineRequest({
  method: "POST",
  path: "/x",
  input: struct.object({ name: struct.string() }),
}); // ✘ builder is required
defineRequest({
  method: "GET",
  path: "/x",
  builder: () => ({ body: { a: 1 } }),
}); // ✘ GET with a body
defineWebSocket({
  path: "/ws/:room",
  input,
  builder: (i) => ({ path: { room: i.room }, headers: {} }),
}); // ✘ WS has no headers

search(); // ✔ when input is optional the argument may be omitted
```

### 5.7 Two pitfalls the prototype exposed (must be locked with type tests during implementation)

1. **Structural typing lets nesting through.** If the anonymous path branch is written only as `{ id: Scalar }`, a non-fresh `input` whose extra `profile` does not trigger excess-property checking is allowed through. Fix: add `[STRUCT]?: never` to the anonymous branch, so a typed object can only take the "all scalars" branch.
2. **The return value of a contextually typed arrow function does not get excess-property checking.** A WS builder that returns `headers` does not error. Fix: explicitly declare the forbidden items in the shape, `headers?: never` and `body?: never`.

### 5.8 Deliberately not done

- Do not put alias into the type layer (an `alias<const N>` literal brand would have to pierce the whole `.optional()` / `.nullable()` chain, doubling the complexity). The runtime `Missing path param` is the fallback.
- Export only `BuilderInput<S>` and the return-shape types of the three transports, for reuse when extracting a standalone builder.
- `STRUCT` must be referable from d.ts, otherwise declaration emit reports a private name; export it as a type and mark it internal in the docs.

---

## 6. Inbound representation

HTTP `output` / `error`, SSE event data, and WebSocket frames all choose a representation by struct kind:

| kind            | Representation |
| --------------- | -------------- |
| `string`        | Raw text       |
| `blob` / `file` | Blob           |
| `arrayBuffer`   | Bytes          |
| Other           | JSON           |

- Consistent with the existing error-side `resolveParseResponseType` (`http/http.ts`); once the output side is aligned, the `responseType` option is deleted.
- SSE no longer needs a `struct.json` / `struct.text` wrapper.
- Known degradation: the server returns the JSON string `"abc"` while the struct is `string`; SSE data is bare text but the user wants `struct.literal`. Accepted.
- WebSocket: `incoming` is a single struct; a text frame is JSON-parsed and then asserted, and failure goes to the runtime error listener (symmetric with SSE `onInvalidEvent`). `outgoing` is a single struct; the type of `session.send` is `StructInput<outgoing>`, which is encoded through the struct and then `JSON.stringify`.

---

## 7. Naming

- The definition field `build` → `builder`.
- In the current terminology "builder" means the return value of `defineXxx` (`RequestCommandBuilder` and so on). To avoid one word with two meanings, the return value is renamed **endpoint**: `getUser` is an endpoint, and calling it yields a command. Types are renamed accordingly (for example `RequestEndpoint`, `EventStreamEndpoint`, `WebSocketEndpoint`; when they collide with existing internal type names, those are adjusted together).
- `withQueryParamsSerializer` → `withQuerySerializer` (the contract change is in 3.3).

---

## 8. Delete, change, keep, add

### Delete

| Item                                                                                                                                                                                                                                  | Reason                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| The bound view, plan, and materialize machinery of `internal/request_builder.ts`, plus its spec / type test                                                                                                                           | Replaced by the builder plus the encoder                                                     |
| `struct.request` and the `request` kind                                                                                                                                                                                               | Replaced by an ordinary input struct and an explicit builder                                 |
| The `requestBody` kind, `struct.json`, and `struct.text`                                                                                                                                                                              | The request side is covered by the body rules; the inbound side is covered by the kind rules |
| `responseType` and its conditional types                                                                                                                                                                                              | Inferred from the kind                                                                       |
| The WebSocket `SocketStructs` map, the `'default'` key, the type-envelope convention, `normalizeIncoming` / `normalizeOutgoing`, `MissingWebSocketStructError`, `cloneStrictJsonValue`, `KnownOutgoingSocketUnion`, and related types | Replaced by a single struct for `incoming` / `outgoing`                                      |
| The query `allowComplex` branch                                                                                                                                                                                                       | Replaced by the serialization contract in 3.3                                                |

### Change

- `withQueryParamsSerializer` → `withQuerySerializer((query) => string)`, which receives only the encoded wire object.
- `struct.formData` / `struct.urlencoded`: become a `codec` tag on `ObjectDefinition`, no longer a wrapper kind.

### Keep

- The `input` struct, `parseEndpointInput`, and `REQ_INPUT_INVALID`.
- `encode.ts`, outbound alias, and the primitive `encode` hooks (date / bigint).
- `protocols` on the WebSocket definition layer.
- method, the path template, `operation`, the single `error` struct, the command and `client.execute` pipeline, and the response and fault model.

### Add

- The outbound encoder (section 4.3), within about a hundred lines.
- A "attach the type" switch on parse, used only by `parseEndpointInput`.
- A shared function that parses the inbound representation.

---

## 9. Rejected alternatives

### 9.1 Passing a mutable native container into the builder

Of the form `builder(req, input) { req.headers.set(...); req.query.set(...); req.body = … }`. Reasons for rejection:

1. The product of the builder is the request, corresponding to fetch's `RequestInit` — a description object that is returned; a server-side Fetch-style handler likewise produces the response as a return value. A mutable container is the XHR `setRequestHeader` style.
2. `URLSearchParams.set` / `Headers.set` accept only strings, so a typed value cannot be encoded through the struct, and alias, `Date`, and `bigint` all have to be handwritten; wrapping another layer to keep alias returns to the old `setQueryParams`.
3. A definition is independent of the client; client default headers, XSRF, and interceptors are merged after the builder, so the container handed in can only be empty, saving only one line of `new Headers()`.
4. A mutable container introduces lifecycle rules (async mutation after return, when to freeze); a pure function has none of these problems.

The role of "getting the native request and handling it in place" belongs to the **interceptor**: the `HttpRequest` it receives is already native `Headers` / `URLSearchParams` and carries `next()`, the same shape as server-side middleware.

| Role        | Owner               | Input                                               | Form                                     | Responsibility                                            |
| ----------- | ------------------- | --------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------- |
| builder     | Endpoint definition | Business values                                     | A pure function that returns the request | Placement + encoding                                      |
| interceptor | client              | The native request (client defaults already merged) | Mutate the native request, call `next()` | Cross-cutting concerns such as auth, tracing, and signing |

### 9.2 `protocols` entering the builder return value

Subprotocols come from execute `protocols` > client `withWebSocketProtocols` > definition `protocols`. The chosen list is copied before the logical session starts and reused on reconnect; the builder, `beforeConnect`, and interceptors cannot change it. When a dynamic token-in-subprotocol is needed, obtain the token first, then pass it through that execute's `protocols`.

### 9.3 Deleting the `input` struct and using only TS types outbound

The position of struct is a Go struct: outbound encoding (alias, codec) is its core value, and deleting input loses that half.

### 9.4 Bundling qs or building a nested query encoder in-house

Nested query formats have many variants, and rebuilding one is reinventing the wheel; the serialization hook in 3.3 plugs in the implementation the user chooses, and defjs stays dependency-free.

---

## 10. Costs

1. **Unit-testing the builder directly does not match the runtime result.** Calling the builder with a literal, the value carries no type, so the encoded result differs. Tests should go through a command plus a fake handle (`doc/recipes/test-with-handle.md`). There is no public API for "stamping a type onto a value".
2. **`toEqual` and logs can see `[STRUCT]`.** This affects only the input value the builder receives internally.
3. **parse has two paths** (attach the type / do not attach), and a test must lock in that "response decoding does not attach".
4. **The nested-query check falls back to runtime** (see 5.3).
5. **WebSocket type inference is rewritten.** It is simpler than the current `KnownOutgoingSocketUnion`, but it is a rewrite.
6. **The migration volume is concentrated in docs and tests**: multilingual docs and a large number of `struct.request(` cases.

---

## 11. Open

- **Converging the sources of WebSocket subprotocols (a historical proposal, not implemented)**: at the time the idea was to keep only definition-layer `protocols` and a dynamic `beforeConnect`, and delete client-level and execute-level `protocols`. The current rule is still the three sources in section 9.2; `beforeConnect` cannot modify the already-copied list.

---

## 12. Test points

- Each row of the section 4.4 walkthrough table becomes a regression case (HTTP as the main path; SSE / WS cover path and query).
- Spread keeps the type; a wire-name conflict errors; a non-flat value errors; `null` errors; `undefined` is omitted.
- Native `URLSearchParams` / `Headers` / `BodyInit` pass through as-is, without the encoder or the serializer.
- Each row of the 3.4 body dispatch table is covered (including `BufferSource` such as `Uint8Array`, the default content-type, and `headers` overrides); a codec tag takes effect only at the body root; an `undefined` field is omitted and `null` is sent.
- query: when no serializer is configured, arrays expand to repeated keys and nesting errors; once configured, the serializer receives the wire object whose aliases have taken effect.
- Declaring input but omitting the builder is a type error; bypassing the type check returns `REQ_BUILD_FAILED`. A static definition with no input may still omit the builder.
- The cases in section 5.6 and the two pitfalls in section 5.7 all become type tests.
- Response decoding and `struct.parse` do not attach `[STRUCT]`.
- The four inbound kind representations; a failed WS `incoming` assertion goes to the error listener; `outgoing` is encoded through alias.
- A builder throw → `REQ_BUILD_FAILED`, and it is not thrown from the endpoint call site.

---

## 13. Implementation order

1. struct: delete the `request` / `requestBody` kinds, change `formData` / `urlencoded` into codec tags, and add an attach-the-type switch to parse.
2. Request side: the outbound encoder plus the builder replace `build`, delete the `request_builder` view mechanism, rename to endpoint, and land the type design and type tests.
3. query: the new `withQuerySerializer` contract, and delete `allowComplex`.
4. Inbound side: kind representation, delete `responseType`, and unwrap SSE.
5. WebSocket: a single struct for `incoming` / `outgoing`, delete the envelope and the normalizer; if section 11 is confirmed, converge the subprotocol sources.
6. Sync the docs and the other languages.

---

## Appendix A: Body scenario examples

The examples below are design walkthroughs and have not yet been verified by tests. Comments are the content-type and content actually sent on the wire.

### A.1 JSON

```ts
const User = struct.object({
  displayName: struct.string().alias("display_name"),
  birthday: struct.date(),
});

// A typed object handed over directly: alias takes effect, Date becomes ISO
builder: (input) => ({ body: input.user });
// application/json  {"display_name":"Ada","birthday":"1815-12-10T00:00:00.000Z"}

// Reshape: the outer layer is anonymous, the inner layer is typed
builder: (input) => ({
  body: { members: input.users, invitedBy: input.inviterId, sendEmail: true },
});
// {"members":[{"display_name":"Ada",…}],"invitedBy":7,"sendEmail":true}

// Top-level array
builder: (input) => ({ body: input.users });
// [{"display_name":"Ada",…},{"display_name":"Bob",…}]

// A bigint field
builder: (input) => ({ body: { amount: input.amount } }); // amount: 12345678901234567890n
// {"amount":"12345678901234567890"}
```

### A.2 PATCH and special JSON media types

```ts
const ProfilePatch = struct.object({
  displayName: struct.string().alias("display_name").optional(), // omit it and it is not sent: no modification
  bio: struct.string().nullable().optional(), // pass null: clear it
});

const patchProfile = defineRequest({
  method: "PATCH",
  path: "/me",
  input: ProfilePatch,
  builder: (input) => ({
    headers: { "content-type": "application/merge-patch+json" },
    body: input,
  }),
});
patchProfile({ bio: null });
// application/merge-patch+json  {"bio":null}
```

### A.3 GraphQL: constants plus variables

```ts
const QUERY = /* GraphQL */ `
  query User($id: ID!) {
    user(id: $id) {
      display_name
    }
  }
`;

const gqlUser = defineRequest({
  method: "POST",
  path: "/graphql",
  input: struct.object({ variables: struct.object({ id: struct.string() }) }),
  builder: (input) => ({
    body: { query: QUERY, operationName: "User", variables: input.variables },
  }),
  output: GqlUserResult,
});
```

The old `build` forbids injecting literals and cannot express this case.

### A.4 `application/x-www-form-urlencoded`

```ts
// codec tag: the key is decided by alias
const login = defineRequest({
  method: "POST",
  path: "/login",
  input: struct.object({
    form: struct.urlencoded({
      userName: struct.string().alias("username"),
      password: struct.string(),
      remember: struct.boolean().optional(),
    }),
  }),
  builder: (input) => ({ body: input.form }),
});
// username=ada&password=***&remember=true

// Native: includes constant fields, such as OAuth
const token = defineRequest({
  method: "POST",
  path: "/oauth/token",
  input: struct.object({
    clientId: struct.string(),
    scope: struct.array(struct.string()),
  }),
  builder: (input) => ({
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: input.clientId,
      scope: input.scope.join(" "),
    }),
  }),
});
```

### A.5 `multipart/form-data`

```ts
// codec tag: the fields are fixed
const upload = defineRequest({
  method: "POST",
  path: "/files",
  input: struct.object({
    form: struct.formData({
      file: struct.file(),
      title: struct.string().alias("t"),
      tags: struct.array(struct.string()), // expands to several fields of the same name
    }),
  }),
  builder: (input) => ({ body: input.form }),
});
// multipart: file, t, tags, tags; the boundary is generated by the platform

// Native: multiple files, a custom file name, dynamic fields
const uploadMany = defineRequest({
  method: "POST",
  path: "/albums/:id/photos",
  input: struct.object({
    id: struct.string(),
    photos: struct.array(struct.file()),
  }),
  builder: (input) => {
    const body = new FormData();
    input.photos.forEach((photo, i) =>
      body.append("photo", photo, `photo-${i}.jpg`),
    );
    return { path: { id: input.id }, body };
  },
});
```

### A.6 Text, XML, CSV

```ts
builder: (input) => ({ body: input.note });
// text/plain;charset=UTF-8  raw text

builder: (input) => ({
  headers: { "content-type": "application/xml" },
  body: `<order id="${escapeXml(input.id)}"/>`,
});

builder: (input) => ({
  headers: { "content-type": "text/csv" },
  body: input.rows.map((row) => row.join(",")).join("\n"),
});
```

### A.7 Binary and streams

```ts
// Send the file directly; content-type is taken from file.type
builder: (input) => ({ path: { key: input.key }, body: input.file });

// protobuf: Uint8Array is a BufferSource and is sent as-is
builder: (input) => ({
  headers: { "content-type": "application/x-protobuf" },
  body: OrderMessage.encode(input.order).finish(),
});

// Stream a large file; when the runtime does not support a streaming request body, the existing capability probe reports the error
builder: (input) => ({ body: input.file.stream() });
```

### A.8 The same endpoint sends a different body per case

```ts
const importData = defineRequest({
  method: "POST",
  path: "/imports",
  input: struct.discriminatedUnion("source", [
    struct.object({
      source: struct.literal("json"),
      records: struct.array(Record),
    }),
    struct.object({ source: struct.literal("file"), file: struct.file() }),
    struct.object({ source: struct.literal("url"), url: struct.string() }),
  ]),
  builder: (input) => {
    switch (input.source) {
      case "json":
        return { body: input.records }; // application/json
      case "file":
        return { body: input.file }; // the file as-is
      case "url":
        return { body: new URLSearchParams({ source_url: input.url }) }; // a form
    }
  },
});
```

The builder receives the real value, so TS narrowing can be used directly.

### A.9 Sending no body

```ts
defineRequest({
  method: "DELETE",
  path: "/users/:id",
  input,
  builder: (i) => ({ path: { id: i.id } }),
});
// Not writing body means it is not sent

defineRequest({ method: "GET", path: "/x", builder: () => ({ body: {} }) });
// ✘ type-layer error: GET does not allow a body
```

### A.10 Serialization that leaves the struct encoding path

```ts
// NDJSON: JSON.stringify sees logical names, so alias does not take effect
builder: (input) => ({
  headers: { "content-type": "application/x-ndjson" },
  body: input.events.map((e) => JSON.stringify(e)).join("\n"),
});
```

The same applies to serialization the user performs themselves, such as qs and protobuf. See the note about `struct.encode` in 3.4.
