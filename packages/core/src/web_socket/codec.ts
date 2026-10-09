import type { AnyStruct } from '../struct'
import { decodeBytes, readBytesText } from '../internal/bytes'
import { decodeJson, encodeJson } from '../struct/codec/json'
import { parseStructValue } from '../struct/introspection'

export function serializeOutgoingWebSocketMessage(outgoing: AnyStruct | undefined, message: unknown): string {
  if (!outgoing) {
    throw new Error('No outgoing WebSocket messages are declared for this endpoint')
  }

  const wire = JSON.stringify(encodeJson(outgoing, parseStructValue(outgoing, message)))
  // JSON.stringify(undefined) is undefined, and the socket would send the text "undefined".
  if (typeof wire !== 'string') {
    throw new TypeError('Outgoing WebSocket message has no JSON representation')
  }
  return wire
}

export async function transformWebSocketMessage(incoming: AnyStruct, raw: unknown): Promise<unknown> {
  return await decodeWebSocketMessage(incoming, raw)
}

/** Synchronous for text and bytes. Only a Blob frame has to be read first. */
export function decodeWebSocketMessage(incoming: AnyStruct, raw: unknown): unknown {
  if (typeof Blob !== 'undefined' && raw instanceof Blob) {
    return raw.arrayBuffer().then((bytes) => decodeWebSocketText(incoming, decodeBytes(bytes)))
  }
  return decodeWebSocketText(incoming, readBytesText(raw))
}

function decodeWebSocketText(incoming: AnyStruct, text: string | undefined): unknown {
  return text === undefined ? undefined : decodeJson(incoming, JSON.parse(text))
}

export interface WebSocketCloseSnapshot {
  cause?: unknown
  code?: number
  reason?: string
  wasClean?: boolean
}

export function extractCloseInfo(event?: CloseEvent, cause?: unknown): WebSocketCloseSnapshot {
  return {
    cause,
    code: event?.code,
    reason: event?.reason,
    wasClean: event?.wasClean,
  }
}
