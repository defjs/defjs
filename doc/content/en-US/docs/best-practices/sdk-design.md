---
title: "SDK design"
description: "Design operations, Structs, and packages that describe a contract without owning an application client."
---

## One operation per definition [#one-operation]

Give each operation its own definition and module. An operation has one method, one path shape, one input, and one output contract. Splitting by operation keeps the contract readable and lets an application import only the operations it calls.

Prefer:

```ts
export const getOrder = defineRequest({
  method: "GET",
  path: "/orders/:id",
  operation: "orders.read",
  input: struct.object({ id: struct.number() }),
  builder: (input) => ({ path: input }),
  output: struct.object({ id: struct.number(), status: struct.string() }),
});
```

Avoid a module that creates a client or stores an endpoint next to the definitions.

## Pair input with an explicit builder [#builder]

Declare every caller value in `input` and place it in `builder`. Do not rely on a field name matching a path parameter. `builder` is synchronous and pure: it may reshape values, but it must not read credentials, call the network, or mutate shared state.

```ts
const updateOrder = defineRequest({
  method: "PATCH",
  path: "/orders/:id",
  input: struct.object({
    id: struct.number(),
    requestId: struct.string(),
    profile: struct.object({ name: struct.string() }),
  }),
  builder: (input) => ({
    path: { id: input.id },
    headers: { "x-request-id": input.requestId },
    body: input.profile,
  }),
});
```

## Structs describe the wire shape [#structs]

Use Struct for the data that crosses the wire. Use aliases when the wire name differs from the TypeScript name. Treat business rules, cross-field validation, and normalization as application policy, not as Struct behavior.

```ts
const profile = struct.object({
  customerName: struct.string().alias("customer_name"),
});
```

## Use a stable operation name [#operation-name]

Set `operation` to a low-cardinality identity such as `orders.read`. It labels telemetry and diagnostics without carrying the URL, user input, or a per-request value.

## Keep the SDK free of execution state [#no-client]

An SDK package exports definitions, Structs, and types. It does not call `createClient`, hold a singleton client, or read environment variables. The application decides the endpoint and credentials.

## Version the contract deliberately [#versioning]

Treat a removed field, a changed method or path, and a narrowed input as breaking. Additions are usually compatible. Keep the package's peer range honest, publish with the same definition text the application compiles against, and record the release tag for the published package.
