import { mapAliasedObjectFields, resolveStructFields } from "./fields";
import { selectUnionOptions } from "./match";
import { DEFINITION } from "./symbols";
import type { ObjectRuntimeStruct, RuntimeStruct } from "./types";
import {
  hasOwnKey,
  intersectionEncodeError,
  isIntersectionIdentity,
  isPlainObject,
  mergeIntersectionValues,
  nullObject,
  sameWireValue,
} from "./utils";

function sameEncodedShape(
  leftStruct: RuntimeStruct,
  leftValue: unknown,
  rightStruct: RuntimeStruct,
  rightValue: unknown,
): boolean {
  return sameWireValue(
    getComparableEncodedValue(leftStruct, leftValue),
    getComparableEncodedValue(rightStruct, rightValue),
  );
}

function getComparableEncodedValue(
  struct: RuntimeStruct,
  value: unknown,
): unknown {
  const definition = struct[DEFINITION];
  if (
    definition.alias &&
    (definition.kind === "array" || definition.kind === "object")
  ) {
    return { alias: definition.alias, value };
  }
  return value;
}

function writeMergedWire(
  output: { [key: string]: unknown },
  key: string,
  encoded: unknown,
  depth: number,
): void {
  if (!hasOwnKey(output, key)) {
    output[key] = encoded;
    return;
  }
  const merged = mergeIntersectionValues(output[key], encoded, false, depth);
  if (!merged.ok) {
    throw intersectionEncodeError([key, ...merged.path]);
  }
  output[key] = merged.value;
}

function writeObjectFieldsMerged(
  struct: ObjectRuntimeStruct,
  value: { [key: string]: unknown },
  output: { [key: string]: unknown },
  depth: number,
): void {
  for (const field of resolveStructFields(struct, struct[DEFINITION])) {
    if (!hasOwnKey(value, field.key)) {
      continue;
    }
    const fieldValue = value[field.key];
    if (typeof fieldValue === "undefined") {
      continue;
    }
    writeMergedWire(
      output,
      field.wireKey,
      encodeValue(field.struct, fieldValue, depth + 1),
      depth + 1,
    );
  }
}

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

/** Walks a value by its struct and writes every object under its wire keys. */
export function encodeValue(
  struct: RuntimeStruct,
  value: unknown,
  depth = 0,
): unknown {
  const definition = struct[DEFINITION];
  if (value === null && definition.flags.nullable) {
    return null;
  }
  if (typeof value === "undefined" && definition.flags.optional) {
    return undefined;
  }

  switch (definition.kind) {
    case "any":
    case "unknown":
    case "null":
    case "enum":
    case "literal":
      return value;

    case "arrayBuffer":
    case "bigint":
    case "blob":
    case "boolean":
    case "date":
    case "file":
    case "number":
    case "string":
      return coerceWireLeaf(value);

    case "array":
      return Array.isArray(value)
        ? value.map((item) => encodeValue(definition.item, item, depth + 1))
        : value;

    case "tuple":
      return Array.isArray(value)
        ? value.map((item: unknown, index) => {
            // Items past the declared positions pass through.
            const itemStruct = definition.items[index];
            return itemStruct === undefined
              ? item
              : encodeValue(itemStruct, item, depth + 1);
          })
        : value;

    case "record": {
      if (!isPlainObject(value)) {
        return value;
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- PERF: Object.create(null) is typed `any`. The typed `{ __proto__: null }` literal made encodeStructValue of a 4-key record 1.083x/1.084x/1.083x and encodeJson of a 1-key record 1.131x/1.140x/1.134x slower (Bun 1.4.4, 3 runs x 21 interleaved rounds x 3e5/4e5 encodes, medians, against an unchanged control copy within 1.3%)
      const output: { [key: string]: unknown } = Object.create(null);
      for (const [key, entry] of Object.entries(value)) {
        output[key] = encodeValue(definition.value, entry, depth + 1);
      }
      return output;
    }

    case "object": {
      if (!isPlainObject(value)) {
        return value;
      }
      return mapAliasedObjectFields(
        struct,
        definition,
        value,
        (fieldStruct, fieldValue) =>
          encodeValue(fieldStruct, fieldValue, depth + 1),
      );
    }

    case "or": {
      const matches = selectUnionOptions(definition.options, value);
      const firstOption = matches[0];
      if (!firstOption) {
        return value;
      }

      const first = encodeValue(firstOption, value, depth);
      for (const option of matches.slice(1)) {
        const encoded = encodeValue(option, value, depth);
        if (!sameEncodedShape(firstOption, first, option, encoded)) {
          throw new TypeError(
            "ambiguous union encode: multiple union branches match with different wire output",
          );
        }
      }
      return first;
    }

    case "discriminatedUnion": {
      if (isPlainObject(value)) {
        const matched = definition.map.get(value[definition.discriminator]);
        if (matched) {
          return encodeValue(matched, value, depth);
        }
      }
      return value;
    }

    case "intersection": {
      const parts: RuntimeStruct[] = [];
      for (const option of definition.options) {
        const runtime = option;
        if (!isIntersectionIdentity(runtime)) {
          parts.push(runtime);
        }
      }
      const first = parts[0];
      if (first === undefined) {
        return value;
      }
      if (parts.length === 1) {
        return encodeValue(first, value, depth);
      }

      // Each member encodes on its own. One logical key can leave under every wire key it declares.
      // Disjoint keys stay one assignment. A key that is already present is merged, not overwritten.
      // Object sides are never intersection identities, so they are exactly `parts`.
      if (definition.objectSides && isPlainObject(value)) {
        const output = nullObject();
        for (const side of definition.options) {
          writeObjectFieldsMerged(side, value, output, depth);
        }
        return output;
      }

      let merged: unknown = encodeValue(first, value, depth);
      for (const part of parts.slice(1)) {
        const encoded = encodeValue(part, value, depth);
        const result = mergeIntersectionValues(merged, encoded, false, depth);
        if (!result.ok) {
          throw intersectionEncodeError(result.path);
        }
        merged = result.value;
      }
      return merged;
    }
  }
}
