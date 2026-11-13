import type { AnyStruct } from "../struct";
import type { Guide } from "../struct/guide";
import { parseStructValue } from "../struct/parse";
import type { ParsedStructOutput, StructInput } from "../struct/types";

export type EndpointInput<TInput extends AnyStruct | undefined> =
  TInput extends AnyStruct ? StructInput<TInput> : unknown;

/** Argument list after the client, decided by the input struct. */
export type EndpointArgs<S extends AnyStruct | undefined> = [S] extends [
  undefined,
]
  ? []
  : undefined extends StructInput<S>
    ? [input?: StructInput<S>]
    : [input: StructInput<S>];

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
