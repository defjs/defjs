import {
  MAX_DEPTH,
  type EnumDefinition,
  type ObjectDefinition,
  type RuntimeStruct,
} from "./definition";
import { isPlainObject } from "./plain_object";
import { resolveObjectShapeEntries } from "./shape";
import { DEFINITION } from "./symbols";

export function selectUnionOptions(
  options: readonly RuntimeStruct[],
  value: unknown,
): RuntimeStruct[] {
  const matches: RuntimeStruct[] = [];
  for (const option of options) {
    if (matchesRuntimeValue(option, value)) {
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
        matchesObjectValue(definition, value, depth)
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
        !Object.hasOwn(value, definition.discriminator)
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
  definition: ObjectDefinition,
  value: { [key: string]: unknown },
  depth: number,
): boolean {
  for (const [key, field] of resolveObjectShapeEntries(definition)) {
    if (!Object.hasOwn(value, key)) {
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

export function matchesEnum(
  definition: EnumDefinition<string | number>,
  value: unknown,
): boolean {
  // One-shot schemas avoid allocating a Set. A second lookup pays for the reusable index.
  if (definition.valueSet === undefined) {
    definition.valueSet = null;
    const values: readonly unknown[] = definition.values;
    return values.includes(value);
  }
  const valueSet: ReadonlySet<unknown> = (definition.valueSet ??= new Set(
    definition.values,
  ));
  return valueSet.has(value);
}
