import { isObjectRuntimeStruct, isStruct } from "./guards";
import {
  createPrimitiveStruct,
  DEFAULT_FLAGS,
  makeStruct,
  NULLABLE_FLAGS,
} from "./runtime";
import { assertStruct, assertStructs } from "./shape";
import { DEFINITION } from "./symbols";
import type {
  ArrayStruct,
  DiscriminatedUnionStruct,
  IntersectionStruct,
  LiteralValue,
  NumberStruct,
  ObjectStruct,
  ObjectShape,
  PresentValue,
  RecordStruct,
  Struct,
  StructLike,
  StringStruct,
  TupleStruct,
  UnionStruct,
  UnknownStruct,
} from "./types";
import type {
  ObjectDefinition,
  ObjectRuntimeStruct,
  RuntimeStruct,
} from "./definition";
import { describeValue, expectedType } from "./errors";
import { isPlainObject } from "./plain_object";

/**
 * Struct that accepts string values.
 *
 * - Accepts `string` values only; anything else fails with `invalid_type`.
 *
 * - As a body root, or as an inbound `output` / `error` struct, the bytes stay text instead of being parsed as JSON.
 *
 * @group struct
 */
export function createStringStruct(): StringStruct {
  return createPrimitiveStruct({
    expected: "string",
    is: (value): value is string => typeof value === "string",
    kind: "string",
  });
}

/**
 * Struct that accepts number values except NaN.
 *
 * - Accepts `number` values, including `Infinity`. `NaN` and non-numbers fail with `invalid_type`.
 *
 * - Strings are not coerced.
 *
 * @group struct
 */
export function createNumberStruct(): NumberStruct {
  return createPrimitiveStruct({
    expected: "number",
    is: (value): value is number =>
      typeof value === "number" && !Number.isNaN(value),
    kind: "number",
  });
}

/**
 * Struct that accepts boolean values.
 *
 * Accepts `true` and `false` only. Other values, including `'true'` and `1`, fail with `invalid_type`.
 *
 * @group struct
 */
export function createBooleanStruct(): Struct<boolean, boolean> {
  return createPrimitiveStruct({
    expected: "boolean",
    is: (value): value is boolean => typeof value === "boolean",
    kind: "boolean",
  });
}

/**
 * Struct that accepts only null.
 *
 * Accepts `null` only. Every other value fails with `invalid_type`. That includes `undefined` at the root or in an array or tuple; a missing object or record field reports `missing_key` instead.
 *
 * This is not the `.null()` modifier. The modifier adds `null` to the values another struct accepts.
 *
 * @group struct
 */
export function createNullStruct(): Struct<null, null> {
  return makeStruct<Struct<null, null>>({
    expected: "null",
    flags: NULLABLE_FLAGS,
    is: (value): value is null => value === null,
    kind: "null",
  });
}

/**
 * Struct that accepts any value except null and undefined, without validation.
 *
 * The value is returned unchanged, and nothing inside it is validated or stripped.
 *
 * - Chain `.null()`, `.optional()`, or `.nullish()` to accept `null` or `undefined`.
 *
 * - The output type is `any`. Prefer {@link struct.unknown}() when the caller should narrow the value.
 *
 * @group struct
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- INTENT: `any` is the documented output type of struct.any() (TSDoc above; published as `Struct<PresentValue, any>`); struct.unknown() is the `unknown` variant
export function createAnyStruct(): Struct<PresentValue, any> {
  return makeStruct({
    flags: DEFAULT_FLAGS,
    kind: "any",
  });
}

/**
 * Struct that accepts any value except null and undefined, typed as unknown.
 *
 * The value is returned unchanged, and nothing inside it is validated or stripped.
 *
 * - Chain `.null()`, `.optional()`, or `.nullish()` to accept `null` or `undefined`.
 *
 * - The output type is `unknown`, so the caller must narrow it before use.
 *
 * @group struct
 */
export function createUnknownStruct(): UnknownStruct {
  return makeStruct<UnknownStruct>({
    flags: DEFAULT_FLAGS,
    kind: "unknown",
  });
}

