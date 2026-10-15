import { encodeValue } from '../struct/encode'
import { resolveStructFields, type ResolvedStructField } from '../struct/fields'
import { guideMembers, guideTag, isGuideSet, readOwnGuide, type Guide } from '../struct/guide'
import { isStruct } from '../struct/guards'
import { selectUnionOptions } from '../struct/match'
import { DEFINITION, STRUCT } from '../struct/symbols'
import { isBlob, isFormData, isReadableStream, isURLSearchParams } from './type_guards'
import type { IntersectionDefinition, ObjectDefinition, Path, RecordDefinition, RuntimeStruct, UnionDefinition } from '../struct/types'
import {
  intersectionEncodeError,
  isIntersectionIdentity,
  isPlainObject,
  mergeIntersectionValues,
  nullObject,
  sameWireValue,
} from '../struct/utils'

export type OutboundTransport = 'http' | 'sse' | 'webSocket'

/** Accepts any concrete builder. `never` keeps the parameter contravariant. */
export type OutboundBuilder = (input: never) => unknown

export type MaterializedRequest = {
  body?: unknown
  defaultContentType?: string
  headers?: HeadersInit | { [key: string]: unknown }
  params?: { [key: string]: string }
  query?: URLSearchParams | { [key: string]: unknown }
}

type FormCodec = 'formData' | 'urlencoded'

type FormTarget = {
  append(key: string, value: string): void
}

export function runOutboundBuilder(input: unknown, builder: OutboundBuilder | undefined, inputDeclared = input !== undefined): unknown {
  if (builder === undefined) {
    if (inputDeclared) {
      throw new TypeError('An endpoint with input requires an explicit builder')
    }
    return {}
  }

  const result = builder(input as never)
  return result === undefined ? {} : result
}

export function materializeOutboundRequest(shape: unknown, transport: OutboundTransport): MaterializedRequest {
  if (!isPlainObject(shape)) {
    throw new TypeError('builder must return an object')
  }

  if (transport === 'webSocket') {
    if (shape['headers'] !== undefined) {
      throw new TypeError('WebSocket request does not support headers')
    }
    if (shape['body'] !== undefined) {
      throw new TypeError('WebSocket request does not support body')
    }
  }

  const request: MaterializedRequest = {}
  if (shape['path'] !== undefined) {
    request.params = materializePath(shape['path'])
  }
  if (shape['query'] !== undefined) {
    request.query = materializeQuery(shape['query'])
  }
  if (shape['headers'] !== undefined) {
    request.headers = materializeHeaders(shape['headers'])
  }
  if (shape['body'] !== undefined) {
    const body = materializeBody(shape['body'])
    request.body = body.body
    if (body.defaultContentType) {
      request.defaultContentType = body.defaultContentType
    }
  }
  return request
}

const LEAF_KINDS: ReadonlySet<string> = new Set([
  'any',
  'arrayBuffer',
  'bigint',
  'blob',
  'boolean',
  'date',
  'enum',
  'file',
  'literal',
  'null',
  'number',
  'string',
  'unknown',
])

type ContainerGuide =
  | { kind: 'array'; item: RuntimeStruct }
  | { kind: 'object'; struct: RuntimeStruct }
  | { kind: 'record'; valueStruct: RuntimeStruct }
  | { kind: 'tuple'; items: readonly RuntimeStruct[] }

export function encodeOutbound(value: unknown): unknown {
  return encodeGuided(value, undefined)
}

