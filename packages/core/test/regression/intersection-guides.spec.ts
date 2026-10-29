import { expect, test } from "vitest";
import {
  createClient,
  defineRequest,
  struct,
  withEndpoint,
  withHTTPHandle,
} from "../../src";
import { parseEndpointInput } from "../../src/internal/endpoint_input";
import { encodeOutbound } from "../../src/internal/outbound_request";
import { encodeJson } from "../../src/struct/codec/json";
import { serializeOutgoingWebSocketMessage } from "../../src/web_socket/codec";

const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const Left = struct.object({ firstName: struct.string().alias("first_name") });
const Right = struct.object({ lastName: struct.string().alias("last_name") });
const logical = { firstName: "Ada", lastName: "Lovelace" };
const wire = { first_name: "Ada", last_name: "Lovelace" };

const Nullable = struct.intersection(
  struct.object({ name: struct.string().nullable().alias("wire_name") }),
  struct.object({ name: struct.string().nullable().alias("wire_name") }),
);
const A = struct.object({ name: struct.string().alias("a_name") });
const B = struct.object({ name: struct.string().alias("b_name") });
const Choice = struct.or(A, B);
const UnionGuide = struct.intersection(
  struct.object({ row: Choice }),
  struct.object({ row: Right }),
);

test("nullable shared fields parse and encode null instead of walking aliases", () => {
  expect(plain(struct.parse(Nullable, { name: null }))).toEqual([
    null,
    { name: null },
  ]);
  expect(plain(encodeJson(Nullable, { name: null }))).toEqual({
    wire_name: null,
  });
  expect(serializeOutgoingWebSocketMessage(Nullable, { name: null })).toBe(
    '{"wire_name":null}',
  );
});

test("nested nullable and explicit undefined containers stay leaves", async () => {
  const child = struct
    .object({ name: struct.string().alias("wire_name") })
    .nullish();
  const schema = struct.intersection(
    struct.object({ row: child }),
    struct.object({ row: child }),
  );
  expect(plain(struct.parse(schema, { row: null }))).toEqual([
    null,
    { row: null },
  ]);
  expect(plain(encodeJson(schema, { row: undefined }))).toEqual({});
  const tagged = await parseEndpointInput(schema, {});
  expect(plain(encodeOutbound({ ...tagged, row: undefined }))).toEqual({});

  const optionalRow = struct.intersection(
    struct.object({ row: Left.optional() }),
    struct.object({ row: Left.optional() }),
  );
  expect(plain(encodeJson(optionalRow, { row: undefined }))).toEqual({});
});

test("nullable intersection input reaches the HTTP handle", async () => {
  let calls = 0;
  const client = createClient(
    withEndpoint("https://example.test"),
    withHTTPHandle(async () => {
      calls += 1;
      return new Response(null, { status: 204 });
    }),
  );
  const request = defineRequest({
    builder: (value) => ({ body: value }),
    input: Nullable,
    method: "POST",
    path: "/",
  });
  const [fault] = await client.execute(request({ name: null }));
  expect(fault).toBeNull();
  expect(calls).toBe(1);
});

test("a union inside a guide set encodes every match and rejects a difference", async () => {
  const value = { name: "N", lastName: "L" };
  expect(() => encodeJson(UnionGuide, { row: value })).toThrow(
    /ambiguous union encode/,
  );
  const tagged = await parseEndpointInput(UnionGuide, { row: value });
  expect(() => encodeOutbound({ ...tagged, row: value })).toThrow(
    /ambiguous union encode/,
  );

  let calls = 0;
  const client = createClient(
    withEndpoint("https://example.test"),
    withHTTPHandle(async () => {
      calls += 1;
      return new Response(null, { status: 204 });
    }),
  );
  const request = defineRequest({
    builder: (input) => ({
      body: {
        ...input,
        row: { lastName: input.row.lastName, name: input.row.name },
      },
    }),
    input: UnionGuide,
    method: "POST",
    path: "/",
  });
  const [fault] = await client.execute(request({ row: value }));
  expect(fault?.code).toBe("REQ_BUILD_FAILED");
  expect(calls).toBe(0);
});

test("wire parsing keeps the union branch that actually matched", async () => {
  const schema = struct.intersection(Choice, B);
  expect(
    plain(struct.parse(schema, { b_name: "N" }, { aliases: true })),
  ).toEqual([null, { name: "N" }]);

  const request = defineRequest({ method: "GET", path: "/", output: schema });
  const client = createClient(
    withEndpoint("https://example.test"),
    withHTTPHandle(async () => Response.json({ b_name: "N" })),
  );
  const [fault, parsed] = await client.execute(request());
  expect(fault).toBeNull();
  expect(plain(parsed)).toEqual({ name: "N" });
});

