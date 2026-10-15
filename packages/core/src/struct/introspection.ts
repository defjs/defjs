import { encodeValue } from './encode'
import { runWithErrorMap, StructError, type ErrorMap } from './errors'
import { resolveStructFields } from './fields'
import { isStruct } from './guards'
import { parseRootValue } from './parse'
import { assertStruct } from './shape'
import { DEFINITION } from './symbols'
import type { ObjectStruct, ObjectShape, ParseResult, RuntimeStruct, StructLike } from './types'

export interface StructField {
  readonly alias: string | undefined
  readonly key: string
  readonly struct: StructLike<unknown, unknown, boolean>
}

export function isObjectStruct(value: unknown): value is ObjectStruct<ObjectShape> {
  return isStruct(value) && (value as RuntimeStruct)[DEFINITION].kind === 'object'
}

export function getStructFields(struct: StructLike<unknown, unknown, boolean>): readonly StructField[] {
  assertStruct(struct, 'struct')
  const runtime = struct as unknown as RuntimeStruct
  const definition = runtime[DEFINITION]
  if (definition.kind !== 'object') {
    throw new TypeError('object struct is required')
  }

  return Object.freeze(
    resolveStructFields(runtime, definition).map((field) =>
      Object.freeze({
        alias: field.alias,
        key: field.key,
        struct: field.struct as unknown as StructLike<unknown, unknown, boolean>,
      }),
    ),
  )
}

export function encodeStructValue(struct: StructLike<unknown, unknown, boolean>, value: unknown): unknown {
  assertStruct(struct, 'struct')
  return encodeValue(struct as unknown as RuntimeStruct, value)
}

export function parseStructTuple<S extends StructLike<unknown, unknown, boolean>>(
  struct: S,
  value: unknown,
  options?: { aliases?: boolean; errorMap?: ErrorMap },
): ParseResult<S['_struct']['output']> {
  assertStruct(struct, 'struct')
  const runtime = struct as unknown as RuntimeStruct
  return runWithErrorMap(options?.errorMap, () => {
    const result = parseRootValue(runtime, value, 'value', options?.aliases === true)
    if (result.ok) {
      return [null, result.value as unknown as S['_struct']['output']]
    }
    return [new StructError([result.issue]), undefined]
  })
}

export function parseStructValue(
  struct: StructLike<unknown, unknown, boolean>,
  value: unknown,
  options?: { tagObjects?: boolean; useAliases?: boolean },
): unknown {
  assertStruct(struct, 'struct')
  const result = parseRootValue(struct as unknown as RuntimeStruct, value, 'value', options?.useAliases, options?.tagObjects === true)
  if (!result.ok) {
    throw new StructError([result.issue])
  }
  return result.value
}
