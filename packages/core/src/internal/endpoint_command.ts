import type { AnyStruct } from '../struct'
import type { EndpointInput } from './endpoint_input'

export type IsEndpointInputOptional<TInput extends AnyStruct | undefined> = [TInput] extends [undefined]
  ? true
  : undefined extends EndpointInput<TInput>
    ? true
    : false

export type EndpointCallable<TInput extends AnyStruct | undefined, TCommand> = [TInput] extends [undefined]
  ? () => TCommand
  : IsEndpointInputOptional<TInput> extends true
    ? (input?: EndpointInput<TInput>) => TCommand
    : (input: EndpointInput<TInput>) => TCommand
