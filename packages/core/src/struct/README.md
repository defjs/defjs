# Struct

SDK authors use Struct to declare reusable contracts for inputs, responses, errors, and realtime messages, and publish them together with API definitions. When an application executes these definitions through its own Client, it still uses the same contract for type inference and runtime validation; the service address and current credentials do not belong to Struct.

`Struct` is the structural contract Defjs uses to describe a protocol boundary: it declares fields, each field's external wire name, and structural parsing plus basic type conversion of values at the boundary. It uses strict field-presence rules; the Go practice of "define the target struct first, then decode" can help understand the type contract, but Struct does not return a zero value or a partial result when parsing fails, and it is not a general-purpose business validation DSL.

Struct mainly answers three questions:

1. Which structural fields should an input or response have?
2. How do external field names map to TypeScript property names?
3. How should missing values, `null`, basic type conversion, and structural errors produce a stable, abortable result?

It does not answer application questions such as whether an email is valid, whether an amount is positive, whether a user has permission, or whether an order status can transition.

## Quick start

Import `struct`, `Infer`, and the endpoint API from the root entry:

```typescript
import {
  createClient,
  defineRequest,
  struct,
  type Infer,
  type StructInput,
  withEndpoint,
} from "@defjs/core";

const User = struct.object({
  id: struct.number(),
  displayName: struct.string().alias("display_name"),
});

type User = Infer<typeof User>;

const getUser = defineRequest({
  method: "GET",
  path: "/users/:id",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: User,
});

const client = createClient(withEndpoint("https://api.example.com"));
const [error, user] = await client.execute(getUser({ id: 1 }));
if (error) throw error;

console.log(user.id, user.displayName);
```

`Infer<typeof User>` is the parsed output type. `alias('display_name')` only changes the field name in the external protocol; it does not rename the TypeScript property `displayName` to `display_name`.

A Struct instance itself has no `.parse()`, `validate`, `parseAsync`, or `encode` method. For standalone parsing, use `struct.parse(User, input)` on the facade; HTTP, SSE, and WebSocket endpoints use the same Struct metadata at their own boundaries. Outbound encoding is driven by the typed values the builder hands over; there is no public `struct.encode`.

## Public constructors

The `struct` facade currently provides the following constructors. They are grouped here by purpose and do not correspond to every definition kind in the internal implementation.

| Purpose                    | Constructor                                | Description                                                                                                                                   |
| -------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Basic values               | `string`, `number`, `boolean`, `null`      | Strings, numbers, booleans, and explicit `null`                                                                                               |
| Opaque values              | `any`, `unknown`                           | Accepts values unconstrained by Struct; the output type of `any` also provides no static guarantee                                            |
| Fixed values               | `literal`, `enum`                          | A single literal or a non-empty enum; enums support string arrays and objects with string or number values                                    |
| Platform/conversion values | `date`, `bigint`                           | Input may come from a wire representation; the outputs are `Date` and `bigint` respectively                                                   |
| Composite values           | `object`, `array`, `tuple`, `record`       | Objects, lists, fixed-length sequences, and records with arbitrary keys                                                                       |
| Combination values         | `or`, `intersection`, `discriminatedUnion` | Ordinary unions, intersections, and unions routed by a discriminator                                                                          |
| Form codecs                | `urlencoded`, `formData`                   | Still an object struct, with one extra codec tag; the tag takes effect only when that value is the body root                                  |
| Binary values              | `blob`, `file`, `arrayBuffer`              | Browser platform-value Structs. Sent as bytes when used as the body root; when declared inbound, they select the corresponding representation |

An ordinary object, array, number, boolean, or `null` is sent as JSON when it is the body root. A `string` keeps its original text when it is the body root or an inbound `string` struct. `struct.urlencoded(shape)` and `struct.formData(shape)` are not wrapper kinds.

Common combination examples:

