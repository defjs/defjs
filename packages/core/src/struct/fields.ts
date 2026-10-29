import { resolveObjectShape } from "./shape";
import { DEFINITION } from "./symbols";
import { hasOwnKey, nullObject } from "./utils";
import type { ObjectDefinition, RuntimeStruct } from "./types";

export interface ResolvedStructField {
  readonly alias: string | undefined;
  readonly key: string;
  readonly struct: RuntimeStruct;
  readonly wireKey: string;
}

export function resolveStructFields(
  struct: RuntimeStruct,
  definition: ObjectDefinition,
): readonly ResolvedStructField[] {
  const cached = definition.cache.fields;
  if (cached) {
    return cached;
  }

  const shape =
    definition.cache.resolvedShape ?? resolveObjectShape(struct, definition);
  const fields = Object.freeze(
    Object.entries(shape).map(([key, field]) => {
      const runtime = field as unknown as RuntimeStruct;
      const alias = runtime[DEFINITION].alias;
      return Object.freeze({
        alias,
        key,
        struct: runtime,
        wireKey: alias ?? key,
      });
    }),
  );

  assertUniqueWireKeys(fields);
  definition.cache.fields = fields;
  return fields;
}

function assertUniqueWireKeys(fields: readonly ResolvedStructField[]): void {
  const seen = new Map<string, string>();
  for (const field of fields) {
    if (seen.has(field.wireKey)) {
      const previous = seen.get(field.wireKey) as string;
      throw new TypeError(
        `duplicate wire key "${field.wireKey}" for object fields "${previous}" and "${field.key}"`,
      );
    }
    seen.set(field.wireKey, field.key);
  }
}

export function mapAliasedObjectFields(
  struct: RuntimeStruct,
  value: { [key: string]: unknown },
  encodeChild: (struct: RuntimeStruct, value: unknown) => unknown,
  output: { [key: string]: unknown } = nullObject(),
): { [key: string]: unknown } {
  const definition = struct[DEFINITION];
  if (definition.kind !== "object") {
    throw new TypeError("json encode expects object struct");
  }

  for (const field of resolveStructFields(struct, definition)) {
    if (!hasOwnKey(value, field.key)) {
      continue;
    }

    const fieldValue = value[field.key];
    if (typeof fieldValue === "undefined") {
      continue;
    }

    output[field.wireKey] = encodeChild(field.struct, fieldValue);
  }

  return output;
}
