import { expect, test } from "vitest";
import {
  createClient,
  defineEventStream,
  defineRequest,
  struct,
  withEndpoint,
  withHTTPHandle,
  withSSEHandle,
} from "../../src";
import { encodeObjectByAlias } from "../encode-by-alias";
import { parseEndpointInput } from "../../src/internal/endpoint_input";
import { encodeOutbound } from "../../src/struct/encode";
import { DEFINITION, STRUCT } from "../../src/struct/symbols";
import { assertObject, symbolValue } from "../narrow";
import {
  serializeOutgoingWebSocketMessage,
  decodeWebSocketMessage,
} from "../../src/web_socket/codec";

const Person = struct.intersection(
  struct.object({ firstName: struct.string().alias("first_name") }),
  struct.or(
    struct.object({ lastName: struct.string().alias("last_name") }),
    struct.number(),
  ),
);
const wire = { first_name: "Ada", last_name: "Lovelace" };
const logical = { firstName: "Ada", lastName: "Lovelace" };

const SharedWire = struct.intersection(
  struct.object({
    firstName: struct.string().alias("first_name"),
    left: struct.string().alias("shared"),
  }),
  struct.or(
    struct.object({
      lastName: struct.string().alias("last_name"),
      right: struct.string().alias("shared"),
    }),
    struct.number(),
  ),
);

const Loose = struct.intersection(
  struct.unknown(),
  struct.object({ name: struct.string().alias("full_name") }),
);

test("struct.parse merges every structured member of a mixed intersection", () => {
  const [aliasedFault, aliased] = struct.parse(Person, wire, { aliases: true });
  expect(aliasedFault).toBeNull();
  expect(aliased).toEqual(logical);
  expect(Object.getPrototypeOf(aliased)).toBeNull();

  const [logicalFault, parsed] = struct.parse(Person, logical);
  expect(logicalFault).toBeNull();
  expect(parsed).toEqual(logical);
  expect(Object.getPrototypeOf(parsed)).toBeNull();
});

test("struct.parse does not merge raw unknown wire keys into an aliased object", () => {
  expect(
    struct.parse(Loose, { extra: true, full_name: "Miao" }, { aliases: true }),
  ).toEqual([null, { name: "Miao" }]);
  expect(
    struct.parse(
      struct.intersection(
        struct.unknown(),
        struct.object({ name: struct.string() }),
      ),
      { extra: true, name: "Miao" },
    ),
  ).toEqual([null, { name: "Miao" }]);
  expect(
    struct.parse(struct.intersection(struct.unknown(), struct.string()), "x", {
      aliases: true,
    }),
  ).toEqual([null, "x"]);
  expect(
    struct.parse(struct.intersection(struct.unknown(), struct.string()), "x"),
  ).toEqual([null, "x"]);
});

test("unknown and any are intersection identities and an all-identity intersection returns the input", () => {
  const input = { extra: 1 };
  const identities = struct.intersection(struct.unknown(), struct.any());
  expect(struct.parse(identities, input)).toEqual([null, input]);
  expect(struct.parse(identities, input)[1]).toBe(input);
  expect(struct.parse(identities, input, { aliases: true })[1]).toBe(input);
  expect(encodeObjectByAlias(identities, input)).toBe(input);

  const nested = struct.intersection(
    struct.intersection(struct.unknown(), struct.any()),
    struct.object({ name: struct.string() }),
  );
  expect(struct.parse(nested, { extra: true, name: "Miao" })).toEqual([
    null,
    { name: "Miao" },
  ]);
  expect(
    struct.parse(
      struct.intersection(
        struct.intersection(
          struct.unknown(),
          struct.object({ name: struct.string() }),
        ),
        struct.object({ age: struct.number() }),
      ),
      {
        age: 1,
        extra: true,
        name: "Miao",
      },
    ),
  ).toEqual([null, { age: 1, name: "Miao" }]);
});

test("struct encode merges every structured member of a mixed intersection", () => {
  expect(encodeObjectByAlias(Person, logical)).toEqual(wire);
  expect(
    Object.getPrototypeOf(encodeObjectByAlias(Person, logical)),
  ).toBeNull();
  expect(() =>
    encodeObjectByAlias(SharedWire, {
      firstName: "Ada",
      lastName: "Lovelace",
      left: "L",
      right: "R",
    }),
  ).toThrow(new TypeError("invalid intersection encode at shared"));
  expect(
    encodeObjectByAlias(SharedWire, {
      firstName: "Ada",
      lastName: "Lovelace",
      left: "same",
      right: "same",
    }),
  ).toEqual({
    first_name: "Ada",
    last_name: "Lovelace",
    shared: "same",
  });
});

