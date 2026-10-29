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
): value is ObjectStruct<ObjectShape> {
  return (
    isStruct(value) && (value as RuntimeStruct)[DEFINITION].kind === "object"
  );
}

export function getStructFields(
  struct: StructLike<unknown, unknown, boolean>,
): readonly StructField[] {
  assertStruct(struct, "struct");
  const runtime = struct as unknown as RuntimeStruct;
  const definition = runtime[DEFINITION];
  if (definition.kind !== "object") {
    throw new TypeError("object struct is required");
  }

  return Object.freeze(
    resolveStructFields(runtime, definition).map((field) =>
      Object.freeze({
        alias: field.alias,
        key: field.key,
        struct: field.struct as unknown as StructLike<
          unknown,
          unknown,
          boolean
        >,
      }),
    ),
  );
}

export function encodeStructValue(
  struct: StructLike<unknown, unknown, boolean>,
  value: unknown,
): unknown {
  assertStruct(struct, "struct");
  return encodeValue(struct as unknown as RuntimeStruct, value);
}

/**
 * Parses an unknown value with a struct and returns an error-first tuple.
 *
 * - **struct** is the struct to parse with. A value that is not a struct throws `TypeError`.
 *
 * - **value** is the unknown input.
 *
 * - **options.aliases** defaults to `false`: object keys are read by their **logical** names (`displayName`). With `true` they are read by their wire names (`display_name`), the way HTTP/JSON codecs read them. The output always uses logical names.
 *
 * - **options.errorMap** is an {@link ErrorMap} that rewrites issue messages for this call only, including bigint/date conversion failures from a struct created by another Core copy. Any string, including `''`, replaces the message; only `undefined` keeps the default. Custom text is used verbatim.
 *
 * - Parsing is fail-fast: it stops at the first failure, so the error holds one issue. Unknown object keys are stripped from the output, and the input is not modified.
 *
 * - At most **256 nested containers** (`object`, `array`, `record`, or `tuple`) are visited along a path, counting the root container as the first. The next container fails with `invalid_type` at its logical path, with `expected: 'value nested at most 256 levels deep'`. In a union, later candidates may still succeed; if none match, the union reports `invalid_union`. Cycles through declared container fields also reach this limit; shared non-cyclic children are allowed. Union and intersection branches do not add a container level, and `any`/`unknown` values remain opaque rather than being traversed.
 *
 * ```ts
 * const [error, user] = struct.parse(User, { id: 1, displayName: "Ada" });
 * if (error) return console.error(error.prettify());
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
  const runtime = struct as unknown as RuntimeStruct;
  return runWithErrorMap(options?.errorMap, () => {
    const result = parseRootValue(
      runtime,
      value,
      "value",
      options?.aliases === true,
    );
    if (result.ok) {
      return [null, result.value as unknown as S["_struct"]["output"]];
    }
    return [new StructError([result.issue]), undefined];
  });
}

export function parseStructValue(
  struct: StructLike<unknown, unknown, boolean>,
  value: unknown,
  options?: {
    tagObjects?: boolean;
    useAliases?: boolean;
    guides?: WeakMap<object, Guide>;
  },
): unknown {
  assertStruct(struct, "struct");
  const result = parseRootValue(
    struct as unknown as RuntimeStruct,
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
