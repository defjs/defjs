import { describe, expect, test } from "vitest";
import { encodeObjectByAlias } from "./codec/common";
import { decodeJson, encodeJson } from "./codec/json";
import { encodeValue } from "./codec/common";
import { StructError } from "./errors";
import { struct as directStruct } from "./facade";
import { isStruct } from "./guards";
import { struct } from "./index";
import { resolveStructFields } from "./fields";
import { parseStructTuple as parse, parseStructValue } from "./parse";
import { matchesRuntimeValue } from "./match";
import { DEFAULT_FLAGS, makeStruct } from "./runtime";
import { assertStruct, resolveObjectShape } from "./shape";
import { DEFINITION, OMIT } from "./symbols";
import type {
  ObjectDefinition,
  Path,
  RuntimeStruct,
  StructDefinition,
} from "./types";
import { describeValue, expectedType } from "./utils";

function runtime(value: unknown): RuntimeStruct {
  assertStruct(value, "struct");
  return value;
}

function objectDefinition(value: RuntimeStruct): ObjectDefinition {
  const definition = value[DEFINITION];
  if (definition.kind !== "object") {
    throw new Error("expected object definition");
  }
  return definition;
}

function definition(value: unknown): StructDefinition {
  return runtime(value)[DEFINITION];
}

