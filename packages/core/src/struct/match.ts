import { resolveObjectShapeEntries } from "./shape";
import { DEFINITION } from "./symbols";
import type { ObjectDefinition, RuntimeStruct } from "./types";
import { hasOwnKey, isPlainObject, matchesEnum, MAX_DEPTH } from "./utils";

export function selectUnionOptions(
  options: readonly RuntimeStruct[],
  value: unknown,
  depth = 0,
): RuntimeStruct[] {
  const matches: RuntimeStruct[] = [];
  for (const option of options) {
    if (matchesRuntimeValue(option, value, depth)) {
      matches.push(option);
    }
  }
  return matches;
}

export function matchesRuntimeValue(
  struct: RuntimeStruct,
  value: unknown,
  depth = 0,
): boolean {
  const definition = struct[DEFINITION];
  if (value === null) {
    if (definition.flags.nullable) {
      return true;
    }
    if (definition.kind !== "intersection" && definition.kind !== "or") {
      return false;
    }
  }
  if (typeof value === "undefined") {
    return definition.flags.optional;
  }

  switch (definition.kind) {
    case "any":
    case "unknown":
      return true;
    case "arrayBuffer":
    case "bigint":
    case "blob":
    case "boolean":
    case "date":
    case "file":
    case "null":
    case "number":
    case "string":
      return (definition.runtimeIs ?? definition.is)(value);
    case "literal":
      return Object.is(value, definition.value);
    case "enum":
      return matchesEnum(definition, value);
    case "array":
      return (
        depth < MAX_DEPTH &&
        Array.isArray(value) &&
        value.every((item) =>
          matchesRuntimeValue(definition.item, item, depth + 1),
        )
      );
    case "tuple":
      return (
        depth < MAX_DEPTH &&
        Array.isArray(value) &&
        value.length === definition.items.length &&
        definition.items.every((item, index) =>
          matchesRuntimeValue(item, value[index], depth + 1),
        )
      );
    case "object":
      return (
        depth < MAX_DEPTH &&
        isPlainObject(value) &&
        matchesObjectValue(struct, definition, value, depth)
      );
    case "record":
      return (
        depth < MAX_DEPTH &&
        isPlainObject(value) &&
        Object.keys(value).every((key) =>
          matchesRuntimeValue(definition.value, value[key], depth + 1),
        )
      );
    case "or":
      return definition.options.some((option) =>
        matchesRuntimeValue(option, value, depth),
      );
    case "discriminatedUnion": {
      if (
        !isPlainObject(value) ||
        !hasOwnKey(value, definition.discriminator)
      ) {
        return false;
      }
      const target = definition.map.get(value[definition.discriminator]);
      return target ? matchesRuntimeValue(target, value, depth) : false;
    }
    case "intersection":
      return definition.options.every((option) =>
        matchesRuntimeValue(option, value, depth),
      );
  }
}

function matchesObjectValue(
  struct: RuntimeStruct,
  definition: ObjectDefinition,
  value: { [key: string]: unknown },
  depth: number,
): boolean {
  for (const [key, field] of resolveObjectShapeEntries(struct, definition)) {
    if (!hasOwnKey(value, key)) {
      if (!field[DEFINITION].flags.optional) {
        return false;
      }
      continue;
    }

    if (!matchesRuntimeValue(field, value[key], depth + 1)) {
      return false;
    }
  }

  return true;
}
