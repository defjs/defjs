import { issue } from "./errors";
import {
  castStruct,
  createPrimitiveStruct,
  DEFAULT_FLAGS,
  makeStruct,
} from "./runtime";
import { assertStruct } from "./shape";
import { DEFINITION } from "./symbols";
import type {
  ArrayStruct,
  DiscriminatedUnionStruct,
  IntersectionStruct,
  LiteralValue,
  NumberStruct,
  ObjectDefinition,
  ObjectStruct,
  ObjectShape,
  PresentValue,
  RecordStruct,
  RuntimeStruct,
  Struct,
  StructDefinition,
  StructLike,
  StringStruct,
  TupleStruct,
  UnionStruct,
  UnknownStruct,
} from "./types";
import { describeValue, expectedType, isPlainObject, success } from "./utils";

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
  return castStruct<StringStruct>(
    createPrimitiveStruct({
      expected: "string",
      is: (value): value is string => typeof value === "string",
      kind: "string",
    }),
  );
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
  return castStruct<NumberStruct>(
    createPrimitiveStruct({
      expected: "number",
      is: (value): value is number =>
        typeof value === "number" && !Number.isNaN(value),
      kind: "number",
    }),
  );
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
  return castStruct<Struct<null, null>>(
    createPrimitiveStruct({
      expected: "null",
      is: (value): value is null => value === null,
      kind: "null",
    }),
  );
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
// oxlint-disable-next-line typescript/no-explicit-any
export function createAnyStruct(): Struct<PresentValue, any> {
  // Type boundary: struct.any() intentionally models an unconstrained decoded value; any is the correct
  // representation of "no static type information" at the output boundary.
  // oxlint-disable-next-line typescript/no-explicit-any
  return castStruct<Struct<PresentValue, any>>(
    makeStruct({
      flags: DEFAULT_FLAGS,
      kind: "any",
    }),
  );
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
  return castStruct<UnknownStruct>(
    makeStruct({
      flags: DEFAULT_FLAGS,
      kind: "unknown",
    }),
  );
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
  return castStruct<Struct<T, T>>(
    makeStruct({
      expected: describeValue(value),
      flags: DEFAULT_FLAGS,
      kind: "literal",
      value,
    }),
  );
}

export function createEnumStruct<
  const T extends readonly [string, ...string[]],