function encodeGuided(value: unknown, guide?: Guide, path: Path = []): unknown {
  // any/unknown is a passthrough wire group, not an intersection identity. A tag on this value
  // must not rename the group, and a passthrough array stays stored. An untagged object still
  // recurses, so a fresh container can carry tagged children.
  if (guide !== undefined && !isGuideSet(guide) && isPassthroughStruct(guide) && (!isPlainObject(value) || readOwnGuide(value))) {
    return value
  }
  if (isPlainObject(value)) {
    const tagged = readOwnGuide(value)
    if (tagged) {
      // Overlap with the parent guide means this tag came from the same parse: keep only that overlap
      // so another wire group cannot leak its aliases. A disjoint tag is a separately parsed replacement.
      return encodeOwnGuide(value, guide === undefined ? tagged : narrowToParent(tagged, guide, value, path), path)
    }
  }
  if (isGuideSet(guide)) {
    return encodeMembers(value, guide.members, path)
  }
  if (guide?.[DEFINITION].kind === 'intersection') {
    return encodeIntersectionGuide(value, guide, path)
  }
  // Peel unions before container dispatch so every match uses this same recursion.
  if (guide?.[DEFINITION].kind === 'or') {
    return encodeMatchingUnion(value, guide, path)
  }
  if (Array.isArray(value)) {
    return encodeGuidedArray(value, guide, path)
  }
  if (isPlainObject(value)) {
    return encodeGuidedObject(value, guide, path)
  }
  return encodeGuidedLeaf(value, guide)
}

function narrowToParent(own: Guide, parent: Guide, value: unknown, path: Path): Guide {
  // Provenance unwraps identity and mixed intersections. Encoding a fresh value must not.
  const derived = resolveGuideMembers(guideMembers(parent), value, path, true)
  const shared: RuntimeStruct[] = []
  for (const member of guideMembers(own)) {
    if (derived.includes(member)) {
      shared.push(member)
    }
  }
  if (shared.length === 0) {
    return own
  }
  // shared is non-empty, so guideTag returns the one struct or a conjunction.
  return guideTag(shared) as Guide
}

function encodeOwnGuide(value: { [key: string]: unknown }, guide: Guide, path: Path): unknown {
  if (isGuideSet(guide)) {
    return encodeMembers(value, guide.members, path)
  }
  return encodeTaggedObject(value, guide, path)
}

function encodeIntersectionGuide(value: unknown, guide: RuntimeStruct, path: Path): unknown {
  const definition = guide[DEFINITION] as IntersectionDefinition
  if (definition.objectSides && isPlainObject(value)) {
    return encodeMembers(value, definition.options as unknown as readonly RuntimeStruct[], path)
  }
  // Array/tuple intersections are not object sides, but their items still have to be guided.
  if (Array.isArray(value)) {
    return encodeMembers(value, [guide], path)
  }
  // A mixed intersection does not guide a fresh object. Parsed objects carry their own tags.
  return encodeGuided(value, undefined, path)
}

function encodeMembers(value: unknown, members: readonly RuntimeStruct[], path: Path): unknown {
  // An array has no tag of its own, so the intersection around its item structs has to be opened here.
  const resolved = resolveGuideMembers(members, value, path, Array.isArray(value))
  if (Array.isArray(value)) {
    return encodeArrayMembers(value, resolved, path)
  }
  if (isPlainObject(value)) {
    return encodeObjectNode(value, resolved, path)
  }
  return encodeLeafMembers(value, resolved)
}

function resolveGuideMembers(members: readonly RuntimeStruct[], value: unknown, path: Path, unwrapIntersections: boolean): RuntimeStruct[] {
  const resolved: RuntimeStruct[] = []
  for (const member of members) {
    appendResolved(member, value, path, resolved, unwrapIntersections)
  }
  return resolved
}

