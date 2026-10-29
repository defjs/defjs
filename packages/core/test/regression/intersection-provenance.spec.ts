import { expect, test } from "vitest";
import {
  createClient,
  defineRequest,
  struct,
  withEndpoint,
  withHTTPHandle,
  type AnyStruct,
} from "../../src";
import { encodeOutbound } from "../../src/internal/outbound_request";
import type { Guide } from "../../src/struct/guide";
import { parseStructValue } from "../../src/struct/introspection";

const ISO = "2026-01-02T00:00:00.000Z";
const opaque = [
  ["any", struct.any],
  ["unknown", struct.unknown],
] as const;

async function post(schema: AnyStruct, input: unknown) {
  let parsed: unknown;
  let body: string | undefined;
  let builderCalls = 0;
  let handleCalls = 0;
  const client = createClient(
    withEndpoint("https://example.test"),
    withHTTPHandle(async (request, init) => {
      handleCalls += 1;
      body = await new Request(request, init).text();
      return new Response(null, { status: 204 });
    }),
  );
  const endpoint = defineRequest({
    builder: (value) => {
      builderCalls += 1;
      parsed = value;
      return { body: value };
    },
    input: schema,
    method: "POST",
    path: "/",
  });
  const [fault] = await client.execute(endpoint(input as never));
  return { body, builderCalls, fault, handleCalls, parsed };
}

test("intersection tagging does not read a union branch after the first success", async () => {
  let reads = 0;
  const schema = struct.intersection(
    struct.or(
      struct.object({ id: struct.string() }),
      struct.object({ later: struct.string() }),
    ),
    struct.object({ note: struct.string() }),
  );
  const input = {
    id: "1",
    get later(): string {
      reads += 1;
      throw new Error("unselected branch");
    },
    note: "ok",
  };
  const result = await post(schema, input);
  expect(reads).toBe(0);
  expect(result.fault).toBeNull();
  expect(result.builderCalls).toBe(1);
  expect(result.handleCalls).toBe(1);
  expect(result.body).toBe('{"id":"1","note":"ok"}');
});

for (const [kind, passthrough] of opaque) {
  test.each(["2", 2n])(
    `intersection keeps the parsed bigint branch before ${kind} for %s`,
    async (count) => {
      const schema = struct.intersection(
        struct.or(
          struct.object({ count: struct.bigint().alias("wire_count") }),
          passthrough(),
        ),
        struct.object({ id: struct.string().alias("wire_id") }),
      );
      const result = await post(schema, { count, id: "1" });
      expect(result.fault).toBeNull();
      expect(result.builderCalls).toBe(1);
      expect(result.handleCalls).toBe(1);
      expect(result.parsed).toMatchObject({ count: 2n, id: "1" });
      expect(result.body).toBe('{"wire_count":"2","wire_id":"1"}');
    },
  );

  test.each([ISO, Date.parse(ISO), new Date(ISO)])(
    `intersection keeps the parsed date branch before ${kind} for %s`,
    async (when) => {
      const schema = struct.intersection(
        struct.or(
          struct.object({ when: struct.date().alias("wire_when") }),
          passthrough(),
        ),
        struct.object({ id: struct.string().alias("wire_id") }),
      );
      const result = await post(schema, { id: "1", when });
      expect(result.fault).toBeNull();
      expect(result.builderCalls).toBe(1);
      expect(result.handleCalls).toBe(1);
      expect(result.parsed).toMatchObject({ id: "1", when: new Date(ISO) });
      expect(result.body).toBe(
        '{"wire_when":"2026-01-02T00:00:00.000Z","wire_id":"1"}',
      );
    },
  );

  test(`intersection preserves a genuinely selected ${kind} fallback beside aliases`, async () => {
    const schema = struct.intersection(
      struct.or(struct.number(), passthrough()),
      struct.object({ name: struct.string().alias("display_name") }),
    );
    const input = { name: "N" };
    const before = Object.getOwnPropertyDescriptors(input);
    const result = await post(schema, input);
    expect(result.fault).toBeNull();
    expect(result.body).toBe('{"display_name":"N","name":"N"}');
    expect(Object.getOwnPropertyDescriptors(input)).toEqual(before);
  });
}

const root = struct.intersection(
  struct.or(struct.unknown(), struct.string()),
  struct.or(struct.any(), struct.number()),
);
const array = struct.intersection(
  struct.array(struct.any()),
  struct.array(struct.unknown()),
);
const integrity = [
  ["freeze", (value: { value: string }) => Object.freeze(value)],
  [
    "preventExtensions",
    (value: { value: string }) => Object.preventExtensions(value),
  ],
] as const;

