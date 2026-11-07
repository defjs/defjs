import { encodeValue } from "./encode";
import { runWithErrorMap, StructError, type ErrorMap } from "./errors";
import { resolveStructFields } from "./fields";
import { isStruct } from "./guards";
import type { Guide } from "./guide";
import { parseRootValue } from "./parse";
import { assertStruct } from "./shape";
import { DEFINITION } from "./symbols";
import type {
  ObjectStruct,
  ObjectShape,
  ParsedStructOutput,
  ParseResult,
  RuntimeStruct,
  StructLike,
} from "./types";

export interface StructField {
  readonly alias: string | undefined;
  readonly key: string;
  readonly struct: StructLike<unknown, unknown, boolean>;
}

export function isObjectStruct(
  value: unknown,
): value is ObjectStruct<ObjectShape> & RuntimeStruct {
  return isStruct(value) && value[DEFINITION].kind === "object";
}

export function getStructFields(
  struct: StructLike<unknown, unknown, boolean>,
): readonly StructField[] {
  assertStruct(struct, "struct");
  const definition = struct[DEFINITION];
  if (definition.kind !== "object") {
    throw new TypeError("object struct is required");
  }

  return Object.freeze(
    resolveStructFields(struct, definition).map((field) =>
      Object.freeze({
        alias: field.alias,
        key: field.key,
        struct: field.struct,
      }),
    ),
  );
}

export function encodeStructValue(
  struct: StructLike<unknown, unknown, boolean>,
  value: unknown,
): unknown {
  assertStruct(struct, "struct");
  return encodeValue(struct, value);
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
export function parseStructTuple<
  S extends StructLike<unknown, unknown, boolean>,
>(
  struct: S,
  value: unknown,
  options?: { aliases?: boolean; errorMap?: ErrorMap },
): ParseResult<S["_struct"]["output"]> {
  assertStruct(struct, "struct");
  return runWithErrorMap(options?.errorMap, () => {
    const result = parseRootValue(
      struct,
      value,
      "value",
      options?.aliases === true,
    );
    if (result.ok) {
      return [null, result.value];
    }
    return [new StructError([result.issue]), undefined];
  });
}

export function parseStructValue<
  S extends StructLike<unknown, unknown, boolean>,
  Tagged extends boolean = false,
>(
  struct: S,
  value: unknown,
  options?: {
    tagObjects?: Tagged;
    useAliases?: boolean;
    guides?: WeakMap<object, Guide>;
  },
): ParsedStructOutput<S, Tagged> {
  assertStruct(struct, "struct");
  const parsed = parseRuntimeValue(struct, value, options);
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: the parser builds this value at run time, while its type is the struct's compile-time-only `_struct` brand (Infer<S> or TaggedStructOutput<S>); no runtime value carries that brand, so it can only be attached here, the decoders' single typed boundary (codec decode and HTTP/SSE bodies call through it). Unasserted: TS2322, `unknown` is not assignable to `ParsedStructOutput<S, Tagged>`
  return parsed as ParsedStructOutput<S, Tagged>;
}

/** {@link parseStructValue} for a struct the caller already checked: the output is not typed from it. */
export function parseRuntimeValue(
  struct: RuntimeStruct,
  value: unknown,
  options?: {
    tagObjects?: boolean;
    useAliases?: boolean;
    guides?: WeakMap<object, Guide>;
  },
): unknown {
  const result = parseRootValue(
    struct,
    value,
    "value",
    options?.useAliases,
    options?.tagObjects === true,
    options?.guides,
  );
  if (!result.ok) {
    throw new StructError([result.issue]);
  }
  return result.value;
}
