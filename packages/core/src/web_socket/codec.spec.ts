import { describe, expect, test } from 'vitest'
import { ERR_ABORTED, ERR_TIMEOUT } from '../error'
import { resolveAbortCause } from '../internal/abort'
import { StructError, struct } from '../struct'
import { decodeWebSocketMessage, extractCloseInfo, serializeOutgoingWebSocketMessage, transformWebSocketMessage } from './codec'

describe('codec helpers', () => {
  test('extractCloseInfo extracts from CloseEvent', () => {
    const event = { code: 1000, reason: 'normal', wasClean: true } as CloseEvent
    const info = extractCloseInfo(event, new Error('cause'))
    expect(info).toEqual({ cause: new Error('cause'), code: 1000, reason: 'normal', wasClean: true })
  })

  test('extractCloseInfo handles undefined event', () => {
    const info = extractCloseInfo(undefined)
    expect(info).toEqual({ code: undefined, reason: undefined, wasClean: undefined })
  })

  test('resolveAbortCause returns undefined when not aborted', () => {
    const signal = new AbortController().signal
    expect(resolveAbortCause(signal)).toBeUndefined()
  })

  test('resolveAbortCause returns ERR_ABORTED for manual close', () => {
    const controller = new AbortController()
    controller.abort({ kind: 'manual-web-socket-close' })
    const cause = resolveAbortCause(controller.signal)
    expect(cause).toBe(ERR_ABORTED)
  })

  test('resolveAbortCause returns ERR_TIMEOUT for timeout reason', () => {
    const controller = new AbortController()
    controller.abort(ERR_TIMEOUT)
    const cause = resolveAbortCause(controller.signal)
    expect(cause).toBe(ERR_TIMEOUT)
  })

  test('resolveAbortCause returns ERR_ABORTED for ERR_ABORTED reason', () => {
    const controller = new AbortController()
    controller.abort(ERR_ABORTED)
    const cause = resolveAbortCause(controller.signal)
    expect(cause).toBe(ERR_ABORTED)
  })

  test('resolveAbortCause classifies an explicit abort with a string reason as ABORTED', () => {
    const controller = new AbortController()
    controller.abort('some reason')
    const cause = resolveAbortCause(controller.signal)
    expect(cause).toBe(ERR_ABORTED)
  })

  test('resolveAbortCause handles DOMException timeout', () => {
    const controller = new AbortController()
    controller.abort(new DOMException('timeout', 'TimeoutError'))
    const cause = resolveAbortCause(controller.signal)
    expect(cause).toBe(ERR_TIMEOUT)
  })

  test('resolveAbortCause falls back to ERR_ABORTED when reason is undefined', () => {
    const signal = Object.create(AbortSignal.prototype)
    Object.defineProperty(signal, 'aborted', { value: true })
    Object.defineProperty(signal, 'reason', { value: undefined })
    const cause = resolveAbortCause(signal as AbortSignal)
    expect(cause).toBe(ERR_ABORTED)
  })

  test('resolveAbortCause treats a plain Error with a timeout-like message as ABORTED', () => {
    const controller = new AbortController()
    controller.abort(new Error(ERR_TIMEOUT.message))
    const cause = resolveAbortCause(controller.signal)
    expect(cause).toBe(ERR_ABORTED)
  })
})

describe('serializeOutgoingWebSocketMessage', () => {
  const outgoing = struct.object({
    text: struct.string().alias('message_text'),
    type: struct.literal('message'),
  })

  test('throws when the endpoint declares no outgoing struct', () => {
    expect(() => serializeOutgoingWebSocketMessage(undefined, { text: 'hello', type: 'message' })).toThrow(
      'No outgoing WebSocket messages are declared for this endpoint',
    )
  })

  test('encodes aliases before JSON.stringify', () => {
    expect(serializeOutgoingWebSocketMessage(outgoing, { text: 'hello', type: 'message' })).toBe(
      '{"message_text":"hello","type":"message"}',
    )
  })

  test('throws when the outgoing value does not match the struct', () => {
    expect(() => serializeOutgoingWebSocketMessage(outgoing, { text: 123, type: 'message' })).toThrow(StructError)
  })

  test('rejects an outgoing value whose JSON serialization is undefined', () => {
    expect(() => serializeOutgoingWebSocketMessage(struct.string().optional(), undefined)).toThrow(
      new TypeError('Outgoing WebSocket message has no JSON representation'),
    )
  })

  test('encodes a nullable object field as JSON null', () => {
    const profile = struct.object({ name: struct.string().alias('display_name') })
    const outgoing = struct.object({ profile: profile.nullable() })

    expect(serializeOutgoingWebSocketMessage(outgoing, { profile: null })).toBe('{"profile":null}')
    expect(serializeOutgoingWebSocketMessage(outgoing, { profile: { name: 'N' } })).toBe('{"profile":{"display_name":"N"}}')
  })
})

