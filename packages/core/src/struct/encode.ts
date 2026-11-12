import { resolveStructFields, type ResolvedStructField } from "./fields";
import {
  guideMembers,
  guideTag,
  isGuideSet,
  readOwnGuide,
  type Guide,
} from "./guide";
import { selectUnionOptions } from "./match";
import { DEFINITION } from "./symbols";
import type {
  IntersectionDefinition,
  ObjectDefinition,
  ObjectRuntimeStruct,
  Path,
  RuntimeStruct,
  UnionDefinition,
} from "./types";
import {
  intersectionEncodeError,
  isIntersectionIdentity,
  isPlainObject,
  mergeIntersectionValues,
  mergePlainObjects,
  nullObject,
  sameWireValue,
} from "./utils";

// One encoder for HTTP, SSE and WebSocket. It walks the value, not a struct: what a struct knows about a node
// arrives as the tag the parser left on it, or as the guide a parent passes down for a fresh value in its place.

/** A Date leaves as its ISO 8601 string and a bigint as its decimal string. Every other leaf leaves as it is. */
export function coerceWireLeaf(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  return value;
}

type ContainerGuide =
  | { kind: "array"; item: RuntimeStruct }
  | { kind: "object"; struct: RuntimeStruct }
  | { kind: "record"; valueStruct: RuntimeStruct }
  | { kind: "tuple"; items: readonly RuntimeStruct[] };

/**
 * Encodes a value a builder placed on a request, or a message, for the wire.
 *
 * The walk follows the value. A plain object that carries a parse tag, on the node itself or in `guides` for a
 * reference an any/unknown struct borrowed, leaves under the wire keys of the struct that parsed it. Untagged plain
 * objects and arrays are walked with their keys as they are. A Date becomes its ISO 8601 string and a bigint its
 * decimal string, a key whose value is undefined is left out, and every other value is returned as it is.
 *
 * Throws TypeError for an ambiguous union, an intersection whose members disagree on a wire key, a key that collides
 * with a declared wire key, and an iterable object.
 */
export function encodeOutbound(
  value: unknown,
  guides?: WeakMap<object, Guide>,
): unknown {
  return encodeGuided(value, undefined, undefined, guides);
}

function encodeGuided(
  value: unknown,
  guide?: Guide,
  path: Path = [],
  guides?: WeakMap<object, Guide>,
): unknown {
  // any/unknown is a passthrough wire group, not an intersection identity. A tag on this value
  // must not rename the group, and a passthrough array stays stored. An untagged object still
  // recurses, so a fresh container can carry tagged children.
  if (
    guide !== undefined &&
    !isGuideSet(guide) &&
    isPassthroughStruct(guide) &&
    (!isPlainObject(value) || readOwnGuide(value, guides))
  ) {
    return value;
  }
  if (isPlainObject(value)) {
    const tagged = readOwnGuide(value, guides);
    if (tagged) {
      // Overlap with the parent guide means this tag came from the same parse: keep only that overlap
      // so another wire group cannot leak its aliases. A disjoint tag is a separately parsed replacement.
      return encodeOwnGuide(
        value,
        guide === undefined
          ? tagged
          : narrowToParent(tagged, guide, value, path, guides),
        path,
        guides,
      );
    }
  }
  if (isGuideSet(guide)) {
    return encodeMembers(value, guide.members, path, guides);
  }
  if (guide !== undefined) {
    const definition = guide[DEFINITION];
    if (definition.kind === "intersection") {
      return encodeIntersectionGuide(value, guide, definition, path, guides);
    }
    // Peel unions before container dispatch so every match uses this same recursion.
    if (definition.kind === "or") {
      return encodeMatchingUnion(value, definition.options, path, guides);
    }
  }
  if (Array.isArray(value)) {
    return encodeGuidedArray(value, guide, path, guides);
  }
  if (isPlainObject(value)) {
    return encodeGuidedObject(value, guide, path, guides);
  }
  return coerceWireLeaf(value);
}

function narrowToParent(
  own: Guide,
  parent: Guide,
  value: unknown,
  path: Path,
  guides?: WeakMap<object, Guide>,
): Guide {
  // Provenance unwraps identity and mixed intersections. Encoding a fresh value must not.
  const derived = resolveGuideMembers(
    guideMembers(parent),
    value,
    path,
    true,
    guides,
  );
  const shared: RuntimeStruct[] = [];
  for (const member of guideMembers(own)) {
    if (derived.includes(member)) {
      shared.push(member);
    }
  }
  // guideTag returns undefined only for an empty list: with no shared member, keep the own guide.
  return guideTag(shared) ?? own;
}

