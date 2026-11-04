import type { AnyStruct, Infer } from "../struct";
import type { AnyStructLike } from "../struct/types";
import { decodeBytes, readBytesText } from "../internal/bytes";
import { rejectNonJson } from "../internal/outbound_request";
import { decodeJson, encodeJson } from "../struct/codec/json";
import { parseStructValue } from "../struct/introspection";

export function serializeOutgoingWebSocketMessage(
  outgoing: AnyStruct | undefined,
  message: unknown,
): string {
  if (!outgoing) {
    throw new Error(
      "No outgoing WebSocket messages are declared for this endpoint",
    );
  }

  // Same guard as an HTTP JSON body: non-finite numbers, functions, symbols and non-plain objects throw.
  const wire = JSON.stringify(
    encodeJson(outgoing, parseStructValue(outgoing, message)),
    (key, value: unknown) =>
      rejectNonJson(key, value, "Outgoing WebSocket message"),
  );
  // JSON.stringify(undefined) is undefined, and the socket would send the text "undefined".
  if (typeof wire !== "string") {
    throw new TypeError(
      "Outgoing WebSocket message has no JSON representation",
    );
  }
  return wire;
}

export async function transformWebSocketMessage<S extends AnyStructLike>(
  incoming: S,
  raw: unknown,
): Promise<Infer<S> | undefined> {
  return await decodeWebSocketMessage(incoming, raw);
}

/** Synchronous for text and bytes. Only a Blob frame has to be read first. */
export function decodeWebSocketMessage<S extends AnyStructLike>(
  incoming: S,
  raw: unknown,
): Infer<S> | undefined | Promise<Infer<S> | undefined> {
  if (typeof Blob !== "undefined" && raw instanceof Blob) {
    return raw
      .arrayBuffer()
      .then((bytes) => decodeWebSocketText(incoming, decodeBytes(bytes)));
  }
  return decodeWebSocketText(incoming, readBytesText(raw));
}

function decodeWebSocketText<S extends AnyStructLike>(
  incoming: S,
  text: string | undefined,
): Infer<S> | undefined {
  return text === undefined
    ? undefined
    : decodeJson(incoming, JSON.parse(text));
}

export interface WebSocketCloseSnapshot {
  cause?: unknown;
  code?: number;
  reason?: string;
  wasClean?: boolean;
}

export function extractCloseInfo(
  event?: {
    code?: number;
    reason?: string;
    wasClean?: boolean;
  },
  cause?: unknown,
): WebSocketCloseSnapshot {
  return {
    cause,
    code: event?.code,
    reason: event?.reason,
    wasClean: event?.wasClean,
  };
}
