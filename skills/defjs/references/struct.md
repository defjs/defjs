# Struct (`struct.*` and `struct.parse`)

Contents: [Constructors](#constructors) · [Modifiers and aliases](#modifiers-and-aliases) · [Parsing](#parsing) · [Body codecs and binary types](#body-codecs-and-binary-types) · [Recursive structs](#recursive-structs) · [Rules and pitfalls](#rules-and-pitfalls)

## Constructors

Import `struct` from `@defjs/core`. Every protocol boundary (`input`, `output`, `error`, SSE `events`, WebSocket `incoming`/`outgoing`) accepts only `@defjs/core` structs.

```ts
import { struct, type Infer } from "@defjs/core";

const OrderItem = struct.object({
  sku: struct.string(),
  quantity: struct.number(),
});

const Order = struct.object({
  id: struct.number(),
  status: struct.enum(["pending", "paid", "shipped"]),
  customerName: struct.string().alias("customer_name"),
  items: struct.array(OrderItem),
  metadata: struct.record(struct.string()).optional(),
  paidAt: struct.date().nullable(),
});

type Order = Infer<typeof Order>;
```

| Constructor                                                               | Accepts                                                                |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `struct.string()`, `struct.number()`, `struct.boolean()`, `struct.null()` | Primitives (`NaN` rejected for `number`)                               |
| `struct.bigint()`, `struct.date()`                                        | `bigint` or numeric string; `Date`, timestamp, or ISO/date string      |
| `struct.literal(value)`, `struct.enum(values)`                            | Exact literal; string array or `{ Key: value }` enum object            |
| `struct.any()`, `struct.unknown()`                                        | Any value except `null` and `undefined` (opaque, not traversed)        |
| `struct.array(item)`, `struct.tuple([a, b])`                              | Homogeneous array; fixed-length tuple                                  |
| `struct.object(shape)`, `struct.record(value)`                            | Fixed-field object (unknown keys stripped); string-keyed dictionary    |
| `struct.or(a, b)`, `struct.intersection(a, b)`                            | First matching branch; merged object branches                          |
| `struct.discriminatedUnion(tag, [optA, optB])`                            | Object union dispatched by `tag` field                                 |
| `struct.urlencoded(shape)`, `struct.formData(shape)`                      | Object struct tagged for form encoding when used as the HTTP body root |
| `struct.blob()`, `struct.file()`, `struct.arrayBuffer()`                  | Binary values                                                          |

## Modifiers and aliases

Every struct supports chainable methods:

- `.optional()` — allows `undefined` or an omitted property.
- `.null()` / `.nullable()` — allows `null`.
- `.nullish()` — allows `null`, `undefined`, or an omitted property.
- `.alias(wireName)` — maps the TypeScript property name (logical key) to `wireName` on the wire.

| Boundary                                                      | Key used                                                               |
| ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `struct.parse(Order, value)` (default)                        | Logical key (`customerName`)                                           |
| `struct.parse(Order, value, { aliases: true })`               | Wire key (`customer_name`) → outputs logical key                       |
| Operation `input` and `builder` parameter                     | Logical key (`input.customerName`)                                     |
| Typed object returned from `builder` (`body`, `query`)        | Encoded to wire key (`customer_name`)                                  |
| Inbound `output`, `error`, SSE `events`, WebSocket `incoming` | Decoded from wire key (`customer_name`) → logical key (`customerName`) |

## Parsing

Structs have **no** instance `.parse()` method and **no** `struct.encode`. Always call `struct.parse(schema, value, options?)`, which returns an error-first tuple `[null, data]` or `[StructError, undefined]`:

```ts
import { struct } from "@defjs/core";

const Order = struct.object({
  id: struct.number(),
  customerName: struct.string().alias("customer_name"),
});

function parseOrder(raw: unknown) {
  const [error, order] = struct.parse(Order, raw, { aliases: true });
  if (error) {
    console.error(error.prettify());
    return;
  }
  console.log(order.id, order.customerName);
}

parseOrder({ id: 1, customer_name: "Ada" });
```

## Body codecs and binary types

- `struct.urlencoded({...})` and `struct.formData({...})` are object structs with a codec tag. The tag takes effect **only when that struct is the HTTP request body root**. When nested inside another object, it is encoded as a regular JSON object field.
- As `output` or `error` on `defineRequest`, the struct kind selects how the response body is read: `struct.string()` reads text, `struct.blob()` / `struct.file()` reads a `Blob`, `struct.arrayBuffer()` reads an `ArrayBuffer`, and every other struct parses JSON.

## Recursive structs

Use a getter property on the shape object for self-referential types. The getter is evaluated lazily when parsing reaches that boundary:

```ts
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
```

## Rules and pitfalls

- **Fail-fast:** parsing stops at the first invalid field. There is no zero-value filling and no partial output.
- **No validation DSL:** string lengths, regexes, number ranges, and business rules belong in application code after parsing.
- **Keep typed objects intact in `builder`:**

```ts
// Incorrect: hand-writing wire keys on a fresh literal bypasses struct aliases
builder: (input) => ({ body: { customer_name: input.order.customerName } });

// Correct: pass the typed struct value so aliases apply across the tree
builder: (input) => ({ body: input.order });
```
