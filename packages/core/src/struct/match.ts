import { resolveObjectShape } from "./shape";
import { DEFINITION } from "./symbols";
import type { RuntimeStruct, StructDefinition, StructLike } from "./types";
import { hasOwnKey, isPlainObject, matchesEnum, MAX_DEPTH } from "./utils";

export function matchesRuntimeValue(
  struct: RuntimeStruct,
  value: unknown,
  depth = 0,
): boolean {
  return matchesDefinition(struct[DEFINITION], value, struct, depth);
}

export function selectUnionOptions(
  options: readonly StructLike<unknown, unknown, boolean>[],
  value: unknown,
  depth = 0,
): RuntimeStruct[] {
  const matches: RuntimeStruct[] = [];
  for (const option of options) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: keep original live field and metadata reads without new validation or cached key/value snapshots
    const runtime = option as unknown as RuntimeStruct;
    if (matchesRuntimeValue(runtime, value, depth)) {
      matches.push(runtime);
    }
  }
  return matches;
}

export function matchesDefinition(
  definition: StructDefinition,
  value: unknown,
  struct: RuntimeStruct,
  depth = 0,
): boolean {
  if (value === null) {
    if (definition.kind === "null" || definition.flags.nullable) {
      return true;
    }
    if (
      (definition.kind !== "literal" || definition.value !== null) &&
      definition.kind !== "intersection" &&
      definition.kind !== "or"
    ) {
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
        matchesObjectValue(struct, value, depth)
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
  value: { [key: string]: unknown },
  depth: number,
): boolean {
  const definition = struct[DEFINITION];
  if (definition.kind !== "object") {
    return true;
  }

  const shape = resolveObjectShape(struct, definition);
  for (const key in shape) {
    const fieldStruct = shape[key];
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: keep original live field and metadata reads without new validation or cached key/value snapshots
    const field = fieldStruct as unknown as RuntimeStruct;
    const fieldDefinition = field[DEFINITION];
    if (!hasOwnKey(value, key)) {
      if (isRequiredField(fieldDefinition)) {
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

function isRequiredField(definition: StructDefinition): boolean {
  return !definition.flags.optional;
}
