import { describe, expect, test } from "vitest";
import { StructError, struct } from "./index";
import { isStruct } from "./guards";
import { assertStruct } from "./shape";
import { DEFINITION } from "./symbols";
import { parseStructTuple as parse } from "./parse";
import {
  createAnyStruct,
  createArrayBufferStruct,
  createArrayStruct,
  createBlobStruct,
  createBooleanStruct,
  createFileStruct,
  createLiteralStruct,
  createNullStruct,
  createNumberStruct,
  createObjectStruct,
  createRecordStruct,
  createStringStruct,
  createTupleStruct,
  createUnknownStruct,
} from "./constructors";

describe("facade.ts", () => {
  test("exports every constructor from namespace", () => {
    expect(struct.string).toBe(createStringStruct);
    expect(struct.number).toBe(createNumberStruct);
    expect(struct.boolean).toBe(createBooleanStruct);
    expect(struct.null).toBe(createNullStruct);
    expect(struct.any).toBe(createAnyStruct);
    expect(struct.unknown).toBe(createUnknownStruct);
    expect(struct.literal).toBe(createLiteralStruct);
    expect(struct.enum).toBeTypeOf("function");
    expect(struct.object).toBe(createObjectStruct);
    expect(struct.array).toBe(createArrayStruct);
    expect(struct.tuple).toBe(createTupleStruct);
    expect(struct.record).toBe(createRecordStruct);
    expect(struct.or).toBeTypeOf("function");
    expect(struct.blob).toBe(createBlobStruct);
    expect(struct.file).toBe(createFileStruct);
    expect(struct.arrayBuffer).toBe(createArrayBufferStruct);
    expect(struct.parse).toBe(parse);
  });

  test("strictly parses boolean and exact null structs", () => {
    const [boolErr, boolVal] = parse(struct.boolean(), undefined);
    expect(boolErr).toBeInstanceOf(StructError);
    expect(boolVal).toBeUndefined();

    const [nullErr1, nullVal1] = parse(struct.null(), undefined);
    expect(nullErr1).toBeInstanceOf(StructError);
    expect(nullVal1).toBeUndefined();

    const [nullErr2, nullVal2] = parse(struct.null(), null);
    if (nullErr2) {
      throw nullErr2;
    }
    expect(nullVal2).toBeNull();
  });

  test("covers internal primitive definitions that are otherwise short-circuited", () => {
    const booleanStruct: unknown = struct.boolean();
    const nullStruct: unknown = struct.null();
    assertStruct(booleanStruct, "boolean");
    assertStruct(nullStruct, "null");
    const booleanDefinition = booleanStruct[DEFINITION];
    const nullDefinition = nullStruct[DEFINITION];
    if (
      booleanDefinition.kind !== "boolean" ||
      nullDefinition.kind !== "null"
    ) {
      throw new Error("expected primitive definitions");
    }

    expect(booleanDefinition.is(true)).toBe(true);
    expect(nullDefinition.is(null)).toBe(true);
  });

  test("exposes struct identity helper", () => {
    expect(isStruct(struct.string())).toBe(true);
    expect(
      isStruct({
        parse() {
          return undefined;
        },
      }),
    ).toBe(false);
  });

  test("returns immutable chained struct objects", () => {
    const base = struct.string();
    const optionalValue = base.optional();

    expect(base).not.toBe(optionalValue);

    const [baseErr, baseVal] = parse(base, undefined);
    expect(baseErr).toBeInstanceOf(StructError);
    expect(baseVal).toBeUndefined();

    const [optErr, optVal] = parse(optionalValue, undefined);
    if (optErr) {
      throw optErr;
    }
    expect(optVal).toBeUndefined();
  });

  test("exposes an error-first parse tuple without adding an instance parser", () => {
    const User = struct.object({ id: struct.string() });

    expect(struct.parse(User, { id: "u_1" })).toEqual([null, { id: "u_1" }]);

    const [error, value] = struct.parse(User, {});
    expect(error).toBeInstanceOf(StructError);
    expect(value).toBeUndefined();
    expect("parse" in User).toBe(false);
  });

  test("object struct snapshots the declared shape at construction time", () => {
    const shape = { name: struct.string() };
    const user = struct.object(shape);
    const fields: { [key: string]: unknown } = shape;
    fields["secret"] = struct.string();

    const [err, val] = parse(user, { name: "Miao", secret: "hidden" });

    if (err) {
      throw err;
    }
    expect(val).toEqual({ name: "Miao" });
  });

  test("object struct ignores later replacement of a declared field", () => {
    const shape = { name: struct.string() };
    const user = struct.object(shape);
    const fields: { [key: string]: unknown } = shape;
    fields["name"] = struct.number();

    const [err, val] = parse(user, { name: "Miao" });

    if (err) {
      throw err;
    }
    expect(val).toEqual({ name: "Miao" });
  });
});