/**
 * Struct that accepts exactly one boolean, null, number, or string value.
 *
 * - Accepts only `value`. The comparison uses `Object.is`, so any other value fails with `invalid_literal`.
 *
 * - `value` must be a `boolean`, `null`, `number`, or `string`.
 *
 * - Use it for the tag field of {@link struct.discriminatedUnion}().
 *
 * @group struct
 */
export function createLiteralStruct<const T extends LiteralValue>(
  value: T,
): Struct<T, T> {
  return makeStruct<Struct<T, T>>({
    expected: describeValue(value),
    flags: value === null ? NULLABLE_FLAGS : DEFAULT_FLAGS,
    kind: "literal",
    value,
  });
}

export function createEnumStruct<
  const T extends readonly [string, ...string[]],
>(values: T): Struct<T[number], T[number]> {
  const enumValues = [...values];
  return makeStruct<Struct<T[number], T[number]>>({
    expected: enumValues.map((item) => JSON.stringify(item)).join(" | "),
    flags: DEFAULT_FLAGS,
    kind: "enum",
    values: enumValues,
  });
}

export function createObjectEnumStruct<
  const T extends { [key: string]: number | string },
>(value: T): Struct<T[keyof T], T[keyof T]> {
  const values = Object.values(value).filter(
    (item): item is T[keyof T] =>
      typeof item === "number" || typeof item === "string",
  );

  if (values.length === 0) {
    throw new TypeError(
      "enum struct requires at least one string or number value",
    );
  }

  return makeStruct<Struct<T[keyof T], T[keyof T]>>({
    expected: values.map((item) => JSON.stringify(item)).join(" | "),
    flags: DEFAULT_FLAGS,
    kind: "enum",
    values,
  });
}

/**
 * Struct that parses an array with one item struct.
 *
 * - Parses every element with `item` and outputs a new array. A non-array fails with `invalid_type` (expected `array`).
 *
 * - Parsing stops at the first failing element, and `issue.path` holds its index.
 *
 * - Throws `TypeError` when `item` is not a struct.
 *
 * The result is an {@link ArrayStruct}, a `Struct<StructInput<S>[], Infer<S>[]>`.
 *
 * @group struct
 */
export function createArrayStruct<S extends StructLike>(
  item: S,
): ArrayStruct<S> {
  assertStruct(item, "array item");

  return makeStruct<ArrayStruct<S>>({
    flags: DEFAULT_FLAGS,
    item,
    kind: "array",
  });
}

/**
 * Struct that parses a plain object with a fixed set of fields.
 *
 * `shape` maps field names to structs.
 *
 * - Every field is **required** by default. A missing key fails with `missing_key`.
 *
 * - `.optional()` and `.nullish()` allow a missing key. An absent optional field stays absent in the output.
 *
 * - `.null()` / `.nullable()` allow `null`.
 *
 * - `.alias(name)` sets the field's wire key. `struct.parse` reads logical keys by default; `{ aliases: true }` and HTTP JSON decoding read wire keys, and HTTP JSON encoding writes them. Parsed output uses logical keys.
 *
 * - Keys that are not in `shape` are removed from the output. The output is a new object with a `null` prototype.
 *
 * - The input must be a plain object. Arrays, `Map`, and class instances fail with `invalid_type` (expected `object`).
 *
 * - Parsing stops at the first failing field, and `issue.path` holds its key.
 *
 * - Throws `TypeError` when `shape` is not a plain object.
 *
 * `ObjectShape` is `{ [key: string]: any }`; each value must be a struct.
 *
 * @group struct
 */
export function createObjectStruct<T extends ObjectShape>(
  shape: T,
): ObjectStruct<T> {
  return makeStruct<ObjectStruct<T>>(objectDefinition(shape));
}

function objectDefinition(shape: ObjectShape): ObjectDefinition {
  if (!isPlainObject(shape)) {
    throw new TypeError("object struct requires a plain object");
  }

  return {
    cache: {
      declaredDescriptors: Object.getOwnPropertyDescriptors(shape),
    },
    flags: DEFAULT_FLAGS,
    kind: "object",
    shape,
  };
}

