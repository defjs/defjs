import {
  failure,
  hasErrorMap,
  issue,
  parkedFailure,
  restoreFailure,
} from "./errors";
import { resolveStructFields, type ResolvedStructField } from "./fields";
import {
  guideMembers,
  guideTag,
  readOwnGuide,
  tagOwnNode,
  type Guide,
} from "./guide";
import { DEFINITION, FAILED, OMIT } from "./symbols";
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
} from "./types";
import {
  expectedType,
  hasOwnKey,
  isIntersectionIdentity,
  isPlainObject,
  matchesEnum,
  MAX_DEPTH,
  mergeIntersectionValues,
  nullObject,
} from "./utils";

// Every parser below returns the parsed value itself, or FAILED after `failure()` parked the issue. A value that parses
// costs no result object, and FAILED cannot be mistaken for one: it is private, so any other symbol is just a value.
//
// `path` is one array for the whole parse. A container pushes the segment of a child around that child's parse and only
// copies the array when it reports an issue. A failure returns without popping, which leaves the array deeper than the
// failing node; the one place that goes on after a failure, a union trying its next candidate, cuts it back first.
// Failed union candidates are discarded, so they are parsed without reporting unless an errorMap wants to see them.
// Only traversed containers consume depth. Unions and intersections stay at the same path; scalar and passthrough
// leaves need no guard. Reject before descending into the next container, including an empty one.
const MAX_DEPTH_EXPECTED = `value nested at most ${MAX_DEPTH} levels deep`;

type ParseContext = {
  owned: WeakSet<object>;
  guides: WeakMap<object, Guide>;
  changes: [object, Guide | undefined][];
};

type Provenance = { passthrough?: RuntimeStruct };

export function parseValue(
  struct: RuntimeStruct,
  input: unknown,
  path: Path,
  mode: ParseMode,
  useAliases = false,
  tagObjects = false,
  guides?: WeakMap<object, Guide>,
): InternalParseResult<unknown> {
  return parseEntry(
    struct,
    input,
    [...path],
    mode,
    useAliases,
    tagObjects,
    guides,
  );
}

export function parseRootValue(
  struct: RuntimeStruct,
  input: unknown,
  mode: ParseMode,
  useAliases = false,
  tagObjects = false,
  guides?: WeakMap<object, Guide>,
): InternalParseResult<unknown> {
  return parseEntry(struct, input, [], mode, useAliases, tagObjects, guides);
}

function parseEntry(
  struct: RuntimeStruct,
  input: unknown,
  path: Path,
  mode: ParseMode,
  useAliases: boolean,
  tagObjects: boolean,
  guides: WeakMap<object, Guide> | undefined,
): InternalParseResult<unknown> {
  // An errorMap, a decode hook or a getter can start another parse in the middle of this one. Leave the slot as found.
  const parked = parkedFailure();
  const context: ParseContext | undefined = tagObjects
    ? { owned: new WeakSet(), guides: guides ?? new WeakMap(), changes: [] }
    : undefined;
  let succeeded = false;
  try {
    const value = parseNode(
      struct,
      input,
      path,
      mode,
      useAliases,
      true,
      context,
    );
    succeeded = value !== FAILED;
    // This parse reports, so every FAILED it returns has an issue parked right behind it.
    return value === FAILED
      ? {
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: an unreported decoder failure keeps the original error-first StructError tuple; do not introduce a new TypeError
          issue: parkedFailure() as StructIssue,
          ok: false,
        }
      : { ok: true, value };
  } finally {
    if (!succeeded && context) {
      restoreGuides(context, 0);
    }
    restoreFailure(parked);
  }
}

function restoreGuides(context: ParseContext, checkpoint: number): void {
  while (context.changes.length > checkpoint) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: pop one rollback entry immediately before each WeakMap write; do not eagerly splice and reverse the whole rollback
    const [value, previous] = context.changes.pop() as [
      object,
      Guide | undefined,
    ];
    if (previous) {
      context.guides.set(value, previous);
    } else {
      context.guides.delete(value);
    }
  }
}

