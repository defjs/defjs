import type { AnyStruct, Infer } from '../struct'
import { parseStructValue } from '../struct/introspection'
import type { StructInput } from '../struct/types'

export type EndpointInput<TInput extends AnyStruct | undefined> = TInput extends AnyStruct ? StructInput<TInput> : unknown

export type ParsedInput<TInput extends AnyStruct | undefined> = TInput extends AnyStruct ? Infer<TInput> : unknown

export async function parseEndpointInput<TInput extends AnyStruct | undefined>(
  struct: TInput,
  input: EndpointInput<TInput> | undefined,
): Promise<ParsedInput<TInput>> {
  if (!struct) {
    return input as ParsedInput<TInput>
  }

  return parseStructValue(struct, input, { tagObjects: true }) as ParsedInput<TInput>
}