test("struct encode does not merge raw unknown keys into an aliased object", () => {
  expect(encodeObjectByAlias(Loose, { extra: true, name: "Miao" })).toEqual({
    full_name: "Miao",
  });
  expect(
    encodeObjectByAlias(
      struct.intersection(struct.unknown(), struct.string()),
      "x",
    ),
  ).toBe("x");
  expect(
    encodeObjectByAlias(struct.intersection(struct.unknown(), struct.any()), {
      extra: 1,
    }),
  ).toEqual({ extra: 1 });
});

test.each([200, 403] as const)(
  "HTTP %s preserves every mixed-intersection member",
  async (status) => {
    const endpoint = defineRequest({
      method: "GET",
      path: "/person",
      output: Person,
      error: Person,
    });
    const client = createClient(
      withEndpoint("https://example.test"),
      withHTTPHandle(() => Promise.resolve(Response.json(wire, { status }))),
    );
    const [fault, person] = await endpoint(client);

    expect(fault?.code ?? null).toBe(status === 200 ? null : "HTTP_STATUS");
    const data = fault?.code === "HTTP_STATUS" ? fault.data : person;
    expect(data).toEqual(logical);
    expect(Object.getPrototypeOf(data)).toBeNull();
  },
);

test("SSE event data preserves every mixed-intersection member", async () => {
  const endpoint = defineEventStream({
    events: { person: Person },
    path: "/person",
  });
  const client = createClient(
    withEndpoint("https://example.test"),
    withSSEHandle(() => {
      const body = `event: person\ndata: ${JSON.stringify(wire)}\n\n`;
      return Promise.resolve(
        new Response(body, {
          headers: { "content-type": "text/event-stream" },
          status: 200,
        }),
      );
    }),
  );
  const [fault, stream] = await endpoint(client);

  expect(fault).toBeNull();
  if (!stream) {
    throw new Error("Expected stream");
  }
  const events = [];
  for await (const event of stream) {
    events.push(event);
  }
  expect(events).toEqual([{ data: logical, event: "person", id: undefined }]);
});

test("WebSocket codecs preserve every mixed-intersection member", () => {
  expect(decodeWebSocketMessage(Person, JSON.stringify(wire))).toEqual(logical);
  expect(
    JSON.parse(serializeOutgoingWebSocketMessage(Person, logical)),
  ).toEqual(wire);
  expect(() =>
    serializeOutgoingWebSocketMessage(SharedWire, {
      firstName: "Ada",
      lastName: "Lovelace",
      left: "L",
      right: "R",
    }),
  ).toThrow(new TypeError("invalid intersection encode at shared"));
});

test("equal shared primitives merge and conflicting ones fail at that path", () => {
  const Same = struct.intersection(
    struct.object({ id: struct.string(), name: struct.string() }),
    struct.object({ id: struct.string() }),
  );
  expect(struct.parse(Same, { id: "same", name: "Ada" })).toEqual([
    null,
    { id: "same", name: "Ada" },
  ]);
  expect(
    Object.getPrototypeOf(struct.parse(Same, { id: "same", name: "Ada" })[1]),
  ).toBeNull();

  let reads = 0;
  const [fastError] = struct.parse(
    struct.intersection(
      struct.object({ id: struct.string() }),
      struct.object({ id: struct.string() }),
    ),
    {
      get id() {
        reads += 1;
        return reads === 1 ? "L" : "R";
      },
    },
  );
  expect(fastError?.issues).toEqual([
    expect.objectContaining({
      code: "invalid_intersection",
      expected: "compatible intersection value",
      path: ["id"],
      received: "R",
    }),
  ]);
  expect(fastError?.format()["id"]).toEqual({
    _errors: ["Expected compatible intersection value at id, received string"],
  });
  expect(fastError?.flatten()).toEqual({
    fieldErrors: {
      id: ["Expected compatible intersection value at id, received string"],
    },
    formErrors: [],
  });
  expect(fastError?.prettify()).toContain(
    "× id: Expected compatible intersection value at id, received string",
  );
});