```typescript
const Point = struct.object({
  x: struct.number(),
  y: struct.number(),
});

const UserId = struct.or(struct.string(), struct.number());
const Coordinates = struct.tuple([struct.number(), struct.number()]);
const Headers = struct.record(struct.string());
const Combined = struct.intersection(
  struct.object({ id: struct.string() }),
  struct.object({ displayName: struct.string() }),
);
```

## Strict parsing and explicit zero values

`struct.parse(schema, input)` returns a fixed error-first pair:

```typescript
type ParseResult<T> =
  [error: null, value: T] | [error: StructError, value: undefined];
```

When parsing fails, the second item is always `undefined`. It does not construct a zero value for the whole Struct, and it does not expose sibling fields that were already parsed successfully.

```typescript
const DailySummary = struct.object({
  orders: struct.number(),
  acceptingOrders: struct.boolean(),
  adjustmentIds: struct.array(struct.string()),
  operatorMessage: struct.string(),
});

const [missingError, missingSummary] = struct.parse(DailySummary, {});
// missingError.issues[0] points at orders; missingSummary is undefined.

const [error, summary] = struct.parse(DailySummary, {
  orders: 0,
  acceptingOrders: false,
  adjustmentIds: [],
  operatorMessage: "",
});
// error is null; 0, false, [], and '' are legal values explicitly provided by the caller.
```

`date`, `bigint`, and the JSON codec still perform boundary conversion: for example, `date` accepts a `Date`, a string, or a number and outputs a `Date`; `bigint` accepts a `bigint` or a string and outputs a `bigint`. An invalid date, or a value that does not match the `bigint` input rules, produces a structural error.

`struct.object(shape)` walks only the declared shape; unknown keys are dropped. `array`, `record`, `tuple`, object, and intersection all stop at the first definite error; a tuple input's length must match the declared length exactly. Parsed objects and records use a null prototype; when you depend on `Object.prototype` methods, use `Object.keys`/`Object.entries`, or explicitly copy into an ordinary object.

`intersection` deep-merges each member's output: values equal under `Object.is`, and `Date`s with the same time, keep that value; ordinary objects are merged recursively by own keys; equal-length arrays are merged by element; every other conflict is recorded as `invalid_intersection`, with path pointing at the conflicting key or index. `unknown` and `any` still run, but they contribute no fields to the merge result; when every member is `unknown` / `any`, the result is the input itself.

Node's strict deep equality compares prototypes, so a Struct parse result is not deep-equal to an object literal with the same fields. Tests should assert this boundary explicitly, or shallow-copy only at the assertion:

```typescript
import assert from "node:assert/strict";

const [profileError, profile] = struct.parse(
  struct.object({ name: struct.string() }),
  { name: "Ada" },
);
assert.equal(profileError, null);
assert.equal(Object.getPrototypeOf(profile), null);
assert.deepEqual({ ...profile }, { name: "Ada" });
```

Spread applies only to the shallow assertion here; nested Struct objects still use a null prototype. Do not add a global normalize or clone on the production path merely to satisfy a test matcher.

## Absence, `null`, and modifiers

`optional()`, `null()`, and `nullish()` return a Struct with new flags; they do not change the original Struct. The actual behavior depends on whether the Struct is in an object-field position or is a top-level value:

| Input situation                    | Ordinary Struct | Object field `.optional()` | Object field `.null()` | Object field `.nullish()` |
| ---------------------------------- | --------------- | -------------------------- | ---------------------- | ------------------------- |
| Field missing or value `undefined` | `StructError`   | Omit the key               | `StructError`          | Omit the key              |
| Explicit `null`                    | `StructError`   | `StructError`              | Keep `null`            | Keep `null`               |
| Present and the type is correct    | Parsed value    | Parsed value               | Parsed value           | Parsed value              |
| Present but the type is wrong      | `StructError`   | `StructError`              | `StructError`          | `StructError`             |

The concrete rules are:

