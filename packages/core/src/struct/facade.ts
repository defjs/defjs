import {
  createAnyStruct,
  createArrayBufferStruct,
  createArrayStruct,
  createBigIntStruct,
  createBlobStruct,
  createBooleanStruct,
  createDateStruct,
  createDiscriminatedUnionStruct,
  createEnumStruct,
  createFileStruct,
  createFormDataBodyStruct,
  createIntersectionStruct,
  createLiteralStruct,
  createNullStruct,
  createNumberStruct,
  createObjectEnumStruct,
  createObjectStruct,
  createRecordStruct,
  createStringStruct,
  createTupleStruct,
  createUnionStruct,
  createUnknownStruct,
  createUrlencodedBodyStruct,
} from "./constructors";
import { parseStructTuple } from "./introspection";
import type { Struct, StructLike, UnionStruct } from "./types";

type EnumValue<T> = T extends readonly (infer U extends string)[]
  ? U
  : T extends { [key: string]: infer U extends number | string }
    ? U
    : never;

/**
 * Struct that accepts one value from a list of strings or from the values of an object.
 *
 * - With a non-empty string array, the accepted values are the array items.
 *
 * - With an object, the accepted values are the object's string and number **values**, not its keys. `{ A: 'a', B: 2 }` accepts `'a'` and `2`.
 *
 * - A TypeScript numeric `enum` object also accepts its member names, because the reverse mapping is part of its values.
 *
 * - A value outside the set fails with `invalid_enum`. An object with no string or number value throws `TypeError` when the struct is created.
 *
 * @group struct
 */
function structEnum<const T extends readonly [string, ...string[]]>(
  value: T,
): Struct<EnumValue<T>, EnumValue<T>>;
function structEnum<const T extends { [key: string]: number | string }>(
  value: T,
): Struct<EnumValue<T>, EnumValue<T>>;
function structEnum(
  value: { [key: string]: number | string } | readonly [string, ...string[]],
) {
  if (Array.isArray(value)) {
    return createEnumStruct(value as readonly [string, ...string[]]);
  }

  return createObjectEnumStruct(value as { [key: string]: number | string });
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
 * `UnionStruct<T>` is not exported. It is a `Struct` whose input and output are the unions of the option types, without `undefined`. For tagged objects prefer {@link struct.discriminatedUnion}(), which reports the issue of the selected option.
 *
 * @group struct
 */
function structOr<const T extends readonly [StructLike, ...StructLike[]]>(
  ...options: T
): UnionStruct<T> {
  return createUnionStruct(options);
}

/**
 * Facade object for building protocol-boundary structs and parsing values with its constructors and `struct.parse`.
 *
 * Prefer this object over importing the constructor functions one by one. Compose shapes with
 * `struct.object`, then parse with `struct.parse` or let HTTP/SSE/WebSocket
 * endpoints apply the same contracts at the wire boundary. `struct` is a plain object of helpers.
 *
 * ```ts
 * import { struct } from "@defjs/core";
 *
 * const User = struct.object({
 *   id: struct.number(),
 *   displayName: struct.string().alias("display_name"),
 * });
 *
 * function readUser() {
 *   const [error, user] = struct.parse(User, { id: 1, displayName: "Ada" });
 *   if (error) {
 *     console.error(error.message);
 *     return;
 *   }
 *   console.log(user.displayName);
 * }
 *
 * readUser();
 * ```
 *
 * ### Primitives and containers
 *
 * | Helper                                                                           | Role                                                      |
 * | -------------------------------------------------------------------------------- | --------------------------------------------------------- |
 * | {@link struct.string}()                                     | Text                                                      |
 * | {@link struct.number}()                                     | Number, `NaN` rejected                                    |
 * | {@link struct.boolean}()                                   | Boolean                                                   |
 * | {@link struct.bigint}()                                     | `bigint`, or a string that parses as one                  |
 * | {@link struct.date}()                                         | `Date`, from a `Date`, timestamp, or string               |
 * | {@link struct.literal}(value)                              | Exact literal                                             |
 * | {@link struct.null}()                                         | Only `null`                                               |
 * | {@link struct.any}() / unknown() ({@link struct.unknown}) | Any value except `null` and `undefined`                   |
 * | {@link struct.array}(item)                                   | Array of one item struct                                  |
 * | {@link struct.tuple}(items)                                  | Fixed-length array; `items` is one array of structs       |
 * | {@link struct.record}(value)                                | Plain object with string keys and one value struct        |
 * | {@link struct.object}(shape)                                | Plain object with fixed fields; unknown keys are stripped |
 * | {@link struct.or}(...options)                                   | First matching option                                     |
 * | {@link struct.intersection}(...structs)               | Every struct must match; object results are merged        |
 * | {@link struct.discriminatedUnion}(tag, options) | Object option picked by the value of the `tag` field      |
 * | {@link struct.enum}(values)                                   | String array, or the values of a `{ Name: value }` object |
 *
 * ### Body codecs and binary values
 *
 * | Helper                                                                                                                         | Role                                                                                                        |
 * | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
 * | {@link struct.formData}(shape) / urlencoded(shape) ({@link struct.urlencoded})                     | Object struct plus a codec tag. The tag applies only when that value is the request body root               |
 * | {@link struct.arrayBuffer}() / blob() ({@link struct.blob}) / file() ({@link struct.file}) | Binary values. As a body root they are sent as bytes; as `output` / `error` they select that representation |
 * | {@link struct.string}()                                                                                   | Text. As a body root or an inbound `string` struct, the bytes stay text                                     |
 *
 * ### Parsing and modifiers
 *
 * {@link struct.parse}(struct, value, options?) parses an unknown value and returns `[null, value]` or `[StructError, undefined]`.
 *
 * Every struct has the chainable modifiers `.optional()`, `.null()` / `.nullable()`, `.nullish()`, and `.alias(name)`. See {@link StructMethods}.
 *
 * @example
 * ```ts
 * const User = struct.object({
 *   id: struct.number(),
 *   displayName: struct.string().alias('display_name'),
 * })
 *
 * const getUser = defineRequest({
 *   method: 'GET',
 *   path: '/users/:id',
 *   input: struct.object({ id: struct.number() }),
 *   builder: (input) => ({ path: input }),
 *   output: User,
 * })
 *
 * function readUser() {
 *   const [error, user] = struct.parse(User, { id: 1, displayName: 'Ada' })
 *   if (error) {
 *     console.error(error.message)
 *     return
 *   }
 *   console.log(user.displayName)
 * }
 *
 * readUser()
 * ```
 * @group struct
 */
export const struct = {
  any: createAnyStruct,
  array: createArrayStruct,
  arrayBuffer: createArrayBufferStruct,
  bigint: createBigIntStruct,
  blob: createBlobStruct,
  boolean: createBooleanStruct,
  date: createDateStruct,
  discriminatedUnion: createDiscriminatedUnionStruct,
  enum: structEnum,
  file: createFileStruct,
  formData: createFormDataBodyStruct,
  intersection: createIntersectionStruct,
  literal: createLiteralStruct,
  null: createNullStruct,
  number: createNumberStruct,
  object: createObjectStruct,
  or: structOr,
  parse: parseStructTuple,
  record: createRecordStruct,
  string: createStringStruct,
  tuple: createTupleStruct,
  unknown: createUnknownStruct,
  urlencoded: createUrlencodedBodyStruct,
} as const;
