import type { AnyStruct } from "../struct";
import { DEFINITION } from "../struct/symbols";
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
  struct: AnyStruct,
): HttpResponseType {
  // Definitions are not validated when declared, so a non-struct output or error fails here. An inherited definition counts.
  const definition: unknown = Reflect.get(struct, DEFINITION);
  if (typeof definition !== "object" || definition === null) {
    throw new TypeError("struct must be a struct");
  }
  const kind: unknown = Reflect.get(definition, "kind");
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