function appendResolved(struct: RuntimeStruct, value: unknown, path: Path, out: RuntimeStruct[], unwrapIntersections: boolean): void {
  const definition = struct[DEFINITION]
  switch (definition.kind) {
    case 'or': {
      const matches = selectUnionOptions((definition as UnionDefinition).options, value)
      const first = matches[0] as RuntimeStruct | undefined
      if (!first) {
        return
      }
      // Every match is encoded. Agreeing branches contribute one structure; a difference is an error.
      if (matches.length > 1) {
        const encoded = encodeGuided(value, first, path)
        for (let index = 1; index < matches.length; index += 1) {
          if (!sameWireValue(encoded, encodeGuided(value, matches[index] as RuntimeStruct, path))) {
            throw new TypeError('ambiguous union encode: multiple union branches match with different wire output')
          }
        }
      }
      appendResolved(first, value, path, out, unwrapIntersections)
      return
    }
    case 'discriminatedUnion': {
      if (!isPlainObject(value)) {
        return
      }
      const matched = definition.map.get(value[definition.discriminator]) as RuntimeStruct | undefined
      if (matched) {
        appendResolved(matched, value, path, out, unwrapIntersections)
      }
      return
    }
    case 'intersection':
      // A fresh mixed intersection stays anonymous. Provenance still unwraps it so a parsed tag can
      // intersect the member that actually parsed the node, including `T & unknown`.
      if (definition.objectSides || unwrapIntersections) {
        for (const option of definition.options) {
          const runtime = option as RuntimeStruct
          if (unwrapIntersections && isIntersectionIdentity(runtime)) {
            continue
          }
          appendResolved(runtime, value, path, out, unwrapIntersections)
        }
      }
      return
    default:
      out.push(struct)
  }
}

function encodeLeafMembers(value: unknown, members: readonly RuntimeStruct[]): unknown {
  if (value === undefined) {
    return undefined
  }
  // Null stays a leaf. Container guides must not be walked with Object.keys(null).
  if (value === null) {
    for (const member of members) {
      const definition = member[DEFINITION]
      if (definition.kind === 'null' || definition.flags.nullable || LEAF_KINDS.has(definition.kind)) {
        return encodeGuidedLeaf(value, member)
      }
    }
    return null
  }
  for (const member of members) {
    if (LEAF_KINDS.has(member[DEFINITION].kind)) {
      return encodeGuidedLeaf(value, member)
    }
  }
  return coerceJsonLeaf(value)
}

function materializePath(value: unknown): { [key: string]: string } {
  const encoded = encodeOutbound(value)
  if (!isPlainObject(encoded)) {
    throw new TypeError('path value must be an object')
  }

  // Ordinary `{}` assignment treats "__proto__" as the prototype setter and drops the key.
  const params: { [key: string]: string } = Object.create(null)
  for (const [key, item] of Object.entries(encoded)) {
    if (item === null) {
      throw new TypeError(`path value for "${key}" must not be null`)
    }
    if (typeof item === 'object') {
      throw new TypeError(`path value for "${key}" must be a scalar`)
    }
    params[key] = String(item)
  }
  return params
}

function materializeQuery(value: unknown): URLSearchParams | { [key: string]: unknown } {
  if (isURLSearchParams(value)) {
    return value
  }

  const encoded = encodeOutbound(value)
  if (!isPlainObject(encoded)) {
    throw new TypeError('query value must be an object or URLSearchParams')
  }
  rejectNullValues(encoded, 'query')
  return encoded
}

function materializeHeaders(value: unknown): HeadersInit | { [key: string]: unknown } {
  if (typeof Headers !== 'undefined' && value instanceof Headers) {
    return value
  }
  if (Array.isArray(value)) {
    return value as HeadersInit
  }

  const encoded = encodeOutbound(value)
  if (!isPlainObject(encoded)) {
    throw new TypeError('headers value must be a header record or HeadersInit')
  }
  for (const [key, item] of Object.entries(encoded)) {
    assertHeaderValue(item, key)
  }
  return encoded
}

function materializeBody(body: unknown): { body?: unknown; defaultContentType?: string } {
  const codec = codecOf(body)
  if (codec && isPlainObject(body)) {
    return { body: encodeCodecBody(body, codec) }
  }
  if (
    isFormData(body) ||
    isURLSearchParams(body) ||
    isBlob(body) ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    isReadableStream(body)
  ) {
    return { body }
  }
  // Classify the builder value. Date and bigint encode to strings and still belong to JSON.
  if (typeof body === 'string') {
    return { body }
  }

  return {
    body: JSON.stringify(encodeOutbound(body), rejectNonJson),
    defaultContentType: 'application/json',
  }
}