describe("struct coverage boundary cases", () => {
  test("direct runtime exports stay wired", () => {
    const testStruct = directStruct.object({ id: directStruct.string() });

    expect(isStruct(testStruct)).toBe(true);
    expect(typeof DEFINITION).toBe("symbol");
    expect(typeof OMIT).toBe("symbol");
    expect(DEFINITION).toBe(Symbol.for("defjs.struct.definition"));
    expect(Symbol.keyFor(OMIT)).toBeUndefined();

    expect(parse(directStruct.string(), "x")).toEqual([null, "x"]);
    expect(encodeJson(testStruct, { id: "u_1" })).toEqual({ id: "u_1" });
    expect(decodeJson(testStruct, { id: "u_1" })).toEqual({ id: "u_1" });
    return Promise.resolve();
  });

  test("constructor guards reject invalid enum and object definitions", () => {
    expect(() => struct.enum({})).toThrow(
      "enum struct requires at least one string or number value",
    );
    expect(() => {
      // @ts-expect-error object structs are built from a plain object
      struct.object(null);
    }).toThrow("object struct requires a plain object");
    const urlencoded = definition(struct.urlencoded({ name: struct.string() }));
    const formData = definition(struct.formData({ name: struct.string() }));
    expect(urlencoded.kind).toBe("object");
    expect(formData.kind).toBe("object");
    expect(urlencoded.kind === "object" ? urlencoded.codec : undefined).toBe(
      "urlencoded",
    );
    expect(formData.kind === "object" ? formData.codec : undefined).toBe(
      "formData",
    );
  });

  test("internal parse tuple returns native struct validation errors", () => {
    const [error] = parse(struct.number(), "bad");
    expect(error).toBeInstanceOf(StructError);
  });

  test("encode non-matching paths and branch matchers are explicit", () => {
    expect(
      encodeValue(runtime(struct.array(struct.string())), "not-array"),
    ).toBe("not-array");
    expect(
      encodeValue(runtime(struct.tuple([struct.string()])), "not-tuple"),
    ).toBe("not-tuple");
    expect(
      encodeValue(runtime(struct.tuple([struct.string()])), ["x", 1]),
    ).toEqual(["x", 1]);

    const requiredObject = struct.object({
      id: struct.string(),
      nickname: struct.string().optional(),
    });
    expect(matchesRuntimeValue(runtime(requiredObject), {})).toBe(false);
    expect(matchesRuntimeValue(runtime(requiredObject), { id: "u_1" })).toBe(
      true,
    );

    const literalObject = struct.object({ type: struct.literal("message") });
    expect(matchesRuntimeValue(runtime(literalObject), { type: "count" })).toBe(
      false,
    );

    const enumObject = struct.object({
      status: struct.enum(["draft", "published"]),
    });
    expect(
      matchesRuntimeValue(runtime(enumObject), { status: "archived" }),
    ).toBe(false);

    expect(
      matchesRuntimeValue(runtime(struct.record(struct.string())), []),
    ).toBe(false);
    expect(
      matchesRuntimeValue(
        runtime(struct.enum(["draft", "published"])),
        "draft",
      ),
    ).toBe(true);

    const nested = struct.object({
      options: struct.object({ include: struct.boolean() }),
      profile: struct.object({ name: struct.string() }),
      session: struct.object({ token: struct.string() }),
      target: struct.object({ id: struct.number() }),
    });
    const nestedValue = {
      options: { include: true },
      profile: { name: "Miao" },
      session: { token: "secret" },
      target: { id: 1 },
    };
    expect(encodeValue(runtime(nested), "not-object")).toBe("not-object");
    expect(encodeValue(runtime(nested), nestedValue)).toEqual(nestedValue);
    expect(encodeValue(runtime(nested), { target: { id: 1 } })).toEqual({
      target: { id: 1 },
    });
    expect(encodeValue(runtime(nested), {})).toEqual({});
    expect(encodeValue(runtime(struct.object({})), {})).toEqual({});
    expect(matchesRuntimeValue(runtime(nested), nestedValue)).toBe(true);
  });

  test("null falls through to literal, union, and intersection matching", () => {
    const literalNull = struct.literal(null);
    expect(matchesRuntimeValue(runtime(literalNull), null)).toBe(true);

    const union = struct.or(struct.string(), struct.number());
    expect(matchesRuntimeValue(runtime(union), null)).toBe(false);

    const both = struct.intersection(struct.literal(null), struct.null());
    expect(matchesRuntimeValue(runtime(both), null)).toBe(true);
  });

  test("error formatting reuses existing tree nodes and root prettify paths", () => {
    const err = new StructError([
      {
        code: "custom",
        expected: "valid value",
        message: "profile failed",
        path: ["profile"],
        received: undefined,
      },
      {
        code: "custom",
        expected: "valid value",
        message: "name failed",
        path: ["profile", "name"],
        received: undefined,
      },
    ]);

    expect(err.format()).toEqual({
      _errors: [],
      profile: {
        _errors: ["profile failed"],
        name: { _errors: ["name failed"] },
      },
    });
    expect(
      new StructError([
        {
          code: "custom",
          expected: "valid value",
          message: "root failed",
          path: [],
          received: undefined,
        },
      ]).prettify(),
    ).toBe("× <root>: root failed");
  });

  test("introspection and shape guards reject non-object structs", () => {
    expect(() => parseStructValue(struct.string(), 1)).toThrow(StructError);
    expect(() => assertStruct({}, "value")).toThrow("value must be a struct");

    const objectStruct = runtime(struct.object({ id: struct.string() }));
    const fields = objectDefinition(objectStruct);
    const first = resolveObjectShape(objectStruct, fields);
    expect(resolveObjectShape(objectStruct, fields)).toBe(first);
  });

  test("strict parsing keeps no zero-value construction path", () => {
    expect(parse(struct.string(), undefined)[0]).toBeInstanceOf(StructError);
    expect(parse(struct.string().optional(), undefined)).toEqual([
      null,
      undefined,
    ]);
    expect(parse(struct.string().null(), undefined)[0]).toBeInstanceOf(
      StructError,
    );
    expect(parse(struct.string().nullish(), undefined)).toEqual([
      null,
      undefined,
    ]);
    expect(
      parse(struct.intersection(struct.any(), struct.string()), "plain"),
    ).toEqual([null, "plain"]);
  });

  test("object parsing covers nested fields", () => {
    const nested = struct.object({
      options: struct.object({ include: struct.boolean().optional() }),
      profile: struct.object({ name: struct.string() }),
      session: struct.object({ token: struct.string().optional() }),
      target: struct.object({ id: struct.number() }),
    });

    expect(parse(struct.string(), null)[0]).toBeInstanceOf(StructError);
    expect(parse(struct.enum(["draft", "published"]), "draft")).toEqual([
      null,
      "draft",
    ]);
    expect(
      parse(struct.enum(["draft", "published"]), "archived")[0],
    ).toBeInstanceOf(StructError);
    expect(parse(nested, "bad")[0]).toBeInstanceOf(StructError);
    expect(
      parse(struct.record(struct.string().optional()), { skip: undefined }),
    ).toEqual([null, {}]);
    const complete = {
      options: {},
      profile: { name: "Miao" },
      session: {},
      target: { id: 1 },
    };
    expect(parse(nested, complete)).toEqual([null, complete]);
    expect(parse(nested, { target: { id: "bad" } })[0]).toBeInstanceOf(
      StructError,
    );
    const optionalObject = struct.object({
      options: struct.object({ include: struct.boolean() }).optional(),
    });
    expect(parse(optionalObject, {})).toEqual([null, {}]);
    expect(parse(struct.object({}), {})).toEqual([null, {}]);
  });

  test("errorMap retains discarded paths across reentrant and throwing parses", () => {
    const retainedPaths: Path[] = [];
    const thrown = new Error("reentrant errorMap");
    let reentered = false;
    const schema = struct.object({
      value: struct.or(struct.string(), struct.number()),
    });

    const [error] = parse(
      schema,
      { value: true },
      {
        errorMap: (outerIssue) => {
          retainedPaths.push(outerIssue.path);
          if (!reentered) {
            reentered = true;
            expect(() =>
              parse(
                struct.object({ nested: struct.string() }),
                { nested: 1 },
                {
                  errorMap: (innerIssue) => {
                    retainedPaths.push(innerIssue.path);
                    throw thrown;
                  },
                },
              ),
            ).toThrow(thrown);
          }
          return undefined;
        },
      },
    );

    expect(error).toBeInstanceOf(StructError);
    expect(retainedPaths).toEqual([
      ["value"],
      ["nested"],
      ["value"],
      ["value"],
    ]);
  });

  test("alias-aware parsing stays on the single fail-fast parser", () => {
    const User = struct.object({
      profile: struct
        .object({ displayName: struct.string().alias("display_name") })
        .alias("user_profile"),
    });
    expect(
      parseStructValue(
        User,
        { user_profile: { display_name: "Miao" } },
        { aliases: true },
      ),
    ).toEqual({
      profile: { displayName: "Miao" },
    });

    const input = {
      first_wire: 1,
      get second_wire(): string {
        throw new Error("alias parser continued");
      },
    };
    expect(() =>
      parseStructValue(
        struct.object({
          first: struct.string().alias("first_wire"),
          second: struct.string().alias("second_wire"),
        }),
        input,
        {
          aliases: true,
        },
      ),
    ).toThrow(StructError);

    const Event = struct.discriminatedUnion("type", [
      struct.object({
        payload: struct.string().alias("body"),
        type: struct.literal("a").alias("kind_a"),
      }),
      struct.object({
        count: struct.number(),
        type: struct.literal("b").alias("kind_b"),
      }),
    ]);
    expect(
      parseStructValue(
        Event,
        { body: "hello", kind_a: "a" },
        { aliases: true },
      ),
    ).toEqual({ payload: "hello", type: "a" });
    expect(
      parseStructValue(
        Event,
        { body: "hello", kind_a: "a", kind_b: "b" },
        { aliases: true },
      ),
    ).toEqual({
      payload: "hello",
      type: "a",
    });
  });

  test("expectedType covers every runtime definition kind", () => {
    const message = struct.object({ type: struct.literal("message") });
    const structs = [
      [struct.any(), "any"],
      [struct.array(struct.string()), "array<string>"],
      [struct.arrayBuffer(), "ArrayBuffer"],
      [struct.blob(), "Blob"],
      [struct.bigint(), "bigint"],
      [struct.boolean(), "boolean"],
      [struct.date(), "Date"],
      [struct.file(), "File"],
      [struct.null(), "null"],
      [struct.number(), "number"],
      [struct.string(), "string"],
      [struct.enum(["draft", "published"]), '"draft" | "published"'],
      [struct.literal("ok"), '"ok"'],
      [
        struct.intersection(struct.string(), struct.number()),
        "string & number",
      ],
      [struct.object({ id: struct.string() }), "object"],
      [struct.or(struct.string(), struct.number()), "string | number"],
      [struct.discriminatedUnion("type", [message]), '"message"'],
      [struct.record(struct.string()), "record<string>"],
      [struct.tuple([struct.string()]), "tuple"],
      [struct.unknown(), "unknown"],
    ] as const;

    for (const [struct, expected] of structs) {
      expect(expectedType(definition(struct))).toBe(expected);
    }
  });

  test("describeValue formats literal primitives", () => {
    expect(describeValue(null)).toBe("null");
    expect(describeValue("x")).toBe('"x"');
    expect(describeValue(true)).toBe("true");
    expect(describeValue(123)).toBe("123");
  });

  test("aliased object codec covers skip, non-object, primitive, and nested paths", () => {
    const profile = struct.object({
      internal: struct.string().optional(),
      name: struct.string().alias("full_name"),
      omitted: struct.string().optional().alias("omitted"),
    });

    expect(encodeObjectByAlias(struct.string(), "x")).toBe("x");
    expect(
      encodeObjectByAlias(profile, { name: "Miao", omitted: undefined }),
    ).toEqual({ full_name: "Miao" });
    expect(() => encodeObjectByAlias(profile, "bad")).toThrow(
      "json encode expects object value",
    );

    const profiles = struct.array(profile);
    expect(
      encodeObjectByAlias(profiles, [{ name: "Miao", omitted: undefined }]),
    ).toEqual([{ full_name: "Miao" }]);

    expect(decodeJson(struct.string(), "x")).toBe("x");
    expect(decodeJson(profile, { full_name: "Miao" })).toEqual({
      name: "Miao",
    });
    expect(() => decodeJson(profile, "bad")).toThrow(StructError);

    expect(() => decodeJson(struct.array(profile), "bad")).toThrow(StructError);
    expect(() => decodeJson(struct.tuple([profile]), "bad")).toThrow(
      StructError,
    );
    expect(
      decodeJson(struct.tuple([profile]), [{ full_name: "Miao" }]),
    ).toEqual([{ name: "Miao" }]);
    expect(() =>
      decodeJson(struct.tuple([profile]), [
        { full_name: "Miao" },
        { untouched: true },
      ]),
    ).toThrow(StructError);
    expect(() => decodeJson(struct.record(profile), "bad")).toThrow(
      StructError,
    );

    const event = struct.or(
      struct.object({
        payload: struct.string().alias("body"),
        type: struct.literal("message").alias("kind"),
      }),
      struct.object({
        count: struct.number().alias("count"),
        type: struct.literal("count").alias("kind"),
      }),
    );
    expect(() => decodeJson(event, "bad")).toThrow(StructError);

    const discriminated = struct.discriminatedUnion("type", [
      struct.object({
        payload: struct.string().alias("body"),
        type: struct.literal("message").alias("kind"),
      }),
    ]);
    expect(() => decodeJson(discriminated, { kind: "unknown" })).toThrow(
      StructError,
    );
  });

  test("guard helpers reject malformed struct metadata", () => {
    expect(isStruct({ [DEFINITION]: null })).toBe(false);
    expect(
      isStruct({
        [DEFINITION]: {
          flags: { nullable: false, optional: false },
          kind: "not-real",
        },
      }),
    ).toBe(false);
  });

  test("union flag and alias codecs cover optional and ambiguous encode branches", () => {
    const optional = struct.string().optional();
    expect(matchesRuntimeValue(runtime(optional), undefined)).toBe(true);

    const conflicting = struct.or(
      struct.object({ count: struct.number() }).alias("left"),
      struct.object({ count: struct.number() }).alias("right"),
    );
    expect(() => encodeObjectByAlias(conflicting, { count: 1 })).toThrow(
      "ambiguous union encode: multiple union branches match with different wire output",
    );
  });

  test("field, flat, and discriminator helpers cover remaining branch edges", () => {
    const duplicate = runtime(
      struct.object({
        first: struct.string().alias("same"),
        second: struct.string().alias("same"),
      }),
    );
    const duplicateDefinition = objectDefinition(duplicate);
    const duplicateShape = resolveObjectShape(duplicate, duplicateDefinition);
    expect(resolveObjectShape(duplicate, duplicateDefinition)).toBe(
      duplicateShape,
    );
    expect(() => parse(duplicate, {})).toThrow(
      'duplicate wire key "same" for object fields "first" and "second"',
    );

    const ambiguous = struct.discriminatedUnion("type", [
      struct.object({ type: struct.literal("a").alias("kind_a") }),
      struct.object({ type: struct.literal("b").alias("kind_b") }),
    ]);
    expect(decodeJson(ambiguous, { kind_a: "a", kind_b: "b" })).toEqual({
      type: "a",
    });
  });

  test("coverage guards cover defensive branches without changing public semantics", () => {
    const shape: { [key: string]: unknown } = {};
    Object.setPrototypeOf(shape, null);
    const duplicateDefinition: ObjectDefinition = {
      cache: {
        declaredDescriptors: {},
        resolvedShape: {
          first: runtime(struct.string().alias("same")),
          second: runtime(struct.string().alias("same")),
        },
      },
      flags: DEFAULT_FLAGS,
      kind: "object",
      shape,
    };
    expect(() =>
      resolveStructFields(runtime(struct.object({})), duplicateDefinition),
    ).toThrow('duplicate wire key "same"');

    const dateWithoutRuntimeGuard = makeStruct({
      expected: "Date",
      flags: DEFAULT_FLAGS,
      is: (value): value is Date => value instanceof Date,
      kind: "date",
    });
    expect(
      matchesRuntimeValue(runtime(dateWithoutRuntimeGuard), new Date(0)),
    ).toBe(true);
    expect(
      matchesRuntimeValue(
        runtime(struct.object({ query: struct.object({}) })),
        "not-a-request",
      ),
    ).toBe(false);

    const missingDiscriminator = struct.discriminatedUnion("type", [
      struct.object({ type: struct.literal("text") }),
    ]);
    expect(matchesRuntimeValue(runtime(missingDiscriminator), {})).toBe(false);
    expect(
      matchesRuntimeValue(runtime(missingDiscriminator), { type: "other" }),
    ).toBe(false);

    const missingWireDiscriminator = struct.discriminatedUnion("type", [
      struct.object({ type: struct.literal("text").alias("kind") }),
    ]);
    expect(() =>
      decodeJson(missingWireDiscriminator, { other: "text" }),
    ).toThrow(StructError);
    expect(() =>
      decodeJson(missingWireDiscriminator, { kind: undefined }),
    ).toThrow(StructError);
    expect(() => decodeJson(missingWireDiscriminator, "not-object")).toThrow(
      StructError,
    );
  });
});
