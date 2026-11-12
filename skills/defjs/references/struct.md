# Struct & schemas [#struct--schemas]

`struct` declares the wire data contract shared between an SDK and the consuming application: caller inputs, `2xx` outputs, declared service errors, SSE events, and WebSocket frames.

- **Static inference**: Derive TypeScript types with `Infer<typeof Schema>`.
- **Error-first validation**: Validate values at runtime with `struct.parse(Schema, value)` — returns `[null, data]` or `[StructError, undefined]` without throwing.

## 1. Define a schema in the SDK, validate in the application [#1-define-a-schema-in-the-sdk-validate-in-the-application]

<Tabs items={["sdk/schema.ts", "app/validate.ts", "Single-file quick look"]}>
<Tab>

```typescript
import { struct, type Infer } from "@defjs/core";

export const Order = struct.object({
  id: struct.number(),
  status: struct.enum(["pending", "paid", "shipped"] as const),
  customerName: struct.string().alias("customer_name"),
  notes: struct.string().optional(),
});

export type Order = Infer<typeof Order>;
```

</Tab>
<Tab>

```typescript
import { struct } from "@defjs/core";
import { Order } from "../sdk/schema.ts";

const [error, order] = struct.parse(Order, {
  id: 1,
  status: "paid",
  customerName: "Ada",
});

if (error) {
  console.error(error.message);
} else {
  console.log(order.customerName);
}
```

</Tab>
<Tab>

```typescript
import { defineRequest, struct, type Infer } from "@defjs/core";

const Order = struct.object({
  id: struct.number(),
  status: struct.string(),
  totalCents: struct.number().alias("total_cents"),
});

type Order = Infer<typeof Order>;

const createOrder = defineRequest({
  method: "POST",
  path: "/orders",
  input: struct.object({
    status: struct.string(),
    customerName: struct.string().alias("customer_name"),
  }),
  builder: (input) => ({ body: input }),
  output: Order,
});

function readOrder() {
  const [parseError, order] = struct.parse(Order, {
    id: 7,
    status: "paid",
    totalCents: 4200,
  });
  if (parseError) {
    console.error(parseError.message);
    return;
  }
  console.log(order.status);
}

readOrder();
```

</Tab>
</Tabs>

Parsed objects keep only declared fields (unknown properties are stripped) and use a `null` prototype. Any missing required key, wrong primitive type, or invalid branch produces a `StructError` with no partial output.

## 2. Required, optional, and nullable fields [#2-required-optional-and-nullable-fields]

Defjs separates **field presence** (`undefined`) from **nullability** (`null`). Every struct constructor is strictly required and non-null by default:

| Declaration                  | Missing / `undefined`                    | `null` | Valid value       |
| ---------------------------- | ---------------------------------------- | ------ | ----------------- |
| `struct.string()`            | Reject                                   | Reject | Accept `string`   |
| `struct.string().optional()` | Accept (omitted when serializing object) | Reject | Accept `string`   |
| `struct.string().null()`     | Reject                                   | Accept | Accept `string`   |
| `struct.string().nullish()`  | Accept (omitted when serializing object) | Accept | Accept `string`   |
| `struct.null()`              | Reject                                   | Accept | Reject non-`null` |

```typescript
import { struct } from "@defjs/core";

const Profile = struct.object({
  name: struct.string(),
  nickname: struct.string().optional(),
  biography: struct.string().null(),
  note: struct.string().nullish(),
});

function showProfile() {
  const [error, profile] = struct.parse(Profile, {
    name: "Ada",
    biography: null,
    note: undefined,
  });
  if (error) {
    console.error(error.message);
    return;
  }
  console.log(profile.name, profile.nickname, profile.biography, profile.note);
}

showProfile();
```

`struct.any()` and `struct.unknown()` also reject `null` and `undefined` unless chained with `.null()`, `.optional()`, or `.nullish()`.

## 3. Bidirectional wire aliases (`.alias()`) [#3-bidirectional-wire-aliases-alias]

Use `.alias("wire_name")` when the backend uses `snake_case` or header names while your TypeScript SDK uses `camelCase`. You declare the alias once on the field, and it works in both directions:

| Boundary                                                              | Key used                                      |
| --------------------------------------------------------------------- | --------------------------------------------- |
| Operation `input` and `struct.parse(Schema, value)`                   | Logical name (`customerName`)                 |
| Typed struct value returned by `builder` (`body`, `query`, `headers`) | Wire alias (`customer_name`)                  |
| JSON response / SSE event / WebSocket frame decoding                  | Wire `customer_name` → logical `customerName` |
| Anonymous object key written directly in `builder`                    | Literal key as written                        |

```typescript
import { struct } from "@defjs/core";

const Order = struct.object({
  customerName: struct.string().alias("customer_name"),
});

function readDisplayName() {
  const [parseError, order] = struct.parse(Order, { customerName: "Ada" });
  if (parseError) {
    console.error(parseError.message);
    return;
  }
  console.log(order.customerName);
}

readDisplayName();

const [wireError] = struct.parse(Order, { customer_name: "Ada" });
// Expected failure: public parse reads logical keys, not wire keys.
if (!wireError) throw new Error("struct.parse must read logical keys");
console.log(wireError.issues[0]?.path);
```

Spreading a typed object inside `builder` (`{ ...input.order, extra: 1 }`) preserves its struct encoding and aliases. Writing both the logical key and its wire alias on the same object fails with `REQ_BUILD_FAILED`.

## 4. Request placement and form codecs [#4-request-placement-and-form-codecs]

`input` declares the parameters; `builder` places them into `{ path, query, headers, body }`. For form-encoded bodies, `struct.urlencoded(shape)` and `struct.formData(shape)` tag the root object so the transport serializes it as `URLSearchParams` or `FormData` automatically:

```typescript
import { defineRequest, struct, type Client } from "@defjs/core";

const createOrder = defineRequest({
  method: "POST",
  path: "/organizations/:organizationId/orders",
  input: struct.object({
    organizationId: struct.string(),
    notify: struct.boolean().optional(),
    requestId: struct.string(),
    order: struct.object({
      customerName: struct.string().alias("customer_name"),
    }),
  }),
  builder: (input) => ({
    path: { organizationId: input.organizationId },
    query: { notify: input.notify },
    headers: { "x-request-id": input.requestId },
    body: input.order,
  }),
});

async function submit(client: Client) {
  const [error] = await createOrder(client, {
    organizationId: "acme",
    notify: true,
    requestId: "request-42",
    order: { customerName: "Ada" },
  });
  if (error) console.error(error.code);
}
```

| Body root returned by `builder`                     | Wire format       | Default `Content-Type`                            |
| --------------------------------------------------- | ----------------- | ------------------------------------------------- |
| Typed object, array, finite number, boolean, `null` | JSON text         | `application/json`                                |
| `string` struct or raw `string`                     | UTF-8 text        | `text/plain;charset=UTF-8`                        |
| `struct.urlencoded(shape)` at body root             | `URLSearchParams` | `application/x-www-form-urlencoded;charset=UTF-8` |
| `struct.formData(shape)` at body root               | `FormData`        | `multipart/form-data; boundary=...`               |
| `Blob` / `File` (`struct.file()`)                   | Binary blob       | `blob.type` or `application/octet-stream`         |
| `ArrayBuffer` / view / `ReadableStream`             | Raw bytes         | `application/octet-stream`                        |

## 5. Handling `StructError` and issues [#5-handling-structerror-and-issues]

`struct.parse(Schema, data, { aliases?, errorMap? })` returns `[StructError, undefined]` on failure. `StructError` extends native `Error` and provides `issues`, `format()`, `flatten()`, and `prettify()`:

```typescript
import { struct, StructError } from "@defjs/core";

const Order = struct.object({ id: struct.number(), status: struct.string() });
const [error] = struct.parse(Order, { id: "not-a-number" });

if (error) {
  console.log(error instanceof StructError);
  console.log(error.issues[0]?.code, error.issues[0]?.path);
  console.log(error.flatten().fieldErrors);
  console.log(error.format(), error.prettify());
}
```

