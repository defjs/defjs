import { afterEach, describe, expect, test, vi } from "vitest";
import { type AnyStruct, StructError, struct } from "./index";
import { __resetJitSupportForTests, supportsJit } from "./jit";
import { parseStructTuple as parse, parseStructValue } from "./parse";
import { createPrimitiveStruct } from "./runtime";

afterEach(() => {
  vi.unstubAllGlobals();
  __resetJitSupportForTests();
});

describe("struct JIT parser", () => {
  test("compiles objects covering all field types and modifiers", () => {
    const trimmedString = createPrimitiveStruct<string>({
      kind: "string",
      expected: "trimmed-string",
      is: (v): v is string => typeof v === "string",
      decode: (v, invalid) => {
        if (typeof v !== "string") return invalid;
        const out = v.trim();
        return out.length > 0 ? out : invalid;
      },
    });
    const positiveInt = createPrimitiveStruct<number>({
      kind: "number",
      expected: "positive-int",
      is: (v): v is number => typeof v === "number",
      decode: (v, invalid) =>
        typeof v === "number" && Number.isInteger(v) && v > 0 ? v : invalid,
    });
    const yesOnly = createPrimitiveStruct<boolean>({
      kind: "boolean",
      expected: "true",
      is: (v): v is boolean => v === true,
      decode: (v, invalid) => (v === true ? true : invalid),
    });
    const nonEmptyBlob = createPrimitiveStruct<Blob>({
      kind: "blob",
      expected: "non-empty-blob",
      is: (v): v is Blob => v instanceof Blob,
      decode: (v, invalid) => (v instanceof Blob && v.size > 0 ? v : invalid),
    });
    const customDate = createPrimitiveStruct<Date>({
      kind: "date",
      expected: "custom-date",
      is: (v): v is Date => v instanceof Date,
      decode: (v, invalid) => (v instanceof Date ? v : invalid),
    });
    const customBigInt = createPrimitiveStruct<bigint>({
      kind: "bigint",
      expected: "custom-bigint",
      is: (v): v is bigint => typeof v === "bigint",
      decode: (v, invalid) => (typeof v === "bigint" ? v : invalid),
    });

    const schema = struct.object({
      id: struct.string().alias("user_id"),
      age: struct.number(),
      active: struct.boolean(),
      nothing: struct.null(),
      createdAt: struct.date(),
      big: struct.bigint(),
      raw: struct.arrayBuffer(),
      blob: struct.blob(),
      file: struct.file(),
      trimmed: trimmedString,
      pos: positiveInt,
      yes: yesOnly,
      customBlob: nonEmptyBlob,
      customDate,
      customBigInt,
      version: struct.literal(1),
      role: struct.enum(["admin", "user"]),
      bigEnum: struct.enum(["a", "b", "c", "d", "e"]),
      anyVal: struct.any(),
      unknownVal: struct.unknown(),
      opt: struct.string().optional(),
      optNullable: struct.string().optional().null(),
      reqNullable: struct.string().null(),
      tupleVal: struct.tuple([struct.string(), struct.number()]),
      recVal: struct.record(struct.number()),
      unionVal: struct.or(struct.string(), struct.number()),
      discVal: struct.discriminatedUnion("kind", [
        struct.object({ kind: struct.literal("a"), val: struct.string() }),
        struct.object({ kind: struct.literal("b"), val: struct.number() }),
      ]),
      interVal: struct.intersection(
        struct.object({ x: struct.number() }),
        struct.object({ y: struct.number() }),
      ),
      nestedObj: struct.object({ label: struct.string() }),
      nestedArr: struct.array(struct.string()),
    });

    const blob = new Blob(["hi"]);
    const file = new File(["hi"], "hi.txt");
    const ab = new ArrayBuffer(2);

    const [err, parsed] = parse(
      schema,
      {
        user_id: "u-1",
        age: 20,
        active: true,
        nothing: null,
        createdAt: "2025-01-01T00:00:00.000Z",
        big: "42",
        raw: ab,
        blob,
        file,
        trimmed: "  hi ",
        pos: 7,
        yes: true,
        customBlob: blob,
        customDate: new Date("2025-01-01T00:00:00.000Z"),
        customBigInt: 9n,
        version: 1,
        role: "admin",
        bigEnum: "e",
        anyVal: { x: 1 },
        unknownVal: "u",
        opt: undefined,
        optNullable: null,
        reqNullable: null,
        tupleVal: ["k", 2],
        recVal: { score: 10 },
        unionVal: "hello",
        discVal: { kind: "a", val: "ok" },
        interVal: { x: 1, y: 2 },
        nestedObj: { label: "nested" },
        nestedArr: ["x", "y"],
      },
      { aliases: true },
    );

    if (err) throw err;
    expect(parsed.id).toBe("u-1");
    expect(parsed.trimmed).toBe("hi");
    expect(parsed.pos).toBe(7);
    expect(parsed.yes).toBe(true);
    expect(parsed.big).toBe(42n);
    expect(parsed.createdAt).toBeInstanceOf(Date);
    expect(parsed.opt).toBeUndefined();
    expect("opt" in parsed).toBe(false);
    expect(parsed.optNullable).toBeNull();
    expect(parsed.reqNullable).toBeNull();

    const baseInput = () => ({
      user_id: "u-1",
      age: 20,
      active: true,
      nothing: null,
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      big: 42n,
      raw: ab,
      blob,
      file,
      trimmed: "ok",
      pos: 1,
      yes: true,
      customBlob: blob,
      customDate: new Date("2025-01-01T00:00:00.000Z"),
      customBigInt: 9n,
      version: 1,
      role: "admin" as const,
      bigEnum: "e" as const,
      anyVal: 1,
      unknownVal: 2,
      reqNullable: "ok",
      tupleVal: ["k", 2] as const,
      recVal: {},
      unionVal: 3,
      discVal: { kind: "a" as const, val: "v" },
      interVal: { x: 1, y: 2 },
      nestedObj: { label: "nested" },
      nestedArr: [],
    });

    for (const override of [
      { trimmed: "   " },
      { pos: -1 },
      { yes: false },
      { customBlob: new Blob([]) },
      { customDate: "not-a-date" },
      { customBigInt: "not-bigint" },
    ]) {
      const [badErr] = parse(
        schema,
        { ...baseInput(), ...override },
        { aliases: true },
      );
      expect(badErr).toBeInstanceOf(StructError);
    }
  });

  test("compiles primitive, nested object, and nested array arrays", () => {
    const strArr = struct.array(struct.string());
    const numArr = struct.array(struct.number());
    const boolArr = struct.array(struct.boolean());
    const objArr = struct.array(struct.object({ id: struct.number() }));
    const matrix = struct.array(struct.array(struct.number()));

    expect(parse(strArr, ["a", "b"])[1]).toEqual(["a", "b"]);
    expect(parse(numArr, [1, 2])[1]).toEqual([1, 2]);
    expect(parse(boolArr, [true, false])[1]).toEqual([true, false]);
    expect(parse(objArr, [{ id: 1 }])[1]).toEqual([{ id: 1 }]);
    expect(parse(matrix, [[1, 2]])[1]).toEqual([[1, 2]]);

    const [boolErr] = parse(boolArr, [true, "nope"]);
    expect(boolErr).toBeInstanceOf(StructError);
    expect(boolErr?.issues[0]?.path).toEqual([1]);

    const [matrixErr] = parse(matrix, [[1], [2, Number.NaN]]);
    expect(matrixErr).toBeInstanceOf(StructError);
    expect(matrixErr?.issues[0]?.path).toEqual([1, 1]);
  });

  test("falls back cleanly to interpreter when dynamic Function is blocked by CSP", () => {
    vi.stubGlobal(
      "Function",
      class BlockedFunction {
        constructor() {
          throw new Error(
            "EvalError: Refused to evaluate a string as JavaScript",
          );
        }
      },
    );
    __resetJitSupportForTests();

    expect(supportsJit()).toBe(false);

    const obj = struct.object({
      name: struct.string().alias("wire_name"),
    });
    const arr = struct.array(struct.number());

    // Exercise both logical and wire modes twice so cached `null` markers are hit.
    expect(parse(obj, { name: "a" })[1]).toEqual({ name: "a" });
    expect(parse(obj, { name: "b" })[1]).toEqual({ name: "b" });
    expect(parse(obj, { wire_name: "c" }, { aliases: true })[1]).toEqual({
      name: "c",
    });
    expect(parse(obj, { wire_name: "d" }, { aliases: true })[1]).toEqual({
      name: "d",
    });

    expect(parse(arr, [1, 2])[1]).toEqual([1, 2]);
    expect(parse(arr, [3, 4])[1]).toEqual([3, 4]);
    expect(parse(arr, [5, 6], { aliases: true })[1]).toEqual([5, 6]);
    expect(parse(arr, [7, 8], { aliases: true })[1]).toEqual([7, 8]);
  });

  test("enforces max nesting depth for interpreter arrays and compiled paths", () => {
    const leafArray = struct.array(struct.string());
    let current: AnyStruct = leafArray;
    let payload: unknown = ["leaf"];
    for (let i = 0; i < 256; i += 1) {
      current = struct.array(current);
      payload = [payload];
    }
    expect(() => {
      void parseStructValue(current, payload, { tagObjects: true });
    }).toThrow(StructError);
  });
});
