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
} from './constructors'
import { parseStructTuple } from './introspection'
import type { Struct, StructLike, UnionStruct } from './types'

type EnumValue<T> = T extends readonly (infer U extends string)[]
  ? U
  : T extends { [key: string]: infer U extends number | string }
    ? U
    : never

function structEnum<const T extends readonly [string, ...string[]]>(value: T): Struct<EnumValue<T>, EnumValue<T>>
function structEnum<const T extends { [key: string]: number | string }>(value: T): Struct<EnumValue<T>, EnumValue<T>>
function structEnum(value: { [key: string]: number | string } | readonly [string, ...string[]]) {
  if (Array.isArray(value)) {
    return createEnumStruct(value as readonly [string, ...string[]])
  }

  return createObjectEnumStruct(value as { [key: string]: number | string })
}

function structOr<const T extends readonly [StructLike, ...StructLike[]]>(...options: T): UnionStruct<T> {
  return createUnionStruct(options)
}

/**
 * Facade for building protocol-boundary structs and parsing values.
 *
 * Prefer this entry point over internal constructors. Compose shapes with
 * `struct.object`, then parse with `struct.parse` or let HTTP/SSE/WebSocket
 * endpoints apply the same contracts at the wire boundary.
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
 * const [error, user] = struct.parse(User, { id: 1, displayName: 'Ada' })
 * ```
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
} as const