test("nested objects and equal-length arrays merge element-wise", () => {
  const Nested = struct.intersection(
    struct.object({ profile: struct.object({ name: struct.string() }) }),
    struct.object({ profile: struct.object({ age: struct.number() }) }),
  );
  const [nestedError, nested] = struct.parse(Nested, {
    profile: { age: 1, name: "Ada" },
  });
  expect(nestedError).toBeNull();
  expect(nested).toEqual({ profile: { age: 1, name: "Ada" } });
  expect(Object.getPrototypeOf(nested?.profile)).toBeNull();

  const Rows = struct.intersection(
    struct.array(struct.object({ name: struct.string() })),
    struct.array(struct.object({ age: struct.number() })),
  );
  expect(struct.parse(Rows, [{ age: 1, name: "Ada" }])).toEqual([
    null,
    [{ age: 1, name: "Ada" }],
  ]);

  const [elementError] = struct.parse(
    struct.intersection(
      struct.array(struct.date()),
      struct.array(struct.string()),
    ),
    ["2020-01-01T00:00:00.000Z"],
  );
  expect(elementError?.issues[0]).toMatchObject({
    code: "invalid_intersection",
    path: [0],
    received: "2020-01-01T00:00:00.000Z",
  });

  const [rootError] = struct.parse(
    struct.intersection(struct.date(), struct.string()),
    "2020-01-01T00:00:00.000Z",
  );
  expect(rootError?.issues[0]).toMatchObject({
    code: "invalid_intersection",
    path: [],
    received: "2020-01-01T00:00:00.000Z",
  });
  expect(rootError?.flatten().formErrors).toEqual([
    "Expected compatible intersection value at <root>, received string",
  ]);
  expect(rootError?.format()._errors).toEqual([
    "Expected compatible intersection value at <root>, received string",
  ]);

  const [dateError, date] = struct.parse(
    struct.intersection(struct.date(), struct.date()),
    "2020-01-01T00:00:00.000Z",
  );
  expect(dateError).toBeNull();
  expect(date).toBeInstanceOf(Date);
  if (!(date instanceof Date)) throw new Error("Expected a date");
  expect(date.toISOString()).toBe("2020-01-01T00:00:00.000Z");
});

test("unequal dates are an intersection conflict", () => {
  let reads = 0;
  const [error] = struct.parse(
    struct.intersection(
      struct.object({ when: struct.date() }),
      struct.object({ when: struct.date() }),
    ),
    {
      get when() {
        reads += 1;
        return reads === 1
          ? "2020-01-01T00:00:00.000Z"
          : "2021-01-01T00:00:00.000Z";
      },
    },
  );
  expect(error?.issues[0]?.code).toBe("invalid_intersection");
  expect(error?.issues[0]?.path).toEqual(["when"]);
  expect(error?.issues[0]?.received).toBeInstanceOf(Date);
});

test("a conflicting intersection inside a union stays a quiet candidate failure", () => {
  let reads = 0;
  const [objectError, objectValue] = struct.parse(
    struct.or(
      struct.intersection(
        struct.object({ id: struct.string() }),
        struct.object({ id: struct.string() }),
      ),
      struct.literal("fallback"),
    ),
    {
      get id() {
        reads += 1;
        return reads === 1 ? "L" : "R";
      },
    },
  );
  expect(objectValue).toBeUndefined();
  expect(objectError?.issues[0]?.code).toBe("invalid_union");
  expect(reads).toBe(2);

  const [rootError, rootValue] = struct.parse(
    struct.or(
      struct.intersection(struct.date(), struct.string()),
      struct.literal("fallback"),
    ),
    "2020-01-01T00:00:00.000Z",
  );
  expect(rootValue).toBeUndefined();
  expect(rootError?.issues[0]?.code).toBe("invalid_union");
});

test("tagged outbound encode deep-merges nested objects and reports wire conflicts as REQ_BUILD_FAILED", async () => {
  const Nested = struct.intersection(
    struct.object({
      profile: struct.object({ name: struct.string().alias("full_name") }),
    }),
    struct.object({
      profile: struct.object({ age: struct.number().alias("years") }),
    }),
  );
  let sent: unknown;
  const nestedEndpoint = defineRequest({
    builder: (input) => ({ body: input }),
    input: Nested,
    method: "POST",
    path: "/nested",
  });
  const nestedClient = createClient(
    withEndpoint("https://example.test"),
    withHTTPHandle(async (request) => {
      sent = await new Request(request).json();
      return new Response(null, { status: 204 });
    }),
  );
  const [nestedFault] = await nestedEndpoint(nestedClient, {
    profile: { age: 1, name: "Ada" },
  });
  expect(nestedFault).toBeNull();
  expect(sent).toEqual({ profile: { full_name: "Ada", years: 1 } });

  const Shared = struct.intersection(
    struct.object({ left: struct.string().alias("shared") }),
    struct.object({ right: struct.string().alias("shared") }),
  );
  const endpoint = defineRequest({
    builder: (input) => ({ body: input.pair }),
    input: struct.object({ pair: Shared }),
    method: "POST",
    path: "/pair",
  });
  let equalSent: unknown;
  const client = createClient(
    withEndpoint("https://example.test"),
    withHTTPHandle(async (request) => {
      equalSent = await new Request(request).json();
      return new Response(null, { status: 204 });
    }),
  );
  const [equalFault] = await endpoint(client, {
    pair: { left: "same", right: "same" },
  });
  expect(equalFault).toBeNull();
  expect(equalSent).toEqual({ shared: "same" });

  const [fault] = await endpoint(client, { pair: { left: "L", right: "R" } });
  expect(fault?.code).toBe("REQ_BUILD_FAILED");
  expect(fault?.cause).toBeInstanceOf(TypeError);
  if (!(fault?.cause instanceof TypeError)) {
    throw new Error("expected intersection encode TypeError");
  }
  expect(fault.cause.message).toBe("invalid intersection encode at shared");
});

