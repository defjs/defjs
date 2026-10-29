import { matchesRuntimeValue, selectUnionOptions } from "./match";
import { mapAliasedObjectFields, resolveStructFields } from "./fields";

export { matchesDefinition } from "./match";
import { resolveObjectShape } from "./shape";
import { DEFINITION } from "./symbols";
import type { ObjectDefinition, RuntimeStruct } from "./types";
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
  struct: RuntimeStruct,
  value: { [key: string]: unknown },
  options: EncodeOptions,
  output: { [key: string]: unknown },
  depth: number,
): void {
  const definition = struct[DEFINITION] as ObjectDefinition;
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
    if (hasOwnKey(value, key)) {
      writeMergedWire(
        output,
        key,
        encodeValue(
          shape[key] as RuntimeStruct,
          value[key],
          options,
          depth + 1,
        ),
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
    if (hasOwnKey(value, key)) {
      output[key] = encodeValue(
        shape[key] as RuntimeStruct,
        value[key],
        options,
        depth + 1,
      );
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
      return definition.encode ? definition.encode(value as never) : value;

    case "array":
      return Array.isArray(value)
        ? value.map((item) =>
            encodeValue(
              definition.item as unknown as RuntimeStruct,
              item,
              options,
              depth + 1,
            ),
          )
        : value;

    case "tuple":
      return Array.isArray(value)
        ? value.map((item, index) =>
            index < definition.items.length
              ? encodeValue(
                  definition.items[index] as unknown as RuntimeStruct,
                  item,
                  options,
                  depth + 1,
                )
              : item,
          )
        : value;

    case "record": {
      if (!isPlainObject(value)) {
        return value;
      }
      const output: { [key: string]: unknown } = Object.create(null);
      for (const [key, entry] of Object.entries(value)) {
        output[key] = encodeValue(
          definition.value as unknown as RuntimeStruct,
          entry,
          options,
          depth + 1,
        );
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
          const runtime = option as unknown as RuntimeStruct;
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
      for (let index = 1; index < matches.length; index += 1) {
        const option = matches[index] as RuntimeStruct;
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
        const matched = definition.map.get(
          (value as { [key: string]: unknown })[definition.discriminator],
        );
        if (matched) {
          return encodeValue(
            matched as unknown as RuntimeStruct,
            value,
            options,
            depth,
          );
        }
      }
      return value;
    }

    case "intersection": {
      const parts: RuntimeStruct[] = [];
      for (const option of definition.options) {
        const runtime = option as RuntimeStruct;
        if (!isIntersectionIdentity(runtime)) {
          parts.push(runtime);
        }
      }
      if (parts.length === 0) {
        return value;
      }
      if (parts.length === 1) {
        const only = parts[0] as RuntimeStruct;
        return encodeValue(only, value, options, depth);
      }

      // Each member encodes on its own. One logical key can leave under every wire key it declares.
      // Disjoint keys stay one assignment. A key that is already present is merged, not overwritten.
      if (
        definition.objectSides &&
        (!options.encodeObject ||
          options.encodeObject === mapAliasedObjectFields) &&
        isPlainObject(value)
      ) {
        const output = nullObject();
        for (const runtime of parts) {
          writeObjectFieldsMerged(runtime, value, options, output, depth);
        }
        return output;
      }

      let merged: unknown = encodeValue(
        parts[0] as RuntimeStruct,
        value,
        options,
        depth,
      );
      for (let index = 1; index < parts.length; index += 1) {
        const encoded = encodeValue(
          parts[index] as RuntimeStruct,
          value,
          options,
          depth,
        );
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
