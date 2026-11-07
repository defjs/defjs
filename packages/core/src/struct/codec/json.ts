import type { AnyStructLike, Infer } from "../types";
import { decodeObjectByAlias, encodeObjectByAlias } from "./common";

export function encodeJson(struct: AnyStructLike, value: unknown): unknown {
  return encodeObjectByAlias(struct, value, "json");
}

export function decodeJson<S extends AnyStructLike>(
  struct: S,
  value: unknown,
): Infer<S> {
  return decodeObjectByAlias(struct, value);
}
