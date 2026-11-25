import {
  MAX_DEPTH,
  type ArrayDefinition,
  type DiscriminatedUnionDefinition,
  type EnumDefinition,
  type IntersectionDefinition,
  type LiteralDefinition,
  type ObjectDefinition,
  type PrimitiveDefinition,
  type PrimitiveKind,
  type RecordDefinition,
  type ResolvedStructField,
  type RuntimeStruct,
  type TupleDefinition,
  type UnionDefinition,
} from "./definition";
import { expectedType, type ErrorMap } from "./errors";
import {
  guideMembers,
  guideTag,
  readOwnGuide,
  tagOwnNode,
  type Guide,
} from "./guide";
import {
  isIntersectionIdentity,
  mergeIntersectionValues,
} from "./intersection";
import { getCompiledArrayParser, getCompiledObjectParser } from "./jit";
import { matchesEnum } from "./match";
import {
  parseState,
  pushReversedSegments,
  reject,
  toStructError,
  type ParseContext,
  type ParseState,
} from "./parse_state";
import { isPlainObject, nullObject } from "./plain_object";
import { assertStruct, resolveStructFields } from "./shape";
import { DEFINITION, FAILED, OMIT } from "./symbols";
import type {
  LiteralValue,
  ParsedStructOutput,
  ParseMode,
  ParseResult,
  StructLike,
} from "./types";

// Every parser below returns the parsed value itself, or FAILED after `reject()` recorded the failure in the parse
// state. A value that parses costs no result object, and FAILED cannot be mistaken for one: it is private, so any
// other symbol is just a value.
//
// One ParseState serves one parse call, so a parse started from an errorMap, a decode hook or a getter has its own.
// Without `errorMap`, no path array is pushed during traversal; only an unwinding failure appends segments in reverse.
// With `errorMap`, `state.path` maintains the forward path so `errorMap` sees every candidate failure immediately.
// Only traversed containers consume depth. Unions and intersections stay at the same depth; scalar and passthrough
// leaves need no guard. Reject before descending into the next container, including an empty one.
const MAX_DEPTH_EXPECTED = `value nested at most ${MAX_DEPTH} levels deep`;