/**
 * Object struct that is encoded as an URL-encoded form when it is the request body.
 *
 * Parses like {@link struct.object}(), and carries a `urlencoded` codec tag.
 *
 * - The tag applies only when this struct's value is the request body root. The body is then sent as `URLSearchParams` with `application/x-www-form-urlencoded;charset=UTF-8`.
 *
 * - Arrays repeat the field name and `undefined` fields are skipped. A nested object or a `Blob` fails the request with `REQ_BUILD_FAILED`.
 *
 * - `struct.parse` ignores the tag. It does not accept a `URLSearchParams` instance, only a plain object.
 *
 * @group struct
 */
export function createUrlencodedBodyStruct<T extends ObjectShape>(
  shape: T,
): ObjectStruct<T> {
  return createCodecObjectStruct(shape, "urlencoded");
}

/**
 * Object struct that is encoded as multipart FormData when it is the request body.
 *
 * Parses like {@link struct.object}(), and carries a `formData` codec tag.
 *
 * - The tag applies only when this struct's value is the request body root. The body is then sent as `FormData` with a platform multipart boundary.
 *
 * - Arrays repeat the field name, `undefined` fields are skipped, and `Blob` / `File` values are appended as files. A nested object fails the request with `REQ_BUILD_FAILED`.
 *
 * - `struct.parse` ignores the tag. It does not accept a `FormData` instance, only a plain object.
 *
 * @group struct
 */
export function createFormDataBodyStruct<T extends ObjectShape>(
  shape: T,
): ObjectStruct<T> {
  return createCodecObjectStruct(shape, "formData");
}

function createCodecObjectStruct<T extends ObjectShape>(
  shape: T,
  codec: "formData" | "urlencoded",
): ObjectStruct<T> {
  const definition = objectDefinition(shape);
  const created = makeStruct<ObjectStruct<T>>(definition);
  definition.codec = codec;
  return created;
}

/**
 * Struct that parses an object with string keys and one value struct.
 *
 * - Parses every own key of a plain object with `value`. Anything else fails with `invalid_type` (expected `record`).
 *
 * - Parsing stops at the first failing value, and `issue.path` holds its key.
 *
 * - The output is a new object with a `null` prototype.
 *
 * - Throws `TypeError` when `value` is not a struct.
 *
 * The result is a {@link RecordStruct}, a `Struct<{ [key: string]: StructInput<S> }, { [key: string]: Output }>`, where `Output` is `Infer<S>` without `undefined`. When `S` is an optional struct, a value that is `undefined` omits its key from the output.
 *
 * @group struct
 */
export function createRecordStruct<S extends StructLike>(
  value: S,
): RecordStruct<S> {
  assertStruct(value, "record value");

  return makeStruct<RecordStruct<S>>({
    flags: DEFAULT_FLAGS,
    kind: "record",
    value,
  });
}

/**
 * Struct that parses a fixed-length array with one struct per position.
 *
 * `struct.tuple` takes **one array** of structs, not separate arguments:
 *
 * ```ts
 * const Pair = struct.tuple([struct.string(), struct.number()]);
 * ```
 *
 * - Each position is parsed with the struct at the same index. The input must be an array of exactly the same length, otherwise it fails with `invalid_type` (expected `tuple of length N`).
 *
 * - Passing the structs as separate arguments, `struct.tuple(a, b)`, throws a `TypeError`.
 *
 * - Throws `TypeError` when an item is not a struct.
 *
 * The result is a {@link TupleStruct}, a `Struct` whose input and output are tuples of the item types.
 *
 * @group struct
 */
export function createTupleStruct<
  const T extends readonly [StructLike, ...StructLike[]],
>(items: T): TupleStruct<T> {
  const tupleItems: readonly unknown[] = [...items];
  assertStructs(tupleItems, "tuple item");

  return makeStruct<TupleStruct<T>>({
    flags: DEFAULT_FLAGS,
    items: tupleItems,
    kind: "tuple",
  });
}

