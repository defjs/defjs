import { expect, test } from "vitest";
import {
  createClient,
  defineRequest,
  struct,
  withEndpoint,
  withHTTPHandle,
} from "../../src";
import type { BodyValue } from "../../src/internal/builder_types";
import { parseEndpointInput } from "../../src/internal/endpoint_input";

const Item = struct.object({ id: struct.string().alias("wire_id") });
const wireItem = { wire_id: "42", extra: "kept" };

async function sendBody(body: BodyValue) {
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
    path: "/round6",
    builder: () => ({ body }),
  });
  const [fault] = await client.execute(endpoint());
  return { fault, sent };
}

test("anonymous parents recurse through arrays of tagged objects beyond depth two", async () => {
  const item = await parseEndpointInput(Item, { id: "42" });
  const result = await sendBody({
    outer: { inner: { rows: [{ ...item, extra: "kept" }] } },
  });
  expect(result.fault).toBeNull();
  expect(result.sent).toEqual([{ outer: { inner: { rows: [wireItem] } } }]);
});

test("records preserve nested extras and aliases", async () => {
  const value = await parseEndpointInput(
    struct.object({ rows: struct.record(Item) }),
    { rows: { selected: { id: "42" } } },
  );
  const result = await sendBody({
    ...value,
    rows: { selected: { ...value.rows["selected"], extra: "kept" } },
  });
  expect(result.fault).toBeNull();
  expect(result.sent).toEqual([{ rows: { selected: wireItem } }]);
});

test("tuples preserve nested extras and aliases", async () => {
  const value = await parseEndpointInput(
    struct.object({ row: struct.tuple([Item]) }),
    { row: [{ id: "42" }] },
  );
  const result = await sendBody({
    ...value,
    row: [{ ...value.row[0], extra: "kept" }],
  });
  expect(result.fault).toBeNull();
  expect(result.sent).toEqual([{ row: [wireItem] }]);
});

test("untagged concrete object children retain their field struct and extras", async () => {
  const value = await parseEndpointInput(struct.object({ row: Item }), {
    row: { id: "42" },
  });
  const result = await sendBody({ ...value, row: { id: "42", extra: "kept" } });
  expect(result.fault).toBeNull();
  expect(result.sent).toEqual([{ row: wireItem }]);
});

test("a child own tag takes precedence over the declared field struct", async () => {
  const value = await parseEndpointInput(struct.object({ row: Item }), {
    row: { id: "42" },
  });
  const replacement = await parseEndpointInput(
    struct.object({ id: struct.string().alias("replacement_id") }),
    { id: "43" },
  );
  const result = await sendBody({
    ...value,
    row: { ...replacement, extra: "kept" },
  });
  expect(result.fault).toBeNull();
  expect(result.sent).toEqual([
    { row: { replacement_id: "43", extra: "kept" } },
  ]);
});

test.each(["anonymous", "record", "tuple", "deep"] as const)(
  "rejects %s collisions before transport",
  async (kind) => {
    const Schema = struct.object({
      record: struct.record(Item),
      tuple: struct.tuple([Item]),
      deep: struct.object({ child: struct.object({ row: Item }) }),
    });
    const value = await parseEndpointInput(Schema, {
      record: { selected: { id: "42" } },
      tuple: [{ id: "42" }],
      deep: { child: { row: { id: "42" } } },
    });
    const collision = { ...value.tuple[0], wire_id: "shadow" };
    const bodies = {
      anonymous: { outer: { inner: [collision] } },
      record: { ...value, record: { selected: collision } },
      tuple: { ...value, tuple: [collision] },
      deep: {
        ...value,
        deep: { ...value.deep, child: { ...value.deep.child, row: collision } },
      },
    };
    const result = await sendBody(bodies[kind]);
    expect(result.fault?.code).toBe("REQ_BUILD_FAILED");
    expect(result.sent).toEqual([]);
  },
);

test("untagged union object children preserve extras", async () => {
  const Schema = struct.object({ row: struct.or(Item, struct.string()) });
  const value = await parseEndpointInput(Schema, { row: { id: "42" } });
  const result = await sendBody({ ...value, row: { id: "42", extra: "kept" } });
  expect(result.fault).toBeNull();
  expect(result.sent).toEqual([{ row: wireItem }]);
});

test.each(["array", "record", "tuple"] as const)(
  "union %s containers preserve tagged object extras",
  async (kind) => {
    const containers = {
      array: struct.array(Item),
      record: struct.record(Item),
      tuple: struct.tuple([Item]),
    };
    const Schema = struct.object({
      rows: struct.or(containers[kind], struct.string()),
    });
    const raw = kind === "record" ? { selected: { id: "42" } } : [{ id: "42" }];
    const value = await parseEndpointInput(Schema, { rows: raw });
    const item = await parseEndpointInput(Item, { id: "42" });
    const row = { ...item, extra: "kept" };
    const result = await sendBody({
      ...value,
      rows: kind === "record" ? { selected: row } : [row],
    });
    expect(result.fault).toBeNull();
    expect(result.sent).toEqual([
      { rows: kind === "record" ? { selected: wireItem } : [wireItem] },
    ]);
  },
);

test("union arrays reject nested collisions before the public HTTP transport", async () => {
  let sends = 0;
  const client = createClient(
    withEndpoint("https://example.test"),
    withHTTPHandle(async () => {
      sends += 1;
      return new Response(null, { status: 204 });
    }),
  );
  const endpoint = defineRequest({
    method: "POST",
    path: "/round6",
    input: struct.object({
      rows: struct.or(struct.array(Item), struct.string()),
    }),
    builder: (input) => ({
      body: {
        ...input,
        rows: Array.isArray(input.rows)
          ? input.rows.map((row) => ({ ...row, wire_id: "shadow" }))
          : input.rows,
      },
    }),
  });
  const [fault] = await client.execute(endpoint({ rows: [{ id: "42" }] }));
  expect(fault?.code).toBe("REQ_BUILD_FAILED");
  expect(sends).toBe(0);
});

test("unknown fields recurse into anonymous containers with tagged children", async () => {
  const parent = await parseEndpointInput(
    struct.object({ payload: struct.unknown() }),
    { payload: {} },
  );
  const item = await parseEndpointInput(Item, { id: "42" });
  const result = await sendBody({
    ...parent,
    payload: { rows: [{ ...item, extra: "kept" }] },
  });
  expect(result.fault).toBeNull();
  expect(result.sent).toEqual([{ payload: { rows: [wireItem] } }]);
});

test("intersection with a union object side retains aliases from both sides", async () => {
  const Schema = struct.intersection(
    struct.object({ firstName: struct.string().alias("first_name") }),
    struct.or(
      struct.object({ lastName: struct.string().alias("last_name") }),
      struct.number(),
    ),
  );
  const value = await parseEndpointInput(Schema, {
    firstName: "Ada",
    lastName: "Lovelace",
  });
  const result = await sendBody(value);
  expect(result.fault).toBeNull();
  expect(result.sent).toEqual([{ first_name: "Ada", last_name: "Lovelace" }]);
});