// JSON.stringify drops a function or symbol, writes NaN and Infinity as null, and turns a Map, Set, stream or
// class instance into `{}`. The replacer sees each value after toJSON, so what is still not JSON data is rejected.
// HTTP JSON bodies and WebSocket text frames share this guard.
export function rejectNonJson(key: string, value: unknown, source: 'body' | 'Outgoing WebSocket message' = 'body'): unknown {
  if (
    typeof value === 'function' ||
    typeof value === 'symbol' ||
    (typeof value === 'number' && !Number.isFinite(value)) ||
    (typeof value === 'object' && value !== null && !Array.isArray(value) && !isPlainObject(value))
  ) {
    const kind =
      typeof value === 'number'
        ? String(value)
        : typeof value === 'object'
          ? (value as { constructor?: { name?: string } }).constructor?.name || Object.prototype.toString.call(value).slice(8, -1)
          : typeof value
    const advice =
      source === 'body'
        ? 'Send JSON data, a string, bytes, Blob, FormData, URLSearchParams or a Web ReadableStream (ReadableStream.from(iterable), Readable.toWeb(readable)).'
        : 'Send JSON data.'
    throw new TypeError(`${source}${key ? ` field "${key}"` : ''} is not JSON data: ${kind}. ${advice}`)
  }
  return value
}

function encodeCodecBody(body: { [key: string]: unknown }, codec: FormCodec): FormData | URLSearchParams {
  const encoded = encodeOutbound(body) as { [key: string]: unknown }
  if (codec === 'formData') {
    const form = new FormData()
    for (const [key, value] of Object.entries(encoded)) {
      appendFormValue(form, key, value, codec)
    }
    return form
  }

  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(encoded)) {
    appendFormValue(params, key, value, codec)
  }
  return params
}

function appendFormValue(target: FormTarget, key: string, value: unknown, codec: FormCodec): void {
  if (value === undefined) {
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      appendFormValue(target, key, item, codec)
    }
    return
  }
  if (codec === 'formData' && typeof Blob !== 'undefined' && value instanceof Blob) {
    ;(target as FormData).append(key, value)
    return
  }
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    target.append(key, String(value))
    return
  }
  throw new TypeError(`${codec} field "${key}" does not support nested values`)
}

function encodeTaggedObject(value: { [key: string]: unknown }, struct: RuntimeStruct, path: Path): { [key: string]: unknown } {
  return encodeObjectNode(value, [struct], path)
}

type WireGroup = {
  passthrough: boolean
  structs: RuntimeStruct[]
  wire: string
}

function isPassthroughStruct(struct: RuntimeStruct): boolean {
  const kind = struct[DEFINITION].kind
  return kind === 'any' || kind === 'unknown'
}

type ObjectKeySets = { fieldKeys: ReadonlySet<string>; wireKeys: ReadonlySet<string> }

// Keyed by the cached field list, so the sets live exactly as long as the struct that owns them.
const objectKeySets = new WeakMap<readonly ResolvedStructField[], ObjectKeySets>()

function keySetsOf(fields: readonly ResolvedStructField[]): ObjectKeySets {
  let sets = objectKeySets.get(fields)
  if (!sets) {
    sets = { fieldKeys: new Set(fields.map((field) => field.key)), wireKeys: new Set(fields.map((field) => field.wireKey)) }
    objectKeySets.set(fields, sets)
  }
  return sets
}

// One object struct is the common node. Its wire keys are unique, so every field is one plain write
// and the grouping below would only rebuild the same plan on every call.
function encodeSingleObject(value: { [key: string]: unknown }, struct: RuntimeStruct, path: Path): { [key: string]: unknown } {
  const fields = resolveStructFields(struct, struct[DEFINITION] as ObjectDefinition)
  const output = nullObject()
  for (const field of fields) {
    if (!Object.hasOwn(value, field.key)) {
      continue
    }
    const fieldValue = value[field.key]
    if (fieldValue === undefined) {
      continue
    }
    output[field.wireKey] = encodeGuided(fieldValue, field.struct, [...path, field.key])
  }

  const { fieldKeys, wireKeys } = keySetsOf(fields)
  for (const key of Object.keys(value)) {
    if (fieldKeys.has(key)) {
      continue
    }
    if (wireKeys.has(key)) {
      throw new TypeError(`wire key collision for "${key}"`)
    }
    const extra = value[key]
    if (extra === undefined) {
      continue
    }
    output[key] = encodeGuided(extra, undefined, [...path, key])
  }
  return output
}

