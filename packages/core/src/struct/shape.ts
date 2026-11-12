import type {
  ObjectDefinition,
  ResolvedStructField,
  RuntimeStruct,
} from "./definition";
import { isStruct } from "./guards";
import { DEFINITION } from "./symbols";

/** The fields as `[key, struct]` pairs in key order. Getters run once, on the first call for this object struct. */
export function resolveObjectShapeEntries(
  definition: ObjectDefinition,
): readonly (readonly [key: string, struct: RuntimeStruct])[] {
  const cached = definition.cache.entries;
  if (cached) {
    return cached;
  }

  const entries: (readonly [key: string, struct: RuntimeStruct])[] = [];
  for (const [key, descriptor] of Object.entries(
    definition.cache.declaredDescriptors,
  )) {
    const value: unknown =
      typeof descriptor.get === "function"
        ? descriptor.get.call(definition.shape)
        : descriptor.value;
    assertStruct(value, `object field "${key}"`);
    entries.push([key, value]);
  }
  definition.cache.entries = entries;
  return entries;
}

export function resolveStructFields(
  definition: ObjectDefinition,
): readonly ResolvedStructField[] {
  const cached = definition.cache.fields;
  if (cached) {
    return cached;
  }

  const fields = Object.freeze(
    resolveObjectShapeEntries(definition).map(([key, struct]) =>
      Object.freeze({
        key,
        struct,
        wireKey: struct[DEFINITION].alias ?? key,
      }),
    ),
  );

  assertUniqueWireKeys(fields);
  definition.cache.fields = fields;
  return fields;
}

function assertUniqueWireKeys(fields: readonly ResolvedStructField[]): void {
  const seen = new Map<string, string>();
  for (const field of fields) {
    if (seen.has(field.wireKey)) {
      const previous = seen.get(field.wireKey);
      throw new TypeError(
        `duplicate wire key "${field.wireKey}" for object fields "${previous}" and "${field.key}"`,
      );
    }
    seen.set(field.wireKey, field.key);
  }
}

export function assertStruct(
  value: unknown,
  label: string,
): asserts value is RuntimeStruct {
  if (!isStruct(value)) {
    throw new TypeError(`${label} must be a struct`);
  }
}

/** Asserts every element in order, throwing for the first one that is not a struct. */
export function assertStructs(
  values: readonly unknown[],
  label: string,
): asserts values is readonly RuntimeStruct[] {
  for (const value of values) {
    assertStruct(value, label);
  }
}
