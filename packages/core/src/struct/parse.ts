import { issue, StructError, type ErrorMap } from "./errors";
import { resolveStructFields, type ResolvedStructField } from "./fields";
import {
  guideMembers,
  guideTag,
  readOwnGuide,
  tagOwnNode,
  type Guide,
} from "./guide";
import { assertStruct } from "./shape";
import { DEFINITION, FAILED, OMIT } from "./symbols";
import type {
  ArrayDefinition,
  DiscriminatedUnionDefinition,
  EnumDefinition,
  IntersectionDefinition,
  LiteralDefinition,
  LiteralValue,
  ObjectDefinition,
  ParsedStructOutput,
  ParseMode,
  ParseResult,
  Path,
  PrimitiveDefinition,
  PrimitiveKind,
  RecordDefinition,
  RuntimeStruct,
  StructIssue,
  StructLike,
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

// Every parser below returns the parsed value itself, or FAILED after `reject()` put the issue in the parse state. A
// value that parses costs no result object, and FAILED cannot be mistaken for one: it is private, so any other symbol
// is just a value.
//
// One ParseState serves one parse call, so a parse started from an errorMap, a decode hook or a getter has its own.
// `path` is one array for the whole parse. A container pushes the segment of a child around that child's parse, and
// `reject()` copies the array when it reports an issue. A failure returns without popping, which leaves the array
// deeper than the failing node; the one place that goes on after a failure, a union trying its next candidate, cuts it
// back first.
// `report` is the only argument that changes on the way down. Failed union candidates are discarded, so they are
// parsed without reporting unless an errorMap wants to see them.
// Only traversed containers consume depth. Unions and intersections stay at the same path; scalar and passthrough
// leaves need no guard. Reject before descending into the next container, including an empty one.
const MAX_DEPTH_EXPECTED = `value nested at most ${MAX_DEPTH} levels deep`;

type ParseContext = {
  owned: WeakSet<object>;
  guides: WeakMap<object, Guide>;
  changes: [object, Guide | undefined][];
};

type ParseState = {
  readonly aliases: boolean;
  /** Present only for a tagging parse, which is the only one that pays for the sets. */
  readonly context: ParseContext | undefined;
  readonly errorMap: ErrorMap | undefined;
  /** The issue behind a reported FAILED. Only `reject()` writes it. */
  issue: StructIssue;
  readonly path: Path;
};

type Provenance = { passthrough?: RuntimeStruct };

// Every reporting FAILED goes through `reject()`, which fills the slot first, so this value is never read.
const NO_ISSUE: StructIssue = {
  code: "custom",
  expected: "",
  message: "",
  path: [],
  received: undefined,
};

function parseState(
  aliases: boolean,
  errorMap: ErrorMap | undefined,
  context: ParseContext | undefined,
): ParseState {
  return { aliases, context, errorMap, issue: NO_ISSUE, path: [] };
}

/**
 * Parses an unknown value with a struct and returns an error-first tuple.
 *
 * - **struct** is the struct to parse with. A value that is not a struct throws `TypeError`.
 *
 * - **value** is the unknown input.
 *
 * - **options.aliases** defaults to `false`: object keys are read by their **logical** names (`customerName`). With `true` they are read by their wire names (`customer_name`), the way HTTP/JSON codecs read them. The output always uses logical names.
 *
 * - **options.errorMap** is an {@link ErrorMap} that rewrites issue messages for this call only, including bigint/date conversion failures from a struct created by another Core copy. Any string, including `''`, replaces the message; only `undefined` keeps the default. Custom text is used verbatim.
 *
 * - Parsing is fail-fast: it stops at the first failure, so the error holds one issue. Unknown object keys are stripped from the output, and the input is not modified.
 *
 * - At most **256 nested containers** (`object`, `array`, `record`, or `tuple`) are visited along a path, counting the root container as the first. The next container fails with `invalid_type` at its logical path, with `expected: 'value nested at most 256 levels deep'`. In a union, later candidates may still succeed; if none match, the union reports `invalid_union`. Cycles through declared container fields also reach this limit; shared non-cyclic children are allowed. Union and intersection branches do not add a container level, and `any`/`unknown` values remain opaque rather than being traversed.
 *
 * ```ts
 * import { struct } from "@defjs/core";
 *
 * const Order = struct.object({ id: struct.number(), customerName: struct.string() });
 *
 * function readOrder() {
 *   const [error, order] = struct.parse(Order, { id: 1, customerName: "Ada" });
 *   if (error) {
 *     console.error(error.prettify());
 *     return;
 *   }
 *   console.log(order.customerName);
 * }
 *
 * readOrder();
 * ```
 *
 * `any` and `unknown` do not traverse their values, but an intersection may recursively merge two distinct object or array values returned by those leaves. This merge shares the same 256-container budget with its enclosing logical path. Exceeding it produces `invalid_intersection` at the rejected container's logical path. Identical references are retained without traversal, including a shared cyclic value.
 *
 * @returns `[null, output]` or `[StructError, undefined]`. Validation failures do not throw. Exceptions from caller-provided getters and `errorMap` callbacks propagate unchanged.
 * @group struct
 * @see {@link Struct}
 * @see {@link ParseResult}
 */
export function parseStructTuple<S extends StructLike>(
  struct: S,
  value: unknown,
  options?: { aliases?: boolean; errorMap?: ErrorMap },
): ParseResult<S["_struct"]["output"]> {
  assertStruct(struct, "struct");
  const state = parseState(
    options?.aliases === true,
    options?.errorMap,
    undefined,
  );
  const output = parseNode(state, struct, value, "value", true);
  return output === FAILED
    ? [new StructError([state.issue]), undefined]
    : [null, output];
}

/** Parses and returns the output typed from the struct. A value that does not parse throws its StructError. */
export function parseStructValue<
  S extends StructLike,
  Tagged extends boolean = false,
>(
  struct: S,
  value: unknown,
  options?: {
    aliases?: boolean;
    tagObjects?: Tagged;
    guides?: WeakMap<object, Guide>;
  },
): ParsedStructOutput<S, Tagged> {
  assertStruct(struct, "struct");
  const parsed = parseRuntimeValue(struct, value, options);
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: the parser builds this value at run time, while its type is the struct's compile-time-only `_struct` brand (Infer<S> or TaggedStructOutput<S>); no runtime value carries that brand, so it can only be attached here, the decoders' single typed boundary (HTTP/SSE bodies, WebSocket frames and endpoint input call through it). Unasserted: TS2322, `unknown` is not assignable to `ParsedStructOutput<S, Tagged>`
  return parsed as ParsedStructOutput<S, Tagged>;
}

/** {@link parseStructValue} for a struct the caller already checked: the output is not typed from it. */
export function parseRuntimeValue(
  struct: RuntimeStruct,
  value: unknown,
  options?: {
    aliases?: boolean;
    tagObjects?: boolean;
    guides?: WeakMap<object, Guide>;
  },
): unknown {
  const context: ParseContext | undefined =
    options?.tagObjects === true
      ? {
          owned: new WeakSet(),
          guides: options.guides ?? new WeakMap(),
          changes: [],
        }
      : undefined;
  const state = parseState(options?.aliases === true, undefined, context);
  let output: unknown = FAILED;
  try {
    output = parseNode(state, struct, value, "value", true);
  } finally {
    // A getter can throw in the middle of a parse. The caller's guide map is left as it was found either way.
    if (output === FAILED && context) {
      restoreGuides(context, 0);
    }
  }
  if (output === FAILED) {
    throw new StructError([state.issue]);
  }
  return output;
}

/** The only place a parse fails. Reports the issue at the current path when asked to, and returns FAILED. */
function reject(
  state: ParseState,
  report: boolean,
  code: StructIssue["code"],
  expected: string,
  received: unknown,
): typeof FAILED {
  if (report) {
    const rejected = issue([...state.path], code, expected, received);
    const message = state.errorMap?.(rejected);
    if (message !== undefined) {
      rejected.message = message;
    }
    state.issue = rejected;
  }
  return FAILED;
}

function restoreGuides(context: ParseContext, checkpoint: number): void {
  let change: ParseContext["changes"][number] | undefined;
  while (
    context.changes.length > checkpoint &&
    (change = context.changes.pop()) !== undefined
  ) {
    const [value, previous] = change;
    if (previous) {
      context.guides.set(value, previous);
    } else {
      context.guides.delete(value);
    }
  }
}

function parseNode(
  state: ParseState,
  struct: RuntimeStruct,
  input: unknown,
  mode: ParseMode,
  report: boolean,
  provenance?: Provenance,
): unknown {
  const definition = struct[DEFINITION];

  // expectedType() builds its text for a container, so the two checks below ask for it only when they report.
  if (input === undefined) {
    if (definition.flags.optional) {
      return mode === "field" ? OMIT : undefined;
    }
    return report
      ? reject(
          state,
          true,
          mode === "field" ? "missing_key" : "invalid_type",
          expectedType(definition),
          input,
        )
      : FAILED;
  }

  if (input === null) {
    if (definition.flags.nullable) {
      return null;
    }
    // An intersection or a union accepts null when its members do, so only those two go on to ask them.
    if (definition.kind !== "intersection" && definition.kind !== "or") {
      return report
        ? reject(state, true, "invalid_type", expectedType(definition), input)
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
      const value = parseArrayValue(state, definition, input, report);
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
      return parsePrimitiveValue(state, definition, input, report);

    case "enum":
      return parseEnumValue(state, definition, input, report);

    case "intersection":
      return parseIntersectionValue(state, definition, input, report);

    case "literal":
      return parseLiteralValue(state, definition, input, report);

    case "object":
      return parseObjectValue(state, struct, definition, input, report);

    case "or":
      return parseUnionValue(state, definition, input, report, provenance);

    case "discriminatedUnion":
      return parseDiscriminatedUnionValue(state, definition, input, report);

    case "record":
      return parseRecordValue(state, struct, definition, input, report);

    case "tuple":
      return parseTupleValue(state, definition, input, report);
  }
}

function parsePrimitiveValue(
  state: ParseState,
  definition: PrimitiveDefinition<PrimitiveKind, unknown, unknown>,
  input: unknown,
  report: boolean,
): unknown {
  const decode = definition.decode;
  if (decode === undefined) {
    return definition.is(input)
      ? input
      : reject(state, report, "invalid_type", definition.expected, input);
  }
  // The hook checks the value itself and hands back this parser's own sentinel, so a struct built by another copy of
  // the package cannot return a failure this copy does not recognize. The issue is always built here.
  const value = decode(input, FAILED);
  return value === FAILED
    ? reject(state, report, "invalid_type", definition.expected, input)
    : value;
}

function parseEnumValue(
  state: ParseState,
  definition: EnumDefinition<string | number>,
  input: unknown,
  report: boolean,
): unknown {
  return matchesEnum(definition, input)
    ? input
    : reject(state, report, "invalid_enum", definition.expected, input);
}

function parseLiteralValue(
  state: ParseState,
  definition: LiteralDefinition<LiteralValue>,
  input: unknown,
  report: boolean,
): unknown {
  return Object.is(input, definition.value)
    ? input
    : reject(state, report, "invalid_literal", definition.expected, input);
}

function parseArrayValue(
  state: ParseState,
  definition: ArrayDefinition,
  input: unknown,
  report: boolean,
): unknown {
  if (!Array.isArray(input)) {
    return reject(state, report, "invalid_type", "array", input);
  }
  const path = state.path;
  if (path.length >= MAX_DEPTH) {
    return reject(state, report, "invalid_type", MAX_DEPTH_EXPECTED, input);
  }

  const item = definition.item;
  const output: unknown[] = [];
  for (let index = 0; index < input.length; index += 1) {
    path.push(index);
    const value = parseNode(state, item, input[index], "value", report);
    if (value === FAILED) {
      return FAILED;
    }
    path.pop();
    output.push(value);
  }
  return output;
}

function parseObjectValue(
  state: ParseState,
  struct: RuntimeStruct,
  definition: ObjectDefinition,
  input: unknown,
  report: boolean,
  cachedKey?: string,
  cachedValue?: unknown,
  target?: { [key: string]: unknown },
): unknown {
  if (!isPlainObject(input)) {
    return reject(state, report, "invalid_type", "object", input);
  }
  const path = state.path;
  if (path.length >= MAX_DEPTH) {
    return reject(state, report, "invalid_type", MAX_DEPTH_EXPECTED, input);
  }

  const aliases = state.aliases;
  const context = state.context;
  const output: { [key: string]: unknown } = target ?? nullObject();
  const fields = resolveStructFields(struct, definition);
  for (let index = 0; index < fields.length; index += 1) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- PERF: `index < fields.length` bounds this read. `for (const field of fields)` over the frozen cached field list made struct.parse 2.066-2.096x slower for an 8-field object and 2.123-2.225x for 6 nested objects (Bun 1.4.4, two copies of each variant, 3 runs x 15 interleaved rounds x 2e5/1.5e5 parses, medians; the two indexed copies differed by at most 1.057x)
    const field = fields[index] as ResolvedStructField;
    const inputKey = aliases ? field.wireKey : field.key;
    const inputValue =
      cachedKey === inputKey
        ? cachedValue
        : hasOwnKey(input, inputKey)
          ? input[inputKey]
          : undefined;
    path.push(field.key);
    const value = parseNode(state, field.struct, inputValue, "field", report);
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
          path.push(field.key, ...merged.path);
          return reject(
            state,
            report,
            "invalid_intersection",
            "compatible intersection value",
            merged.received,
          );
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
  state: ParseState,
  struct: RuntimeStruct,
  definition: RecordDefinition,
  input: unknown,
  report: boolean,
): unknown {
  if (!isPlainObject(input)) {
    return reject(state, report, "invalid_type", "record", input);
  }
  const path = state.path;
  if (path.length >= MAX_DEPTH) {
    return reject(state, report, "invalid_type", MAX_DEPTH_EXPECTED, input);
  }

  const item = definition.value;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- PERF: Object.create(null) is typed `any`. The typed `{ __proto__: null }` literal made struct.parse 1.207-1.295x slower for a 1-key record and 1.212-1.225x for 8 nested 2-key records (Bun 1.4.4, two copies of each variant, 3 runs x 15 interleaved rounds x 3e5/6e4 parses, medians; the two Object.create copies differed by at most 1.025x); `{}` plus setPrototypeOf allocates slower still
  const output: { [key: string]: unknown } = Object.create(null);
  for (const key of Object.keys(input)) {
    path.push(key);
    const value = parseNode(state, item, input[key], "field", report);
    if (value === FAILED) {
      return FAILED;
    }
    path.pop();
    if (value !== OMIT) {
      output[key] = value;
    }
  }
  // Nullable null never reaches a record parse. The object itself carries the struct that parsed it.
  if (state.context) {
    state.context.owned.add(output);
    tagOwnNode(output, struct);
  }
  return output;
}

function parseTupleValue(
  state: ParseState,
  definition: TupleDefinition,
  input: unknown,
  report: boolean,
): unknown {
  if (!Array.isArray(input) || input.length !== definition.items.length) {
    return report
      ? reject(
          state,
          true,
          "invalid_type",
          `tuple of length ${definition.items.length}`,
          input,
        )
      : FAILED;
  }
  const path = state.path;
  if (path.length >= MAX_DEPTH) {
    return reject(state, report, "invalid_type", MAX_DEPTH_EXPECTED, input);
  }

  const output: unknown[] = [];
  let index = 0;
  for (const item of definition.items) {
    path.push(index);
    const value = parseNode(state, item, input[index], "value", report);
    if (value === FAILED) {
      return FAILED;
    }
    path.pop();
    output.push(value);
    index += 1;
  }
  return output;
}

function parseUnionValue(
  state: ParseState,
  definition: UnionDefinition,
  input: unknown,
  report: boolean,
  provenance: Provenance | undefined,
): unknown {
  const context = state.context;
  const path = state.path;
  const reportCandidates = report && state.errorMap !== undefined;
  const depth = path.length;
  for (const option of definition.options) {
    const checkpoint = context?.changes.length ?? 0;
    const value = parseNode(
      state,
      option,
      input,
      "value",
      reportCandidates,
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
  return reject(state, report, "invalid_union", definition.expected, input);
}

function parseDiscriminatedUnionValue(
  state: ParseState,
  definition: DiscriminatedUnionDefinition,
  input: unknown,
  report: boolean,
): unknown {
  if (!isPlainObject(input)) {
    return reject(state, report, "invalid_type", "object", input);
  }

  // The tag is read once, here. With aliases every option may name it differently on the wire, so the first wire
  // name the input has decides, and the option that tag selects has to be the one that uses that name.
  const aliases = state.aliases;
  const key = aliases
    ? firstOwnKey(input, definition.discriminatorWireKeys)
    : hasOwnKey(input, definition.discriminator)
      ? definition.discriminator
      : undefined;
  const tag = key === undefined ? undefined : input[key];
  const target = definition.map.get(tag);
  if (
    target === undefined ||
    (aliases && definition.wireKeyByValue.get(tag) !== key)
  ) {
    state.path.push(definition.discriminator);
    return reject(
      state,
      report,
      tag === undefined ? "missing_key" : "invalid_union",
      definition.expected,
      tag,
    );
  }
  return parseObjectValue(
    state,
    target,
    target[DEFINITION],
    input,
    report,
    key,
    tag,
  );
}

function firstOwnKey(
  input: { [key: string]: unknown },
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    if (hasOwnKey(input, key)) {
      return key;
    }
  }
  return undefined;
}

function parseIntersectionValue(
  state: ParseState,
  definition: IntersectionDefinition,
  input: unknown,
  report: boolean,
): unknown {
  const context = state.context;
  if (definition.objectSides && isPlainObject(input)) {
    const merged = nullObject();
    for (const side of definition.options) {
      const value = parseObjectValue(
        state,
        side,
        side[DEFINITION],
        input,
        report,
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
      tagOwnNode(merged, guideTag(definition.options));
    }
    return merged;
  }

  // unknown/any still run, but they are the identity of `&` and must not put keys back into the output.
  const contributed: unknown[] = [];
  let passthroughs: [RuntimeStruct, ...RuntimeStruct[]] | undefined;
  for (const option of definition.options) {
    const provenance: Provenance | undefined = context ? {} : undefined;
    const value = parseNode(state, option, input, "value", report, provenance);
    if (value === FAILED) {
      return FAILED;
    }
    if (!isIntersectionIdentity(option)) {
      contributed.push(value);
      if (provenance?.passthrough) {
        if (passthroughs) {
          passthroughs.push(provenance.passthrough);
        } else {
          passthroughs = [provenance.passthrough];
        }
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
      state.path.length,
      context,
    );
    if (!mergedValue.ok) {
      state.path.push(...mergedValue.path);
      return reject(
        state,
        report,
        "invalid_intersection",
        "compatible intersection value",
        mergedValue.received,
      );
    }
    merged = mergedValue.value;
  }

  if (context && passthroughs) {
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
  guides: readonly [RuntimeStruct, ...RuntimeStruct[]],
  context: ParseContext,
): void {
  const current = readOwnGuide(value, context.guides);
  const next = guideTag(
    current ? [...guideMembers(current), ...guides] : guides,
  );
  if (context.owned.has(value)) {
    tagOwnNode(value, next);
  } else {
    // any/unknown borrowed this reference. Keep its provenance in this parse, never on the caller's object.
    context.changes.push([value, context.guides.get(value)]);
    context.guides.set(value, next);
  }
}
