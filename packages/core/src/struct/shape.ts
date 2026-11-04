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
  for (const [key, value] of Object.entries(shape)) {
    assertStruct(value, `object field "${key}"`);
  }

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: finish every shape getter before validating any field, then cache and return that same validated object
  definition.cache.resolvedShape = shape as RuntimeObjectShape;
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: finish every shape getter before validating any field, then cache and return that same validated object
  return shape as RuntimeObjectShape;
}

export function readObjectShape(
  shape: ObjectShape,
  descriptors: PropertyDescriptorMap,
): { [key: string]: unknown } {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- PERF: literal/setPrototypeOf record allocation was 2.058/2.122/2.052x slower at four keys, 3 independent runs x 13 alternating pairs x 100000 iterations
  const output: { [key: string]: unknown } = Object.create(null);

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