test("record intersections tag every record container and emit each wire key", () => {
  const Rows = struct.intersection(
    struct.record(struct.string()),
    struct.record(struct.string()),
  );
  const rows = parseEndpointInput(Rows, { name: "Ada" });
  expect(Object.fromEntries(Object.entries(rows))).toEqual({ name: "Ada" });
  const rowsTag = structTag(rows);
  expect(rowsTag).toBeDefined();
  expect(Object.hasOwn(rowsTag, DEFINITION)).toBe(false);
  expect(JSON.parse(JSON.stringify(encodeOutbound(rows)))).toEqual(
    encodeObjectByAlias(Rows, { name: "Ada" }),
  );

  const Mixed = struct.intersection(
    struct.record(struct.string()),
    struct.object({ name: struct.string().alias("display_name") }),
  );
  const mixed = parseEndpointInput(Mixed, { extra: "kept", name: "Ada" });
  expect(Object.fromEntries(Object.entries(mixed))).toEqual({
    extra: "kept",
    name: "Ada",
  });
  const mixedTag = structTag(mixed);
  expect(mixedTag).toBeDefined();
  expect(Object.hasOwn(mixedTag, DEFINITION)).toBe(false);
  expect(JSON.parse(JSON.stringify(encodeOutbound(mixed)))).toEqual(
    encodeObjectByAlias(Mixed, { extra: "kept", name: "Ada" }),
  );
});

test("tagged object intersections keep a guide set for equal shared fields and an absent optional", () => {
  const SharedId = struct.intersection(
    struct.object({ id: struct.string() }),
    struct.object({ id: struct.string(), name: struct.string() }),
  );
  const shared = parseEndpointInput(SharedId, { id: "1", name: "Ada" });
  expect(Object.fromEntries(Object.entries(shared))).toEqual({
    id: "1",
    name: "Ada",
  });
  const sharedTag = structTag(shared);
  expect(sharedTag).toBeDefined();
  expect(Object.hasOwn(sharedTag, DEFINITION)).toBe(false);

  const MixedField = struct.intersection(
    struct.object({
      profile: struct.object({ name: struct.string() }).optional(),
    }),
    struct.object({ profile: struct.string().optional() }),
  );
  const mixed = parseEndpointInput(MixedField, {});
  expect(Object.fromEntries(Object.entries(mixed))).toEqual({});
  const mixedTag = structTag(mixed);
  expect(mixedTag).toBeDefined();
  expect(Object.hasOwn(mixedTag, DEFINITION)).toBe(false);
});

test("object-side encode skips an explicit undefined alias and an omitted logical key", () => {
  const Aliased = struct.intersection(
    struct.object({ first: struct.string().alias("wire") }),
    struct.object({ second: struct.string().optional().alias("other") }),
  );
  expect(
    encodeObjectByAlias(Aliased, { first: "first", second: undefined }),
  ).toEqual({
    wire: "first",
  });

  const Logical = struct.intersection(
    struct.object({ id: struct.string() }),
    struct.object({ note: struct.string().optional() }),
  );
  const encoded = encodeObjectByAlias(Logical, { id: "1" });
  expect(encoded).toEqual({ id: "1" });
  expect(Object.getPrototypeOf(encoded)).toBeNull();
});

test("tagged date intersections keep the equal date and do not attach an object tag", () => {
  const Both = struct.intersection(struct.date(), struct.date());
  const value = parseEndpointInput(Both, "2020-01-01T00:00:00.000Z");
  expect(value).toBeInstanceOf(Date);
  expect(value.toISOString()).toBe("2020-01-01T00:00:00.000Z");
  expect(symbolValue(value, STRUCT)).toBeUndefined();
});

function structTag(value: unknown): object {
  return assertObject(symbolValue(value, STRUCT), "struct tag");
}