Each `StructIssue` contains `code` (`invalid_type`, `missing_key`, `invalid_literal`, `invalid_enum`, `invalid_union`, `invalid_intersection`, or `custom`), `path`, `expected`, `received`, and `message`. Default messages omit the received value and report only its _type_, but paths retain dynamic record keys, which may contain sensitive values. `String(error)` and `error.prettify()` are not a redaction boundary; use an allowlist of safe fields when logging, and treat raw `received` values and custom messages as sensitive.

## 6. Constructor reference [#6-constructor-reference]

```typescript
import { struct } from "@defjs/core";

const Any = struct.any();
const ArrayOfStrings = struct.array(struct.string());
const Bytes = struct.arrayBuffer();
const BigIntValue = struct.bigint();
const BlobValue = struct.blob();
const BooleanValue = struct.boolean();
const DateValue = struct.date();
const Discriminated = struct.discriminatedUnion("kind", [
  struct.object({ kind: struct.literal("created"), id: struct.number() }),
  struct.object({ kind: struct.literal("deleted"), id: struct.number() }),
]);
const Status = struct.enum(["draft", "published"]);
const FileValue = struct.file();
const Form = struct.formData({ file: struct.file() });
const Combined = struct.intersection(
  struct.object({ id: struct.number() }),
  struct.object({ name: struct.string() }),
);
const Literal = struct.literal("ready");
const NullValue = struct.null();
const NumberValue = struct.number();
const ObjectValue = struct.object({ id: struct.number() });
const Union = struct.or(struct.string(), struct.number());
const RecordValue = struct.record(struct.number());
const StringValue = struct.string();
const Tuple = struct.tuple([struct.string(), struct.number()]);
const Unknown = struct.unknown();
const FormUrlEncoded = struct.urlencoded({ name: struct.string() });
```

| Constructor                                                | Accepted input                          | Inferred output                                                |
| ---------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------- |
| `struct.string()` / `struct.boolean()`                     | Matching primitive                      | `string` / `boolean`                                           |
| `struct.number()`                                          | Any `number` except `NaN`               | `number` (`NaN` rejected; `±Infinity` rejected in JSON bodies) |
| `struct.bigint()`                                          | `bigint` or numeric string              | `bigint`                                                       |
| `struct.date()`                                            | Valid `Date`, timestamp, or ISO string  | `Date`                                                         |
| `struct.literal(value)`                                    | Exact primitive literal                 | Literal type                                                   |
| `struct.enum(values)`                                      | Declared string or number member        | Union of literals                                              |
| `struct.array(item)` / `struct.tuple(items)`               | Array / fixed-length tuple              | `T[]` / `[...]`                                                |
| `struct.object(shape)` / `struct.record(val)`              | Plain object                            | Typed object / `Record<string, V>`                             |
| `struct.discriminatedUnion(key, options)`                  | Object with literal `key` discriminator | Union of object branches                                       |
| `struct.or(branches)`                                      | First matching branch                   | Union of branch types                                          |
| `struct.intersection(members)`                             | Value satisfying all members            | Deep-merged intersection                                       |
| `struct.file()` / `struct.blob()` / `struct.arrayBuffer()` | `File` / `Blob` / `ArrayBuffer`         | Binary representation                                          |

### Recursive structs [#recursive-structs]

A self-referential type reads itself through a getter property on the shape. The getters run once, when the object struct is first used, not when the constant is defined, so the constant can name itself. Annotate the constant with `Struct<T>`: TypeScript cannot infer a type that refers to itself.

```typescript
import { struct, type Struct } from "@defjs/core";

interface Category {
  name: string;
  children: Category[];
}

const CategoryStruct: Struct<Category> = struct.object({
  name: struct.string(),
  get children() {
    return struct.array(CategoryStruct);
  },
});

const [error, tree] = struct.parse(CategoryStruct, {
  name: "tools",
  children: [{ name: "hammers", children: [] }],
});

if (!error) console.log(tree.children[0]?.name);
```

### What `struct` does not do [#what-struct-does-not-do]

- `struct` declares structure only. String length, patterns, numeric ranges, and business rules belong in application code after parsing.
- Parsing stops at the first invalid field. It never fills a missing field with a zero value and never returns partial output.

## Related reading [#related-reading]

- [HTTP operations](/docs/http)
- [Error handling](/docs/errors)
- [Send and validate JSON](/recipes/post-json)
