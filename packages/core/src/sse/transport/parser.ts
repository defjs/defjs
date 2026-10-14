import { awaitWithSignal } from '../../internal/abort'

export interface EventStreamMessage {
  id: string
  event: string
  data: string
}

export class SSEParserLimitError extends Error {
  constructor() {
    super('SSE parser buffer exceeded maxBufferSize')
    this.name = 'SSEParserLimitError'
  }
}

export async function readStreamBytes(
  stream: ReadableStream<Uint8Array>,
  onChunk: (chunk: Uint8Array) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const reader = stream.getReader()
  try {
    for (;;) {
      const read = () => reader.read()
      const result = signal ? await awaitWithSignal(read, signal) : await read()
      if (result.done) return
      await onChunk(result.value)
    }
  } catch (error) {
    void reader.cancel(error).catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }
}

export interface LineParserOptions {
  maxBufferSize?: number
}

/** Split byte chunks at the WHATWG SSE CR, LF and CRLF line boundaries. */
export function createLineParser(
  onLine: (line: Uint8Array) => void | Promise<void>,
  options?: LineParserOptions,
): (chunk: Uint8Array) => Promise<void> {
  const limit = validateMaxBufferSize(options?.maxBufferSize)
  let parts: Uint8Array[] = []
  let byteLength = 0
  let afterCR = false

  function append(part: Uint8Array): void {
    byteLength += part.length
    if (limit !== undefined && byteLength > limit) throw new SSEParserLimitError()
    parts.push(part)
  }

  return async (chunk) => {
    let start = 0
    for (let cursor = 0; cursor < chunk.length; cursor += 1) {
      const byte = chunk[cursor]
      if (afterCR) {
        afterCR = false
        if (byte === 10) {
          start = cursor + 1
          continue
        }
      }
      if (byte !== 10 && byte !== 13) continue

      const segment = chunk.subarray(start, cursor)
      append(segment)
      let line = segment
      if (parts.length > 1) {
        line = new Uint8Array(byteLength)
        let offset = 0
        for (const part of parts) {
          line.set(part, offset)
          offset += part.length
        }
      }
      parts = []
      byteLength = 0
      afterCR = byte === 13
      start = cursor + 1
      const pending = onLine(line)
      if (pending) await pending
    }
    if (start < chunk.length) append(chunk.subarray(start))
  }
}

export interface MessageParserOptions {
  maxBufferSize?: number
}

/** Interpret SSE fields and dispatch only when a blank line ends a data-bearing event. */
export function createMessageParser(
  onId: (id: string) => void,
  onRetry: (retry: number) => void,
  onMessage?: (message: EventStreamMessage) => void | Promise<void>,
  options?: MessageParserOptions,
): (line: Uint8Array) => void | Promise<void> {
  const limit = validateMaxBufferSize(options?.maxBufferSize)
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true })
  let firstLine = true
  let id = ''
  let event = ''
  let data = ''
  let dataBytes = 0

  return (line) => {
    let content = line
    if (firstLine) {
      firstLine = false
      if (line[0] === 0xef && line[1] === 0xbb && line[2] === 0xbf) content = line.subarray(3)
    }
    if (content.length === 0) {
      const message = data === '' ? undefined : { id, event, data: data.slice(0, -1) }
      event = ''
      data = ''
      dataBytes = 0
      return message ? onMessage?.(message) : undefined
    }

    const separator = content.indexOf(58)
    const field = decoder.decode(separator < 0 ? content : content.subarray(0, separator))
    let valueStart = separator < 0 ? content.length : separator + 1
    if (content[valueStart] === 32) valueStart += 1
    const value = decoder.decode(content.subarray(valueStart))

    switch (field) {
      case 'data':
        dataBytes += content.length - valueStart + 1
        if (limit !== undefined && dataBytes > limit) throw new SSEParserLimitError()
        data += `${value}\n`
        break
      case 'event':
        event = value
        break
      case 'id':
        if (!value.includes('\0')) {
          id = value
          onId(value)
        }
        break
      case 'retry':
        if (/^[0-9]+$/.test(value)) onRetry(Math.min(Number(value), 2_147_483_647))
        break
    }
  }
}

function validateMaxBufferSize(value: number | undefined): number | undefined {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) {
    throw new TypeError('SSE maxBufferSize must be a positive safe integer')
  }
  return value
}