- `.optional()` omits the field when it is missing or `undefined` in an object-field position; as a top-level value, a missing result is `undefined`. Explicit `null` still fails.
- `.null()` accepts only explicit `null` and does not make the field optional; missing or `undefined` still fails.
- `.nullish()` sets both optional and nullable: when missing, it omits the object field; when explicitly `null`, it keeps `null`; as a top-level value, a missing result is `undefined`.
- `.null()` or `.nullish()` does not exempt an arbitrary non-null value from type parsing; a wrong type still fails.

Object input properties are required by default; only `.optional()` or `.nullish()` fields may be omitted. When `exactOptionalPropertyTypes` is enabled, the inferred object input uses exact optional properties: callers should omit optional or nullish keys rather than explicitly assigning `undefined`.

```typescript
const OptionalProfile = struct.object({
  nickname: struct.string().optional(),
});

type OptionalProfileInput = StructInput<typeof OptionalProfile>;

const omitted: OptionalProfileInput = {};
// @ts-expect-error With exactOptionalPropertyTypes, omit optional keys instead.
const explicitUndefined: OptionalProfileInput = { nickname: undefined };
```

At runtime, when facing unknown input, an explicit `undefined` on an optional/nullish field is still accepted defensively and that key is omitted from the parse result; this normalization does not loosen the static caller's input type.

## Structural parsing and application validation

In Struct, the word "validation" means failure at the structural boundary, not a business validator that returns a boolean. It will:

- read declared fields and drop unknown object keys;
- require ordinary fields to be present, and handle absence or `null` according to the optional, nullable, and nullish modifiers;
- check basic types, literals, enums, arrays, tuples, records, and object structure;
- convert supported wire/runtime types such as `date` and `bigint`;
- stop at the first structural problem and produce one `StructIssue`.

The current Struct has no `.min()`, `.max()`, `.int()`, `.nonempty()`, `.refine()`, `.transform()`, `.default()`, `.strip()`, `.passthrough()`, `.pick()`, or custom predicate. The following rules belong in the service, router, or a dedicated validator layer:

- non-empty strings, email/regex formats, and identifier prefixes;
- numbers that must be integers, finite, positive, a money precision, or within some range;
- permissions, tenant ownership, inventory caps, and immutable fields;
- cross-field constraints, for example that an end time must be later than a start time;
- order-status transitions and security authorization.

Struct distinguishes "the field was not passed" from "a legal `0`, `false`, `''`, or `[]` was passed explicitly": the former fails for a required field, and the latter parses normally. It still does not judge whether those explicit values satisfy business rules; business constraints are the responsibility of the service, router, or a dedicated validator.

## Alias and wire keys

`.alias(name)` changes only the wire key, not the logical field name or `Infer`. Typed objects use the same alias for outbound encoding, JSON responses, SSE events, and WebSocket frames. Keys of an anonymous object are sent as literals; alias does not participate.

```typescript
import {
  createClient,
  defineRequest,
  struct,
  withEndpoint,
  withHTTPHandle,
} from "@defjs/core";

const UserBody = struct.object({
  id: struct.number().alias("user_id"),
  displayName: struct.string().alias("display_name"),
});

const [logicalError, logicalUser] = struct.parse(UserBody, {
  id: 1,
  displayName: "Ada",
});
if (logicalError) throw logicalError;

const [wireKeyError] = struct.parse(UserBody, {
  user_id: 1,
  display_name: "Ada",
});
if (!wireKeyError) throw new Error("struct.parse must read logical keys");

let requestWireBody: unknown;
const echoUser = defineRequest({
  method: "POST",
  path: "/users",
  input: struct.object({ user: UserBody }),
  builder: (input) => ({ body: input.user }),
  output: UserBody,
});
const client = createClient(
  withEndpoint("https://example.test"),
  withHTTPHandle(async (input, init) => {
    requestWireBody = await new Request(input, init).json();
    return Response.json({ user_id: 1, display_name: "Ada" });
  }),
);

const [requestError, responseUser] = await client.execute(
  echoUser({ user: { id: 1, displayName: "Ada" } }),
);
if (requestError) throw requestError;
```

