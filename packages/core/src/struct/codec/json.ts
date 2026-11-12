import { parseStructValue } from "../parse";
import type { StructLike, Infer } from "../types";
import { encodeObjectByAlias } from "./common";

export function encodeJson(struct: StructLike, value: unknown): unknown {
  return encodeObjectByAlias(struct, value, "json");
}

export function decodeJson<S extends StructLike>(
  struct: S,
  value: unknown,
): Infer<S> {
  return parseStructValue(struct, value, { aliases: true });
}