describe('transformWebSocketMessage', () => {
  const incoming = struct.object({
    text: struct.string().alias('message_text'),
    type: struct.literal('message'),
  })

  test('returns undefined for frames that are not text', async () => {
    await expect(transformWebSocketMessage(incoming, 123)).resolves.toBeUndefined()
    await expect(transformWebSocketMessage(incoming, null)).resolves.toBeUndefined()
    await expect(transformWebSocketMessage(incoming, undefined)).resolves.toBeUndefined()
    await expect(transformWebSocketMessage(incoming, { type: 'message' })).resolves.toBeUndefined()
  })

  test('rejects invalid JSON', async () => {
    await expect(transformWebSocketMessage(incoming, 'not json')).rejects.toBeInstanceOf(SyntaxError)
  })

  test('decodes a text frame with aliases', async () => {
    await expect(transformWebSocketMessage(incoming, '{"message_text":"hello","type":"message"}')).resolves.toEqual({
      text: 'hello',
      type: 'message',
    })
  })

  test('decodes an ArrayBuffer frame', async () => {
    const buffer = new TextEncoder().encode('{"message_text":"hello","type":"message"}').buffer
    await expect(transformWebSocketMessage(incoming, buffer)).resolves.toEqual({ text: 'hello', type: 'message' })
  })

  test('decodes a Uint8Array frame', async () => {
    const bytes = new TextEncoder().encode('{"message_text":"hello","type":"message"}')
    await expect(transformWebSocketMessage(incoming, bytes)).resolves.toEqual({ text: 'hello', type: 'message' })
  })

  test('decodes a DataView frame', async () => {
    const bytes = new TextEncoder().encode('{"message_text":"hello","type":"message"}')
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    await expect(transformWebSocketMessage(incoming, view)).resolves.toEqual({ text: 'hello', type: 'message' })
  })

  test('decodes a Blob frame', async () => {
    const blob = new Blob(['{"message_text":"hello","type":"message"}'])
    await expect(transformWebSocketMessage(incoming, blob)).resolves.toEqual({ text: 'hello', type: 'message' })
  })

  test('rejects a text frame that fails the incoming struct', async () => {
    await expect(transformWebSocketMessage(incoming, '{"message_text":1,"type":"message"}')).rejects.toBeInstanceOf(StructError)
  })

  test('rejects a Blob frame that fails the incoming struct', async () => {
    const blob = new Blob(['{"type":"other"}'])
    await expect(transformWebSocketMessage(incoming, blob)).rejects.toBeInstanceOf(StructError)
  })
})

describe('decodeWebSocketMessage', () => {
  const incoming = struct.object({
    text: struct.string().alias('message_text'),
    type: struct.literal('message'),
  })
  const json = '{"message_text":"hello","type":"message"}'
  const decoded = { text: 'hello', type: 'message' }

  // Junk before and after the frame: a decoder that ignores the view's window reads it and fails to parse.
  function windowed(text: string, createView: (buffer: ArrayBuffer, offset: number, byteLength: number) => ArrayBufferView) {
    const bytes = new TextEncoder().encode(text)
    const padding = 8
    const buffer = new ArrayBuffer(padding + bytes.length + padding)
    new Uint8Array(buffer).fill(0x7a)
    new Uint8Array(buffer, padding, bytes.length).set(bytes)
    return createView(buffer, padding, bytes.length)
  }

  test.each([
    ['text', () => json],
    ['ArrayBuffer', () => new TextEncoder().encode(json).buffer],
    ['Uint8Array', () => new TextEncoder().encode(json)],
    ['DataView', () => new DataView(new TextEncoder().encode(json).buffer)],
  ])('should decode %s frames without waiting', (_kind, createFrame) => {
    expect(decodeWebSocketMessage(incoming, createFrame())).toEqual(decoded)
  })

  test('should return a promise only for a Blob frame', async () => {
    const result = decodeWebSocketMessage(incoming, new Blob([json]))

    expect(result).toBeInstanceOf(Promise)
    await expect(result).resolves.toEqual(decoded)
  })

  test.each([
    ['Uint8Array', (buffer: ArrayBuffer, offset: number, byteLength: number) => new Uint8Array(buffer, offset, byteLength)],
    ['DataView', (buffer: ArrayBuffer, offset: number, byteLength: number) => new DataView(buffer, offset, byteLength)],
    // Two bytes per element: the window is measured in bytes, not elements.
    ['Uint16Array', (buffer: ArrayBuffer, offset: number, byteLength: number) => new Uint16Array(buffer, offset, byteLength / 2)],
  ])('should decode only the window of a %s view', (_kind, createView) => {
    // The two-byte view needs an even byte length. A trailing space pads it, and JSON ignores it.
    const frame = windowed(json.length % 2 === 0 ? json : `${json} `, createView)

    expect(decodeWebSocketMessage(incoming, frame)).toEqual(decoded)
  })

  test('should throw at once when a text or byte frame cannot be decoded', () => {
    expect(() => decodeWebSocketMessage(incoming, 'not json')).toThrow(SyntaxError)
    expect(() => decodeWebSocketMessage(incoming, '{"message_text":1,"type":"message"}')).toThrow(StructError)
    expect(() => decodeWebSocketMessage(incoming, new TextEncoder().encode('{"type":"other"}'))).toThrow(StructError)
  })

  test('should reject, not throw, when a Blob frame cannot be decoded', async () => {
    const result = decodeWebSocketMessage(incoming, new Blob(['not json']))

    await expect(result).rejects.toBeInstanceOf(SyntaxError)
  })

  test.each([123, null, undefined, { type: 'message' }])('should return undefined for the frame %j, which carries no text', (frame) => {
    expect(decodeWebSocketMessage(incoming, frame)).toBeUndefined()
  })
})
