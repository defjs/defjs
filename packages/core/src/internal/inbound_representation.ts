import type { RuntimeStruct } from "../struct/definition";
import { DEFINITION } from "../struct/symbols";
import type { StructLike } from "../struct/types";
import type { HttpResponseType } from "../http/http_request";

/**
 * Representation chosen from the struct kind.
 *
 * `string` is raw text, `blob` and `file` are blobs, `arrayBuffer` is bytes,
 * and every other kind is JSON. Those binary kinds apply to HTTP bodies and
 * SSE handshake error bodies. SSE event data keeps `string` raw and JSON-parses
 * every other kind. Optional and nullable are flags, so they keep the inner kind.
 */
export function resolveInboundRepresentation(
  struct: StructLike,
): HttpResponseType {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- INTENT: the public StructLike is a compile-time brand with no runtime members, while every struct the constructors build carries the definition RuntimeStruct describes, and making StructLike assignable to it would change the published type. Unasserted: TS2345, `StructLike` is not assignable to `RuntimeStruct`
  const kind = (struct as RuntimeStruct)[DEFINITION].kind;
  if (kind === "string") {
    return "text";
  }
  if (kind === "blob" || kind === "file") {
    return "blob";
  }
  if (kind === "arrayBuffer") {
    return "arraybuffer";
  }
  return "json";
}