type Provenance = { passthrough?: RuntimeStruct };

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
 * function main() {
 *   const [err, order] = struct.parse(Order, { id: 1, customerName: "Ada" });
 *   if (err) {
 *     console.error(err.prettify());
 *     return;
 *   }
 *   console.log(order.customerName);
 * }
 *
 * main();
 * ```
 *
 * `any` and `unknown` do not traverse their values, but an intersection may recursively merge two distinct object or array values returned by those leaves. This merge shares the same 256-container budget with its enclosing logical path. Exceeding it produces `invalid_intersection` at the rejected container's logical path. Identical references are retained without traversal, including a shared cyclic value.
 *
 * @returns `[null, output]` or `[err, undefined]` where `err` is a `StructError`. Validation failures do not throw. Exceptions from caller-provided getters and `errorMap` callbacks propagate unchanged.
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
  const output = parseNode(state, struct, value, "value", true, 0);
  return output === FAILED ? [toStructError(state), undefined] : [null, output];
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
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: the public StructLike is a compile-time brand with no runtime members, while every struct the constructors build carries the definition RuntimeStruct describes, and making StructLike assignable to it would change the published type. Unasserted: TS2345, `S` is not assignable to `RuntimeStruct`
  const parsed = parseRuntimeValue(struct as S & RuntimeStruct, value, options);
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: the parser builds this value at run time, while its type is the struct's compile-time-only `_struct` brand (Infer<S> or TaggedStructOutput<S>); no runtime value carries that brand, so it can only be attached here, the decoders' single typed boundary (HTTP/SSE bodies, WebSocket frames and endpoint input call through it). Unasserted: TS2322, `unknown` is not assignable to `ParsedStructOutput<S, Tagged>`
  return parsed as ParsedStructOutput<S, Tagged>;
}

/** {@link parseStructValue} for a struct already read as a runtime struct: the output is not typed from it. */
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
          owned: undefined,
          guides: options.guides,
          changes: undefined,
        }
      : undefined;
  const state = parseState(options?.aliases === true, undefined, context);
  let output: unknown = FAILED;
  try {
    output = parseNode(state, struct, value, "value", true, 0);
  } finally {
    // A getter can throw in the middle of a parse. The caller's guide map is left as it was found either way.
    if (output === FAILED && context?.changes && context.guides) {
      restoreGuides(context.changes, context.guides, 0);
    }
  }
  if (output === FAILED) {
    throw toStructError(state);
  }
  return output;
}

function restoreGuides(
  changes: [object, Guide | undefined][],
  guides: WeakMap<object, Guide>,
  checkpoint: number,
): void {
  let change: [object, Guide | undefined] | undefined;
  while (
    changes.length > checkpoint &&
    (change = changes.pop()) !== undefined
  ) {
    const [value, previous] = change;
    if (previous) {
      guides.set(value, previous);
    } else {
      guides.delete(value);
    }
  }
}

export function parseNode(
  state: ParseState,
  struct: RuntimeStruct,
  input: unknown,
  mode: ParseMode,
  report: boolean,
  depth: number,
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
      if (report && state.path === undefined && state.context === undefined) {
        const compiled = getCompiledArrayParser(
          definition,
          state.aliases,
          parseNode,
        );
        if (compiled !== undefined) {
          return compiled(state, input, depth);
        }
      }
      const value = parseArrayValue(state, definition, input, report, depth);
      if (provenance && value !== FAILED) {
        const item = definition.item;
        const kind = item[DEFINITION].kind;
        if (kind === "any" || kind === "unknown") {
          provenance.passthrough = item;
        }
      }
      return value;
    }

    case "string":
      if (definition.decode === undefined) {
        return typeof input === "string"
          ? input
          : reject(state, report, "invalid_type", definition.expected, input);
      }
      return parsePrimitiveDecode(state, definition, input, report);

    case "number":
      if (definition.decode === undefined) {
        return typeof input === "number" && !Number.isNaN(input)
          ? input
          : reject(state, report, "invalid_type", definition.expected, input);
      }
      return parsePrimitiveDecode(state, definition, input, report);

    case "boolean":
      if (definition.decode === undefined) {
        return typeof input === "boolean"
          ? input
          : reject(state, report, "invalid_type", definition.expected, input);
      }
      return parsePrimitiveDecode(state, definition, input, report);

    case "null":
      return reject(state, report, "invalid_type", definition.expected, input);

    case "arrayBuffer":
    case "bigint":
    case "blob":
    case "date":
    case "file":
      return parsePrimitiveValue(state, definition, input, report);

    case "enum":
      return parseEnumValue(state, definition, input, report);

    case "intersection":
      return parseIntersectionValue(state, definition, input, report, depth);

    case "literal":
      return parseLiteralValue(state, definition, input, report);

    case "object":
      if (report && state.path === undefined && state.context === undefined) {
        const compiled = getCompiledObjectParser(
          definition,
          state.aliases,
          parseNode,
        );
        if (compiled !== undefined) {
          return compiled(state, input, depth);
        }
      }
      return parseObjectValue(state, struct, definition, input, report, depth);

    case "or":
      return parseUnionValue(
        state,
        definition,
        input,
        report,
        depth,
        provenance,
      );

    case "discriminatedUnion":
      return parseDiscriminatedUnionValue(
        state,
        definition,
        input,
        report,
        depth,
      );

    case "record":
      return parseRecordValue(state, struct, definition, input, report, depth);

    case "tuple":
      return parseTupleValue(state, definition, input, report, depth);
  }
}

function parsePrimitiveDecode(
  state: ParseState,
  definition: PrimitiveDefinition<PrimitiveKind, unknown, unknown>,
  input: unknown,
  report: boolean,
): unknown {
  // The hook checks the value itself and hands back this parser's own sentinel, so a struct built by another copy of
  // the package cannot return a failure this copy does not recognize. The issue is always built here.
  const value = definition.decode?.(input, FAILED);
  return value === FAILED
    ? reject(state, report, "invalid_type", definition.expected, input)
    : value;
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
  depth: number,
): unknown {
  if (!Array.isArray(input)) {
    return reject(state, report, "invalid_type", "array", input);
  }
  if (depth >= MAX_DEPTH) {
    return reject(state, report, "invalid_type", MAX_DEPTH_EXPECTED, input);
  }

  const path = state.path;
  const item = definition.item;
  const length = input.length;
  const output = new Array<unknown>(length);
  const childDepth = depth + 1;
  for (let index = 0; index < length; index += 1) {
    path?.push(index);
    const value = parseNode(
      state,
      item,
      input[index],
      "value",
      report,
      childDepth,
    );
    if (value === FAILED) {
      if (report && path === undefined) {
        state.issue.path.push(index);
      }
      return FAILED;
    }
    path?.pop();
    output[index] = value;
  }
  return output;
}

function parseObjectValue(
  state: ParseState,
  struct: RuntimeStruct,
  definition: ObjectDefinition,
  input: unknown,
  report: boolean,
  depth: number,
  cachedKey?: string,
  cachedValue?: unknown,
  target?: { [key: string]: unknown },
): unknown {
  if (!isPlainObject(input)) {
    return reject(state, report, "invalid_type", "object", input);
  }
  if (depth >= MAX_DEPTH) {
    return reject(state, report, "invalid_type", MAX_DEPTH_EXPECTED, input);
  }

  const path = state.path;
  const aliases = state.aliases;
  const context = state.context;
  const output: { [key: string]: unknown } = target ?? nullObject();
  const fields = resolveStructFields(definition);
  const childDepth = depth + 1;
  for (let index = 0; index < fields.length; index += 1) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- PERF: `index < fields.length` bounds this read. `for (const field of fields)` over the frozen cached field list made struct.parse 2.066-2.096x slower for an 8-field object and 2.123-2.225x for 6 nested objects (Bun 1.4.4, two copies of each variant, 3 runs x 15 interleaved rounds x 2e5/1.5e5 parses, medians; the two indexed copies differed by at most 1.057x)
    const field = fields[index] as ResolvedStructField;
    const inputKey = aliases ? field.wireKey : field.key;
    const inputValue =
      cachedKey === inputKey
        ? cachedValue
        : Object.hasOwn(input, inputKey)
          ? input[inputKey]
          : undefined;
    path?.push(field.key);
    const value = parseNode(
      state,
      field.struct,
      inputValue,
      "field",
      report,
      childDepth,
    );
    if (value === FAILED) {
      if (report && path === undefined) {
        state.issue.path.push(field.key);
      }
      return FAILED;
    }
    path?.pop();
    if (value !== OMIT) {
      // A shared intersection target already has this logical key. Merge it; do not let the later side win.
      if (target !== undefined && Object.hasOwn(output, field.key)) {
        const merged = mergeIntersectionValues(
          output[field.key],
          value,
          childDepth,
          context,
        );
        if (!merged.ok) {
          if (path !== undefined) {
            path.push(field.key, ...merged.path);
          }
          reject(
            state,
            report,
            "invalid_intersection",
            "compatible intersection value",
            merged.received,
          );
          if (report && path === undefined) {
            pushReversedSegments(state, merged.path);
            state.issue.path.push(field.key);
          }
          return FAILED;
        }
        output[field.key] = merged.value;
      } else {
        output[field.key] = value;
      }
    }
  }
  if (context && !target) {
    context.owned?.add(output);
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
  depth: number,
): unknown {
  if (!isPlainObject(input)) {
    return reject(state, report, "invalid_type", "record", input);
  }
  if (depth >= MAX_DEPTH) {
    return reject(state, report, "invalid_type", MAX_DEPTH_EXPECTED, input);
  }

  const path = state.path;
  const item = definition.value;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- PERF: Object.create(null) is typed `any`. The typed `{ __proto__: null }` literal made struct.parse 1.207-1.295x slower for a 1-key record and 1.212-1.225x for 8 nested 2-key records (Bun 1.4.4, two copies of each variant, 3 runs x 15 interleaved rounds x 3e5/6e4 parses, medians; the two Object.create copies differed by at most 1.025x); `{}` plus setPrototypeOf allocates slower still
  const output: { [key: string]: unknown } = Object.create(null);
  const childDepth = depth + 1;
  for (const key of Object.keys(input)) {
    path?.push(key);
    const value = parseNode(
      state,
      item,
      input[key],
      "field",
      report,
      childDepth,
    );
    if (value === FAILED) {
      if (report && path === undefined) {
        state.issue.path.push(key);
      }
      return FAILED;
    }
    path?.pop();
    if (value !== OMIT) {
      output[key] = value;
    }
  }
  // Nullable null never reaches a record parse. The object itself carries the struct that parsed it.
  if (state.context) {
    state.context.owned?.add(output);
    tagOwnNode(output, struct);
  }
  return output;
}

function parseTupleValue(
  state: ParseState,
  definition: TupleDefinition,
  input: unknown,
  report: boolean,
  depth: number,
): unknown {
  const items = definition.items;
  if (!Array.isArray(input) || input.length !== items.length) {
    return report
      ? reject(
          state,
          true,
          "invalid_type",
          `tuple of length ${items.length}`,
          input,
        )
      : FAILED;
  }
  if (depth >= MAX_DEPTH) {
    return reject(state, report, "invalid_type", MAX_DEPTH_EXPECTED, input);
  }

  const path = state.path;
  const output = new Array<unknown>(items.length);
  const childDepth = depth + 1;
  let index = 0;
  for (const item of items) {
    path?.push(index);
    const value = parseNode(
      state,
      item,
      input[index],
      "value",
      report,
      childDepth,
    );
    if (value === FAILED) {
      if (report && path === undefined) {
        state.issue.path.push(index);
      }
      return FAILED;
    }
    path?.pop();
    output[index] = value;
    index += 1;
  }
  return output;
}

function parseUnionValue(
  state: ParseState,
  definition: UnionDefinition,
  input: unknown,
  report: boolean,
  depth: number,
  provenance: Provenance | undefined,
): unknown {
  const context = state.context;
  const path = state.path;
  const reportCandidates = report && state.errorMap !== undefined;
  const savedLength = path?.length ?? 0;
  for (const option of definition.options) {
    const checkpoint = context?.changes?.length ?? 0;
    const value = parseNode(
      state,
      option,
      input,
      "value",
      reportCandidates,
      depth,
      provenance,
    );
    if (value !== FAILED) {
      return value;
    }
    if (context?.changes && context.guides) {
      restoreGuides(context.changes, context.guides, checkpoint);
    }
    // The failed candidate stopped wherever it failed. The next one starts at the union.
    if (path !== undefined) {
      path.length = savedLength;
    }
  }
  return reject(state, report, "invalid_union", definition.expected, input);
}

function parseDiscriminatedUnionValue(
  state: ParseState,
  definition: DiscriminatedUnionDefinition,
  input: unknown,
  report: boolean,
  depth: number,
): unknown {
  if (!isPlainObject(input)) {
    return reject(state, report, "invalid_type", "object", input);
  }

  // The tag is read once, here. With aliases every option may name it differently on the wire, so the first wire
  // name the input has decides, and the option that tag selects has to be the one that uses that name.
  const aliases = state.aliases;
  const key = aliases
    ? firstOwnKey(input, definition.discriminatorWireKeys)
    : Object.hasOwn(input, definition.discriminator)
      ? definition.discriminator
      : undefined;
  const tag = key === undefined ? undefined : input[key];
  const target = definition.map.get(tag);
  if (
    target === undefined ||
    (aliases && definition.wireKeyByValue.get(tag) !== key)
  ) {
    state.path?.push(definition.discriminator);
    reject(
      state,
      report,
      tag === undefined ? "missing_key" : "invalid_union",
      definition.expected,
      tag,
    );
    if (report && state.path === undefined) {
      state.issue.path.push(definition.discriminator);
    }
    return FAILED;
  }
  return parseObjectValue(
    state,
    target,
    target[DEFINITION],
    input,
    report,
    depth,
    key,
    tag,
  );
}

function firstOwnKey(
  input: { [key: string]: unknown },
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    if (Object.hasOwn(input, key)) {
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
  depth: number,
): unknown {
  const context = state.context;
  if (context) {
    context.owned ??= new WeakSet();
  }
  if (definition.objectSides && isPlainObject(input)) {
    const merged = nullObject();
    for (const side of definition.options) {
      const value = parseObjectValue(
        state,
        side,
        side[DEFINITION],
        input,
        report,
        depth,
        undefined,
        undefined,
        merged,
      );
      if (value === FAILED) {
        return FAILED;
      }
    }
    if (context) {
      context.owned?.add(merged);
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
    const value = parseNode(
      state,
      option,
      input,
      "value",
      report,
      depth,
      provenance,
    );
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
      depth,
      context,
    );
    if (!mergedValue.ok) {
      if (state.path !== undefined) {
        state.path.push(...mergedValue.path);
      }
      reject(
        state,
        report,
        "invalid_intersection",
        "compatible intersection value",
        mergedValue.received,
      );
      if (report && state.path === undefined) {
        pushReversedSegments(state, mergedValue.path);
      }
      return FAILED;
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
  if (context.owned?.has(value)) {
    tagOwnNode(value, next);
  } else {
    // any/unknown borrowed this reference. Keep its provenance in this parse, never on the caller's object.
    const guideMap = (context.guides ??= new WeakMap());
    const changes = (context.changes ??= []);
    changes.push([value, guideMap.get(value)]);
    guideMap.set(value, next);
  }
}