function encodeOwnGuide(
  value: { [key: string]: unknown },
  guide: Guide,
  path: Path,
  guides?: WeakMap<object, Guide>,
): unknown {
  if (isGuideSet(guide)) {
    return encodeMembers(value, guide.members, path, guides);
  }
  return encodeObjectNode(value, [guide], path, guides);
}

function encodeIntersectionGuide(
  value: unknown,
  guide: RuntimeStruct,
  definition: IntersectionDefinition,
  path: Path,
  guides?: WeakMap<object, Guide>,
): unknown {
  if (definition.objectSides && isPlainObject(value)) {
    return encodeMembers(value, definition.options, path, guides);
  }
  // Array/tuple intersections are not object sides, but their items still have to be guided.
  if (Array.isArray(value)) {
    return encodeMembers(value, [guide], path, guides);
  }
  // A mixed intersection does not guide a fresh object. Parsed objects carry their own tags.
  return encodeGuided(value, undefined, path, guides);
}

function encodeMembers(
  value: unknown,
  members: readonly RuntimeStruct[],
  path: Path,
  guides?: WeakMap<object, Guide>,
): unknown {
  // An array has no tag of its own, so the intersection around its item structs has to be opened here.
  const resolved = resolveGuideMembers(
    members,
    value,
    path,
    Array.isArray(value),
    guides,
  );
  if (Array.isArray(value)) {
    return encodeArrayMembers(value, resolved, path, guides);
  }
  if (isPlainObject(value)) {
    return encodeObjectNode(value, resolved, path, guides);
  }
  return coerceWireLeaf(value);
}

function resolveGuideMembers(
  members: readonly RuntimeStruct[],
  value: unknown,
  path: Path,
  unwrapIntersections: boolean,
  guides?: WeakMap<object, Guide>,
): RuntimeStruct[] {
  const resolved: RuntimeStruct[] = [];
  for (const member of members) {
    appendResolved(member, value, path, resolved, unwrapIntersections, guides);
  }
  return resolved;
}

function appendResolved(
  struct: RuntimeStruct,
  value: unknown,
  path: Path,
  out: RuntimeStruct[],
  unwrapIntersections: boolean,
  guides?: WeakMap<object, Guide>,
): void {
  const definition = struct[DEFINITION];
  switch (definition.kind) {
    case "or": {
      const matches = selectUnionOptions(definition.options, value);
      const first = matches[0];
      if (!first) {
        return;
      }
      // Agreeing branches contribute one structure.
      if (matches.length > 1) {
        encodeUnionMatches(value, first, matches, path, guides);
      }
      appendResolved(first, value, path, out, unwrapIntersections, guides);
      return;
    }
    case "discriminatedUnion": {
      if (!isPlainObject(value)) {
        return;
      }
      const matched = definition.map.get(value[definition.discriminator]);
      if (matched) {
        appendResolved(matched, value, path, out, unwrapIntersections, guides);
      }
      return;
    }
    case "intersection":
      // A fresh mixed intersection stays anonymous. Provenance still unwraps it so a parsed tag can
      // intersect the member that actually parsed the node, including `T & unknown`.
      if (definition.objectSides || unwrapIntersections) {
        for (const option of definition.options) {
          const runtime = option;
          if (unwrapIntersections && isIntersectionIdentity(runtime)) {
            continue;
          }
          appendResolved(
            runtime,
            value,
            path,
            out,
            unwrapIntersections,
            guides,
          );
        }
      }
      return;
    default:
      out.push(struct);
  }
}

/** Encodes an object under one object struct: the body root of a urlencoded or formData codec. */
export function encodeTaggedObject(
  value: { [key: string]: unknown },
  struct: ObjectRuntimeStruct,
  guides?: WeakMap<object, Guide>,
): { [key: string]: unknown } {
  return encodeSingleObject(value, struct, struct[DEFINITION], [], guides);
}

type WireGroup = {
  passthrough: boolean;
  structs: RuntimeStruct[];
  wire: string;
};

function isPassthroughStruct(struct: RuntimeStruct): boolean {
  const kind = struct[DEFINITION].kind;
  return kind === "any" || kind === "unknown";
}

type ObjectKeySets = {
  fieldKeys: ReadonlySet<string>;
  wireKeys: ReadonlySet<string>;
};