>(values: T): Struct<T[number], T[number]> {
  const enumValues = [...values] as unknown as T;
  return castStruct<Struct<T[number], T[number]>>(
    makeStruct({
      expected: enumValues.map((item) => JSON.stringify(item)).join(" | "),
      flags: DEFAULT_FLAGS,
      kind: "enum",
      values: enumValues,
    }),
  );
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

  return castStruct<Struct<T[keyof T], T[keyof T]>>(
    makeStruct({
      expected: values.map((item) => JSON.stringify(item)).join(" | "),
      flags: DEFAULT_FLAGS,
      kind: "enum",
      values: values as [T[keyof T], ...T[keyof T][]],
    }),
  );
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
 * `ArrayStruct<S>` is not exported. It is a `Struct<StructInput<S>[], Infer<S>[]>`.
 *
 * @group struct
 */
export function createArrayStruct<
  S extends StructLike<unknown, unknown, boolean>,
>(item: S): ArrayStruct<S> {
  assertStruct(item, "array item");

  return castStruct<ArrayStruct<S>>(
    makeStruct({
      flags: DEFAULT_FLAGS,
      item,
      kind: "array",
    }),
  );
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
  if (!isPlainObject(shape)) {
    throw new TypeError("object struct requires a plain object");
  }

  return castStruct<ObjectStruct<T>>(
    makeStruct({
      cache: {
        declaredDescriptors: Object.getOwnPropertyDescriptors(shape),
      },
      flags: DEFAULT_FLAGS,
      kind: "object",
      shape,
    }),
  );
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
  const created = createObjectStruct(shape);
  (
    (created as unknown as RuntimeStruct)[DEFINITION] as ObjectDefinition
  ).codec = codec;
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
 * `RecordStruct<S>` is not exported. It is a `Struct<{ [key: string]: StructInput<S> }, { [key: string]: Output }>`, where `Output` is `Infer<S>` without `undefined`. When `S` is an optional struct, a value that is `undefined` omits its key from the output.
 *
 * @group struct
 */
export function createRecordStruct<
  S extends StructLike<unknown, unknown, boolean>,
>(value: S): RecordStruct<S> {
  assertStruct(value, "record value");

  return castStruct<RecordStruct<S>>(
    makeStruct({
      flags: DEFAULT_FLAGS,
      kind: "record",
      value,
    }),
  );
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
 * `TupleStruct<T>` is not exported. It is a `Struct` whose input and output are tuples of the item types.
 *
 * @group struct
 */
export function createTupleStruct<
  const T extends readonly [
    StructLike<unknown, unknown, boolean>,
    ...StructLike<unknown, unknown, boolean>[],
  ],
>(items: T): TupleStruct<T> {
  const tupleItems = [...items] as unknown as T;
  for (const item of tupleItems) {
    assertStruct(item, "tuple item");
  }

  return castStruct<TupleStruct<T>>(
    makeStruct({
      flags: DEFAULT_FLAGS,
      items: tupleItems,
      kind: "tuple",
    }),
  );
}

export function createUnionStruct<
  const T extends readonly [
    StructLike<unknown, unknown, boolean>,
    ...StructLike<unknown, unknown, boolean>[],
  ],
>(options: T): UnionStruct<T> {
  const unionOptions = [...options] as unknown as T;
  for (const option of unionOptions) {
    assertStruct(option, "or option");
  }

  return castStruct<UnionStruct<T>>(
    makeStruct({
      expected: unionOptions
        .map((option) =>
          expectedType((option as unknown as RuntimeStruct)[DEFINITION]),
        )
        .join(" | "),
      flags: DEFAULT_FLAGS,
      kind: "or",
      options: unionOptions,
      uniformIdentityEncode: computeUniformIdentityEncode(unionOptions),
    }),
  );
}

function computeUniformIdentityEncode(
  options: readonly [
    StructLike<unknown, unknown, boolean>,
    ...StructLike<unknown, unknown, boolean>[],
  ],
): boolean {
  const first = options[0] as unknown as RuntimeStruct;
  const firstDefinition = first[DEFINITION];
  if (firstDefinition.kind === "object") {
    const firstShape = identityEncodeShape(first);
    if (!firstShape) {
      return false;
    }
    for (let index = 1; index < options.length; index += 1) {
      const shape = identityEncodeShape(
        options[index] as unknown as RuntimeStruct,
      );
      if (!shape || shape.size !== firstShape.size) {
        return false;
      }
      for (const [key, kind] of firstShape) {
        if (shape.get(key) !== kind) {
          return false;
        }
      }
    }
    return true;
  }

  return options.every((option) =>
    isIdentityEncodeKind((option as unknown as RuntimeStruct)[DEFINITION].kind),
  );
}

function identityEncodeShape(
  struct: RuntimeStruct,
): Map<string, StructDefinition["kind"]> | undefined {
  const definition = struct[DEFINITION];
  if (definition.kind !== "object") {
    return undefined;
  }

  const encoded = new Map<string, StructDefinition["kind"]>();
  for (const [key, descriptor] of Object.entries(
    definition.cache.declaredDescriptors,
  )) {
    if (typeof descriptor.get === "function") {
      return undefined;
    }
    const fieldDefinition = (descriptor.value as RuntimeStruct | undefined)?.[
      DEFINITION
    ];
    if (!fieldDefinition || !isIdentityEncodeKind(fieldDefinition.kind)) {
      return undefined;
    }
    encoded.set(key, fieldDefinition.kind);
  }
  return encoded;
}

function isIdentityEncodeKind(kind: StructDefinition["kind"]): boolean {
  return (
    kind === "any" ||
    kind === "boolean" ||
    kind === "enum" ||
    kind === "literal" ||
    kind === "null" ||
    kind === "number" ||
    kind === "string" ||
    kind === "unknown"
  );
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
 * `RequiredDiscriminatorOptions` and `DiscriminatedUnionStruct` are not exported. The type check rejects an option whose tag field is missing or may be `undefined`.
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
  const unionOptions = [...options] as unknown as TOptions;
  const map = new Map<unknown, StructLike<unknown, unknown, boolean>>();
  const wireKeyByValue = new Map<unknown, string>();
  const discriminatorWireKeys: string[] = [];
  const seenWireKeys = new Set<string>();
  const values: unknown[] = [];

  for (const option of unionOptions) {
    assertStruct(option, "discriminatedUnion option");
    const optionDef = (option as unknown as RuntimeStruct)[DEFINITION];
    if (optionDef.kind !== "object") {
      throw new TypeError("discriminatedUnion options must be object structs");
    }
    const descriptor = optionDef.cache.declaredDescriptors[discriminator];
    const fieldStruct = (
      descriptor && typeof descriptor.get === "function"
        ? descriptor.get.call(optionDef.shape)
        : descriptor?.value
    ) as RuntimeStruct | undefined;
    if (!fieldStruct) {
      throw new TypeError(
        `discriminatedUnion option missing discriminator field "${discriminator}"`,
      );
    }
    const fieldDef = fieldStruct[DEFINITION];
    /* istanbul ignore next -- type-safe: discriminator is checked at compile time */
    if (fieldDef.kind !== "literal") {
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

  return castStruct<DiscriminatedUnionStruct<TOptions>>(
    makeStruct({
      discriminator,
      discriminatorWireKeys,
      expected: values.map((item) => JSON.stringify(item)).join(" | "),
      flags: DEFAULT_FLAGS,
      kind: "discriminatedUnion",
      map,
      options: unionOptions,
      wireKeyByValue,
    }),
  );
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
    decode: (input, path, fail) => {
      if (typeof input === "bigint") {
        return success(input);
      }
      try {
        return success(BigInt(input as string));
      } catch {
        return fail(issue(path, "invalid_type", "bigint", input));
      }
    },
    encode: (value) => value.toString(),
    expected: "bigint",
    is: (value): value is bigint | string =>
      typeof value === "bigint" || typeof value === "string",
    kind: "bigint",
    runtimeIs: (value): value is bigint => typeof value === "bigint",
  }) as Struct<bigint | string, bigint>;
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
    decode: (input, path, fail) => {
      const date = input instanceof Date ? input : new Date(input as never);
      if (Number.isNaN(date.getTime())) {
        return fail(issue(path, "invalid_type", "Date", input));
      }
      return success(date);
    },
    encode: (value) => value.toISOString(),
    expected: "Date",
    is: (value): value is Date | number | string =>
      value instanceof Date ||
      typeof value === "string" ||
      typeof value === "number",
    kind: "date",
    runtimeIs: (value): value is Date =>
      value instanceof Date && !Number.isNaN(value.getTime()),
  }) as Struct<Date | number | string, Date>;
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
 * - A single struct is returned unchanged, so it keeps its own identity and type, including `.optional()` and `.null()`. Calling it with no structs throws `TypeError`, and so does a non-struct argument.
 *
 * - A nonempty variadic tuple must account for that singleton. Spreading a tuple that may contain only one member infers both the singleton and multi-member results. Its object fields may therefore be optional. A tuple known to contain at least two members keeps the required intersection semantics.
 *
 * `IntersectionStruct<T>` is not exported. It is a `Struct` whose input and output are the intersections of the member types.
 *
 * @group struct
 */
export function createIntersectionStruct<
  const T extends readonly [
    StructLike<unknown, unknown, boolean>,
    ...StructLike<unknown, unknown, boolean>[],
  ],
>(
  ...structs: T
): T extends readonly [unknown]
  ? T[0]
  : T extends readonly [unknown, unknown, ...unknown[]]
    ? IntersectionStruct<T>
    : T[0] | IntersectionStruct<T>;
export function createIntersectionStruct(
  ...structs: [
    StructLike<unknown, unknown, boolean>,
    ...StructLike<unknown, unknown, boolean>[],
  ]
): StructLike<unknown, unknown, boolean> {
  if (structs.length === 0) {
    throw new TypeError("intersection requires at least one struct");
  }

  for (const struct of structs) {
    assertStruct(struct, "intersection item");
  }

  if (structs.length === 1) {
    return structs[0];
  }

  const objectSides = structs.every(isObjectIntersectionSide);
  const options = objectSides
    ? flattenObjectIntersectionSides(structs)
    : structs;

  return makeStruct({
    expected: structs
      .map((item) =>
        expectedType((item as unknown as RuntimeStruct)[DEFINITION]),
      )
      .join(" & "),
    flags: DEFAULT_FLAGS,
    kind: "intersection",
    objectSides,
    options: options as [
      StructLike<unknown, unknown, boolean>,
      ...StructLike<unknown, unknown, boolean>[],
    ],
  });
}

function isObjectIntersectionSide(
  struct: StructLike<unknown, unknown, boolean>,
): boolean {
  const definition = (struct as unknown as RuntimeStruct)[DEFINITION];
  // A nullable intersection stays one member: flattening its sides would drop the null it accepts itself.
  return (
    definition.kind === "object" ||
    (definition.kind === "intersection" &&
      definition.objectSides &&
      !definition.flags.nullable)
  );
}

function flattenObjectIntersectionSides(
  structs: readonly StructLike<unknown, unknown, boolean>[],
): StructLike<unknown, unknown, boolean>[] {
  const options: StructLike<unknown, unknown, boolean>[] = [];
  for (const struct of structs) {
    const definition = (struct as unknown as RuntimeStruct)[DEFINITION];
    if (definition.kind === "intersection") {
      options.push(...definition.options);
    } else {
      options.push(struct);
    }
  }
  return options;
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
    runtimeIs: (value): value is ArrayBuffer =>
      typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer,
  });
}
