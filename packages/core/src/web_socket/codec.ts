import type { AnyStruct, Infer } from "../struct";
import type { StructLike } from "../struct/types";
import { decodeBytes, readBytesText } from "../internal/bytes";
import { rejectNonJson } from "../internal/outbound_request";
import { encodeValue } from "../struct/encode_by_struct";
import { parseRuntimeValue, parseStructValue } from "../struct/parse";
import { toRuntimeStruct } from "../struct/shape";

export function serializeOutgoingWebSocketMessage(
  outgoing: AnyStruct | undefined,
  message: unknown,
): string {
  if (!outgoing) {
    throw new Error(
      "No outgoing WebSocket messages are declared for this endpoint",
    );
  }

  // PERF: the shared outbound encoder (a tagging parse, then encodeOutbound) measured 4% to 28% slower on one send: Bun 1.4.4
  // +7.5% on a number, +16% on a nested object, +4% on a union; Node 26.13 +21%, +28%, +17% (seven interleaved runs each).
  const runtime = toRuntimeStruct(outgoing);
  // Same guard as an HTTP JSON body: non-finite numbers, functions, symbols and non-plain objects throw.
  const wire = JSON.stringify(
    encodeValue(runtime, parseRuntimeValue(runtime, message)),
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

/** Synchronous for text and bytes. Only a Blob frame has to be read first. */
export function decodeWebSocketMessage<S extends StructLike>(
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

function decodeWebSocketText<S extends StructLike>(
  incoming: S,
  text: string | undefined,
): Infer<S> | undefined {
  return text === undefined
    ? undefined
    : parseStructValue(incoming, JSON.parse(text), { aliases: true });
}

export interface WebSocketCloseSnapshot {
  cause?: unknown;
  code?: number;
  reason?: string;
  wasClean?: boolean;
}

export function extractCloseInfo(event: {
  code: number;
  reason: string;
  wasClean: boolean;
}): WebSocketCloseSnapshot {
  return {
    code: event.code,
    reason: event.reason,
    wasClean: event.wasClean,
  };
}