// Keyed by the cached field list, so the sets live exactly as long as the struct that owns them.
const objectKeySets = new WeakMap<
  readonly ResolvedStructField[],
  ObjectKeySets
>();

function keySetsOf(fields: readonly ResolvedStructField[]): ObjectKeySets {
  let sets = objectKeySets.get(fields);
  if (!sets) {
    sets = {
      fieldKeys: new Set(fields.map((field) => field.key)),
      wireKeys: new Set(fields.map((field) => field.wireKey)),
    };
    objectKeySets.set(fields, sets);
  }
  return sets;
}

// One object struct is the common node. Its wire keys are unique, so every field is one plain write
// and the grouping below would only rebuild the same plan on every call.
function encodeSingleObject(
  value: { [key: string]: unknown },
  struct: RuntimeStruct,
  definition: ObjectDefinition,
  path: Path,
  guides?: WeakMap<object, Guide>,
): { [key: string]: unknown } {
  const fields = resolveStructFields(struct, definition);
  const output = nullObject();
  for (const field of fields) {
    if (!Object.hasOwn(value, field.key)) {
      continue;
    }
    const fieldValue = value[field.key];
    if (fieldValue === undefined) {
      continue;
    }
    output[field.wireKey] = encodeGuided(
      fieldValue,
      field.struct,
      [...path, field.key],
      guides,
    );
  }

  const { fieldKeys, wireKeys } = keySetsOf(fields);
  writeExtras(output, value, fieldKeys, wireKeys, path, guides);
  return output;
}

/** Keys the structs at this node do not declare leave under their own names, unless a declared wire key owns the name. */
function writeExtras(
  output: { [key: string]: unknown },
  value: { [key: string]: unknown },
  fieldKeys: ReadonlySet<string>,
  wireKeys: ReadonlySet<string>,
  path: Path,
  guides?: WeakMap<object, Guide>,
): void {
  for (const key of Object.keys(value)) {
    if (fieldKeys.has(key)) {
      continue;
    }
    if (wireKeys.has(key)) {
      throw new TypeError(`wire key collision for "${key}"`);
    }
    const extra = value[key];
    if (extra === undefined) {
      continue;
    }
    output[key] = encodeGuided(extra, undefined, [...path, key], guides);
  }
}

function encodeObjectNode(
  value: { [key: string]: unknown },
  members: readonly RuntimeStruct[],
  path: Path,
  guides?: WeakMap<object, Guide>,
): { [key: string]: unknown } {
  const sole = members.length === 1 ? members[0] : undefined;
  const soleDefinition = sole?.[DEFINITION];
  if (sole !== undefined && soleDefinition?.kind === "object") {
    return encodeSingleObject(value, sole, soleDefinition, path, guides);
  }

  const output = nullObject();
  const fieldKeys = new Set<string>();
  const wireKeys = new Set<string>();
  const plans = new Map<string, WireGroup[]>();
  const order: string[] = [];
  const recordValues: RuntimeStruct[] = [];
  let passthrough = false;

  // Object fields are planned in member order; record values and passthroughs are applied after them.
  for (const member of members) {
    const definition = member[DEFINITION];
    if (definition.kind === "object") {
      for (const field of resolveStructFields(member, definition)) {
        fieldKeys.add(field.key);
        wireKeys.add(field.wireKey);
        addWireGroup(plans, order, field.key, field.wireKey, field.struct);
      }
    } else if (definition.kind === "record") {
      recordValues.push(definition.value);
    } else if (isPassthroughStruct(member)) {
      passthrough = true;
    }
  }

  // A record declares every key at this node, so there is no separate literal pass.
  const keys =
    recordValues.length > 0 ? declaredRecordKeys(value, order) : order;
  if (recordValues.length > 0) {
    for (const key of keys) {
      for (const valueStruct of recordValues) {
        addWireGroup(plans, order, key, key, valueStruct);
      }
    }
  }
  for (const key of keys) {
    // Every key in `keys` was inserted into `plans` above.
    const groups = plans.get(key);
    if (groups === undefined || !Object.hasOwn(value, key)) {
      continue;
    }
    const fieldValue = value[key];
    if (fieldValue === undefined) {
      continue;
    }
    writeWireGroups(output, fieldValue, groups, [...path, key], guides);
  }

  // The passthrough group is the raw value. Writing extras first would turn a Date into an ISO string and then
  // conflict with that raw group.
  if (passthrough) {
    return mergePassthrough(output, value, path, guides);
  }
  // A record declared every key of this node, so nothing is left over.
  if (recordValues.length === 0) {
    writeExtras(output, value, fieldKeys, wireKeys, path, guides);
  }
  return output;
}