function parseNode(
  struct: RuntimeStruct,
  input: unknown,
  path: Path,
  mode: ParseMode,
  useAliases: boolean,
  reportIssues: boolean,
  context: ParseContext | undefined,
  provenance?: Provenance,
): unknown {
  const definition = struct[DEFINITION];

  if (input === undefined) {
    if (definition.flags.optional) {
      return mode === "field" ? OMIT : undefined;
    }
    return reportIssues
      ? failure(
          issue(
            [...path],
            mode === "field" ? "missing_key" : "invalid_type",
            expectedType(definition),
            input,
          ),
        )
      : FAILED;
  }

  if (input === null) {
    if (definition.kind === "null" || definition.flags.nullable) {
      return null;
    }
    const delegatesNull =
      (definition.kind === "literal" && definition.value === null) ||
      definition.kind === "intersection" ||
      definition.kind === "or";
    if (!delegatesNull) {
      return reportIssues
        ? failure(
            issue([...path], "invalid_type", expectedType(definition), input),
          )
        : FAILED;
    }
  }

  switch (definition.kind) {
    case "any":
    case "unknown":
      if (provenance) {
        provenance.passthrough = struct;
      }
      return input;

    case "array": {
      const value = parseArrayValue(
        definition,
        input,
        path,
        useAliases,
        reportIssues,
        context,
      );
      if (provenance && value !== FAILED) {
        const item = definition.item;
        const kind = item[DEFINITION].kind;
        if (kind === "any" || kind === "unknown") {
          provenance.passthrough = item;
        }
      }
      return value;
    }

    case "arrayBuffer":
    case "bigint":
    case "blob":
    case "boolean":
    case "date":
    case "file":
    case "null":
    case "number":
    case "string":
      return parsePrimitiveValue(definition, input, path, reportIssues);

    case "enum":
      return parseEnumValue(definition, input, path, reportIssues);

    case "intersection":
      return parseIntersectionValue(
        definition,
        input,
        path,
        useAliases,
        reportIssues,
        context,
      );

    case "literal":
      return parseLiteralValue(definition, input, path, reportIssues);

    case "object":
      return parseObjectValue(
        struct,
        definition,
        input,
        path,
        useAliases,
        reportIssues,
        context,
      );

    case "or":
      return parseUnionValue(
        definition,
        input,
        path,
        useAliases,
        reportIssues,
        context,
        provenance,
      );

    case "discriminatedUnion":
      return parseDiscriminatedUnionValue(
        definition,
        input,
        path,
        useAliases,
        reportIssues,
        context,
      );

    case "record":
      return parseRecordValue(
        struct,
        definition,
        input,
        path,
        useAliases,
        reportIssues,
        context,
      );

    case "tuple":
      return parseTupleValue(
        definition,
        input,
        path,
        useAliases,
        reportIssues,
        context,
      );
  }
}

function nestingExceeded(
  input: unknown,
  path: Path,
  reportIssues: boolean,
): unknown {
  return reportIssues
    ? failure(issue([...path], "invalid_type", MAX_DEPTH_EXPECTED, input))
    : FAILED;
}

function parsePrimitiveValue(
  definition: PrimitiveDefinition<PrimitiveKind, unknown, unknown>,
  input: unknown,
  path: Path,
  reportIssues: boolean,
): unknown {
  if (!definition.is(input)) {
    return reportIssues
      ? failure(issue([...path], "invalid_type", definition.expected, input))
      : FAILED;
  }

  // The hook reports through this parser's own `failure`, which also applies this parse's error map. A hook built by
  // another copy of the package would otherwise hand back a FAILED this copy does not know and park its issue where
  // this copy never looks.
  return definition.decode
    ? definition.decode(input, [...path], failure)
    : input;
}

function parseEnumValue(
  definition: EnumDefinition<string | number>,
  input: unknown,
  path: Path,
  reportIssues: boolean,
): unknown {
  // Type boundary: enum structs are defined with string or number literals; by the time we reach this
  // parser the input has already been validated as non-null/undefined and only enum members can match.
  return matchesEnum(definition, input)
    ? input
    : reportIssues
      ? failure(issue([...path], "invalid_enum", definition.expected, input))
      : FAILED;
}

