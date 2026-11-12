import type {
  IntersectionDefinition,
  ObjectDefinition,
  ObjectRuntimeStruct,
  ResolvedStructField,
  RuntimeStruct,
} from "./definition";
import {
  guideMembers,
  guideTag,
  isGuideSet,
  readOwnGuide,
  type Guide,
} from "./guide";
import {
  intersectionEncodeError,
  isIntersectionIdentity,
  mergeIntersectionValues,
  mergePlainObjects,
} from "./intersection";
import { selectUnionOptions } from "./match";
import { isPlainObject, nullObject } from "./plain_object";
import { resolveStructFields } from "./shape";
import { DEFINITION } from "./symbols";
import type { Path } from "./types";

// The outbound encoder of HTTP and SSE. WebSocket sends keep the struct-walking encoder in encode_by_struct.ts, which is faster for one message. It walks the value, not a struct: what a struct knows about a node
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

type EncodeContext = {
  readonly guides: WeakMap<object, Guide> | undefined;
  /**
   * One array for the whole encode. A container pushes the segment of a child around that child's encode; only an
   * error copies it. A throw leaves it as it is, and the context ends with the call.
   */
  readonly path: Path;
};

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
  return encodeGuided({ guides, path: [] }, value, undefined);
}

/** Encodes an object under one object struct: the body root of a urlencoded or formData codec. */
export function encodeTaggedObject(
  value: { [key: string]: unknown },
  struct: ObjectRuntimeStruct,
  guides?: WeakMap<object, Guide>,
): { [key: string]: unknown } {
  return encodeSingleObject({ guides, path: [] }, value, struct[DEFINITION]);
}

function encodeGuided(
  context: EncodeContext,
  value: unknown,
  guide: Guide | undefined,
): unknown {
  // A leaf that is neither an object nor a bigint leaves as it is under any guide, so it skips the checks below.
  if (
    value === null ||
    !(typeof value === "object" || typeof value === "bigint")
  ) {
    return value;
  }
  const guideSet = isGuideSet(guide);
  const plain = isPlainObject(value);
  const tagged = plain ? readOwnGuide(value, context.guides) : undefined;
  // any/unknown is a passthrough wire group, not an intersection identity. A tag on this value
  // must not rename the group, and a passthrough array stays stored. An untagged object still
  // recurses, so a fresh container can carry tagged children.
  if (
    guide !== undefined &&
    !guideSet &&
    isPassthroughStruct(guide) &&
    (!plain || tagged)
  ) {
    return value;
  }
  if (plain && tagged) {
    // Overlap with the parent guide means this tag came from the same parse: keep only that overlap
    // so another wire group cannot leak its aliases. A disjoint tag is a separately parsed replacement.
    return encodeOwnGuide(
      context,
      value,
      guide === undefined
        ? tagged
        : narrowToParent(context, tagged, guide, value),
    );
  }
  if (guideSet) {
    return encodeMembers(context, value, guide.members);
  }
  if (guide !== undefined) {
    const definition = guide[DEFINITION];
    if (definition.kind === "intersection") {
      return encodeIntersectionGuide(context, value, guide, definition);
    }
    // Peel unions before container dispatch so every match uses this same recursion.
    if (definition.kind === "or") {
      return encodeMatchingUnion(context, value, definition.options);
    }
  }
  if (Array.isArray(value)) {
    return encodeGuidedArray(context, value, guide);
  }
  if (plain) {
    return encodeGuidedObject(context, value, guide);
  }
  return coerceWireLeaf(value);
}