for (const [kind, protect] of integrity) {
  test(`opaque intersection accepts a ${kind} root without replacing it`, async () => {
    const input = protect({ value: "kept" });
    const before = Object.getOwnPropertyDescriptors(input);
    const result = await post(root, input);
    expect(result.fault).toBeNull();
    expect(result.builderCalls).toBe(1);
    expect(result.handleCalls).toBe(1);
    expect(result.parsed).toBe(input);
    expect(result.body).toBe('{"value":"kept"}');
    expect(Object.getOwnPropertyDescriptors(input)).toEqual(before);
  });

  test(`opaque array intersection accepts a ${kind} child without replacing it`, async () => {
    const child = protect({ value: "kept" });
    const before = Object.getOwnPropertyDescriptors(child);
    const result = await post(array, [child]);
    expect(result.fault).toBeNull();
    expect(result.builderCalls).toBe(1);
    expect(result.handleCalls).toBe(1);
    expect((result.parsed as unknown[])[0]).toBe(child);
    expect(result.body).toBe('[{"value":"kept"}]');
    expect(Object.getOwnPropertyDescriptors(child)).toEqual(before);
  });
}

test.each([false, true])(
  "opaque intersection leaves all caller descriptors and symbols unchanged (array=%s)",
  async (inArray) => {
    const input = Object.defineProperties(
      { value: "kept" },
      {
        hidden: { value: 1 },
        [Symbol("caller")]: { configurable: true, value: "owned" },
      },
    );
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const symbols = Object.getOwnPropertySymbols(input);
    const result = await post(
      inArray ? array : root,
      inArray ? [input] : input,
    );
    expect(result.fault).toBeNull();
    expect(Object.getOwnPropertyDescriptors(input)).toEqual(descriptors);
    expect(Object.getOwnPropertySymbols(input)).toEqual(symbols);
    expect(inArray ? (result.parsed as unknown[])[0] : result.parsed).toBe(
      input,
    );
    expect(result.body).toBe(
      inArray ? '[{"value":"kept"}]' : '{"value":"kept"}',
    );
  },
);

test.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])(
  "opaque intersection keeps a tagged child as stored JSON (frozen=%s, array=%s)",
  async (frozen, inArray) => {
    const profile = await post(
      struct.object({ name: struct.string().alias("display_name") }),
      { name: "N" },
    );
    expect(profile.fault).toBeNull();
    expect(profile.body).toBe('{"display_name":"N"}');
    const input = { row: profile.parsed };
    if (frozen) Object.freeze(input);
    const before = Object.getOwnPropertyDescriptors(input);
    const result = await post(
      inArray ? array : root,
      inArray ? [input] : input,
    );
    expect(result.fault).toBeNull();
    expect(inArray ? (result.parsed as unknown[])[0] : result.parsed).toBe(
      input,
    );
    expect(result.body).toBe(
      inArray ? '[{"row":{"name":"N"}}]' : '{"row":{"name":"N"}}',
    );
    expect(Object.getOwnPropertyDescriptors(input)).toEqual(before);
  },
);

test("a discarded union candidate cannot leave opaque guides on the selected branch", async () => {
  const profile = await post(
    struct.object({ name: struct.string().alias("display_name") }),
    { name: "N" },
  );
  expect(profile.fault).toBeNull();
  const payload = { row: profile.parsed };
  const before = Object.getOwnPropertyDescriptors(payload);
  const schema = struct.or(
    struct.object({ payload: root, missing: struct.string() }),
    struct.object({ payload: struct.unknown() }),
  );
  const result = await post(schema, { payload });
  expect(result.fault).toBeNull();
  expect(result.body).toBe('{"payload":{"row":{"display_name":"N"}}}');
  expect((result.parsed as { payload: unknown }).payload).toBe(payload);
  expect(Object.getOwnPropertyDescriptors(payload)).toEqual(before);
});

test.each([false, true])(
  "a failed tagged parse restores pre-existing contextual guides (getter throws=%s)",
  (throws) => {
    const profile = struct.object({
      name: struct.string().alias("display_name"),
    });
    const value = { name: "N" };
    const guides = new WeakMap<object, Guide>([
      [value, profile as unknown as Guide],
    ]);
    const schema = struct.object({ payload: root, missing: struct.string() });
    const original = new RangeError("caller getter");
    const input = {
      payload: value,
      get missing(): unknown {
        if (throws) throw original;
        return undefined;
      },
    };
    expect(() =>
      parseStructValue(schema, input, { tagObjects: true, guides }),
    ).toThrow(throws ? original : /Expected string at missing/);
    expect(encodeOutbound(value, guides)).toEqual({ display_name: "N" });
    expect(Object.getOwnPropertySymbols(value)).toEqual([]);
  },
);

test("a single opaque union member remains borrowed beside an intersection identity", async () => {
  const schema = struct.intersection(
    struct.or(struct.unknown(), struct.string()),
    struct.unknown(),
  );
  const input = Object.freeze({ value: "kept" });
  const result = await post(schema, input);
  expect(result.fault).toBeNull();
  expect(result.parsed).toBe(input);
  expect(result.body).toBe('{"value":"kept"}');
});