function parseLiteralValue(
  definition: LiteralDefinition<LiteralValue>,
  input: unknown,
  path: Path,
  reportIssues: boolean,
): unknown {
  return Object.is(input, definition.value)
    ? input
    : reportIssues
      ? failure(issue([...path], "invalid_literal", definition.expected, input))
      : FAILED;
}

function parseArrayValue(
  definition: ArrayDefinition,
  input: unknown,
  path: Path,
  useAliases: boolean,
  reportIssues: boolean,
  context: ParseContext | undefined,
): unknown {
  if (!Array.isArray(input)) {
    return reportIssues
      ? failure(issue([...path], "invalid_type", "array", input))
      : FAILED;
  }
  if (path.length >= MAX_DEPTH) {
    return nestingExceeded(input, path, reportIssues);
  }

  const item = definition.item;
  const output: unknown[] = [];
  for (let index = 0; index < input.length; index += 1) {
    path.push(index);
    const value = parseNode(
      item,
      input[index],
      path,
      "value",
      useAliases,
      reportIssues,
      context,
    );
    if (value === FAILED) {
      return FAILED;
    }
    path.pop();
    output.push(value);
  }
  return output;
}

function parseObjectValue(
  struct: RuntimeStruct,
  definition: ObjectDefinition,
  input: unknown,
  path: Path,
  useAliases: boolean,
  reportIssues: boolean,
  context: ParseContext | undefined,
  cachedKey?: string,
  cachedValue?: unknown,
  target?: { [key: string]: unknown },
): unknown {
  if (!isPlainObject(input)) {
    return reportIssues
      ? failure(issue([...path], "invalid_type", "object", input))
      : FAILED;
  }
  if (path.length >= MAX_DEPTH) {
    return nestingExceeded(input, path, reportIssues);
  }

  const output: { [key: string]: unknown } = target ?? nullObject();
  const fields = resolveStructFields(struct, definition);
  for (let index = 0; index < fields.length; index += 1) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- MEASURED: same-process alternating 15 rounds x 1e6 parses/variant x 8 fixtures; for-of/index aggregate median 1.76349x (IQR 1.74673-1.76996x, range 1.63984-1.96549x; 15/15 > 1.05x), depth-8 median 1.96922x (min 1.89534x); index < fields.length
    const field = fields[index] as ResolvedStructField;
    const inputKey = useAliases ? field.wireKey : field.key;
    const inputValue =
      cachedKey === inputKey
        ? cachedValue
        : hasOwnKey(input, inputKey)
          ? input[inputKey]
          : undefined;
    path.push(field.key);
    const value = parseNode(
      field.struct,
      inputValue,
      path,
      "field",
      useAliases,
      reportIssues,
      context,
    );
    if (value === FAILED) {
      return FAILED;
    }
    path.pop();
    if (value !== OMIT) {
      // A shared intersection target already has this logical key. Merge it; do not let the later side win.
      if (target !== undefined && hasOwnKey(output, field.key)) {
        const merged = mergeIntersectionValues(
          output[field.key],
          value,
          context !== undefined,
          path.length + 1,
          context,
        );
        if (!merged.ok) {
          return reportIssues
            ? failure(
                issue(
                  [...path, field.key, ...merged.path],
                  "invalid_intersection",
                  "compatible intersection value",
                  merged.received,
                ),
              )
            : FAILED;
        }
        output[field.key] = merged.value;
      } else {
        output[field.key] = value;
      }
    }
  }
  if (context && !target) {
    context.owned.add(output);
    tagOwnNode(output, struct);
  }
  return output;
}

function parseRecordValue(
  struct: RuntimeStruct,
  definition: RecordDefinition,
  input: unknown,
  path: Path,
  useAliases: boolean,
  reportIssues: boolean,
  context: ParseContext | undefined,
): unknown {
  if (!isPlainObject(input)) {
    return reportIssues
      ? failure(issue([...path], "invalid_type", "record", input))
      : FAILED;
  }
  if (path.length >= MAX_DEPTH) {
    return nestingExceeded(input, path, reportIssues);
  }

  const item = definition.value;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- PERF: literal/setPrototypeOf record allocation ratios were 2.058/2.122/2.052x at four keys and 1.044/1.051/1.024x at 64 keys, 3 runs x 13 alternating pairs x 100000 iterations
  const output: { [key: string]: unknown } = Object.create(null);
  for (const key of Object.keys(input)) {
    path.push(key);
    const value = parseNode(
      item,
      input[key],
      path,
      "field",
      useAliases,
      reportIssues,
      context,
    );
    if (value === FAILED) {
      return FAILED;
    }
    path.pop();
    if (value !== OMIT) {
      output[key] = value;
    }
  }
  // Nullable null never reaches a record parse. The object itself carries the struct that parsed it.
  if (context) {
    context.owned.add(output);
    tagOwnNode(output, struct);
  }
  return output;
}