test("a child tag replaces parent field guides for the whole subtree", async () => {
  const schema = struct.intersection(
    struct.object({ row: A.optional() }),
    struct.object({ row: B.optional() }),
  );
  const tagged = await parseEndpointInput(schema, {});
  const own = await parseEndpointInput(
    struct.object({ name: struct.string().alias("own_name") }),
    { name: "N" },
  );
  expect(plain(encodeOutbound({ ...tagged, row: own }))).toEqual({
    row: { own_name: "N" },
  });

  const single = struct.intersection(
    struct.object({ note: struct.string(), row: Left.optional() }),
    struct.object({ note: struct.string() }),
  );
  const singleRoot = await parseEndpointInput(single, { note: "hi" });
  expect(plain(encodeOutbound({ ...singleRoot, row: own }))).toEqual({
    note: "hi",
    row: { own_name: "N" },
  });
});

test("a record beside an object guides every fresh key at that node", async () => {
  const schema = struct.intersection(
    struct.object({ rows: struct.record(Left) }),
    struct.object({ rows: struct.object({ one: Right }) }),
  );
  const rows = { extra: { firstName: "Grace" }, one: logical };
  const tagged = await parseEndpointInput(schema, { rows });
  const expected = { rows: { extra: { first_name: "Grace" }, one: wire } };
  expect(plain(encodeOutbound(tagged))).toEqual(expected);
  expect(plain(encodeOutbound({ ...tagged, rows }))).toEqual(expected);
});

test("guide-set edges encode null, agreeing unions, records, and non-object members", async () => {
  const nullWire = struct.intersection(
    struct.object({ name: struct.null() }),
    struct.object({ name: struct.string().nullable().alias("wire_name") }),
  );
  expect(plain(encodeJson(nullWire, { name: null }))).toEqual({
    name: null,
    wire_name: null,
  });
  const nullTagged = await parseEndpointInput(nullWire, { name: null });
  expect(plain(encodeOutbound(nullTagged))).toEqual({
    name: null,
    wire_name: null,
  });

  const containers = struct.intersection(
    struct.object({ row: Left.optional() }),
    struct.object({ row: Right.optional() }),
  );
  const empty = await parseEndpointInput(containers, {});
  expect(encodeOutbound({ ...empty, row: null })).toEqual({ row: null });

  const First = struct.object({ id: struct.string().alias("wire_id") });
  const Second = struct.object({ id: struct.string().alias("wire_id") });
  const agreed = struct.intersection(
    struct.object({ row: struct.or(First, Second).optional() }),
    struct.object({
      row: struct
        .object({ title: struct.string().alias("title_name") })
        .optional(),
    }),
  );
  const agreedRoot = await parseEndpointInput(agreed, {});
  expect(
    plain(encodeOutbound({ ...agreedRoot, row: { id: "1", title: "T" } })),
  ).toEqual({
    row: { title_name: "T", wire_id: "1" },
  });

  const unmatched = struct.intersection(
    struct.object({
      row: struct.or(struct.string(), struct.number()).optional(),
    }),
    struct.object({
      row: struct
        .object({ title: struct.string().alias("title_name") })
        .optional(),
    }),
  );
  const unmatchedRoot = await parseEndpointInput(unmatched, {});
  expect(
    plain(encodeOutbound({ ...unmatchedRoot, row: { extra: 1, title: "T" } })),
  ).toEqual({
    row: { extra: 1, title_name: "T" },
  });

  const Cat = struct.object({
    kind: struct.literal("cat"),
    name: struct.string(),
  });
  const missed = struct.intersection(
    struct.object({ pet: struct.discriminatedUnion("kind", [Cat]).optional() }),
    struct.object({
      pet: struct
        .object({ title: struct.string().alias("title_name") })
        .optional(),
    }),
  );
  const missedRoot = await parseEndpointInput(missed, {});
  expect(
    plain(encodeOutbound({ ...missedRoot, pet: { kind: "bird", title: "T" } })),
  ).toEqual({
    pet: { kind: "bird", title_name: "T" },
  });

  const boxed = struct.intersection(
    struct.object({ box: struct.record(struct.string()) }),
    struct.object({
      box: struct.object({ name: struct.string().alias("display_name") }),
    }),
  );
  const boxedRoot = await parseEndpointInput(boxed, {
    box: { extra: "x", name: "Ada" },
  });
  expect(
    plain(encodeOutbound({ ...boxedRoot, box: { extra: "x", name: "Ada" } })),
  ).toEqual({
    box: { display_name: "Ada", extra: "x", name: "Ada" },
  });

  const partial = struct.intersection(
    struct.object({ box: struct.record(struct.string()) }),
    struct.object({
      box: struct.object({
        name: struct.string().alias("display_name").optional(),
        note: struct.string(),
      }),
    }),
  );
  const partialRoot = await parseEndpointInput(partial, {
    box: { note: "hi" },
  });
  expect(
    plain(encodeOutbound({ ...partialRoot, box: { extra: "x", note: "hi" } })),
  ).toEqual({
    box: { extra: "x", note: "hi" },
  });

  const lists = struct.intersection(
    struct.object({ rows: struct.array(Left).optional() }),
    struct.object({ rows: struct.array(Right).optional() }),
  );
  const listsRoot = await parseEndpointInput(lists, {});
  expect(
    plain(encodeOutbound({ ...listsRoot, rows: { extra: logical } })),
  ).toEqual({ rows: { extra: logical } });

  const holes = struct.intersection(
    struct.object({ rows: struct.array(struct.string().optional()) }),
    struct.object({ rows: struct.array(struct.number().optional()) }),
  );
  const holesRoot = await parseEndpointInput(holes, { rows: [] });
  expect(encodeOutbound({ ...holesRoot, rows: [undefined] })).toEqual({
    rows: [undefined],
  });
});

