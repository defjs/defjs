import type { AnyStruct } from "../struct";
import { DEFINITION } from "../struct/symbols";
import type { RuntimeStruct } from "../struct/types";
import type { HttpResponseType } from "./http_request";

/**
 * Representation chosen from the struct kind.
 *
 * `string` is raw text, `blob` and `file` are blobs, `arrayBuffer` is bytes,
 * and every other kind is JSON. Those binary kinds apply to HTTP bodies and
 * SSE handshake error bodies. SSE event data keeps `string` raw and JSON-parses
 * every other kind. Optional and nullable are flags, so they keep the inner kind.
 */
export function resolveInboundRepresentation(
  struct: AnyStruct,
): HttpResponseType {
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
