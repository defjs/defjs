import { expect, test } from "vitest";
import { parseEndpointInput } from "../../src/internal/endpoint_input";
import { encodeOutbound } from "../../src/internal/outbound_request";
import { struct, type AnyStruct } from "../../src/struct";
import { encodeJson } from "../../src/struct/codec/json";
import type { Guide } from "../../src/struct/guide";

const Profile = struct.object({ name: struct.string().alias("display_name") });
const plain = (input: unknown): unknown =>
  input === undefined ? undefined : JSON.parse(JSON.stringify(input));

async function equivalent(schema: AnyStruct, input: unknown): Promise<void> {
  const guides = new WeakMap<object, Guide>();
  const parsed = await parseEndpointInput(schema, input as never, guides);
  expect(plain(encodeOutbound(parsed, guides))).toEqual(
    plain(encodeJson(schema, parsed)),
  );
}

test("object intersected with or(any() | number()) keeps the passthrough logical key", async () => {
  await equivalent(
    struct.intersection(Profile, struct.or(struct.any(), struct.number())),
    { name: "N" },
  );
});

test("object intersected with or(unknown() | number()) keeps the passthrough logical key", async () => {
  await equivalent(
    struct.intersection(Profile, struct.or(struct.unknown(), struct.number())),
    { name: "N" },
  );
});

test("root array(any()) intersected with array(object) keeps logical and aliased item keys", async () => {
  await equivalent(
    struct.intersection(struct.array(struct.any()), struct.array(Profile)),
    [{ name: "N" }],
  );
});

test("nullable passthrough array items merge null", async () => {
  await equivalent(
    struct.object({
      rows: struct.intersection(
        struct.array(struct.any().nullable()),
        struct.array(Profile.nullable()),
      ),
    }),
    { rows: [null] },
  );
});

test("optional passthrough array items merge undefined", async () => {
  await equivalent(
    struct.object({
      rows: struct.intersection(
        struct.array(struct.unknown().optional()),
        struct.array(Profile.optional()),
      ),
    }),
    { rows: [undefined] },
  );
});

test("primitive passthrough array items merge scalars", async () => {
  await equivalent(
    struct.object({
      rows: struct.intersection(
        struct.array(struct.any()),
        struct.array(struct.string()),
      ),
    }),
    { rows: ["N"] },
  );
});

test("a parent array of objects still keeps passthrough keys beside aliases", async () => {
  await equivalent(
    struct.object({
      rows: struct.intersection(
        struct.array(struct.any()),
        struct.array(Profile),
      ),
    }),
    { rows: [{ name: "N" }] },
  );
});

test("direct any stays an intersection identity and does not repeat the logical key", async () => {
  const schema = struct.intersection(Profile, struct.any());
  const parsed = await parseEndpointInput(schema, { name: "N" });
  expect(plain(encodeJson(schema, parsed))).toEqual({ display_name: "N" });
  expect(plain(encodeOutbound(parsed))).toEqual({ display_name: "N" });
});

test("a selected concrete union branch stays concrete beside a number", async () => {
  await equivalent(
    struct.intersection(
      struct.or(struct.number(), struct.any()),
      struct.number(),
    ),
    7,
  );
});

test("a passthrough any beside a scalar number does not tag the scalar", async () => {
  await equivalent(
    struct.intersection(
      struct.or(struct.any(), struct.string()),
      struct.number(),
    ),
    7,
  );
});

test("any and unknown unions keep a nested logical key when no object struct parsed the parent", async () => {
  const profile = await parseEndpointInput(Profile, { name: "N" });
  await equivalent(
    struct.intersection(
      struct.or(struct.any(), struct.number()),
      struct.or(struct.unknown(), struct.string()),
    ),
    {
      row: profile,
    },
  );
});

test("passthrough any conflicts with an encoded date on the same key", async () => {
  const schema = struct.intersection(
    struct.object({ when: struct.date() }),
    struct.or(struct.any(), struct.number()),
  );
  const parsed = await parseEndpointInput(schema, {
    when: new Date("2026-01-02T00:00:00.000Z"),
  });
  expect(() => encodeJson(schema, parsed)).toThrow(
    /invalid intersection encode/,
  );
  expect(() => encodeOutbound(parsed)).toThrow(/invalid intersection encode/);
});

test("a passthrough array item conflicts with an encoded date", async () => {
  const schema = struct.object({
    rows: struct.intersection(
      struct.array(struct.any()),
      struct.array(struct.date()),
    ),
  });
  const parsed = await parseEndpointInput(schema, {
    rows: [new Date("2026-01-02T00:00:00.000Z")],
  });
  expect(() => encodeJson(schema, parsed)).toThrow(
    /invalid intersection encode/,
  );
  expect(() => encodeOutbound(parsed)).toThrow(/invalid intersection encode/);
});
