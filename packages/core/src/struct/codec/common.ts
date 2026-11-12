import { encodeValue } from "../encode";
import { mapAliasedObjectFields } from "../fields";
import { parseStructValue } from "../introspection";
import { assertStruct } from "../shape";
import { DEFINITION } from "../symbols";
import type { AnyStructLike, Infer, RuntimeStruct } from "../types";

export function encodeObjectByAlias(
  struct: AnyStructLike,
  value: unknown,
  label = "json",
  depth = 0,
): unknown {
  assertStruct(struct, "struct");
  return encodeAliasedStruct(struct, value, label, depth);
}

/** {@link encodeObjectByAlias} for a struct the caller already checked. */
export function encodeAliasedStruct(
  struct: RuntimeStruct,
  value: unknown,
  label: string,
  depth: number,
): unknown {
  const definition = struct[DEFINITION];
  // `.nullable()` and `.optional()` keep kind `object`, so nullish has to win before the object assertion.
  if (value === null && definition.flags.nullable) {
    return null;
  }
  if (typeof value === "undefined" && definition.flags.optional) {
    return undefined;
  }

  if (definition.kind !== "object") {
    return encodeValue(struct, value, depth);
  }

  assertPlainObject(value, `${label} encode expects object value`);

  return mapAliasedObjectFields(
    struct,
    definition,
    value,
    (fieldStruct, fieldValue) =>
      encodeAliasedStruct(fieldStruct, fieldValue, label, depth + 1),
  );
}

export function decodeObjectByAlias<S extends AnyStructLike>(
  struct: S,
  value: unknown,
): Infer<S> {
  return parseStructValue(struct, value, { useAliases: true });
}

export function assertPlainObject(
  value: unknown,
  message: string,
): asserts value is { [key: string]: unknown } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(message);
  }
}