function encodeObjectNode(value: { [key: string]: unknown }, members: readonly RuntimeStruct[], path: Path): { [key: string]: unknown } {
  if (members.length === 1 && (members[0] as RuntimeStruct)[DEFINITION].kind === 'object') {
    return encodeSingleObject(value, members[0] as RuntimeStruct, path)
  }
  const objects: RuntimeStruct[] = []
  const records: RuntimeStruct[] = []
  const passthroughs: RuntimeStruct[] = []
  for (const member of members) {
    const kind = member[DEFINITION].kind
    if (kind === 'object') {
      objects.push(member)
    } else if (kind === 'record') {
      records.push(member)
    } else if (isPassthroughStruct(member)) {
      passthroughs.push(member)
    }
  }

  const output = nullObject()
  const fieldKeys = new Set<string>()
  const wireKeys = new Set<string>()
  const plans = new Map<string, WireGroup[]>()
  const order: string[] = []

  for (const member of objects) {
    for (const field of resolveStructFields(member, member[DEFINITION] as ObjectDefinition)) {
      fieldKeys.add(field.key)
      wireKeys.add(field.wireKey)
      addWireGroup(plans, order, field.key, field.wireKey, field.struct)
    }
  }

  const recordValues = records.map((record) => (record[DEFINITION] as RecordDefinition).value as RuntimeStruct)
  // A record declares every key at this node, so there is no separate literal pass.
  const keys = records.length > 0 ? declaredRecordKeys(value, order) : order
  if (records.length > 0) {
    for (const key of keys) {
      for (const valueStruct of recordValues) {
        addWireGroup(plans, order, key, key, valueStruct)
      }
    }
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      continue
    }
    const fieldValue = value[key]
    if (fieldValue === undefined) {
      continue
    }
    // Every key in `keys` was inserted into `plans` above.
    writeWireGroups(output, fieldValue, plans.get(key) as WireGroup[], [...path, key])
  }

  if (records.length > 0) {
    return applyPassthrough(output, value, passthroughs, path)
  }

  // The passthrough group is the raw value, same as encodeJson. Encoding extras first would turn a
  // Date into an ISO string and then conflict with that raw group.
  if (passthroughs.length > 0) {
    return applyPassthrough(output, value, passthroughs, path)
  }

  for (const key of Object.keys(value)) {
    if (fieldKeys.has(key)) {
      continue
    }
    if (wireKeys.has(key)) {
      throw new TypeError(`wire key collision for "${key}"`)
    }
    const extra = value[key]
    if (extra === undefined) {
      continue
    }
    output[key] = encodeGuided(extra, undefined, [...path, key])
  }

  return output
}

function applyPassthrough(
  output: { [key: string]: unknown },
  value: { [key: string]: unknown },
  passthroughs: readonly RuntimeStruct[],
  path: Path,
): { [key: string]: unknown } {
  let merged: unknown = output
  for (const guide of passthroughs) {
    const passed = encodeGuided(value, guide, path)
    const result = mergeIntersectionValues(merged, passed, false, path.length)
    if (!result.ok) {
      throw intersectionEncodeError([...path, ...result.path])
    }
    merged = result.value
  }
  return merged as { [key: string]: unknown }
}

function addWireGroup(plans: Map<string, WireGroup[]>, order: string[], logical: string, wire: string, struct: RuntimeStruct): void {
  let groups = plans.get(logical)
  if (!groups) {
    groups = []
    plans.set(logical, groups)
    order.push(logical)
  }
  const passthrough = isPassthroughStruct(struct)
  // Sharing a group with a concrete struct encodes once and drops the stored keys.
  let group = groups.find((item) => item.wire === wire && item.passthrough === passthrough)
  if (!group) {
    group = { passthrough, structs: [], wire }
    groups.push(group)
  }
  group.structs.push(struct)
}

