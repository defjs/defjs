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

const Item = struct.object({ id: struct.string().alias("wire_id") });
const OtherItem = struct.object({ id: struct.string().alias("other_id") });

test.each([
  [
    "empty arrays",
    struct.or(struct.array(struct.string()), struct.array(struct.number())),
    [],
  ],
  [
    "overlapping scalar arrays",
    struct.or(struct.array(struct.literal("x")), struct.array(struct.string())),
    ["x"],
  ],
  [
    "empty records",
    struct.or(struct.record(struct.string()), struct.record(struct.number())),
    {},
  ],
  [
    "tuple and array",
    struct.or(struct.tuple([struct.string()]), struct.array(struct.string())),
    ["x"],
  ],
  [
    "array and unknown",
    struct.or(struct.array(struct.string()), struct.unknown()),
    ["x"],
  ],
] as const)(
  "accepts equivalent wire encodings for %s through a public endpoint",
  async (_name, field, value) => {
    const sent: unknown[] = [];
    const client = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(async (request) => {
        sent.push(await new Request(request).json());
        return new Response(null, { status: 204 });
      }),
    );
    const endpoint = defineRequest({
      method: "POST",
      path: "/equivalent-union",
      input: struct.object({ value: field }),
      builder: (input) => ({ body: input }),
    });
    const [fault] = await client.execute(endpoint({ value }));
    expect(fault?.code ?? null).toBeNull();
    expect(sent).toEqual([{ value }]);
  },
);

test("own child tags disambiguate the wire encoding of overlapping array branches", async () => {
  const input = await parseEndpointInput(
    struct.object({
      rows: struct.or(struct.array(Item), struct.array(OtherItem)),
    }),
    {
      rows: [{ id: "42" }],
    },
  );
  expect(encodeOutbound(input)).toEqual({ rows: [{ wire_id: "42" }] });
});

test("equivalent untagged object branches keep literal extras", async () => {
  const Plain = struct.object({ id: struct.string() });
  const input = await parseEndpointInput(
    struct.object({ row: struct.or(Plain, struct.unknown()) }),
    { row: { id: "42" } },
  );
  expect(
    encodeOutbound({ ...input, row: { id: "42", extra: "kept" } }),
  ).toEqual({ row: { id: "42", extra: "kept" } });
});

test("different untagged union wire encodings still fail loudly", async () => {
  const input = await parseEndpointInput(
    struct.object({ row: struct.or(Item, OtherItem) }),
    { row: { id: "42" } },
  );
  expect(() => encodeOutbound({ ...input, row: { id: "42" } })).toThrow(
    /ambiguous union encode/,
  );
});

test("unique discriminated and union guides recurse through records and tuples at depth", async () => {
  const Cat = struct.object({
    kind: struct.literal("cat"),
    rows: struct.record(struct.tuple([Item])),
  });
  const Dog = struct.object({
    kind: struct.literal("dog"),
    age: struct.number(),
  });
  const input = await parseEndpointInput(
    struct.object({ pet: struct.discriminatedUnion("kind", [Cat, Dog]) }),
    {
      pet: { kind: "cat", rows: { selected: [{ id: "42" }] } },
    },
  );
  const body = {
    ...input,
    pet: { kind: "cat", rows: { selected: [{ id: "42", extra: "kept" }] } },
  };
  expect(encodeOutbound(body)).toEqual({
    pet: {
      kind: "cat",
      rows: { selected: [{ wire_id: "42", extra: "kept" }] },
    },
  });
  expect(() =>
    encodeOutbound({
      ...input,
      pet: {
        kind: "cat",
        rows: { selected: [{ id: "42", wire_id: "shadow" }] },
      },
    }),
  ).toThrow(/wire key collision/);
});

test("nested mixed intersections retain all object-side tags and hostile keys", async () => {
  const First = struct.object({ first: struct.string().alias("first_wire") });
  const Second = struct.object({
    second: struct.string().alias("second_wire"),
  });
  const Third = struct.object({
    ["__proto__"]: struct.string().alias("proto_wire"),
  });
  const Schema = struct.intersection(
    struct.intersection(First, struct.or(Second, struct.number())),
    struct.or(Third, struct.string()),
  );
  const input = await parseEndpointInput(Schema, {
    first: "A",
    second: "B",
    ["__proto__"]: "safe",
  });
  expect(encodeOutbound(input)).toEqual({
    first_wire: "A",
    second_wire: "B",
    proto_wire: "safe",
  });
  expect(Object.getPrototypeOf(input)).toBeNull();
});

test("object intersections keep literal extras and reject a key that shadows a wire alias", async () => {
  const Left = struct.object({ id: struct.string().alias("wire_id") });
  const Right = struct.object({ n: struct.number() });
  const input = await parseEndpointInput(struct.intersection(Left, Right), {
    id: "42",
    n: 1,
  });
  expect(
    encodeOutbound({ ...input, extra: "kept", dropped: undefined }),
  ).toEqual({ wire_id: "42", n: 1, extra: "kept" });
  expect(() => encodeOutbound({ ...input, wire_id: "shadow" })).toThrow(
    /wire key collision/,
  );
});