function parseTupleValue(
  definition: TupleDefinition,
  input: unknown,
  path: Path,
  useAliases: boolean,
  reportIssues: boolean,
  context: ParseContext | undefined,
): unknown {
  if (!Array.isArray(input) || input.length !== definition.items.length) {
    return reportIssues
      ? failure(
          issue(
            [...path],
            "invalid_type",
            `tuple of length ${definition.items.length}`,
            input,
          ),
        )
      : FAILED;
  }
  if (path.length >= MAX_DEPTH) {
    return nestingExceeded(input, path, reportIssues);
  }

  const output: unknown[] = [];
  for (let index = 0; index < definition.items.length; index += 1) {
    path.push(index);
    const value = parseNode(
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: preserve bounded tuple-index reads without invoking a new entries method or iterator on caller-supplied metadata
      definition.items[index] as RuntimeStruct,
      input[index],
      path,
      "value",
      useAliases,
      reportIssues,
      context,
    );
    if (value === FAILED) {
      return FAILED;
    }
    path.pop();
    output.push(value);
  }
  return output;
}

function parseUnionValue(
  definition: UnionDefinition,
  input: unknown,
  path: Path,
  useAliases: boolean,
  reportIssues: boolean,
  context: ParseContext | undefined,
  provenance: Provenance | undefined,
): unknown {
  const reportCandidateIssues = reportIssues && hasErrorMap();
  const depth = path.length;
  for (const option of definition.options) {
    const checkpoint = context?.changes.length ?? 0;
    const value = parseNode(
      option,
      input,
      path,
      "value",
      useAliases,
      reportCandidateIssues,
      context,
      provenance,
    );
    if (value !== FAILED) {
      return value;
    }
    if (context) {
      restoreGuides(context, checkpoint);
    }
    // The failed candidate stopped wherever it failed. The next one starts at the union.
    path.length = depth;
  }
  return reportIssues
    ? failure(issue([...path], "invalid_union", definition.expected, input))
    : FAILED;
}

function parseDiscriminatedUnionValue(
  definition: DiscriminatedUnionDefinition,
  input: unknown,
  path: Path,
  useAliases: boolean,
  reportIssues: boolean,
  context: ParseContext | undefined,
): unknown {
  if (!isPlainObject(input)) {
    return reportIssues
      ? failure(issue([...path], "invalid_type", "object", input))
      : FAILED;
  }

  if (!useAliases) {
    const value = hasOwnKey(input, definition.discriminator)
      ? input[definition.discriminator]
      : undefined;
    if (value === undefined) {
      return reportIssues
        ? failure(
            issue(
              [...path, definition.discriminator],
              "missing_key",
              definition.expected,
              undefined,
            ),
          )
        : FAILED;
    }
    const target = definition.map.get(value);
    if (!target) {
      return reportIssues
        ? failure(
            issue(
              [...path, definition.discriminator],
              "invalid_union",
              definition.expected,
              value,
            ),
          )
        : FAILED;
    }
    const runtime = target;
    return parseObjectValue(
      runtime,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: preserve the original selected-object parse without a new kind check or extra metadata reads
      runtime[DEFINITION] as ObjectDefinition,
      input,
      path,
      false,
      reportIssues,
      context,
      definition.discriminator,
      value,
    );
  }

  for (const wireKey of definition.discriminatorWireKeys ?? []) {
    if (!hasOwnKey(input, wireKey)) {
      continue;
    }

    const value = input[wireKey];
    if (value === undefined) {
      return reportIssues
        ? failure(
            issue(
              [...path, definition.discriminator],
              "missing_key",
              definition.expected,
              undefined,
            ),
          )
        : FAILED;
    }
    const target = definition.map.get(value);
    if (!target || definition.wireKeyByValue?.get(value) !== wireKey) {
      return reportIssues
        ? failure(
            issue(
              [...path, definition.discriminator],
              "invalid_union",
              definition.expected,
              value,
            ),
          )
        : FAILED;
    }
    return parseObjectValue(
      target,
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: preserve the original selected-object parse without a new kind check or extra metadata reads
      target[DEFINITION] as ObjectDefinition,
      input,
      path,
      true,
      reportIssues,
      context,
      wireKey,
      value,
    );
  }
  return reportIssues
    ? failure(
        issue(
          [...path, definition.discriminator],
          "missing_key",
          definition.expected,
          undefined,
        ),
      )
    : FAILED;
}