/**
 * Struct that accepts a value matching any one of several structs.
 *
 * `struct.or` is variadic: pass each option as its own argument.
 *
 * - Tries the options in order and returns the result of the first one that parses.
 *
 * - If none matches, it fails with one `invalid_union` issue at the union's own path. The issues of the individual options are not reported.
 *
 * - Throws `TypeError` when an option is not a struct.
 *
 * The result is a {@link UnionStruct}, a `Struct` whose input and output are the unions of the option types, without `undefined`. For tagged objects prefer {@link struct.discriminatedUnion}(), which reports the issue of the selected option.
 *
 * @group struct
 */
export function createUnionStruct<
  const T extends readonly [StructLike, ...StructLike[]],
>(...options: T): UnionStruct<T> {
  const unionOptions: readonly unknown[] = [...options];
  assertStructs(unionOptions, "or option");

  return makeStruct<UnionStruct<T>>({
    expected: unionOptions
      .map((option) => expectedType(option[DEFINITION]))
      .join(" | "),
    flags: DEFAULT_FLAGS,
    kind: "or",
    options: unionOptions,
  });
}

type RequiredDiscriminatorOption<
  TDiscriminator extends string,
  TOption extends ObjectStruct<ObjectShape>,
> =
  TOption extends ObjectStruct<infer TShape>
    ? TDiscriminator extends keyof TShape
      ? TShape[TDiscriminator] extends StructLike<infer TInput, unknown, false>
        ? undefined extends TInput
          ? never
          : null extends TInput
            ? [TInput] extends [null]
              ? TOption
              : never
            : TOption
        : never
      : never
    : never;

type RequiredDiscriminatorOptions<
  TDiscriminator extends string,
  TOptions extends readonly ObjectStruct<ObjectShape>[],
> = {
  [K in keyof TOptions]: TOptions[K] extends ObjectStruct<ObjectShape>
    ? RequiredDiscriminatorOption<TDiscriminator, TOptions[K]>
    : never;
};

/**
 * Struct that picks one object struct by the value of a tag field.
 *
 * ```ts
 * const Event = struct.discriminatedUnion("kind", [
 *   struct.object({ kind: struct.literal("created"), id: struct.number() }),
 *   struct.object({ kind: struct.literal("deleted"), id: struct.number() }),
 * ]);
 * ```
 *
 * - Every option must be an object struct whose `discriminator` field is a required {@link struct.literal}(). A missing field, a non-literal field, an optional field, or a duplicate tag value throws `TypeError` when the struct is created.
 *
 * - The input must be a plain object. The tag value selects the option, and that option parses the whole object.
 *
 * - A missing tag fails with `missing_key`, and an unknown tag fails with `invalid_union`. Both report the tag field's path. Other failures come from the selected option.
 *
 * - With `struct.parse(..., { aliases: true })` the tag is read from the field's alias.
 *
 * The result is a {@link DiscriminatedUnionStruct}. `RequiredDiscriminatorOptions` is not exported. The type check rejects an option whose tag field is missing or may be `undefined`.
 *
 * @group struct
 */
export function createDiscriminatedUnionStruct<
  const TDiscriminator extends string,
  const TOptions extends readonly [
    ObjectStruct<ObjectShape>,
    ...ObjectStruct<ObjectShape>[],
  ],
