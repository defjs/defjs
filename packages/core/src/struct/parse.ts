import { failure, hasErrorMap, issue, parkedFailure, restoreFailure } from './errors'
import { resolveStructFields, type ResolvedStructField } from './fields'
import { defineStructTag, guideMembers, guideTag, readOwnGuide, tagOwnNode, type Guide } from './guide'
import { selectUnionOptions } from './match'
import { DEFINITION, FAILED, OMIT } from './symbols'
import type {
  ArrayDefinition,
  DiscriminatedUnionDefinition,
  EnumDefinition,
  InternalParseResult,
  IntersectionDefinition,
  LiteralDefinition,
  LiteralValue,
  ObjectDefinition,
  ParseMode,
  Path,
  PrimitiveDefinition,
  PrimitiveKind,
  RecordDefinition,
  RuntimeStruct,
  StructIssue,
  TupleDefinition,
  UnionDefinition,
} from './types'
import {
  expectedType,
  hasOwnKey,
  isIntersectionIdentity,
  isPlainObject,
  matchesEnum,
  MAX_DEPTH,
  mergeIntersectionValues,
  nullObject,
} from './utils'

// Every parser below returns the parsed value itself, or FAILED after `failure()` parked the issue. A value that parses
// costs no result object, and FAILED cannot be mistaken for one: it is private, so any other symbol is just a value.
//
// `path` is one array for the whole parse. A container pushes the segment of a child around that child's parse and only
// copies the array when it reports an issue. A failure returns without popping, which leaves the array deeper than the
// failing node; the one place that goes on after a failure, a union trying its next candidate, cuts it back first.
// Failed union candidates are discarded, so they are parsed without reporting unless an errorMap wants to see them.
// Only traversed containers consume depth. Unions and intersections stay at the same path; scalar and passthrough
// leaves need no guard. Reject before descending into the next container, including an empty one.
const MAX_DEPTH_EXPECTED = `value nested at most ${MAX_DEPTH} levels deep`

export function parseValue(
  struct: RuntimeStruct,
  input: unknown,
  path: Path,
  mode: ParseMode,
  useAliases = false,
  tagObjects = false,
): InternalParseResult<unknown> {
  return parseEntry(struct, input, [...path], mode, useAliases, tagObjects)
}

export function parseRootValue(
  struct: RuntimeStruct,
  input: unknown,
  mode: ParseMode,
  useAliases = false,
  tagObjects = false,
): InternalParseResult<unknown> {
  return parseEntry(struct, input, [], mode, useAliases, tagObjects)
}

function parseEntry(
  struct: RuntimeStruct,
  input: unknown,
  path: Path,
  mode: ParseMode,
  useAliases: boolean,
  tagObjects: boolean,
): InternalParseResult<unknown> {
  // An errorMap, a decode hook or a getter can start another parse in the middle of this one. Leave the slot as found.
  const parked = parkedFailure()
  try {
    const value = parseNode(struct, input, path, mode, useAliases, true, tagObjects)
    // This parse reports, so every FAILED it returns has an issue parked right behind it.
    return value === FAILED ? { issue: parkedFailure() as StructIssue, ok: false } : { ok: true, value }
  } finally {
    restoreFailure(parked)
  }
}

function parseNode(
  struct: RuntimeStruct,
  input: unknown,
  path: Path,
  mode: ParseMode,
  useAliases: boolean,
  reportIssues: boolean,
  tagObjects: boolean,
): unknown {
  const definition = struct[DEFINITION]

  if (input === undefined) {
    if (definition.flags.optional) {
      return mode === 'field' ? OMIT : undefined
    }
    return reportIssues
      ? failure(issue([...path], mode === 'field' ? 'missing_key' : 'invalid_type', expectedType(definition), input))
      : FAILED
  }

  if (input === null) {
    if (definition.kind === 'null' || definition.flags.nullable) {
      return null
    }
    const delegatesNull =
      (definition.kind === 'literal' && definition.value === null) || definition.kind === 'intersection' || definition.kind === 'or'
    if (!delegatesNull) {
      return reportIssues ? failure(issue([...path], 'invalid_type', expectedType(definition), input)) : FAILED
    }
  }

  switch (definition.kind) {
    case 'any':
    case 'unknown':
      return input

    case 'array':
      return parseArrayValue(definition, input, path, useAliases, reportIssues, tagObjects)

    case 'arrayBuffer':
    case 'bigint':
    case 'blob':
    case 'boolean':
    case 'date':
    case 'file':
    case 'null':
    case 'number':
    case 'string':
      return parsePrimitiveValue(definition, input, path, reportIssues)

    case 'enum':
      return parseEnumValue(definition, input, path, reportIssues)

    case 'intersection':
      return parseIntersectionValue(definition, input, path, useAliases, reportIssues, tagObjects)

    case 'literal':
      return parseLiteralValue(definition, input, path, reportIssues)

    case 'object':
      return parseObjectValue(struct, definition, input, path, useAliases, reportIssues, tagObjects)

    case 'or':
      return parseUnionValue(definition, input, path, useAliases, reportIssues, tagObjects)

    case 'discriminatedUnion':
      return parseDiscriminatedUnionValue(definition, input, path, useAliases, reportIssues, tagObjects)

    case 'record':
      return parseRecordValue(struct, definition, input, path, useAliases, reportIssues, tagObjects)

    case 'tuple':
      return parseTupleValue(definition, input, path, useAliases, reportIssues, tagObjects)
  }
}