function narrowToParent(
  context: EncodeContext,
  own: Guide,
  parent: Guide,
  value: unknown,
): Guide {
  // Provenance unwraps identity and mixed intersections. Encoding a fresh value must not.
  const derived = resolveGuideMembers(
    context,
    guideMembers(parent),
    value,
    true,
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
  context: EncodeContext,
  value: { [key: string]: unknown },
  guide: Guide,
): unknown {
  if (isGuideSet(guide)) {
    return encodeMembers(context, value, guide.members);
  }
  const definition = guide[DEFINITION];
  return definition.kind === "object"
    ? encodeSingleObject(context, value, definition)
    : encodeObjectNode(context, value, [guide]);
}

function encodeIntersectionGuide(
  context: EncodeContext,
  value: unknown,
  guide: RuntimeStruct,
  definition: IntersectionDefinition,
): unknown {
  if (definition.objectSides && isPlainObject(value)) {
    return encodeMembers(context, value, definition.options);
  }
  // Array/tuple intersections are not object sides, but their items still have to be guided.
  if (Array.isArray(value)) {
    return encodeMembers(context, value, [guide]);
  }
  // A mixed intersection does not guide a fresh object. Parsed objects carry their own tags.
  return encodeGuided(context, value, undefined);
}

function encodeMembers(
  context: EncodeContext,
  value: unknown,
  members: readonly RuntimeStruct[],
): unknown {
  // An array has no tag of its own, so the intersection around its item structs has to be opened here.
  const resolved = resolveGuideMembers(
    context,
    members,
    value,
    Array.isArray(value),
  );
  if (Array.isArray(value)) {
    return encodeArrayMembers(context, value, resolved);
  }
  if (isPlainObject(value)) {
    return encodeObjectNode(context, value, resolved);
  }
  return coerceWireLeaf(value);
}

function resolveGuideMembers(
  context: EncodeContext,
  members: readonly RuntimeStruct[],
  value: unknown,
  unwrapIntersections: boolean,
): RuntimeStruct[] {
  const resolved: RuntimeStruct[] = [];
  for (const member of members) {
    appendResolved(context, member, value, resolved, unwrapIntersections);
  }
  return resolved;
}

function appendResolved(
  context: EncodeContext,
  struct: RuntimeStruct,
  value: unknown,
  out: RuntimeStruct[],
  unwrapIntersections: boolean,
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
        encodeUnionMatches(context, value, first, matches);
      }
      appendResolved(context, first, value, out, unwrapIntersections);
      return;
    }
    case "discriminatedUnion": {
      if (!isPlainObject(value)) {
        return;
      }
      const matched = definition.map.get(value[definition.discriminator]);
      if (matched) {
        out.push(matched);
      }
      return;
    }
    case "intersection":
      // A fresh mixed intersection stays anonymous. Provenance still unwraps it so a parsed tag can
      // intersect the member that actually parsed the node, including `T & unknown`.
      if (definition.objectSides || unwrapIntersections) {
        for (const option of definition.options) {
          if (unwrapIntersections && isIntersectionIdentity(option)) {
            continue;
          }
          appendResolved(context, option, value, out, unwrapIntersections);
        }
      }
      return;
    default:
      out.push(struct);
  }
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
  context: EncodeContext,
  value: { [key: string]: unknown },
  definition: ObjectDefinition,
): { [key: string]: unknown } {
  const fields = resolveStructFields(definition);
  const output = nullObject();
  const path = context.path;
  for (let index = 0; index < fields.length; index += 1) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- PERF: `index < fields.length` bounds this read. `for (const field of fields)` over the frozen cached field list made encodeOutbound 2.021x slower for a 4-field tagged object, 2.142x for 8 fields, 2.215x for 64 fields and 1.565x for an array of 100 2-field objects (Bun 1.4.4, 5 process rounds per variant, interleaved, 61 batches each, medians)
    const field = fields[index] as ResolvedStructField;
    if (!Object.hasOwn(value, field.key)) {
      continue;
    }
    const fieldValue = value[field.key];
    if (fieldValue === undefined) {
      continue;
    }
    path.push(field.key);
    output[field.wireKey] = encodeGuided(context, fieldValue, field.struct);
    path.pop();
  }

  const { fieldKeys, wireKeys } = keySetsOf(fields);
  writeExtras(context, output, value, fieldKeys, wireKeys);
  return output;
}

