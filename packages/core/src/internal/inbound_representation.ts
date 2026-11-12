import { toRuntimeStruct } from "../struct/shape";
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
  const kind = toRuntimeStruct(struct)[DEFINITION].kind;
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
