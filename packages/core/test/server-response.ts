import { type IncomingMessage, ServerResponse } from "node:http";
import { isRecord } from "./narrow";

function isServerResponse(
  value: unknown,
): value is ServerResponse<IncomingMessage> {
  return value instanceof ServerResponse;
}

/** Node-only: keep it out of `narrow.ts`, which browser specs import. */
export function serverResponse(env: unknown): ServerResponse<IncomingMessage> {
  if (!isRecord(env)) throw new TypeError("Expected node HTTP bindings");
  const outgoing = env["outgoing"];
  if (!isServerResponse(outgoing)) {
    throw new TypeError("Expected a server response");
  }
  return outgoing;
}