test("outbound encoding of a parsed value matches encodeJson", async () => {
  const shared = struct.intersection(
    struct.object({
      id: struct.string().alias("wire_id"),
      name: struct.string().alias("wire_name"),
    }),
    struct.object({ name: struct.string().alias("wire_name") }),
  );
  const aliased = struct.intersection(
    struct.object({ name: struct.string().alias("a_name") }),
    struct.object({ name: struct.string().alias("b_name") }),
  );
  const recordObject = struct.intersection(
    struct.record(Left),
    struct.object({ one: Right }),
  );
  const tupleArray = struct.intersection(
    struct.array(Left),
    struct.tuple([Right]),
  );
  const Cat = struct.object({
    kind: struct.literal("cat").alias("type"),
    name: struct.string().alias("cat_name"),
  });
  const Dog = struct.object({
    kind: struct.literal("dog").alias("type"),
    name: struct.string().alias("dog_name"),
  });
  const unionInSet = struct.intersection(
    struct.object({ pet: struct.or(Cat, Dog) }),
    struct.object({ pet: Right }),
  );
  const splitParents = struct.intersection(
    struct.object({ profile: Left.alias("p1") }),
    struct.object({ profile: Right.alias("p2") }),
  );
  const recordRoot = struct.intersection(
    struct.record(struct.string()),
    struct.object({ name: struct.string().alias("display_name") }),
  );
  const nested = struct.intersection(
    struct.object({
      meta: struct.record(struct.string()),
      profile: Left.alias("p1"),
    }),
    struct.object({
      meta: struct.object({ name: struct.string().alias("display_name") }),
      profile: Right.alias("p2"),
    }),
  );
  const cases = [
    { input: logical, schema: struct.intersection(Left, Right) },
    { input: { id: "1", name: "Ada" }, schema: shared },
    { input: { name: "N" }, schema: aliased },
    {
      input: { extra: { firstName: "Grace" }, one: logical },
      schema: recordObject,
    },
    { input: [logical], schema: tupleArray },
    {
      input: { pet: { kind: "dog" as const, lastName: "L", name: "D" } },
      schema: unionInSet,
    },
    { input: { name: null }, schema: Nullable },
    { input: { profile: logical }, schema: splitParents },
    { input: { extra: "x", name: "Ada" }, schema: recordRoot },
    {
      input: { meta: { extra: "x", name: "N" }, profile: logical },
      schema: nested,
    },
  ];
  for (const { input, schema } of cases) {
    const tagged = await parseEndpointInput(schema, input as never);
    const encoded = plain(encodeJson(schema, input));
    expectOutboundMatchesEncode(plain(encodeOutbound(tagged)), encoded);
  }
});

// Outbound may keep a key encode.ts dropped, but only as a literal. Another member's wire key is not a literal.
function expectOutboundMatchesEncode(actual: unknown, encoded: unknown): void {
  const wireKeys = new Set<string>();
  collectWireKeys(encoded, wireKeys);
  expectSameWire(actual, encoded, wireKeys);
}

function collectWireKeys(value: unknown, keys: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectWireKeys(item, keys);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(
      value as { [key: string]: unknown },
    )) {
      keys.add(key);
      collectWireKeys(child, keys);
    }
  }
}

function expectSameWire(
  actual: unknown,
  encoded: unknown,
  wireKeys: Set<string>,
): void {
  if (Array.isArray(encoded)) {
    expect(actual).toEqual(expect.any(Array));
    const items = actual as unknown[];
    expect(items).toHaveLength(encoded.length);
    for (let index = 0; index < encoded.length; index += 1) {
      expectSameWire(items[index], encoded[index], wireKeys);
    }
    return;
  }
  if (encoded !== null && typeof encoded === "object") {
    expect(
      actual !== null && typeof actual === "object" && !Array.isArray(actual),
    ).toBe(true);
    const actualObject = actual as { [key: string]: unknown };
    const encodedObject = encoded as { [key: string]: unknown };
    for (const key of Object.keys(encodedObject)) {
      expect(actualObject).toHaveProperty(key);
      expectSameWire(actualObject[key], encodedObject[key], wireKeys);
    }
    for (const key of Object.keys(actualObject)) {
      if (!Object.hasOwn(encodedObject, key)) {
        expect(wireKeys.has(key)).toBe(false);
      }
    }
    return;
  }
  expect(actual).toEqual(encoded);
}