`logicalUser` and `responseUser` use `{ id, displayName }`; `wireKeyError` points at the missing logical `id`; `requestWireBody` is `{ user_id, display_name }`. The public `struct.parse` reads logical values unless `{ aliases: true }` is passed. Transport JSON encode/decode applies wire aliases on the wire.

| Concept                  | Example                   | Result                                                    |
| ------------------------ | ------------------------- | --------------------------------------------------------- |
| TypeScript property name | `displayName`             | Callers and parsed objects use `displayName`              |
| wire key                 | `display_name`            | JSON/query/path/headers/form encoding uses `display_name` |
| Parsed value             | `{ displayName: 'Ada' }`  | Does not become `{ display_name: 'Ada' }`                 |
| Encoded value            | `{ display_name: 'Ada' }` | The key sent to the protocol boundary                     |

Wire keys within the same object shape must be unique; two fields cannot resolve through aliases to the same external key. path, query, headers, and body are different objects, so they may reuse the same wire key with each other.

The builder receives the parsed real values, and object nodes carry the struct that produced them. Hand over a typed value and the alias takes effect; write a key by hand inside an anonymous object and that key is the on-the-wire name:

```typescript
builder: (input) => ({ body: { name: input.user.displayName } });
```

The `name` here will not have `display_name` applied again. Only `body: input.user` is encoded according to `UserBody`'s aliases. Spreading `{ ...input.user, role: 'admin' }` still keeps the type; writing both the logical name and its wire key at the same time becomes `REQ_BUILD_FAILED` during execution.

## Unions and discriminated unions

### Ordinary unions

`struct.or(a, b, ...)` tries options in declaration order; the first successful branch wins:

```typescript
const Identifier = struct.or(struct.string(), struct.number());
type Identifier = Infer<typeof Identifier>; // string | number
```

Order is part of the contract. Overlapping branches let an earlier branch absorb a later one; a broad branch such as `struct.any()` or `struct.unknown()` can also leave later branches with no chance forever. Each option fails fast internally; the first successful option returns immediately. When every option fails, only one outer `invalid_union` issue is produced; errors from candidate branches are not aggregated.

Issue codes for parse failure are `custom`, `invalid_enum`, `invalid_intersection`, `invalid_literal`, `invalid_type`, `invalid_union`, and `missing_key`. `format()`, `flatten()`, and `prettify()` present these codes by path and message.

### Discriminated unions

When object events and similar values need stable routing, prefer `discriminatedUnion`:

```typescript
const Event = struct.discriminatedUnion("type", [
  struct.object({
    type: struct.literal("parcel_packed"),
    orderId: struct.string(),
    parcels: struct.number(),
  }),
  struct.object({
    type: struct.literal("delivery_delayed"),
    orderId: struct.string(),
    reason: struct.string(),
  }),
]);

type Event = Infer<typeof Event>;

function summarize(event: Event): string {
  if (event.type === "parcel_packed") return `${event.parcels} parcels packed`;
  return `${event.orderId} delayed: ${event.reason}`;
}
```

Every option must be an object Struct, must contain a discriminator field of the same name, and that field must be a required `struct.literal(...)`; except for a pure `literal(null)`, a modifier must not widen the discriminator's accepted values. Discriminator values must be unique. These are definition-time constraints; violating them throws `TypeError`. During parsing:

- A known discriminator routes only to the matching option, then that branch is parsed; it does not fall back across other options.
- A missing or unknown discriminator cannot be routed and produces a `StructError`, with the issue path pointing at the discriminator.
- A field error on the selected branch keeps that field's path.
- The JSON codec supports an alias on the discriminator field; it reads the first wire discriminator that actually exists, in option declaration order, and after the branch is selected it no longer visits other options' aliases.

## Request placement

