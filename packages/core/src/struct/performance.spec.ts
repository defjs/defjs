import { describe, expect, test } from "vitest";
import { encodeJson } from "./codec/json";
import { encodeValue } from "./encode";
import { struct } from "./index";
import { parseStructTuple } from "./introspection";
import type { RuntimeStruct, StructLike } from "./types";

describe("performance optimization contracts", () => {
  test("JSON union preserves getter reads and rejects changing wire values", () => {
    const schema = struct.or(
      struct.object({ value: struct.string() }),
      struct.object({ value: struct.string() }),
    );
    let reads = 0;
    const input = {
      get value() {
        reads += 1;
        return reads <= 2 ? "match" : `encoded${reads}`;
      },
    };
    expect(() => encodeJson(schema, input)).toThrow("ambiguous union encode");
    expect(reads).toBe(4);
  });

  test("JSON union preserves different root aliases and omitted optional fields", () => {
    const field = struct.string().optional().alias("wire");
    const left = struct.object({ value: field });
    const right = struct.object({ value: field });
    expect(encodeJson(struct.or(left, right), {})).toEqual({});
    expect(encodeJson(struct.or(left, right), { value: undefined })).toEqual(
      {},
    );
    expect(() =>
      encodeJson(struct.or(left.alias("left"), right.alias("right")), {
        value: "x",
      }),
    ).toThrow("ambiguous union encode");
  });

  test("JSON union does not validate wire collisions in an unmatched branch", () => {
    const schema = struct.or(
      struct.object({ kind: struct.literal("ok"), value: struct.string() }),
      struct.object({
        kind: struct.literal("other").alias("duplicate"),
        value: struct.string().alias("duplicate"),
      }),
    );
    expect(encodeJson(schema, { kind: "ok", value: "x" })).toEqual({
      kind: "ok",
      value: "x",
    });
  });

  test("JSON union compares different declared keys and nested wire values", () => {
    const left = struct.object({
      a: struct.string().optional(),
      nested: struct.object({ x: struct.string() }),
    });
    const right = struct.object({
      b: struct.string().optional(),
      nested: struct.object({ x: struct.string() }),
    });
    expect(
      encodeJson(struct.or(left, right), { nested: { x: "same" } }),
    ).toEqual({ nested: { x: "same" } });
    expect(() =>
      encodeJson(struct.or(left, right), {
        a: "left",
        b: "right",
        nested: { x: "same" },
      }),
    ).toThrow("ambiguous union encode");
    expect(() =>
      encodeJson(
        struct.or(
          struct.object({ nested: struct.object({ x: struct.string() }) }),
          struct.object({
            nested: struct.object({ x: struct.string().alias("y") }),
          }),
        ),
        { nested: { x: "different" } },
      ),
    ).toThrow("ambiguous union encode");
  });

  test("union errorMap observes failed candidates in order even when a later branch succeeds", () => {
    const events: string[] = [];
    const schema = struct.object({
      item: struct.or(struct.number(), struct.boolean(), struct.string()),
    });
    const [error, value] = struct.parse(
      schema,
      { item: "valid" },
      {
        errorMap(issue) {
          events.push(
            `${issue.path.join(".")}:${issue.expected}:${issue.received}`,
          );
          return "custom";
        },
      },
    );
    expect(error).toBeNull();
    expect(value).toEqual({ item: "valid" });
    expect(events).toEqual(["item:number:valid", "item:boolean:valid"]);
  });

  test("union probing preserves errors from reentrant public parsing", () => {
    const innerPaths: (number | string)[][] = [];
    const schema = struct.or(
      struct.object({ value: struct.number() }),
      struct.object({ value: struct.string() }),
    );
    const input = {
      get value() {
        const [error] = struct.parse(
          struct.object({ count: struct.number() }),
          { count: "bad" },
        );
        if (error) innerPaths.push(error.issues[0]?.path ?? []);
        return "valid";
      },
    };
    expect(struct.parse(schema, input)).toEqual([null, { value: "valid" }]);
    expect(innerPaths).toEqual([["count"], ["count"]]);
  });

  test("intersection retains earlier values when a later optional field is omitted", () => {
    const field = struct.string().optional();
    const schema = struct.intersection(
      struct.object({ value: field }),
      struct.object({ value: field }),
    );
    let reads = 0;
    const [error, value] = struct.parse(schema, {
      get value() {
        reads += 1;
        return reads === 1 ? "first" : undefined;
      },
    });
    expect(error).toBeNull();
    expect(value).toEqual({ value: "first" });
    expect(Object.getPrototypeOf(value)).toBeNull();
    expect(reads).toBe(2);
  });

  test("detached modifiers preserve their source schema and remain independent", () => {
    const source = struct.string();
    const { optional, alias, nullish } = source;
    expect(struct.parse(optional(), undefined)).toEqual([null, undefined]);
    expect(struct.parse(nullish(), null)).toEqual([null, null]);
    expect(
      encodeJson(struct.object({ value: alias("wire") }), { value: "x" }),
    ).toEqual({ wire: "x" });
    expect(struct.parse(source, undefined)[0]).not.toBeNull();
  });

  test("JSON intersection merges equal shared wire keys and rejects conflicts", () => {
    const schema = struct.intersection(
      struct.object({ first: struct.string().alias("wire") }),
      struct.object({ second: struct.string().optional().alias("wire") }),
    );
    expect(encodeJson(schema, { first: "first" })).toEqual({ wire: "first" });
    expect(encodeJson(schema, { first: "same", second: "same" })).toEqual({
      wire: "same",
    });
    expect(() =>
      encodeJson(schema, { first: "first", second: "last" }),
    ).toThrow(new TypeError("invalid intersection encode at wire"));
    expect(struct.parse(schema, { first: 1 })[0]?.issues[0]?.path).toEqual([
      "first",
    ]);
    const nullable = struct.intersection(
      struct.object({ x: struct.string() }).nullable(),
      struct.object({ y: struct.string() }).nullable(),
    );
    expect(struct.parse(nullable, null)).toEqual([null, null]);
    expect(encodeJson(nullable, null)).toBeNull();
  });

  test("discarded union candidates retain complete outer errors across container kinds", () => {
    const tagged = struct.discriminatedUnion("kind", [
      struct.object({
        kind: struct.literal("ok").alias("type"),
        value: struct.number(),
      }),
    ]);
    const cases: [StructLike, unknown][] = [
      [struct.object({ value: struct.number() }), {}],
      [struct.number(), null],
      [struct.number(), "bad"],
      [struct.enum(["ok"]), "bad"],
      [struct.literal("ok"), "bad"],
      [struct.array(struct.number()), "bad"],
      [struct.array(struct.number()), [1, "bad"]],
      [struct.object({ value: struct.number() }), []],
      [struct.record(struct.number()), []],
      [struct.record(struct.number()), { value: "bad" }],
      [struct.object({ query: struct.object({ id: struct.number() }) }), "bad"],
      [struct.object({ query: struct.object({ id: struct.number() }) }), {}],
      [struct.object({ body: struct.number() }), {}],
      [struct.object({ body: struct.number() }), { body: "bad" }],
      [struct.tuple([struct.number()]), []],
      [struct.tuple([struct.number()]), ["bad"]],
      [struct.or(struct.number(), struct.boolean()), "bad"],
      [
        struct.intersection(
          struct.object({ value: struct.number() }),
          struct.object({ id: struct.string() }),
        ),
        { value: "bad" },
      ],
      [struct.intersection(struct.string(), struct.literal("ok")), "bad"],
      [tagged, []],
      [tagged, {}],
      [tagged, { kind: "missing", type: "missing" }],
      [tagged, { kind: undefined, type: undefined }],
    ];
    for (const aliases of [false, true]) {
      for (const [candidate, input] of cases) {
        const schema = struct.object({
          nested: struct.or(candidate, struct.literal("fallback")),
        });
        const [error] = parseStructTuple(
          schema,
          { nested: input },
          { aliases },
        );
        expect(error?.issues).toHaveLength(1);
        expect(error?.issues[0]).toMatchObject({
          code: "invalid_union",
          path: ["nested"],
          received: input,
        });
        expect(error?.message).toContain("Expected ");
      }
    }
  });

  test("enum lookup preserves snapshots, numeric equality and modifier independence", () => {
    const values: [string, ...string[]] = ["first", "last"];
    const schema = struct.enum(values);
    expect(struct.parse(schema, "last")).toEqual([null, "last"]);
    values[0] = "changed";
    expect(struct.parse(schema, "first")).toEqual([null, "first"]);
    expect(struct.parse(schema, "changed")[0]).not.toBeNull();
    expect(struct.parse(schema.optional(), undefined)).toEqual([
      null,
      undefined,
    ]);
    expect(struct.parse(schema, undefined)[0]).not.toBeNull();
    const numeric = struct.enum({ nan: NaN, zero: 0 });
    expect(struct.parse(numeric, NaN)).toEqual([null, NaN]);
    expect(struct.parse(numeric, -0)).toEqual([null, -0]);
    expect(
      encodeJson(
        struct.or(
          struct.object({ value: numeric }),
          struct.object({ value: struct.string() }),
        ),
        { value: NaN },
      ),
    ).toEqual({
      value: NaN,
    });
  });

  test("mixed intersections retain generic merging and custom object encoders", () => {
    const mixed = struct.intersection(
      struct.any(),
      struct.object({ value: struct.string() }),
    );
    expect(struct.parse(mixed, { extra: 1, value: "x" })).toEqual([
      null,
      { value: "x" },
    ]);
    const objects = struct.intersection(
      struct.object({ value: struct.string() }),
      struct.object({ value: struct.string() }),
    );
    let calls = 0;
    const output = encodeValue(
      objects as unknown as RuntimeStruct,
      { value: "x" },
      {
        encodeObject() {
          calls += 1;
          return { [`branch${calls}`]: calls, shared: 1 };
        },
      },
    );
    expect(output).toEqual({ branch1: 1, branch2: 2, shared: 1 });
    expect(Object.getPrototypeOf(output)).toBeNull();
    expect(calls).toBe(2);
  });
});