function nestingExceeded(input: unknown, path: Path, reportIssues: boolean): unknown {
  return reportIssues ? failure(issue([...path], 'invalid_type', MAX_DEPTH_EXPECTED, input)) : FAILED
}

function parsePrimitiveValue(
  definition: PrimitiveDefinition<PrimitiveKind, unknown, unknown>,
  input: unknown,
  path: Path,
  reportIssues: boolean,
): unknown {
  if (!definition.is(input)) {
    return reportIssues ? failure(issue([...path], 'invalid_type', definition.expected, input)) : FAILED
  }

  // The hook reports through this parser's own `failure`, which also applies this parse's error map. A hook built by
  // another copy of the package would otherwise hand back a FAILED this copy does not know and park its issue where
  // this copy never looks.
  return definition.decode ? definition.decode(input, [...path], failure) : input
}

function parseEnumValue(definition: EnumDefinition<string | number>, input: unknown, path: Path, reportIssues: boolean): unknown {
  // Type boundary: enum structs are defined with string or number literals; by the time we reach this
  // parser the input has already been validated as non-null/undefined and only enum members can match.
  return matchesEnum(definition, input)
    ? input
    : reportIssues
      ? failure(issue([...path], 'invalid_enum', definition.expected, input))
      : FAILED
}

function parseLiteralValue(definition: LiteralDefinition<LiteralValue>, input: unknown, path: Path, reportIssues: boolean): unknown {
  return Object.is(input, definition.value)
    ? input
    : reportIssues
      ? failure(issue([...path], 'invalid_literal', definition.expected, input))
      : FAILED
}

function parseArrayValue(
  definition: ArrayDefinition,
  input: unknown,
  path: Path,
  useAliases: boolean,
  reportIssues: boolean,
  tagObjects: boolean,
): unknown {
  if (!Array.isArray(input)) {
    return reportIssues ? failure(issue([...path], 'invalid_type', 'array', input)) : FAILED
  }
  if (path.length >= MAX_DEPTH) {
    return nestingExceeded(input, path, reportIssues)
  }

  const item = definition.item as RuntimeStruct
  const output: unknown[] = []
  for (let index = 0; index < input.length; index += 1) {
    path.push(index)
    const value = parseNode(item, input[index], path, 'value', useAliases, reportIssues, tagObjects)
    if (value === FAILED) {
      return FAILED
    }
    path.pop()
    output.push(value)
  }
  return output
}

function parseObjectValue(
  struct: RuntimeStruct,
  definition: ObjectDefinition,
  input: unknown,
  path: Path,
  useAliases: boolean,
  reportIssues: boolean,
  tagObjects: boolean,
  cachedKey?: string,
  cachedValue?: unknown,
  target?: { [key: string]: unknown },
): unknown {
  if (!isPlainObject(input)) {
    return reportIssues ? failure(issue([...path], 'invalid_type', 'object', input)) : FAILED
  }
  if (path.length >= MAX_DEPTH) {
    return nestingExceeded(input, path, reportIssues)
  }

  const output: { [key: string]: unknown } = target ?? nullObject()
  const fields = resolveStructFields(struct, definition)
  // Indexed on purpose: for...of over this frozen array costs several times more in JavaScriptCore.
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index] as ResolvedStructField
    const inputKey = useAliases ? field.wireKey : field.key
    const inputValue = cachedKey === inputKey ? cachedValue : hasOwnKey(input, inputKey) ? input[inputKey] : undefined
    path.push(field.key)
    const value = parseNode(field.struct, inputValue, path, 'field', useAliases, reportIssues, tagObjects)
    if (value === FAILED) {
      return FAILED
    }
    path.pop()
    if (value !== OMIT) {
      // A shared intersection target already has this logical key. Merge it; do not let the later side win.
      if (target !== undefined && hasOwnKey(output, field.key)) {
        const merged = mergeIntersectionValues(output[field.key], value, tagObjects, path.length + 1)
        if (!merged.ok) {
          return reportIssues
            ? failure(issue([...path, field.key, ...merged.path], 'invalid_intersection', 'compatible intersection value', merged.received))
            : FAILED
        }
        output[field.key] = merged.value
      } else {
        output[field.key] = value
      }
    }
  }
  if (tagObjects && !target) {
    tagOwnNode(output, struct)
  }
  return output
}