path, query, headers, and body are returned by the endpoint's `builder`; they are not a struct kind. Whenever `input` is declared, a `builder` must be provided explicitly. `input` only defines the incoming parameters; where each value is placed is decided only by the builder; input field names have no placement meaning. Only a definition with no `input` may omit `builder`. Whether a field is required depends only on its own `.optional()` / `.nullish()`.

```typescript
const Profile = struct.object({
  name: struct.string().alias("display_name"),
});

const updateUser = defineRequest({
  method: "PATCH",
  path: "/users/:id",
  input: struct.object({
    userId: struct.number(),
    includeProfile: struct.boolean().optional(),
    traceId: struct.string(),
    profile: Profile,
  }),
  builder: (input) => ({
    path: { id: input.userId },
    query: { include_profile: input.includeProfile },
    headers: { "x-trace-id": input.traceId },
    body: input.profile,
  }),
});

updateUser({
  userId: 1,
  includeProfile: true,
  traceId: "trace-1",
  profile: { name: "Miao" },
});
```

After encoding, `path` values must be scalars. A header value may be a scalar or an array of scalars. When no query serializer is configured, `query` must also be flat scalars: arrays expand into repeated keys, and a nested object reports `REQ_BUILD_FAILED`. After `withQuerySerializer` is configured, `query` may be nested; the serializer receives the on-the-wire object with aliases already applied (`Date` as ISO, `bigint` as a string). The codec tag of `urlencoded` and `formData` encodes fields as a form only when that object is the body root; nested inside another object, they are encoded as ordinary JSON fields. HTTP and SSE may have a body; `GET` / `HEAD` forbid a body at the type level. A WebSocket builder cannot return headers or a body.

A path placeholder should be passed a raw scalar; Core runs `encodeURIComponent` exactly once on each value. Callers must not pre-encode, or `%` will be encoded again as `%25`.

The builder is not responsible for application-level validation, and it does not change the transport lifecycle. A validation failure is still `REQ_INPUT_INVALID`; a builder throw or an on-the-wire name conflict is `REQ_BUILD_FAILED`, and it is not thrown from the endpoint call site.

## StructError and parse failure

Passing wrong constructor arguments at definition time, for example an illegal discriminated union option, throws `TypeError`. Parsing a wrongly typed value against an already defined Struct produces a `StructError`, in which each `StructIssue` contains `code`, `expected`, `message`, `path`, and `received`.

The public `struct.parse` uses the following result shape:

```text
Success: [null, parsedValue]
Failure: [StructError, undefined]
```

Objects, arrays, records, tuples, and the like stop at the first error; a partially successful output is not exposed to the caller. For compatibility with the error-display API, `StructError.issues` is still an array, but a normal parse failure contains only the current first issue. The internal `parseStructValue` is a throwing adapter; applications should use `struct.parse` from the root entry and should not depend on internal paths such as `./introspection`.

In the endpoint runtime, Struct errors are wrapped again by the corresponding transport. For example, a structural failure of an HTTP input becomes `REQ_INPUT_INVALID`, and a response body that does not match the declaration becomes `RES_STRUCT_MISMATCH`. The branching conditions are in the HTTP matrix below; this step belongs to the endpoint layer, not to Struct itself.

```typescript
import { StructError } from "@defjs/core";

const [error, result] = await client.execute(command);

if (error?.code === "RES_STRUCT_MISMATCH") {
  if (error.cause instanceof StructError) {
    console.error(error.cause.flatten());
    console.error(error.cause.prettify());
  }
}
```

`StructError` also provides `issues`, `format()`, `flatten()`, and `prettify()`. The default message describes only the type of received, for example `Expected number at email, received string`, and does not embed the original value; the default `prettify()` and `String(fault)` also do not contain the original received value. The original value stays on `StructIssue.received` and still needs redaction. The `SyntaxError` fault message for `RES_DECODE_FAILED` is fixed as `Response body could not be decoded`; the original parser cause may contain a response fragment.

