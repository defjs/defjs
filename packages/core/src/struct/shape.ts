import type {
  ObjectDefinition,
  ResolvedStructField,
  RuntimeStruct,
} from "./definition";
import { isStruct } from "./guards";
import { DEFINITION } from "./symbols";
import type { StructLike } from "./types";

/** The fields as `[key, struct]` pairs in key order. Getters run once, on the first call for this object struct. */
export function resolveObjectShapeEntries(
  definition: ObjectDefinition,
): readonly (readonly [key: string, struct: RuntimeStruct])[] {
  const cached = definition.cache.entries;
  if (cached) {
    return cached;
  }

  // Every getter runs before any value is checked, so a getter that throws wins over an invalid field before it.
  const read: [key: string, value: unknown][] = [];
  for (const [key, descriptor] of Object.entries(
    definition.cache.declaredDescriptors,
  )) {
    read.push([
      key,
      typeof descriptor.get === "function"
        ? descriptor.get.call(definition.shape)
        : descriptor.value,
    ]);
  }

  const entries: (readonly [key: string, struct: RuntimeStruct])[] = [];
  for (const [key, value] of read) {
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

/**
 * The runtime view of a struct the types already vouch for. Library code that receives a declared struct reads
 * its definition through this instead of checking it again on every call.
 */
export function toRuntimeStruct(struct: StructLike): RuntimeStruct {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: the public StructLike is a compile-time brand with no runtime members, while every struct the constructors build carries the definition RuntimeStruct describes. Unasserted: TS2322, `StructLike` is not assignable to `RuntimeStruct`
  return struct as RuntimeStruct;
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