function parseRecordValue(
  struct: RuntimeStruct,
  definition: RecordDefinition,
  input: unknown,
  path: Path,
  useAliases: boolean,
  reportIssues: boolean,
  tagObjects: boolean,
): unknown {
  if (!isPlainObject(input)) {
    return reportIssues ? failure(issue([...path], 'invalid_type', 'record', input)) : FAILED
  }
  if (path.length >= MAX_DEPTH) {
    return nestingExceeded(input, path, reportIssues)
  }

  const item = definition.value as RuntimeStruct
  const output: { [key: string]: unknown } = Object.create(null)
  for (const key of Object.keys(input)) {
    path.push(key)
    const value = parseNode(item, input[key], path, 'field', useAliases, reportIssues, tagObjects)
    if (value === FAILED) {
      return FAILED
    }
    path.pop()
    if (value !== OMIT) {
      output[key] = value
    }
  }
  // Nullable null never reaches a record parse. The object itself carries the struct that parsed it.
  if (tagObjects) {
    tagOwnNode(output, struct)
  }
  return output
}

function parseTupleValue(
  definition: TupleDefinition,
  input: unknown,
  path: Path,
  useAliases: boolean,
  reportIssues: boolean,
  tagObjects: boolean,
): unknown {
  if (!Array.isArray(input) || input.length !== definition.items.length) {
    return reportIssues ? failure(issue([...path], 'invalid_type', `tuple of length ${definition.items.length}`, input)) : FAILED
  }
  if (path.length >= MAX_DEPTH) {
    return nestingExceeded(input, path, reportIssues)
  }

  const output: unknown[] = []
  for (let index = 0; index < definition.items.length; index += 1) {
    path.push(index)
    const value = parseNode(definition.items[index] as RuntimeStruct, input[index], path, 'value', useAliases, reportIssues, tagObjects)
    if (value === FAILED) {
      return FAILED
    }
    path.pop()
    output.push(value)
  }
  return output
}

function parseUnionValue(
  definition: UnionDefinition,
  input: unknown,
  path: Path,
  useAliases: boolean,
  reportIssues: boolean,
  tagObjects: boolean,
): unknown {
  const reportCandidateIssues = reportIssues && hasErrorMap()
  const depth = path.length
  for (const option of definition.options) {
    const value = parseNode(option as RuntimeStruct, input, path, 'value', useAliases, reportCandidateIssues, tagObjects)
    if (value !== FAILED) {
      return value
    }
    // The failed candidate stopped wherever it failed. The next one starts at the union.
    path.length = depth
  }
  return reportIssues ? failure(issue([...path], 'invalid_union', definition.expected, input)) : FAILED
}

function parseDiscriminatedUnionValue(
  definition: DiscriminatedUnionDefinition,
  input: unknown,
  path: Path,
  useAliases: boolean,
  reportIssues: boolean,
  tagObjects: boolean,
): unknown {
  if (!isPlainObject(input)) {
    return reportIssues ? failure(issue([...path], 'invalid_type', 'object', input)) : FAILED
  }

  if (!useAliases) {
    const value = hasOwnKey(input, definition.discriminator) ? input[definition.discriminator] : undefined
    if (value === undefined) {
      return reportIssues ? failure(issue([...path, definition.discriminator], 'missing_key', definition.expected, undefined)) : FAILED
    }
    const target = definition.map.get(value)
    if (!target) {
      return reportIssues ? failure(issue([...path, definition.discriminator], 'invalid_union', definition.expected, value)) : FAILED
    }
    const runtime = target as RuntimeStruct
    return parseObjectValue(
      runtime,
      runtime[DEFINITION] as ObjectDefinition,
      input,
      path,
      false,
      reportIssues,
      tagObjects,
      definition.discriminator,
      value,
    )
  }

  for (const wireKey of definition.discriminatorWireKeys ?? []) {
    if (!hasOwnKey(input, wireKey)) {
      continue
    }

    const value = input[wireKey]
    if (value === undefined) {
      return reportIssues ? failure(issue([...path, definition.discriminator], 'missing_key', definition.expected, undefined)) : FAILED
    }
    const target = definition.map.get(value) as RuntimeStruct | undefined
    if (!target || definition.wireKeyByValue?.get(value) !== wireKey) {
      return reportIssues ? failure(issue([...path, definition.discriminator], 'invalid_union', definition.expected, value)) : FAILED
    }
    return parseObjectValue(target, target[DEFINITION] as ObjectDefinition, input, path, true, reportIssues, tagObjects, wireKey, value)
  }
  return reportIssues ? failure(issue([...path, definition.discriminator], 'missing_key', definition.expected, undefined)) : FAILED
}