`struct.parse(s, v, { errorMap })` rewrites issue messages only for this one parse, and it also covers conversion failures of a bigint/date Struct created by another copy of Core. Returning any string (including `''`) replaces the default message; only `undefined` keeps the default. Custom text enters the message as-is, and adding the original value yourself can still leak it; do not log a complete issue or parser cause directly.

### Struct does not provide an HTTP tuple

`[err, data, response]`, HTTP status, `HTTP_STATUS`, `DecodedResponse`, and a fault's `data` are all contracts of the endpoint/transport layer. Struct itself has no status, response, or HTTP tuple.

`ok` is the only branch point: 2xx is decoded with `output`, everything else with `error`, and both are never tried. Omitting one side means that body is not read at all. The representation is decided by the struct kind: `string` is the original text, `blob` / `file` is a Blob, `arrayBuffer` is bytes, and everything else is JSON. When neither side is declared, the lower layer cancels the response body. There is no `responseType` option.

A real Fetch response checks a JSON media type and JSON-parses that representation inside the interceptor chain. A bad media type or syntax rejects the call as `BodyFailure` before `next()` resolves. Struct validation runs once, after the chain. `makeResponse(...)` skips that in-chain read; its body is decoded only in the post-chain step.

| HTTP branch                                              | Condition                                                               | Current wrapping                                                                         |
| -------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| That side is not declared                                | The corresponding `output` or `error` is absent; the body is never read | 2xx is success with `data` `undefined`; non-2xx is `HTTP_STATUS` with `data` `undefined` |
| Media type does not match a declared JSON representation | Decided **before** the body is read                                     | `RES_MEDIA_TYPE_INVALID`; text, blob, and bytes are not checked this way                 |
| The representation cannot be read                        | Interpreting the bytes by the effective mode fails                      | `RES_DECODE_FAILED`; no body                                                             |
| Struct validation fails                                  | Runtime decides the value is not accepted by Struct                     | `RES_STRUCT_MISMATCH`; no body and no `data`                                             |
| 2xx and decode succeeds                                  | Both the representation and Struct succeed                              | success; both `data` and `response.body` are the parsed value                            |
| Non-2xx and decode succeeds                              | Both the representation and Struct succeed                              | `HTTP_STATUS`; the typed parsed value is in `err.data`                                   |

Philosophy item 5 has an easy-to-miss corollary: **the body on the undeclared side is not even concerned with "read failure"**. When an endpoint that declares only `output` meets a 500 whose body is bad JSON, the result is `HTTP_STATUS` + `status: 500`, not a representation-layer error.

A decode failure leaves no body: the `response` of a `RES_*` fault is `HttpMeta`, which has no `body` field at the type level. Error detail is in `cause` (a `StructError` when Struct does not match). A transport failure is a fault rather than a response, so there is no status-0 response that represents a transport failure.

For HTTP result details and response availability, see the [HTTP documentation](../../../../doc/content/en-US/docs/http.mdx) and the [error documentation](../../../../doc/content/en-US/docs/errors.mdx). Do not reverse-infer endpoint tuple semantics into the Struct API.

## Current practice and source index

The following sources align with the current public API and can be used as references for actual usage:

- [`index.ts`](./index.ts) and [`facade.ts`](./facade.ts): public exports and the `struct` constructors.
- [`parse.ts`](./parse.ts) and [`introspection.ts`](./introspection.ts): strict Struct parsing and the internal adapter implementation.
- [`errors.ts`](./errors.ts): `StructError`, issue messages, and error views.
- [`doc/content/en-US/docs/struct.mdx`](../../../../doc/content/en-US/docs/struct.mdx): Struct documentation for users.
- [`doc/content/en-US/docs/commands.mdx`](../../../../doc/content/en-US/docs/commands.mdx): request input, the explicit builder, and transport constraints.

If historical documents or research materials contain examples of `tag.*`, `RuntimeStruct`, `TypeOf`, `InputOf`, or of importing `codec`/`introspection` directly, they do not represent the current `@defjs/core` public API; the current root-entry exports, type tests, and the sources above are authoritative.