>(
  discriminator: TDiscriminator,
  options: TOptions & RequiredDiscriminatorOptions<TDiscriminator, TOptions>,
): DiscriminatedUnionStruct<TOptions> {
  const snapshot: readonly unknown[] = [...options];
  const unionOptions: ObjectRuntimeStruct[] = [];
  const map = new Map<unknown, ObjectRuntimeStruct>();
  const wireKeyByValue = new Map<unknown, string>();
  const discriminatorWireKeys: string[] = [];
  const seenWireKeys = new Set<string>();
  const values: unknown[] = [];

  for (const option of snapshot) {
    assertStruct(option, "discriminatedUnion option");
    if (!isObjectRuntimeStruct(option)) {
      throw new TypeError("discriminatedUnion options must be object structs");
    }
    unionOptions.push(option);
    const optionDef = option[DEFINITION];
    const descriptor = optionDef.cache.declaredDescriptors[discriminator];
    const fieldStruct: unknown =
      descriptor && typeof descriptor.get === "function"
        ? descriptor.get.call(optionDef.shape)
        : descriptor?.value;
    if (!fieldStruct) {
      throw new TypeError(
        `discriminatedUnion option missing discriminator field "${discriminator}"`,
      );
    }
    const fieldDef = isStruct(fieldStruct)
      ? fieldStruct[DEFINITION]
      : undefined;
    if (fieldDef?.kind !== "literal") {
      throw new TypeError(
        `discriminatedUnion option discriminator "${discriminator}" must be a literal struct`,
      );
    }
    if (
      fieldDef.flags.optional ||
      (fieldDef.flags.nullable && fieldDef.value !== null)
    ) {
      throw new TypeError(
        `discriminatedUnion option discriminator "${discriminator}" must be a required literal struct`,
      );
    }
    if (map.has(fieldDef.value)) {
      throw new TypeError(
        `discriminatedUnion duplicate discriminator value: ${JSON.stringify(fieldDef.value)}`,
      );
    }
    const wireKey = fieldDef.alias ?? discriminator;
    map.set(fieldDef.value, option);
    wireKeyByValue.set(fieldDef.value, wireKey);
    if (!seenWireKeys.has(wireKey)) {
      seenWireKeys.add(wireKey);
      discriminatorWireKeys.push(wireKey);
    }
    values.push(fieldDef.value);
  }

  return makeStruct<DiscriminatedUnionStruct<TOptions>>({
    discriminator,
    discriminatorWireKeys,
    expected: values.map((item) => JSON.stringify(item)).join(" | "),
    flags: DEFAULT_FLAGS,
    kind: "discriminatedUnion",
    map,
    options: unionOptions,
    wireKeyByValue,
  });
}

/**
 * Struct that accepts a Blob.
 *
 * - Accepts a `Blob` (a `File` is a `Blob`). Anything else fails with `invalid_type`.
 *
 * - As a body root it is sent as is, with the blob's own type or `application/octet-stream`.
 *
 * - As an `output` or `error` struct it makes the response body be read as a `Blob`.
 *
 * @group struct
 */
export function createBlobStruct(): Struct<Blob, Blob> {
  return createPrimitiveStruct({
    expected: "Blob",
    is: (value): value is Blob => value instanceof Blob,
    kind: "blob",
    runtimeIs: (value): value is Blob =>
      typeof Blob !== "undefined" && value instanceof Blob,
  });
}

/**
 * Struct that accepts a bigint or a bigint string and outputs a bigint.
 *
 * - Accepts a `bigint`, or a string that `BigInt()` can parse. A `number` is rejected.
 *
 * - Output is always a `bigint`; an unparsable string fails with `invalid_type`.
 *
 * - When encoded for the wire, the value becomes a decimal string.
 *
 * @group struct
 */
export function createBigIntStruct(): Struct<bigint | string, bigint> {
  return createPrimitiveStruct({
    decode: (input, invalid) => {
      if (typeof input === "bigint") {
        return input;
      }
      try {
        return BigInt(input);
      } catch {
        return invalid;
      }
    },
    expected: "bigint",
    is: (value): value is bigint | string =>
      typeof value === "bigint" || typeof value === "string",
    kind: "bigint",
    runtimeIs: (value): value is bigint => typeof value === "bigint",
  });
}

/**
 * Struct that accepts a Date, timestamp, or date string and outputs a Date.
 *
 * - Accepts a `Date`, a millisecond timestamp, or a string. A valid `Date` is returned as the same object. A number or string is converted with `new Date(value)`.
 *
 * - Output is a `Date`. A value that produces an invalid date fails with `invalid_type`.
 *
 * - When encoded for the wire, the value becomes an ISO 8601 string (`toISOString()`).
 *
 * @group struct
 */
export function createDateStruct(): Struct<Date | number | string, Date> {
  return createPrimitiveStruct({
    decode: (input, invalid) => {
      const date = input instanceof Date ? input : new Date(input);
      return Number.isNaN(date.getTime()) ? invalid : date;
    },
    expected: "Date",
    is: (value): value is Date | number | string =>
      value instanceof Date ||
      typeof value === "string" ||
      typeof value === "number",
    kind: "date",
    runtimeIs: (value): value is Date =>
      value instanceof Date && !Number.isNaN(value.getTime()),
  });
}

