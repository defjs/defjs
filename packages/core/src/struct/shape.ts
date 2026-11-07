import { isStruct } from "./guards";
import type {
  ObjectDefinition,
  ObjectShape,
  RuntimeStruct,
  RuntimeObjectShape,
} from "./types";

export function resolveObjectShape(
  _struct: RuntimeStruct,
  definition: ObjectDefinition,
): RuntimeObjectShape {
  const cached = definition.cache.resolvedShape;
  if (cached) {
    return cached;
  }

  const shape = readObjectShape(
    definition.shape,
    definition.cache.declaredDescriptors,
  );
  assertShapeFields(shape);

  definition.cache.resolvedShape = shape;
  return shape;
}

/** The resolved shape as `[key, struct]` pairs in key order, built once per object struct. */
export function resolveObjectShapeEntries(
  struct: RuntimeStruct,
  definition: ObjectDefinition,
): readonly (readonly [key: string, struct: RuntimeStruct])[] {
  return (definition.cache.shapeEntries ??= Object.entries(
    resolveObjectShape(struct, definition),
  ));
}

function assertShapeFields(shape: {
  [key: string]: unknown;
}): asserts shape is RuntimeObjectShape {
  for (const [key, value] of Object.entries(shape)) {
    assertStruct(value, `object field "${key}"`);
  }
}

export function readObjectShape(
  shape: ObjectShape,
  descriptors: PropertyDescriptorMap,
): { [key: string]: unknown } {
  const output: { [key: string]: unknown } = { __proto__: null };

  for (const [key, descriptor] of Object.entries(descriptors)) {
    const value: unknown =
      typeof descriptor.get === "function"
        ? descriptor.get.call(shape)
        : descriptor.value;
    output[key] = value;
  }

  return output;
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
