import type { AnyStruct } from "../struct";
import type { Guide } from "../struct/guide";
import { parseStructValue } from "../struct/introspection";
import type { ParsedStructOutput, StructInput } from "../struct/types";

export type EndpointInput<TInput extends AnyStruct | undefined> =
  TInput extends AnyStruct ? StructInput<TInput> : unknown;

/** Validates operation input against the definition's input struct, tagging objects for the builder. */
export function parseEndpointInput<S extends AnyStruct>(
  struct: S,
  input: unknown,
  guides?: WeakMap<object, Guide>,
): ParsedStructOutput<S, true> {
  return parseStructValue(struct, input, {
    guides,
    tagObjects: true,
  });
}
