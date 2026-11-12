import { encodeValue } from "../src/struct/encode_by_struct";
import { toRuntimeStruct } from "../src/struct/shape";
import type { StructLike } from "../src/struct/types";

/** What a WebSocket send writes for an already parsed value, for specs that read the wire shape. */
export function encodeObjectByAlias(
  struct: StructLike,
  value: unknown,
): unknown {
  return encodeValue(toRuntimeStruct(struct), value);
}