function writeWireGroups(output: { [key: string]: unknown }, fieldValue: unknown, groups: readonly WireGroup[], path: Path): void {
  for (const group of groups) {
    const guide = group.passthrough ? group.structs[0] : guideTag(group.structs)
    writeWire(output, group.wire, encodeGuided(fieldValue, guide, path), path.length)
  }
}

function declaredRecordKeys(value: { [key: string]: unknown }, order: readonly string[]): string[] {
  const keys: string[] = []
  const seen = new Set<string>()
  for (const key of order) {
    if (Object.hasOwn(value, key)) {
      keys.push(key)
      seen.add(key)
    }
  }
  for (const key of Object.keys(value)) {
    if (!seen.has(key)) {
      keys.push(key)
    }
  }
  return keys
}

function writeWire(output: { [key: string]: unknown }, wireKey: string, encoded: unknown, depth: number): void {
  if (!Object.hasOwn(output, wireKey)) {
    output[wireKey] = encoded
    return
  }
  const merged = mergeIntersectionValues(output[wireKey], encoded, false, depth)
  if (!merged.ok) {
    throw intersectionEncodeError([wireKey, ...merged.path])
  }
  output[wireKey] = merged.value
}

function encodeGuidedArray(value: unknown[], guide: RuntimeStruct | undefined, path: Path): unknown[] {
  const container = guide ? containerOf(guide, value) : undefined
  if (container?.kind === 'array') {
    const item = container.item
    return value.map((entry, index) => encodeGuided(entry, item, [...path, index]))
  }
  if (container?.kind === 'tuple') {
    const items = container.items
    return value.map((entry, index) => encodeGuided(entry, index < items.length ? items[index] : undefined, [...path, index]))
  }
  return value.map((entry, index) => encodeGuided(entry, undefined, [...path, index]))
}

function encodeArrayMembers(value: unknown[], members: readonly RuntimeStruct[], path: Path): unknown[] {
  return value.map((entry, index) => {
    const children: RuntimeStruct[] = []
    const passthrough: RuntimeStruct[] = []
    for (const member of members) {
      const definition = member[DEFINITION]
      let child: RuntimeStruct | undefined
      if (definition.kind === 'array') {
        child = definition.item as RuntimeStruct
      } else if (definition.kind === 'tuple' && index < definition.items.length) {
        child = definition.items[index] as RuntimeStruct
      }
      if (!child) {
        continue
      }
      // An any/unknown item is not an intersection identity. Its stored keys stay beside the concrete item.
      if (isPassthroughStruct(child)) {
        passthrough.push(child)
        continue
      }
      children.push(child)
    }
    const itemPath = [...path, index]
    let encoded: unknown = encodeGuided(entry, guideTag(children), itemPath)
    for (const guide of passthrough) {
      // Nullish and scalar items merge by value. Object.keys(null) and assignment onto a string both throw.
      const passed = encodeGuided(entry, guide, itemPath)
      const merged = mergeIntersectionValues(encoded, passed, false, itemPath.length)
      if (!merged.ok) {
        throw intersectionEncodeError([...itemPath, ...merged.path])
      }
      encoded = merged.value
    }
    return encoded
  })
}

function encodeGuidedObject(value: { [key: string]: unknown }, guide: RuntimeStruct | undefined, path: Path): { [key: string]: unknown } {
  const container = guide ? containerOf(guide, value) : undefined
  if (container?.kind === 'object') {
    return encodeTaggedObject(value, container.struct, path)
  }
  if (container?.kind === 'record') {
    return encodeRecord(container.valueStruct, value, path)
  }
  return encodeAnonymousObject(value, path)
}

function encodeGuidedLeaf(value: unknown, guide: RuntimeStruct | undefined): unknown {
  // encodeValue is only for leaves. Date and bigint still stringify when the guide does not encode them.
  const encoded = guide && LEAF_KINDS.has(guide[DEFINITION].kind) ? encodeValue(guide, value) : value
  return coerceJsonLeaf(encoded)
}

function coerceJsonLeaf(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (typeof value === 'bigint') {
    return value.toString()
  }
  return value
}