/** Every any/unknown member encodes this node the same way, so its record is merged in once. */
function mergePassthrough(
  output: { [key: string]: unknown },
  value: { [key: string]: unknown },
  path: Path,
  guides?: WeakMap<object, Guide>,
): { [key: string]: unknown } {
  const result = mergePlainObjects(
    output,
    encodePassthroughObject(value, path, guides),
    false,
    path.length,
  );
  if (!result.ok) {
    throw intersectionEncodeError([...path, ...result.path]);
  }
  return result.value;
}

/** What encodeGuided returns for an object node under an any/unknown guide: a tagged node as is, else its fields. */
function encodePassthroughObject(
  value: { [key: string]: unknown },
  path: Path,
  guides?: WeakMap<object, Guide>,
): { [key: string]: unknown } {
  return readOwnGuide(value, guides)
    ? value
    : encodeAnonymousObject(value, path, guides);
}

function addWireGroup(
  plans: Map<string, WireGroup[]>,
  order: string[],
  logical: string,
  wire: string,
  struct: RuntimeStruct,
): void {
  let groups = plans.get(logical);
  if (!groups) {
    groups = [];
    plans.set(logical, groups);
    order.push(logical);
  }
  const passthrough = isPassthroughStruct(struct);
  // Sharing a group with a concrete struct encodes once and drops the stored keys.
  let group = groups.find(
    (item) => item.wire === wire && item.passthrough === passthrough,
  );
  if (!group) {
    group = { passthrough, structs: [], wire };
    groups.push(group);
  }
  group.structs.push(struct);
}

function writeWireGroups(
  output: { [key: string]: unknown },
  fieldValue: unknown,
  groups: readonly WireGroup[],
  path: Path,
  guides?: WeakMap<object, Guide>,
): void {
  for (const group of groups) {
    const guide = group.passthrough
      ? group.structs[0]
      : guideTag(group.structs);
    writeWire(
      output,
      group.wire,
      encodeGuided(fieldValue, guide, path, guides),
      path.length,
    );
  }
}

function declaredRecordKeys(
  value: { [key: string]: unknown },
  order: readonly string[],
): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const key of order) {
    if (Object.hasOwn(value, key)) {
      keys.push(key);
      seen.add(key);
    }
  }
  for (const key of Object.keys(value)) {
    if (!seen.has(key)) {
      keys.push(key);
    }
  }
  return keys;
}

/** Writes one wire key. A key that is already there is merged with the new value, never overwritten. */
export function writeWire(
  output: { [key: string]: unknown },
  wireKey: string,
  encoded: unknown,
  depth: number,
): void {
  if (!Object.hasOwn(output, wireKey)) {
    output[wireKey] = encoded;
    return;
  }
  const merged = mergeIntersectionValues(
    output[wireKey],
    encoded,
    false,
    depth,
  );
  if (!merged.ok) {
    throw intersectionEncodeError([wireKey, ...merged.path]);
  }
  output[wireKey] = merged.value;
}

function encodeGuidedArray(
  value: unknown[],
  guide: RuntimeStruct | undefined,
  path: Path,
  guides?: WeakMap<object, Guide>,
): unknown[] {
  const container = guide ? containerOf(guide, value) : undefined;
  if (container?.kind === "array") {
    const item = container.item;
    return value.map((entry, index) =>
      encodeGuided(entry, item, [...path, index], guides),
    );
  }
  if (container?.kind === "tuple") {
    const items = container.items;
    return value.map((entry, index) =>
      encodeGuided(
        entry,
        index < items.length ? items[index] : undefined,
        [...path, index],
        guides,
      ),
    );
  }
  return value.map((entry, index) =>
    encodeGuided(entry, undefined, [...path, index], guides),
  );
}

