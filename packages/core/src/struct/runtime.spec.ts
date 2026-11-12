import { describe, expect, test } from "vitest";
import { isStruct } from "./guards";
import { StructError, struct } from "./index";
import { parseStructTuple as parse } from "./parse";
import { assertStruct } from "./shape";
import { DEFINITION } from "./symbols";
import type { RuntimeStruct } from "./definition";

function runtimeOf(value: unknown): RuntimeStruct {
  assertStruct(value, "struct");
  return value;
}

function withPrototype(prototype: object): unknown {
  return Object.create(prototype);
}

describe("runtime.ts chain methods", () => {
  test("nullable stays required while optional and nullish may be omitted", () => {
    const testStruct = struct.object({
      a: struct.string().optional(),
      b: struct.string().null(),
      c: struct.string().nullish(),
    });

    const [missingError, missingValue] = parse(testStruct, {});
    expect(missingError).toBeInstanceOf(StructError);
    expect(missingError?.issues[0]?.code).toBe("missing_key");
    expect(missingError?.issues[0]?.path).toEqual(["b"]);
    expect(missingValue).toBeUndefined();

    const [err, val] = parse(testStruct, { b: null });
    if (err) {
      throw err;
    }
    expect(val).toEqual({ b: null });
  });

  test("alias stores wire names without changing parse output", () => {
    const user = struct.object({
      name: struct.string().alias("full_name"),
    });

    const [err, val] = parse(user, { name: "Miao" });
    if (err) {
      throw err;
    }
    expect(val).toEqual({ name: "Miao" });
  });

  test("removed tag method is absent from struct runtime surface", () => {
    expect("tag" in struct.string()).toBe(false);
  });

  test("shares lazy object shape and fields cache across pre-created struct derivations", () => {
    let reads = 0;
    const User = struct.object({
      get name() {
        reads += 1;
        return struct.string();
      },
    });
    const Alias = User.alias("user");
    const Optional = User.optional();
    const Nullish = User.nullish();
    const baseRuntime = runtimeOf(User);
    const aliasRuntime = runtimeOf(Alias);
    const optionalRuntime = runtimeOf(Optional);
    const nullishRuntime = runtimeOf(Nullish);
    const baseDefinition = baseRuntime[DEFINITION];
    const aliasDefinition = aliasRuntime[DEFINITION];
    const optionalDefinition = optionalRuntime[DEFINITION];
    const nullishDefinition = nullishRuntime[DEFINITION];

    if (
      baseDefinition.kind !== "object" ||
      aliasDefinition.kind !== "object" ||
      optionalDefinition.kind !== "object" ||
      nullishDefinition.kind !== "object"
    ) {
      throw new Error("expected object definition");
    }

    expect(aliasDefinition.cache).toBe(baseDefinition.cache);
    expect(optionalDefinition.cache).toBe(baseDefinition.cache);
    expect(nullishDefinition.cache).toBe(baseDefinition.cache);

    parse(Alias, { name: "x" });
    const cachedFields = baseDefinition.cache.fields;

    parse(Optional, { name: "x" });
    parse(User, { name: "x" });
    parse(Nullish, { name: "x" });

    expect(reads).toBe(1);
    expect(cachedFields).toBeDefined();
    expect(optionalDefinition.cache.fields).toBe(cachedFields);
    expect(aliasDefinition.cache.fields).toBe(cachedFields);
    expect(nullishDefinition.cache.fields).toBe(cachedFields);
  });

  test("rejects duplicate wire keys in the same object shape", () => {
    const User = struct.object({
      name: struct.string(),
      displayName: struct.string().alias("name"),
    });

    expect(() => parse(User, {})).toThrow('duplicate wire key "name"');
  });

  test("rejects duplicate aliases in the same object shape", () => {
    const User = struct.object({
      firstName: struct.string().alias("name"),
      displayName: struct.string().alias("name"),
    });

    expect(() => parse(User, {})).toThrow('duplicate wire key "name"');
  });

  test("rejects duplicate empty wire keys", () => {
    const User = struct.object({
      firstName: struct.string().alias(""),
      secondName: struct.string().alias(""),
    });

    expect(() => parse(User, {})).toThrow('duplicate wire key ""');
  });

  test("keeps duplicate wire key failures stable across repeated field resolution", () => {
    const User = struct.object({
      firstName: struct.string().alias("name"),
      displayName: struct.string().alias("name"),
    });
    expect(() => parse(User, {})).toThrow('duplicate wire key "name"');
    expect(() => parse(User, {})).toThrow('duplicate wire key "name"');
  });

  test("does not accept inherited struct definition brand", () => {
    const fake = withPrototype(struct.string());
    expect(isStruct(fake)).toBe(false);
  });

  test("does not accept malformed struct definition brand", () => {
    const fake = { [DEFINITION]: { kind: "object" } };

    expect(isStruct(fake)).toBe(false);
  });

  test("does not accept a definition that is null or of an unknown kind", () => {
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

  test.each([
    undefined,
    null,
    1,
    {},
    { nullable: false },
    { optional: false },
    { nullable: 0, optional: false },
    { nullable: false, optional: 0 },
  ])("rejects malformed struct flags: %j", (flags) => {
    expect(isStruct({ [DEFINITION]: { kind: "string", flags } })).toBe(false);
  });

  test("invalid primitive parse returns StructError and undefined", () => {
    const [err, val] = parse(struct.string(), 42);

    expect(err).toBeInstanceOf(StructError);
    expect(val).toBeUndefined();
  });

  test("modifiers retain their captured definition when the writable metadata property is replaced", () => {
    const value = struct.string();
    const original = runtimeOf(value)[DEFINITION];
    Reflect.set(value, DEFINITION, {
      ...original,
      flags: { nullable: true, optional: false },
    });
    expect(runtimeOf(value.optional())[DEFINITION].flags).toEqual({
      nullable: false,
      optional: true,
    });
    expect(runtimeOf(value.alias("wire"))[DEFINITION].flags).toEqual({
      nullable: false,
      optional: false,
    });
  });

  test("runtime structs do not carry an own _struct property", () => {
    const value = struct.string();

    expect(Object.hasOwn(value, "_struct")).toBe(false);
    expect("_struct" in value).toBe(false);
    expect(isStruct(value)).toBe(true);
    expect(Object.getOwnPropertySymbols(value)).toEqual([DEFINITION]);
  });
});
