import { encodeValue } from "../encode";
import { mapAliasedObjectFields } from "../fields";

import { isObjectStruct, parseStructValue } from "../introspection";
import { DEFINITION } from "../symbols";
import type { AnyStructLike, Infer, RuntimeStruct } from "../types";

export { mapAliasedObjectFields } from "../fields";

export const ALIAS_ENCODE_OPTIONS = { encodeObject: mapAliasedObjectFields };

export function encodeObjectByAlias(
  struct: AnyStructLike,
  value: unknown,
  label = "json",
  depth = 0,
): unknown {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: retain the original metadata reads, object-guard sequence and native invalid-input errors; do not add an early struct validator
  const definition = (struct as RuntimeStruct)[DEFINITION];
  // `.nullable()` and `.optional()` keep kind `object`, so nullish has to win before the object assertion.
  if (value === null && definition.flags.nullable) {
    return null;
  }
  if (typeof value === "undefined" && definition.flags.optional) {
    return undefined;
  }

  if (!isObjectStruct(struct)) {
    return encodeAliasedField(struct, value, label, depth);
  }

  assertPlainObject(value, `${label} encode expects object value`);

  return mapAliasedObjectFields(
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: retain the original metadata reads, object-guard sequence and native invalid-input errors; do not add an early struct validator
    struct as unknown as RuntimeStruct,
    value,
    (fieldStruct, fieldValue) =>
      encodeAliasedField(fieldStruct, fieldValue, label, depth + 1),
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

function encodeAliasedField(
  struct: AnyStructLike,
  value: unknown,
  label: string,
  depth: number,
): unknown {
  if (isObjectStruct(struct)) {
    return encodeObjectByAlias(struct, value, label, depth);
  }

  return encodeValue(
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: retain the original metadata reads, object-guard sequence and native invalid-input errors; do not add an early struct validator
    struct as unknown as RuntimeStruct,
    value,
    ALIAS_ENCODE_OPTIONS,
    depth,
  );
}
