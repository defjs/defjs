import { encodeValue } from "../src/struct/encode_by_struct";
import type { RuntimeStruct } from "../src/struct/definition";
import type { StructLike } from "../src/struct/types";

/** What a WebSocket send writes for an already parsed value, for specs that read the wire shape. */
export function encodeObjectByAlias(
  struct: StructLike,
  value: unknown,
): unknown {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: the public StructLike is a compile-time brand with no runtime members, while every struct the constructors build carries the definition RuntimeStruct describes, and making StructLike assignable to it would change the published type. Unasserted: TS2345, `StructLike` is not assignable to `RuntimeStruct`
  return encodeValue(struct as RuntimeStruct, value);
}
