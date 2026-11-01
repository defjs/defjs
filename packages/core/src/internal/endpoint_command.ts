import type { AnyStruct } from "../struct";
import type { StructInput } from "../struct/types";

/** Argument list after the client, decided by the input struct. */
export type EndpointArgs<S extends AnyStruct | undefined> = [S] extends [
  undefined,
]
  ? []
  : undefined extends StructInput<S>
    ? [input?: StructInput<S>]
    : [input: StructInput<S>];
