import { matchesRuntimeValue, selectUnionOptions } from "./match";
import { mapAliasedObjectFields, resolveStructFields } from "./fields";

export { matchesDefinition } from "./match";
import { resolveObjectShape } from "./shape";
import { DEFINITION } from "./symbols";
import type {
  ObjectDefinition,
  ObjectRuntimeStruct,
  RuntimeStruct,
} from "./types";
import {
  hasOwnKey,
  intersectionEncodeError,
  isIntersectionIdentity,
  isPlainObject,
  mergeIntersectionValues,
  nullObject,
  sameWireValue,
} from "./utils";

export interface EncodeOptions {
  encodeObject?: (
    struct: RuntimeStruct,
    value: { [key: string]: unknown },
    encodeChild: (struct: RuntimeStruct, value: unknown) => unknown,
  ) => unknown;
  selectUnionOptions?: typeof selectUnionOptions;
}

function sameEncodedShape(
  leftStruct: RuntimeStruct,
  leftValue: unknown,
  rightStruct: RuntimeStruct,
  rightValue: unknown,
  options: EncodeOptions,
): boolean {
  return sameWireValue(
    getComparableEncodedValue(leftStruct, leftValue, options),
    getComparableEncodedValue(rightStruct, rightValue, options),
  );
}

function getComparableEncodedValue(
  struct: RuntimeStruct,
  value: unknown,
  options: EncodeOptions,
): unknown {
  const definition = struct[DEFINITION];
  if (
    options.encodeObject &&
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
  options: EncodeOptions,
  output: { [key: string]: unknown },
  depth: number,
): void {
  const definition = struct[DEFINITION];
  if (options.encodeObject === mapAliasedObjectFields) {
    for (const field of resolveStructFields(struct, definition)) {
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
        encodeValue(field.struct, fieldValue, options, depth + 1),
        depth + 1,
      );
    }
    return;
  }

  const shape = resolveObjectShape(struct, definition);
  for (const key in shape) {
    const fieldStruct = shape[key];
    if (fieldStruct !== undefined && hasOwnKey(value, key)) {
      writeMergedWire(
        output,
        key,
        encodeValue(fieldStruct, value[key], options, depth + 1),
        depth + 1,
      );
    }
  }
}

function encodeObjectFields(
  struct: RuntimeStruct,
  definition: ObjectDefinition,
  value: { [key: string]: unknown },
  options: EncodeOptions,
  depth: number,
  output: { [key: string]: unknown } = nullObject(),
): { [key: string]: unknown } {
  const shape = resolveObjectShape(struct, definition);
  for (const key in shape) {
    const fieldStruct = shape[key];
    if (fieldStruct !== undefined && hasOwnKey(value, key)) {
      output[key] = encodeValue(fieldStruct, value[key], options, depth + 1);
    }
  }
  return output;
}

export function encodeValue(
  struct: RuntimeStruct,
  value: unknown,
  options: EncodeOptions = {},
  depth = 0,
): unknown {
  const definition = struct[DEFINITION];
  if (
    value === null &&
    (definition.kind === "null" || definition.flags.nullable)
  ) {
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
      return definition.encode ? definition.encode(value) : value;

    case "array":
      return Array.isArray(value)
        ? value.map((item) =>
            encodeValue(definition.item, item, options, depth + 1),
          )
        : value;

    case "tuple":
      return Array.isArray(value)
        ? value.map((item: unknown, index) => {
            // Items past the declared positions pass through.
            const itemStruct = definition.items[index];
            return itemStruct === undefined
              ? item
              : encodeValue(itemStruct, item, options, depth + 1);
          })
        : value;

    case "record": {
      if (!isPlainObject(value)) {
        return value;
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- PERF: Object.create(null) is typed `any`. The typed `{ __proto__: null }` literal made encodeStructValue of a 4-key record 1.083x/1.084x/1.083x and encodeJson of a 1-key record 1.131x/1.140x/1.134x slower (Bun 1.4.4, 3 runs x 21 interleaved rounds x 3e5/4e5 encodes, medians, against an unchanged control copy within 1.3%)
      const output: { [key: string]: unknown } = Object.create(null);
      for (const [key, entry] of Object.entries(value)) {
        output[key] = encodeValue(definition.value, entry, options, depth + 1);
      }
      return output;
    }

    case "object": {
      if (!isPlainObject(value)) {
        return value;
      }
      if (options.encodeObject) {
        return options.encodeObject(struct, value, (fieldStruct, fieldValue) =>
          encodeValue(fieldStruct, fieldValue, options, depth + 1),
        );
      }
      return encodeObjectFields(struct, definition, value, options, depth);
    }

    case "or": {
      if (
        !options.encodeObject &&
        !options.selectUnionOptions &&
        definition.uniformIdentityEncode
      ) {
        for (const option of definition.options) {
          const runtime = option;
          if (matchesRuntimeValue(runtime, value)) {
            return encodeValue(runtime, value, options, depth);
          }
        }
        return value;
      }

      const selectOptions = options.selectUnionOptions ?? selectUnionOptions;
      const matches = selectOptions(definition.options, value);
      const firstOption = matches[0];
      if (!firstOption) {
        return value;
      }

      const first = encodeValue(firstOption, value, options, depth);
      for (const option of matches.slice(1)) {
        const encoded = encodeValue(option, value, options, depth);
        if (!sameEncodedShape(firstOption, first, option, encoded, options)) {
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
          return encodeValue(matched, value, options, depth);
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
        return encodeValue(first, value, options, depth);
      }

      // Each member encodes on its own. One logical key can leave under every wire key it declares.
      // Disjoint keys stay one assignment. A key that is already present is merged, not overwritten.
      // Object sides are never intersection identities, so they are exactly `parts`.
      if (
        definition.objectSides &&
        (!options.encodeObject ||
          options.encodeObject === mapAliasedObjectFields) &&
        isPlainObject(value)
      ) {
        const output = nullObject();
        for (const side of definition.options) {
          writeObjectFieldsMerged(side, value, options, output, depth);
        }
        return output;
      }

      let merged: unknown = encodeValue(first, value, options, depth);
      for (const part of parts.slice(1)) {
        const encoded = encodeValue(part, value, options, depth);
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
