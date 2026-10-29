import { describe, expect, test } from "vitest";
import { StructError, struct } from "./index";
import { parseStructTuple as parse } from "./introspection";

describe("constructors.ts discriminatedUnion", () => {
  const event = struct.discriminatedUnion("type", [
    struct.object({
      type: struct.literal("click"),
      x: struct.number(),
      y: struct.number(),
    }),
    struct.object({
      type: struct.literal("scroll"),
      delta: struct.number(),
    }),
    struct.object({
      type: struct.literal("keypress"),
      key: struct.string(),
    }),
  ]);

  test("routes payload by discriminator field in O(1)", () => {
    const [e1, v1] = parse(event, { type: "click", x: 10, y: 20 });
    if (e1) {
      throw e1;
    }
    expect(v1).toEqual({ type: "click", x: 10, y: 20 });

    const [e2, v2] = parse(event, { type: "scroll", delta: 5 });
    if (e2) {
      throw e2;
    }
    expect(v2).toEqual({ type: "scroll", delta: 5 });

    const [e3, v3] = parse(event, { type: "keypress", key: "Enter" });
    if (e3) {
      throw e3;
    }
    expect(v3).toEqual({ type: "keypress", key: "Enter" });
  });

  test("reports invalid_union with declared values on unknown discriminator", () => {
    const [err] = parse(event, { type: "unknown", payload: "no" });
    expect(err).toBeInstanceOf(StructError);
    const issue = err?.issues[0];
    expect(issue?.code).toBe("invalid_union");
    expect(issue?.path).toEqual(["type"]);
    expect(issue?.expected).toBe('"click" | "scroll" | "keypress"');
    expect(issue?.received).toBe("unknown");
    expect(issue?.message).toBe(
      'Expected "click" | "scroll" | "keypress" at type, received string',
    );
  });

  test("reports missing_key when the discriminator is absent", () => {
    const [err, value] = parse(event, { x: 10, y: 20 });

    expect(err).toBeInstanceOf(StructError);
    expect(err?.issues).toHaveLength(1);
    expect(err?.issues[0]?.code).toBe("missing_key");
    expect(err?.issues[0]?.path).toEqual(["type"]);
    expect(value).toBeUndefined();
  });

  test("does not read an inherited discriminator value", () => {
    const ConstructorEvent = struct.discriminatedUnion("constructor", [
      struct.object({
        constructor: struct.literal("event"),
        value: struct.string(),
      }),
    ]);
    const [err, value] = parse(ConstructorEvent, {});

    expect(err).toBeInstanceOf(StructError);
    expect(err?.issues[0]?.code).toBe("missing_key");
    expect(err?.issues[0]?.path).toEqual(["constructor"]);
    expect(value).toBeUndefined();
  });

  test("forwards selected branch issues with full path", () => {
    const [err] = parse(event, { type: "click", x: "no", y: 20 });
    expect(err).toBeInstanceOf(StructError);
    const issue = err?.issues[0];
    expect(issue?.path).toEqual(["x"]);
    expect(issue?.code).toBe("invalid_type");
  });

  test("rejects non-object payloads", () => {
    const [e1] = parse(event, "click");
    expect(e1).toBeInstanceOf(StructError);

    const [e2] = parse(event, []);
    expect(e2).toBeInstanceOf(StructError);
  });

  test("rejects a non-object option", () => {
    expect(() =>
      struct.discriminatedUnion("type", [struct.string()] as never),
    ).toThrow(
      new TypeError("discriminatedUnion options must be object structs"),
    );
  });

  test("rejects option list with duplicate discriminator value at chain time", () => {
    expect(() =>
      struct.discriminatedUnion("type", [
        struct.object({ type: struct.literal("a"), value: struct.string() }),
        struct.object({
          type: struct.literal("a"),
          other: struct.number(),
        }) as never,
      ]),
    ).toThrowError("duplicate discriminator value");
  });

  test("rejects option missing the discriminator field at chain time", () => {
    expect(() =>
      struct.discriminatedUnion("type", [
        struct.object({ type: struct.literal("a") }),
        struct.object({ other: struct.string() }) as never,
      ]),
    ).toThrowError("missing discriminator field");
  });

  test("rejects discriminator field that is not literal", () => {
    expect(() =>
      struct.discriminatedUnion("type", [
        struct.object({ type: struct.string() }) as never,
      ]),
    ).toThrowError("must be a literal struct");
  });

  test.each([
    struct.literal("a").optional(),
    struct.literal("a").null(),
    struct.literal("a").nullish(),
  ])("rejects discriminator field modifiers", (type) => {
    expect(() =>
      struct.discriminatedUnion("type", [struct.object({ type })] as never),
    ).toThrowError("must be a required literal struct");
  });

  test("reads a getter discriminator while building the union", () => {
    let reads = 0;
    const event = struct.discriminatedUnion("type", [
      struct.object({
        get type() {
          reads += 1;
          return struct.literal("click");
        },
        x: struct.number(),
      }),
    ]);

    expect(reads).toBe(1);
    expect(parse(event, { type: "click", x: 3 })).toEqual([
      null,
      { type: "click", x: 3 },
    ]);
    expect(reads).toBe(2);
  });

  test("accepts an exact null discriminator declaration", () => {
    const NullEvent = struct.discriminatedUnion("type", [
      struct.object({
        payload: struct.string(),
        type: struct.literal(null).null(),
      }),
    ]);

    expect(parse(NullEvent, { payload: "hello", type: null })).toEqual([
      null,
      { payload: "hello", type: null },
    ]);
  });

  test("internal parse routes via discriminator as well", () => {
    const [err, val] = parse(event, { type: "scroll", delta: 3 });
    if (err) {
      throw err;
    }
    expect(val).toEqual({ type: "scroll", delta: 3 });
  });

  test("internal parse fails on invalid branch", () => {
    const [err] = parse(event, { type: "click", x: "no", y: 20 });
    expect(err).toBeInstanceOf(StructError);
  });

  test("internal parse fails on non-object payload", () => {
    const [err] = parse(event, "not-an-object");
    expect(err).toBeInstanceOf(StructError);
  });

  test("internal parse fails on unknown discriminator", () => {
    const [err] = parse(event, { type: "unknown" });
    expect(err).toBeInstanceOf(StructError);
  });
});