/** Keys the structs at this node do not declare leave under their own names, unless a declared wire key owns the name. */
function writeExtras(
  context: EncodeContext,
  output: { [key: string]: unknown },
  value: { [key: string]: unknown },
  fieldKeys: ReadonlySet<string>,
  wireKeys: ReadonlySet<string>,
): void {
  const path = context.path;
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
    path.push(key);
    output[key] = encodeGuided(context, extra, undefined);
    path.pop();
  }
}

function encodeObjectNode(
  context: EncodeContext,
  value: { [key: string]: unknown },
  members: readonly RuntimeStruct[],
): { [key: string]: unknown } {
  const sole = members.length === 1 ? members[0] : undefined;
  const soleDefinition = sole?.[DEFINITION];
  if (sole !== undefined && soleDefinition?.kind === "object") {
    return encodeSingleObject(context, value, soleDefinition);
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
      const fields = resolveStructFields(definition);
      for (let index = 0; index < fields.length; index += 1) {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- PERF: `index < fields.length` bounds this read. `for (const field of fields)` over the frozen cached field list made encodeOutbound of an object intersection 2.013x slower for 2 members and 1.792x for 16 (Bun 1.4.4, 5 process rounds per variant, interleaved, 61 batches each, medians)
        const field = fields[index] as ResolvedStructField;
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
  const path = context.path;
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
    path.push(key);
    writeWireGroups(context, output, fieldValue, groups);
    path.pop();
  }

  // The passthrough group is the raw value. Writing extras first would turn a Date into an ISO string and then
  // conflict with that raw group.
  if (passthrough) {
    return mergePassthrough(context, output, value);
  }
  // A record declared every key of this node, so nothing is left over.
  if (recordValues.length === 0) {
    writeExtras(context, output, value, fieldKeys, wireKeys);
  }
  return output;
}

/** Every any/unknown member encodes this node the same way, so its record is merged in once. */
function mergePassthrough(
  context: EncodeContext,
  output: { [key: string]: unknown },
  value: { [key: string]: unknown },
): { [key: string]: unknown } {
  // What encodeGuided returns for an object node under an any/unknown guide: a tagged node as is, else its fields.
  const passed = readOwnGuide(value, context.guides)
    ? value
    : encodeAnonymousObject(context, value);
  const result = mergePlainObjects(output, passed, context.path.length);
  if (!result.ok) {
    throw intersectionEncodeError([...context.path, ...result.path]);
  }
  return result.value;
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

/** Writes the value at the current path under every wire key its groups name. */
function writeWireGroups(
  context: EncodeContext,
  output: { [key: string]: unknown },
  fieldValue: unknown,
  groups: readonly WireGroup[],
): void {
  for (const group of groups) {
    const guide = group.passthrough
      ? group.structs[0]
      : guideTag(group.structs);
    writeWire(
      output,
      group.wire,
      encodeGuided(context, fieldValue, guide),
      context.path.length,
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
  const merged = mergeIntersectionValues(output[wireKey], encoded, depth);
  if (!merged.ok) {
    throw intersectionEncodeError([wireKey, ...merged.path]);
  }
  output[wireKey] = merged.value;
}

function encodeGuidedArray(
  context: EncodeContext,
  value: unknown[],
  guide: RuntimeStruct | undefined,
): unknown[] {
  const definition = guide?.[DEFINITION];
  const item = definition?.kind === "array" ? definition.item : undefined;
  const items = definition?.kind === "tuple" ? definition.items : undefined;
  const path = context.path;
  return value.map((entry, index) => {
    path.push(index);
    // Items past the declared positions of a tuple have no guide.
    const encoded = encodeGuided(
      context,
      entry,
      items === undefined ? item : items[index],
    );
    path.pop();
    return encoded;
  });
}

function encodeArrayMembers(
  context: EncodeContext,
  value: unknown[],
  members: readonly RuntimeStruct[],
): unknown[] {
  const path = context.path;
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
    path.push(index);
    let encoded: unknown = encodeGuided(context, entry, guideTag(children));
    for (const guide of passthrough) {
      // Nullish and scalar items merge by value. Object.keys(null) and assignment onto a string both throw.
      const merged = mergeIntersectionValues(
        encoded,
        encodeGuided(context, entry, guide),
        path.length,
      );
      if (!merged.ok) {
        throw intersectionEncodeError([...path, ...merged.path]);
      }
      encoded = merged.value;
    }
    path.pop();
    return encoded;
  });
}

function encodeGuidedObject(
  context: EncodeContext,
  value: { [key: string]: unknown },
  guide: RuntimeStruct | undefined,
): { [key: string]: unknown } {
  const definition = guide?.[DEFINITION];
  if (definition?.kind === "record") {
    return encodeRecord(context, definition.value, value);
  }
  const struct =
    definition?.kind === "discriminatedUnion"
      ? definition.map.get(value[definition.discriminator])
      : guide;
  const structDefinition = struct?.[DEFINITION];
  return struct !== undefined && structDefinition?.kind === "object"
    ? encodeSingleObject(context, value, structDefinition)
    : encodeAnonymousObject(context, value);
}

function encodeMatchingUnion(
  context: EncodeContext,
  value: unknown,
  options: readonly RuntimeStruct[],
): unknown {
  const matches = selectUnionOptions(options, value);
  const first = matches[0];
  return first === undefined
    ? encodeGuided(context, value, undefined)
    : encodeUnionMatches(context, value, first, matches);
}

/** Encodes the value under every matching option. Options that agree are one wire value; a difference is an error. */
function encodeUnionMatches(
  context: EncodeContext,
  value: unknown,
  first: RuntimeStruct,
  matches: readonly RuntimeStruct[],
): unknown {
  const encoded = encodeGuided(context, value, first);
  for (let index = 1; index < matches.length; index += 1) {
    if (!sameWireValue(encoded, encodeGuided(context, value, matches[index]))) {
      throw new TypeError(
        "ambiguous union encode: multiple union branches match with different wire output",
      );
    }
  }
  return encoded;
}

function encodeRecord(
  context: EncodeContext,
  valueStruct: RuntimeStruct,
  value: { [key: string]: unknown },
): { [key: string]: unknown } {
  // Ordinary `{}` assignment treats "__proto__" as the prototype setter and drops the key, so the record has none.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- PERF: Object.create(null) is typed `any`. The typed `{ __proto__: null }` literal made encodeOutbound of a fresh record under a record guide 1.063x slower for 1 key, 1.082x for 4 keys and 1.064x for 100 records of 4 keys (Bun 1.4.4, 6 process rounds per variant, interleaved, 61 batches each, medians)
  const output: { [key: string]: unknown } = Object.create(null);
  const path = context.path;
  for (const [key, entry] of Object.entries(value)) {
    path.push(key);
    output[key] = encodeGuided(context, entry, valueStruct);
    path.pop();
  }
  return output;
}

function encodeAnonymousObject(
  context: EncodeContext,
  value: { [key: string]: unknown },
): { [key: string]: unknown } {
  const path = context.path;
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
    path.push(key);
    output[key] = encodeGuided(context, item, undefined);
    path.pop();
  }
  return output;
}

/**
 * Structural equality for encoded wire values.
 *
 * Leaves use `Object.is`, so infinities and signed zeroes stay distinct. Plain objects ignore key
 * order. Arrays compare element by element. This never calls a user serializer.
 */
export function sameWireValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameWireValue(item, right[index]))
    );
  }
  if (!isPlainObject(left) || !isPlainObject(right)) {
    return false;
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(right, key) && sameWireValue(left[key], right[key]),
    )
  );
}
