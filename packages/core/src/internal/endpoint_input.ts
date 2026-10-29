import type { AnyStruct, Infer } from "../struct";
import type { Guide } from "../struct/guide";
import { parseStructValue } from "../struct/introspection";
import type { StructInput } from "../struct/types";

export type EndpointInput<TInput extends AnyStruct | undefined> =
  TInput extends AnyStruct ? StructInput<TInput> : unknown;

export type ParsedInput<TInput extends AnyStruct | undefined> =
  TInput extends AnyStruct ? Infer<TInput> : unknown;

export function parseEndpointInput<TInput extends AnyStruct | undefined>(
  struct: TInput | undefined,
  input: EndpointInput<TInput> | undefined,
  guides?: WeakMap<object, Guide>,
): ParsedInput<TInput> {
  if (!struct) {
    return input as ParsedInput<TInput>;
  }

  return parseStructValue(struct, input, {
    guides,
    tagObjects: true,
  }) as ParsedInput<TInput>;
}