function containerOf(guide: RuntimeStruct, value: unknown): ContainerGuide | undefined {
  const definition = guide[DEFINITION]
  switch (definition.kind) {
    case 'object':
      return { kind: 'object', struct: guide }
    case 'record':
      return { kind: 'record', valueStruct: definition.value as RuntimeStruct }
    case 'array':
      return { kind: 'array', item: definition.item as RuntimeStruct }
    case 'tuple':
      return { kind: 'tuple', items: definition.items as unknown as readonly RuntimeStruct[] }
    case 'discriminatedUnion': {
      if (!isPlainObject(value)) {
        return undefined
      }
      const matched = definition.map.get(value[definition.discriminator]) as RuntimeStruct | undefined
      return matched ? { kind: 'object', struct: matched } : undefined
    }
    default:
      return undefined
  }
}

function encodeMatchingUnion(value: unknown, guide: RuntimeStruct, path: Path): unknown {
  const matches = selectUnionOptions((guide[DEFINITION] as UnionDefinition).options, value)
  const first = matches[0]
  if (!first) {
    return encodeGuided(value, undefined, path)
  }

  const encoded = encodeGuided(value, first, path)
  for (let index = 1; index < matches.length; index += 1) {
    if (!sameWireValue(encoded, encodeGuided(value, matches[index] as RuntimeStruct, path))) {
      throw new TypeError('ambiguous union encode: multiple union branches match with different wire output')
    }
  }
  return encoded
}

function encodeRecord(valueStruct: RuntimeStruct, value: { [key: string]: unknown }, path: Path): { [key: string]: unknown } {
  // Ordinary `{}` assignment treats "__proto__" as the prototype setter and drops the key.
  const output: { [key: string]: unknown } = Object.create(null)
  for (const [key, entry] of Object.entries(value)) {
    output[key] = encodeGuided(entry, valueStruct, [...path, key])
  }
  return output
}

function encodeAnonymousObject(value: { [key: string]: unknown }, path: Path): { [key: string]: unknown } {
  // Only string keys reach the wire. An object that iterates is a list or a stream; dropping that protocol omits it.
  if (Symbol.iterator in value || Symbol.asyncIterator in value) {
    const key = path.at(-1)
    throw new TypeError(
      `${key === undefined ? 'value' : `field "${key}"`} is an iterable object, not a record. Convert it first: Array.from(iterable) for a list or header pairs, ReadableStream.from(iterable) for a streamed body.`,
    )
  }
  const output = nullObject()
  for (const key of Object.keys(value)) {
    const item = value[key]
    if (item === undefined) {
      continue
    }
    output[key] = encodeGuided(item, undefined, [...path, key])
  }
  return output
}

function rejectNullValues(value: { [key: string]: unknown }, section: string): void {
  for (const [key, item] of Object.entries(value)) {
    rejectNullValue(item, key, section)
  }
}

function rejectNullValue(value: unknown, key: string, section: string): void {
  if (value === null) {
    throw new TypeError(`${section} value for "${key}" must not be null`)
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      rejectNullValue(item, key, section)
    }
    return
  }
  if (isPlainObject(value)) {
    rejectNullValues(value, section)
  }
}

function assertHeaderValue(value: unknown, key: string): void {
  if (value === null) {
    throw new TypeError(`header value for "${key}" must not be null`)
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      assertHeaderValue(item, key)
    }
    return
  }
  if (typeof value === 'object' && value !== null) {
    throw new TypeError(`header value for "${key}" must be a scalar`)
  }
}

function codecOf(value: unknown): FormCodec | undefined {
  if (!isPlainObject(value)) {
    return undefined
  }
  const tag = structTag(value)
  if (!isStruct(tag)) {
    return undefined
  }
  const definition = (tag as RuntimeStruct)[DEFINITION]
  if (definition.kind !== 'object') {
    return undefined
  }
  return definition.codec
}

function structTag(value: { [key: string]: unknown }): unknown {
  return (value as { [STRUCT]?: unknown })[STRUCT]
}