function parseIntersectionValue(
  definition: IntersectionDefinition,
  input: unknown,
  path: Path,
  useAliases: boolean,
  reportIssues: boolean,
  tagObjects: boolean,
): unknown {
  if (definition.objectSides && isPlainObject(input)) {
    const merged = nullObject()
    for (const option of definition.options) {
      const runtime = option as RuntimeStruct
      const value = parseObjectValue(
        runtime,
        runtime[DEFINITION] as ObjectDefinition,
        input,
        path,
        useAliases,
        reportIssues,
        tagObjects,
        undefined,
        undefined,
        merged,
      )
      if (value === FAILED) {
        return FAILED
      }
    }
    if (tagObjects) {
      // An object intersection always has at least one member struct, so the guide exists.
      tagOwnNode(merged, guideTag(definition.options as unknown as readonly RuntimeStruct[]) as Guide)
    }
    return merged
  }

  // unknown/any still run, but they are the identity of `&` and must not put keys back into the output.
  const contributed: unknown[] = []
  for (const option of definition.options) {
    const runtime = option as RuntimeStruct
    const value = parseNode(runtime, input, path, 'value', useAliases, reportIssues, tagObjects)
    if (value === FAILED) {
      return FAILED
    }
    if (!isIntersectionIdentity(runtime)) {
      contributed.push(value)
    }
  }
  if (contributed.length === 0) {
    return input
  }

  let merged = contributed[0]
  for (let index = 1; index < contributed.length; index += 1) {
    const mergedValue = mergeIntersectionValues(merged, contributed[index], tagObjects, path.length)
    if (!mergedValue.ok) {
      return reportIssues
        ? failure(issue([...path, ...mergedValue.path], 'invalid_intersection', 'compatible intersection value', mergedValue.received))
        : FAILED
    }
    merged = mergedValue.value
  }

  if (tagObjects) {
    rememberPassthroughBranches(definition, input, merged, path.length)
  }
  return merged
}

function rememberPassthroughBranches(definition: IntersectionDefinition, input: unknown, merged: unknown, depth: number): void {
  const guides: RuntimeStruct[] = []
  for (const option of definition.options) {
    const runtime = option as RuntimeStruct
    // A direct any/unknown is the identity of `&` and must not put the logical key back.
    if (isIntersectionIdentity(runtime)) {
      continue
    }
    const branch = passthroughBranch(runtime, input, depth)
    if (branch) {
      guides.push(branch)
    }
  }
  if (guides.length === 0) {
    return
  }
  if (isPlainObject(merged)) {
    attachPassthroughGuides(merged, guides)
    return
  }
  if (!Array.isArray(merged)) {
    return
  }
  for (const item of merged) {
    if (isPlainObject(item)) {
      attachPassthroughGuides(item, guides)
    }
  }
}

function attachPassthroughGuides(value: { [key: string]: unknown }, guides: readonly RuntimeStruct[]): void {
  const current = readOwnGuide(value)
  const next = guideTag([...(current ? guideMembers(current) : []), ...guides])
  // guides is non-empty, so guideTag always returns a struct or a conjunction.
  /* istanbul ignore if -- @preserve guideTag returns a tag whenever at least one passthrough guide is present */
  if (!next) {
    return
  }
  defineStructTag(value, next)
}

function passthroughBranch(struct: RuntimeStruct, value: unknown, depth: number): RuntimeStruct | undefined {
  const definition = struct[DEFINITION]
  if (definition.kind === 'or') {
    const selected = selectUnionOptions(definition.options, value, depth)[0]
    if (!selected) {
      return undefined
    }
    const kind = selected[DEFINITION].kind
    return kind === 'any' || kind === 'unknown' ? selected : undefined
  }
  if (definition.kind === 'array' && Array.isArray(value)) {
    const item = definition.item as RuntimeStruct
    const kind = item[DEFINITION].kind
    return kind === 'any' || kind === 'unknown' ? item : undefined
  }
  return undefined
}
