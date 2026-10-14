import { combineGuides, readOwnGuide, tagOwnNode } from './guide'
import { DEFINITION } from './symbols'
import type { EnumDefinition, Path, RuntimeStruct, StructDefinition } from './types'

export type IntersectionMerge = { ok: true; value: unknown } | { ok: false; path: Path; received: unknown }

/**
 * Deep-merge two intersection outputs.
 *
 * `Object.is` keeps NaN and distinguishes signed zeroes. Equal-time Dates are one instant even
 * though the instances differ. Plain objects are copied onto a null prototype so `__proto__` stays
 * an own data key. Anything else, including arrays of different lengths, is a conflict.
 *
 * `tagNodes` folds each side's parse tag into the new object at this level. One-sided children are
 * copied with the tag their own parser already wrote, so a later walk is not required. Null and
 * undefined never enter this branch.
 */
export function mergeIntersectionValues(left: unknown, right: unknown, tagNodes = false): IntersectionMerge {
  if (Object.is(left, right)) {
    return { ok: true, value: left }
  }
  if (left instanceof Date && right instanceof Date && left.getTime() === right.getTime()) {
    return { ok: true, value: left }
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const output = nullObject()
    for (const key of Object.keys(left)) {
      output[key] = left[key]
    }
    for (const key of Object.keys(right)) {
      if (!hasOwnKey(output, key)) {
        output[key] = right[key]
        continue
      }
      const merged = mergeIntersectionValues(output[key], right[key], tagNodes)
      if (!merged.ok) {
        return { ok: false, path: [key, ...merged.path], received: merged.received }
      }
      output[key] = merged.value
    }
    if (tagNodes) {
      const tag = combineGuides(readOwnGuide(left), readOwnGuide(right))
      if (tag) {
        tagOwnNode(output, tag)
      }
    }
    return { ok: true, value: output }
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return { ok: false, path: [], received: right }
    }
    const output = new Array<unknown>(left.length)
    for (let index = 0; index < left.length; index += 1) {
      const merged = mergeIntersectionValues(left[index], right[index], tagNodes)
      if (!merged.ok) {
        return { ok: false, path: [index, ...merged.path], received: merged.received }
      }
      output[index] = merged.value
    }
    return { ok: true, value: output }
  }
  return { ok: false, path: [], received: right }
}

export function intersectionEncodeError(path: Path): TypeError {
  return new TypeError(`invalid intersection encode at ${formatPath(path)}`)
}

/** `unknown` and `any` are the identity of intersection, including an intersection made only of them. */
export function isIntersectionIdentity(struct: RuntimeStruct): boolean {
  const definition = struct[DEFINITION]
  if (definition.kind === 'any' || definition.kind === 'unknown') {
    return true
  }
  if (definition.kind !== 'intersection') {
    return false
  }
  for (const option of definition.options) {
    if (!isIntersectionIdentity(option as RuntimeStruct)) {
      return false
    }
  }
  return true
}

export function matchesEnum(definition: EnumDefinition<string | number>, value: unknown): boolean {
  // One-shot schemas avoid allocating a Set. A second lookup pays for the reusable index.
  if (definition.valueSet === undefined) {
    definition.valueSet = null
    return definition.values.includes(value as string | number)
  }
  return (definition.valueSet ??= new Set(definition.values)).has(value as string | number)
}

/** What a decode hook returns for a value it accepts: the decoded value itself. */
export function success<T>(value: T): T {
  return value
}

export function expectedType(definition: StructDefinition): string {
  switch (definition.kind) {
    case 'any':
      return 'any'

    case 'array':
      return `array<${expectedType((definition.item as RuntimeStruct)[DEFINITION])}>`

    case 'arrayBuffer':
      return 'ArrayBuffer'

    case 'blob':
      return 'Blob'

    case 'bigint':
    case 'boolean':
    case 'date':
    case 'file':
    case 'null':
    case 'number':
    case 'string':
      return definition.expected

    case 'enum':
    case 'literal':
      return definition.expected

    case 'intersection':
    case 'or':
    case 'discriminatedUnion':
      return definition.expected

    case 'object':
      return 'object'

    case 'record':
      return `record<${expectedType((definition.value as RuntimeStruct)[DEFINITION])}>`

    case 'tuple':
      return 'tuple'

    case 'unknown':
      return 'unknown'
  }
}

export function formatPath(path: Path): string {
  if (path.length === 0) {
    return '<root>'
  }

  let output = ''
  for (const item of path) {
    if (typeof item === 'number') {
      output += `[${item}]`
      continue
    }

    output += output ? `.${item}` : item
  }
  return output
}

/**
 * A null-prototype object for a node whose keys come from a struct.
 *
 * V8 puts `Object.create(null)` objects in dictionary mode, which makes every later write and read
 * slower, including the caller's reads of a decoded body. Dropping the prototype from a fresh literal
 * keeps fast properties. With no prototype, a `__proto__` key is an ordinary own data property.
 * Records keep `Object.create(null)`: arbitrary keys are what dictionary mode is for.
 */
export function nullObject(): { [key: string]: unknown } {
  const value = {}
  Object.setPrototypeOf(value, null)
  return value as { [key: string]: unknown }
}

export function hasOwnKey(value: { [key: string]: unknown }, key: string): boolean {
  return Object.hasOwn(value, key)
}

export function isPlainObject(value: unknown): value is { [key: string]: unknown } {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Structural equality for encoded wire values.
 *
 * Leaves use `Object.is`, so infinities and signed zeroes stay distinct. Plain objects ignore key
 * order. Arrays compare element by element. This never calls a user serializer.
 */
export function sameWireValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameWireValue(item, right[index]))
    )
  }
  if (!isPlainObject(left) || !isPlainObject(right)) {
    return false
  }

  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => hasOwnKey(right, key) && sameWireValue(left[key], right[key]))
}

/**
 * Kind of a received value, safe to put in a log line.
 *
 * Names the kind and never the value. `File` is checked before `Blob` because a file is a blob.
 */
export function describeKind(value: unknown): string {
  if (value === null) {
    return 'null'
  }

  if (Array.isArray(value)) {
    return 'array'
  }

  if (typeof value !== 'object') {
    return typeof value
  }

  if (value instanceof File) {
    return 'File'
  }

  if (value instanceof Blob) {
    return 'Blob'
  }

  if (value instanceof ArrayBuffer) {
    return 'ArrayBuffer'
  }

  if (value instanceof Date) {
    return 'Date'
  }

  return 'object'
}

export function describeValue(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value)
}