/**
 * Struct that requires a value to satisfy every given struct.
 *
 * `struct.intersection` is variadic: pass each struct as its own argument.
 *
 * - Parses the input with every struct and merges the results.
 *
 * - When every struct is an object struct, the output is one object with the fields of all of them. Keys that none of them declares are removed.
 *
 * - When two structs produce incompatible values for the same key, it fails with `invalid_intersection`.
 *
 * - Accepts `null` only when every struct accepts it, including a nested intersection marked `.null()`.
 *
 * - A single struct is returned unchanged, so it keeps its own identity and type, including `.optional()` and `.null()`. A non-struct argument throws `TypeError`.
 *
 * - A nonempty variadic tuple must account for that singleton. Spreading a tuple that may contain only one member infers both the singleton and multi-member results. Its object fields may therefore be optional. A tuple known to contain at least two members keeps the required intersection semantics.
 *
 * The result is an {@link IntersectionStruct}, a `Struct` whose input and output are the intersections of the member types.
 *
 * @group struct
 */
export function createIntersectionStruct<
  const T extends readonly [StructLike, ...StructLike[]],
>(
  ...structs: T
): T extends readonly [unknown]
  ? T[0]
  : T extends readonly [unknown, unknown, ...unknown[]]
    ? IntersectionStruct<T>
    : T[0] | IntersectionStruct<T>;
export function createIntersectionStruct(
  ...structs: [StructLike, ...StructLike[]]
): StructLike {
  assertStructs(structs, "intersection item");

  if (structs.length === 1) {
    return structs[0];
  }

  const members: readonly RuntimeStruct[] = structs;
  const expected = members
    .map((item) => expectedType(item[DEFINITION]))
    .join(" & ");
  const sides = objectIntersectionSides(members);

  return makeStruct(
    sides
      ? {
          expected,
          flags: DEFAULT_FLAGS,
          kind: "intersection",
          objectSides: true,
          options: sides,
        }
      : {
          expected,
          flags: DEFAULT_FLAGS,
          kind: "intersection",
          objectSides: false,
          options: members,
        },
  );
}

/** The object structs every member flattens to, or undefined when a member is not an object side. */
function objectIntersectionSides(
  structs: readonly RuntimeStruct[],
): ObjectRuntimeStruct[] | undefined {
  const sides: ObjectRuntimeStruct[] = [];
  for (const struct of structs) {
    if (isObjectRuntimeStruct(struct)) {
      sides.push(struct);
      continue;
    }
    const definition = struct[DEFINITION];
    // A nullable intersection stays one member: flattening its sides would drop the null it accepts itself.
    if (
      definition.kind === "intersection" &&
      definition.objectSides &&
      !definition.flags.nullable
    ) {
      sides.push(...definition.options);
      continue;
    }
    return undefined;
  }
  return sides;
}

/**
 * Struct that accepts a File.
 *
 * - Accepts a `File` only; a plain `Blob` fails with `invalid_type`.
 *
 * - Use it for a field of {@link struct.formData}(), or for a raw file body.
 *
 * - As an `output` or `error` struct it makes the response body be read as a blob.
 *
 * @group struct
 */
export function createFileStruct(): Struct<File, File> {
  return createPrimitiveStruct({
    expected: "File",
    is: (value): value is File => value instanceof File,
    kind: "file",
    runtimeIs: (value): value is File =>
      typeof File !== "undefined" && value instanceof File,
  });
}

/**
 * Struct that accepts an ArrayBuffer.
 *
 * - Accepts an `ArrayBuffer` only. Typed arrays and other views fail with `invalid_type`.
 *
 * - As a body root it is sent as bytes with `application/octet-stream`.
 *
 * - As an `output` or `error` struct it makes the response body be read as an `ArrayBuffer`.
 *
 * @group struct
 */
export function createArrayBufferStruct(): Struct<ArrayBuffer, ArrayBuffer> {
  return createPrimitiveStruct({
    expected: "ArrayBuffer",
    is: (value): value is ArrayBuffer => value instanceof ArrayBuffer,
    kind: "arrayBuffer",
  });
}