function parseIntersectionValue(
  definition: IntersectionDefinition,
  input: unknown,
  path: Path,
  useAliases: boolean,
  reportIssues: boolean,
  context: ParseContext | undefined,
): unknown {
  if (definition.objectSides && isPlainObject(input)) {
    const merged = nullObject();
    for (const option of definition.options) {
      const runtime = option;
      const value = parseObjectValue(
        runtime,
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: preserve the original selected-object parse without a new kind check or extra metadata reads
        runtime[DEFINITION] as ObjectDefinition,
        input,
        path,
        useAliases,
        reportIssues,
        context,
        undefined,
        undefined,
        merged,
      );
      if (value === FAILED) {
        return FAILED;
      }
    }
    if (context) {
      context.owned.add(merged);
      // An object intersection always has at least one member struct, so the guide exists.
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: retain the original full guide-member scan and tag result, including unchecked empty-member behaviour, without a new guard or rest snapshot
      tagOwnNode(merged, guideTag(definition.options) as Guide);
    }
    return merged;
  }

  // unknown/any still run, but they are the identity of `&` and must not put keys back into the output.
  const contributed: unknown[] = [];
  const passthroughs: RuntimeStruct[] = [];
  for (const option of definition.options) {
    const runtime = option;
    const provenance: Provenance | undefined = context ? {} : undefined;
    const value = parseNode(
      runtime,
      input,
      path,
      "value",
      useAliases,
      reportIssues,
      context,
      provenance,
    );
    if (value === FAILED) {
      return FAILED;
    }
    if (!isIntersectionIdentity(runtime)) {
      contributed.push(value);
      if (provenance?.passthrough) {
        passthroughs.push(provenance.passthrough);
      }
    }
  }
  if (contributed.length === 0) {
    return input;
  }

  let merged = contributed[0];
  for (let index = 1; index < contributed.length; index += 1) {
    const mergedValue = mergeIntersectionValues(
      merged,
      contributed[index],
      context !== undefined,
      path.length,
      context,
    );
    if (!mergedValue.ok) {
      return reportIssues
        ? failure(
            issue(
              [...path, ...mergedValue.path],
              "invalid_intersection",
              "compatible intersection value",
              mergedValue.received,
            ),
          )
        : FAILED;
    }
    merged = mergedValue.value;
  }

  if (context && passthroughs.length > 0) {
    if (isPlainObject(merged)) {
      attachPassthroughGuides(merged, passthroughs, context);
    } else if (Array.isArray(merged)) {
      for (const item of merged) {
        if (isPlainObject(item)) {
          attachPassthroughGuides(item, passthroughs, context);
        }
      }
    }
  }
  return merged;
}

function attachPassthroughGuides(
  value: { [key: string]: unknown },
  guides: readonly RuntimeStruct[],
  context: ParseContext,
): void {
  const current = readOwnGuide(value, context.guides);
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: retain the original full guide-member scan and tag result, including unchecked empty-member behaviour, without a new guard or rest snapshot
  const next = guideTag([
    ...(current ? guideMembers(current) : []),
    ...guides,
  ]) as Guide;
  if (context.owned.has(value)) {
    tagOwnNode(value, next);
  } else {
    // any/unknown borrowed this reference. Keep its provenance in this parse, never on the caller's object.
    context.changes.push([value, context.guides.get(value)]);
    context.guides.set(value, next);
  }
}