function encodeArrayMembers(
  value: unknown[],
  members: readonly RuntimeStruct[],
  path: Path,
  guides?: WeakMap<object, Guide>,
): unknown[] {
  return value.map((entry, index) => {
    const children: RuntimeStruct[] = [];
    const passthrough: RuntimeStruct[] = [];
    for (const member of members) {
      const definition = member[DEFINITION];
      let child: RuntimeStruct | undefined;
      if (definition.kind === "array") {
        child = definition.item;
      } else if (
        definition.kind === "tuple" &&
        index < definition.items.length
      ) {
        child = definition.items[index];
      }
      if (!child) {
        continue;
      }
      // An any/unknown item is not an intersection identity. Its stored keys stay beside the concrete item.
      if (isPassthroughStruct(child)) {
        passthrough.push(child);
        continue;
      }
      children.push(child);
    }
    const itemPath = [...path, index];
    let encoded: unknown = encodeGuided(
      entry,
      guideTag(children),
      itemPath,
      guides,
    );
    for (const guide of passthrough) {
      // Nullish and scalar items merge by value. Object.keys(null) and assignment onto a string both throw.
      const passed = encodeGuided(entry, guide, itemPath, guides);
      const merged = mergeIntersectionValues(
        encoded,
        passed,
        false,
        itemPath.length,
      );
      if (!merged.ok) {
        throw intersectionEncodeError([...itemPath, ...merged.path]);
      }
      encoded = merged.value;
    }
    return encoded;
  });
}

function encodeGuidedObject(
  value: { [key: string]: unknown },
  guide: RuntimeStruct | undefined,
  path: Path,
  guides?: WeakMap<object, Guide>,
): { [key: string]: unknown } {
  const container = guide ? containerOf(guide, value) : undefined;
  if (container?.kind === "object") {
    return encodeObjectNode(value, [container.struct], path, guides);
  }
  if (container?.kind === "record") {
    return encodeRecord(container.valueStruct, value, path, guides);
  }
  return encodeAnonymousObject(value, path, guides);
}

function containerOf(
  guide: RuntimeStruct,
  value: unknown,
): ContainerGuide | undefined {
  const definition = guide[DEFINITION];
  switch (definition.kind) {
    case "object":
      return { kind: "object", struct: guide };
    case "record":
      return { kind: "record", valueStruct: definition.value };
    case "array":
      return { kind: "array", item: definition.item };
    case "tuple":
      return {
        kind: "tuple",
        items: definition.items,
      };
    case "discriminatedUnion": {
      if (!isPlainObject(value)) {
        return undefined;
      }
      const matched = definition.map.get(value[definition.discriminator]);
      return matched ? { kind: "object", struct: matched } : undefined;
    }
    default:
      return undefined;
  }
}

function encodeMatchingUnion(
  value: unknown,
  options: UnionDefinition["options"],
  path: Path,
  guides?: WeakMap<object, Guide>,
): unknown {
  const matches = selectUnionOptions(options, value);
  const first = matches[0];
  if (!first) {
    return encodeGuided(value, undefined, path, guides);
  }

  return encodeUnionMatches(value, first, matches, path, guides);
}

/** Encodes the value under every matching option. Options that agree are one wire value; a difference is an error. */
function encodeUnionMatches(
  value: unknown,
  first: RuntimeStruct,
  matches: readonly RuntimeStruct[],
  path: Path,
  guides?: WeakMap<object, Guide>,
): unknown {
  const encoded = encodeGuided(value, first, path, guides);
  for (let index = 1; index < matches.length; index += 1) {
    if (
      !sameWireValue(encoded, encodeGuided(value, matches[index], path, guides))
    ) {
      throw new TypeError(
        "ambiguous union encode: multiple union branches match with different wire output",
      );
    }
  }
  return encoded;
}

function encodeRecord(
  valueStruct: RuntimeStruct,
  value: { [key: string]: unknown },
  path: Path,
  guides?: WeakMap<object, Guide>,
): { [key: string]: unknown } {
  // Ordinary `{}` assignment treats "__proto__" as the prototype setter and drops the key, so the record has none.
  const output: { [key: string]: unknown } = { __proto__: null };
  for (const [key, entry] of Object.entries(value)) {
    output[key] = encodeGuided(entry, valueStruct, [...path, key], guides);
  }
  return output;
}

function encodeAnonymousObject(
  value: { [key: string]: unknown },
  path: Path,
  guides?: WeakMap<object, Guide>,
): { [key: string]: unknown } {
  // Only string keys reach the wire. An object that iterates is a list or a stream; dropping that protocol omits it.
  if (Symbol.iterator in value || Symbol.asyncIterator in value) {
    const key = path.at(-1);
    throw new TypeError(
      `${key === undefined ? "value" : `field "${key}"`} is an iterable object, not a record. Convert it first: Array.from(iterable) for a list or header pairs, ReadableStream.from(iterable) for a streamed body.`,
    );
  }
  const output = nullObject();
  for (const key of Object.keys(value)) {
    const item = value[key];
    if (item === undefined) {
      continue;
    }
    output[key] = encodeGuided(item, undefined, [...path, key], guides);
  }
  return output;
}
