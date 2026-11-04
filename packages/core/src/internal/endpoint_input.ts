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
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: preserve raw input passthrough for every falsy schema and the existing optional-schema generic contract
    return input as ParsedInput<TInput>;
  }

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: retain the original parsed-input contract without a definition-time capture wrapper or a second request parser
  return parseStructValue(struct, input, {
    guides,
    tagObjects: true,
  }) as ParsedInput<TInput>;
}
