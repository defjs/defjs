import { describe, expect, test, vi } from 'vitest'
import type { EventStreamMessage } from './parser'
import { createLineParser, createMessageParser, readStreamBytes } from './parser'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const noop = () => {
  /* intentionally empty */
}

function settleWithin<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('operation did not settle')), 100)
    promise.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

async function parseEvents(
  source: string,
  options: { lineLimit?: number; messageLimit?: number } = {},
): Promise<{ ids: string[]; messages: EventStreamMessage[]; retries: number[] }> {
  const ids: string[] = []
  const retries: number[] = []
  const messages: EventStreamMessage[] = []
  const maxBufferSize = options.messageLimit ?? 1024
  const parseMessage = createMessageParser(
    ids.push.bind(ids),
    retries.push.bind(retries),
    (message) => {
      messages.push(message)
    },
    { maxBufferSize },
  )
  const parseLine = createLineParser(parseMessage, { maxBufferSize: options.lineLimit ?? 1024 })

  await parseLine(encoder.encode(source))
  return { ids, messages, retries }
}

describe('sse parser', () => {
  test('should read stream bytes chunk by chunk', async () => {
    const chunks = ['first', 'second', 'third'].map((value) => encoder.encode(value))
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk)
        }
        controller.close()
      },
    })

    const seen: string[] = []
    await readStreamBytes(stream, async (chunk) => {
      seen.push(decoder.decode(chunk))
    })

    expect(seen).toEqual(['first', 'second', 'third'])
  })

  test('should release reader lock on error', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('ok'))
        controller.close()
      },
    })

    await expect(
      readStreamBytes(stream, () => {
        throw new Error('fail')
      }),
    ).rejects.toThrow('fail')

    // stream should be unlocked so we can get a new reader
    expect(() => stream.getReader()).not.toThrow()
  })

  test('should cancel upstream once with the original callback error', async () => {
    const error = new Error('parse failed')
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data'))
      },
      cancel,
    })

    await expect(
      readStreamBytes(stream, () => {
        throw error
      }),
    ).rejects.toBe(error)

    expect(cancel).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledWith(error)
    expect(() => stream.getReader()).not.toThrow()
  })

  test('should preserve the callback error when upstream cancellation rejects', async () => {
    const error = new Error('parse failed')
    const cancel = vi.fn(() => Promise.reject(new Error('cancel failed')))
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data'))
      },
      cancel,
    })

    await expect(
      readStreamBytes(stream, () => {
        throw error
      }),
    ).rejects.toBe(error)

    expect(cancel).toHaveBeenCalledOnce()
    expect(() => stream.getReader()).not.toThrow()
  })

  test('should not wait for upstream cancellation after a callback error', async () => {
    const error = new Error('parse failed')
    const cancel = vi.fn(() => new Promise<void>(() => undefined))
    const stream = new ReadableStream<Uint8Array>({
      cancel,
      start(controller) {
        controller.enqueue(encoder.encode('data'))
      },
    })

    await expect(
      settleWithin(
        readStreamBytes(stream, () => {
          throw error
        }),
      ),
    ).rejects.toBe(error)

    expect(cancel).toHaveBeenCalledExactlyOnceWith(error)
    expect(() => stream.getReader()).not.toThrow()
  })

  test('should not wait for upstream cancellation after abort', async () => {
    const reason = new DOMException('owner stopped', 'AbortError')
    const cancel = vi.fn(() => new Promise<void>(() => undefined))
    const stream = new ReadableStream<Uint8Array>({ cancel })
    const controller = new AbortController()
    const pending = readStreamBytes(stream, noop, controller.signal)

    controller.abort(reason)

    await expect(settleWithin(pending)).rejects.toBe(reason)
    expect(cancel).toHaveBeenCalledExactlyOnceWith(reason)
    expect(() => stream.getReader()).not.toThrow()
  })

  test('should cancel a pre-aborted stream with the original reason before reading', async () => {
    const reason = new DOMException('owner already stopped', 'AbortError')
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({ cancel })
    const controller = new AbortController()
    controller.abort(reason)

    await expect(readStreamBytes(stream, noop, controller.signal)).rejects.toBe(reason)

    expect(cancel).toHaveBeenCalledExactlyOnceWith(reason)
    expect(() => stream.getReader()).not.toThrow()
  })

  test('should release reader lock after normal completion', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('ok'))
        controller.close()
      },
      cancel,
    })

    await readStreamBytes(stream, noop)

    expect(() => stream.getReader()).not.toThrow()
    expect(cancel).not.toHaveBeenCalled()
  })

  test('should handle abort without reason gracefully', async () => {
    let enqueueTimeout: ReturnType<typeof setTimeout> | undefined
    let closeTimeout: ReturnType<typeof setTimeout> | undefined

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        enqueueTimeout = setTimeout(() => controller.enqueue(encoder.encode('ok')), 50)
        closeTimeout = setTimeout(() => controller.close(), 100)
      },
      cancel() {
        clearTimeout(enqueueTimeout)
        clearTimeout(closeTimeout)
      },
    })

    const abortController = new AbortController()
    setTimeout(() => abortController.abort(), 10)

    await expect(readStreamBytes(stream, noop, abortController.signal)).rejects.toMatchObject({ name: 'AbortError' })

    expect(() => stream.getReader()).not.toThrow()
  })

  test('should parse split lines and crlf correctly', async () => {
    const lines: Array<{ fieldLength: number; line: string }> = []
    const parseLine = createLineParser(async (line, fieldLength) => {
      lines.push({
        fieldLength,
        line: decoder.decode(line),
      })
    })

    await parseLine(encoder.encode('data: hel'))
    await parseLine(encoder.encode('lo\r\nid: 1\r'))
    await parseLine(encoder.encode('\n\r\n'))

    expect(lines).toEqual([
      { fieldLength: 4, line: 'data: hello' },
      { fieldLength: 2, line: 'id: 1' },
      { fieldLength: -1, line: '' },
    ])
  })

  test('should parse message fields, ids and retry values', async () => {
    const ids: string[] = []
    const retries: number[] = []
    const messages: EventStreamMessage[] = []
    const parseMessage = createMessageParser(
      (id) => {
        ids.push(id)
      },
      (retry) => {
        retries.push(retry)
      },
      async (message) => {
        messages.push(message)
      },
    )
    const parseLine = createLineParser(parseMessage)

    await parseLine(encoder.encode('id: 1\nretry: 500\nevent: update\ndata: line 1\ndata: line 2\n\n'))

    expect(ids).toEqual(['1'])
    expect(retries).toEqual([500])
    expect(messages).toEqual([
      {
        id: '1',
        event: 'update',
        data: 'line 1\nline 2',
      },
    ])
  })

  test('should keep json-looking data as raw string at parser boundary', async () => {
    const messages: EventStreamMessage[] = []
    const parseMessage = createMessageParser(noop, noop, async (message) => {
      messages.push(message)
    })
    const parseLine = createLineParser(parseMessage)

    await parseLine(encoder.encode('event: profile\ndata: {"display_name":"Miao"}\n\n'))

    expect(messages).toEqual([
      {
        id: '',
        event: 'profile',
        data: '{"display_name":"Miao"}',
      },
    ])
  })

  test('should ignore comments malformed retry and lines without field', async () => {
    const ids: string[] = []
    const retries: number[] = []
    const messages: EventStreamMessage[] = []
    const parseMessage = createMessageParser(
      (id) => {
        ids.push(id)
      },
      (retry) => {
        retries.push(retry)
      },
      async (message) => {
        messages.push(message)
      },
    )
    const parseLine = createLineParser(parseMessage)

    await parseLine(encoder.encode(': comment\nretry: nope\nevent\ndata: ok\n\n'))

    expect(ids).toEqual([])
    expect(retries).toEqual([])
    expect(messages).toEqual([
      {
        id: '',
        event: '',
        data: 'ok',
      },
    ])
  })

  test('should match field names as bytes, skip one leading BOM, and ignore near misses', async () => {
    const { ids, messages, retries } = await parseEvents('ix: 1\ndat4: x\nevenx: y\nretrx: 5\n\uFEFFdata: bom\n\n')

    expect(ids).toEqual([])
    expect(retries).toEqual([])
    expect(messages).toEqual([{ id: '', event: '', data: 'bom' }])
  })

  test('should not dispatch messages for frames without data fields', async () => {
    const ids: string[] = []
    const retries: number[] = []
    const messages: EventStreamMessage[] = []
    const parseMessage = createMessageParser(
      (id) => {
        ids.push(id)
      },
      (retry) => {
        retries.push(retry)
      },
      async (message) => {
        messages.push(message)
      },
    )
    const parseLine = createLineParser(parseMessage)

    await parseLine(encoder.encode(': comment\n\n'))
    await parseLine(encoder.encode('event: ping\n\n'))
    await parseLine(encoder.encode('retry: 500\n\n'))
    await parseLine(encoder.encode('id: 1\n\n'))

    expect(ids).toEqual(['1'])
    expect(retries).toEqual([500])
    expect(messages).toEqual([])
  })

  test('should handle partial line across chunks with non-zero line start', async () => {
    const messages: EventStreamMessage[] = []
    const parseMessage = createMessageParser(noop, noop, async (message) => {
      messages.push(message)
    })
    const parseLine = createLineParser(parseMessage)

    // First chunk: complete line + partial line (with colon so fieldLength > 0)
    await parseLine(encoder.encode('data: hello\ndata: in'))
    // Second chunk: complete the partial line
    await parseLine(encoder.encode('complete\n\n'))

    expect(messages).toEqual([
      {
        id: '',
        event: '',
        data: 'hello\nincomplete',
      },
    ])
  })

  test('should handle crlf line endings and discard trailing newlines', async () => {
    const messages: EventStreamMessage[] = []
    const parseMessage = createMessageParser(noop, noop, async (message) => {
      messages.push(message)
    })
    const parseLine = createLineParser(parseMessage)

    // CRLF line endings: \r\n triggers discardTrailingNewline, then next \n is skipped
    await parseLine(encoder.encode('data: hello\r\n\r\n'))

    expect(messages).toEqual([
      {
        id: '',
        event: '',
        data: 'hello',
      },
    ])
  })

  test('should handle field with space after colon', async () => {
    const messages: EventStreamMessage[] = []
    const parseMessage = createMessageParser(noop, noop, async (message) => {
      messages.push(message)
    })
    const parseLine = createLineParser(parseMessage)

    // Space after colon means valueOffset uses +2 instead of +1
    await parseLine(encoder.encode('data: hello world\n\n'))

    expect(messages).toEqual([
      {
        id: '',
        event: '',
        data: 'hello world',
      },
    ])
  })

  test('should handle field without space after colon', async () => {
    const messages: EventStreamMessage[] = []
    const parseMessage = createMessageParser(noop, noop, async (message) => {
      messages.push(message)
    })
    const parseLine = createLineParser(parseMessage)

    // No space after colon means valueOffset uses +1
    await parseLine(encoder.encode('data:hello\n\n'))

    expect(messages).toEqual([
      {
        id: '',
        event: '',
        data: 'hello',
      },
    ])
  })

  test('should handle crlf followed by non-newline char', async () => {
    const lines: Array<{ fieldLength: number; line: string }> = []
    const parseLine = createLineParser(async (line, fieldLength) => {
      lines.push({
        fieldLength,
        line: decoder.decode(line),
      })
    })

    // \r\n triggers discardTrailingNewline, next char is 'i' not \n
    await parseLine(encoder.encode('data: hello\r\nid: 1\r\n\r\n'))

    expect(lines).toEqual([
      { fieldLength: 4, line: 'data: hello' },
      { fieldLength: 2, line: 'id: 1' },
      { fieldLength: -1, line: '' },
    ])
  })

  test('should handle bare cr without following lf', async () => {
    const lines: Array<{ fieldLength: number; line: string }> = []
    const parseLine = createLineParser(async (line, fieldLength) => {
      lines.push({
        fieldLength,
        line: decoder.decode(line),
      })
    })

    // Bare \r (not \r\n) — discardTrailingNewline is true but next char is not \n
    await parseLine(encoder.encode('data: hello\rid: 1\r\r'))

    expect(lines).toEqual([
      { fieldLength: 4, line: 'data: hello' },
      { fieldLength: 2, line: 'id: 1' },
      { fieldLength: -1, line: '' },
    ])
  })

  test('should enforce maxBufferSize on unterminated line', async () => {
    const parseLine = createLineParser(noop, { maxBufferSize: 10 })

    // First chunk fits within limit
    await parseLine(encoder.encode('data: a'))
    // Second chunk concatenates and exceeds maxBufferSize
    await expect(parseLine(encoder.encode('b c d e f g h i j k l m'))).rejects.toThrow('SSE parser buffer exceeded maxBufferSize')
  })

  test('should not enforce maxBufferSize when not set', async () => {
    const parseLine = createLineParser(noop)

    // Large unterminated line without limit should not throw
    await parseLine(encoder.encode('data: '))
    await parseLine(encoder.encode('a'.repeat(10000)))
  })

  test('should not throw maxBufferSize for short messages', async () => {
    const messages: EventStreamMessage[] = []
    const parseMessage = createMessageParser(noop, noop, async (message) => {
      messages.push(message)
    })
    const parseLine = createLineParser(parseMessage, { maxBufferSize: 100 })

    await parseLine(encoder.encode('data: hello\n\n'))

    expect(messages).toEqual([
      {
        id: '',
        event: '',
        data: 'hello',
      },
    ])
  })

  test('should allow one chunk with multiple short messages over maxBufferSize', async () => {
    const messages: EventStreamMessage[] = []
    const parseMessage = createMessageParser(noop, noop, async (message) => {
      messages.push(message)
    })
    const parseLine = createLineParser(parseMessage, { maxBufferSize: 20 })

    await parseLine(encoder.encode('data: one\n\ndata: two\n\n'))

    expect(messages.map((message) => message.data)).toEqual(['one', 'two'])
  })

  test('should dispatch colonless data fields and preserve empty data lines', async () => {
    await expect(parseEvents('data\n\n')).resolves.toMatchObject({
      messages: [{ data: '', event: '', id: '' }],
    })
    await expect(parseEvents('data\ndata\n\n')).resolves.toMatchObject({
      messages: [{ data: '\n', event: '', id: '' }],
    })
  })

  test('should accept only ASCII-digit retry values and clamp timer overflow', async () => {
    const { messages, retries } = await parseEvents('retry: 1000junk\nretry: -1\nretry: 999999999999999999999999\ndata: ok\n\n')

    expect(retries).toEqual([2_147_483_647])
    expect(messages).toEqual([{ data: 'ok', event: '', id: '' }])
  })

  test('should persist valid ids across events and ignore ids containing NUL', async () => {
    const { ids, messages } = await parseEvents('id: good\ndata: one\n\ndata: two\n\nid: bad\0id\ndata: three\n\n')

    expect(ids).toEqual(['good'])
    expect(messages).toEqual([
      { data: 'one', event: '', id: 'good' },
      { data: 'two', event: '', id: 'good' },
      { data: 'three', event: '', id: 'good' },
    ])
  })

  test('should enforce maxBufferSize for complete and unterminated lines at the exact byte boundary', async () => {
    const exact = createLineParser(noop, { maxBufferSize: 9 })
    await expect(exact(encoder.encode('data: 猫\n'))).resolves.toBeUndefined()

    const completeOverflow = createLineParser(noop, { maxBufferSize: 8 })
    await expect(completeOverflow(encoder.encode('data: 猫\n'))).rejects.toThrow('SSE parser buffer exceeded maxBufferSize')

    const partial = createLineParser(noop, { maxBufferSize: 4 })
    await expect(partial(encoder.encode('data'))).resolves.toBeUndefined()
    await expect(partial(encoder.encode('x'))).rejects.toThrow('SSE parser buffer exceeded maxBufferSize')
  })

  test('should enforce cumulative data bytes including inserted line feeds', async () => {
    await expect(parseEvents('data: 1234\ndata: 5678\n\n', { lineLimit: 10, messageLimit: 10 })).resolves.toMatchObject({
      messages: [{ data: '1234\n5678', event: '', id: '' }],
    })

    await expect(parseEvents('data: 1234\ndata: 5678\ndata: 9\n\n', { lineLimit: 10, messageLimit: 10 })).rejects.toThrow(
      'SSE parser buffer exceeded maxBufferSize',
    )
  })

  test('should allow one large chunk containing many bounded events', async () => {
    const source = Array.from({ length: 100 }, (_, index) => `data: ${index % 10}\n\n`).join('')
    const { messages } = await parseEvents(source, { lineLimit: 8, messageLimit: 2 })

    expect(messages).toHaveLength(100)
  })

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'should reject invalid maxBufferSize %s',
    (maxBufferSize) => {
      expect(() => createLineParser(noop, { maxBufferSize })).toThrow('SSE maxBufferSize must be a positive safe integer')
      expect(() => createMessageParser(noop, noop, noop, { maxBufferSize })).toThrow('SSE maxBufferSize must be a positive safe integer')
    },
  )
})

type ParsedLine = { fieldLength: number; line: string }

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function collectLines(options?: { maxBufferSize?: number }) {
  const lines: ParsedLine[] = []
  const parse = createLineParser((line, fieldLength) => {
    lines.push({ fieldLength, line: decoder.decode(line) })
  }, options)
  return { lines, parse }
}

// One char per byte, so a reference computed on text reports the offsets the parser reports.
function toBinary(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes)
}

// The SSE line rules, written apart from the parser so it is checked against the spec and not against itself:
// LF, CR and CRLF end a line, a field ends at the first colon, and only terminated lines are emitted.
function referenceLines(source: string): ParsedLine[] {
  const pieces = source.split(/\r\n|\r|\n/)
  pieces.pop()
  return pieces.map((line) => {
    const colon = line.indexOf(':')
    return { fieldLength: line === '' ? -1 : colon === -1 ? line.length : colon, line }
  })
}

// Feeds `source` in chunks cut at `cuts` and checks after every chunk that exactly the lines of the prefix fed so far came out.
async function expectReferenceLines(source: string, cuts: readonly number[]): Promise<void> {
  const bytes = encoder.encode(source)
  const binarySource = toBinary(bytes)
  const emitted: ParsedLine[] = []
  const parse = createLineParser((line, fieldLength) => {
    emitted.push({ fieldLength, line: toBinary(line) })
  })
  let start = 0
  for (const end of [...cuts, bytes.length]) {
    await parse(bytes.slice(start, end))
    expect(emitted).toEqual(referenceLines(binarySource.slice(0, end)))
    start = end
  }
}

const chunkingSources = [
  // Every terminator, a colonless line, a leading colon, and colons inside values.
  'data: a:b\r\nid: 1\rretry\n\n:c\r\n\r\r\n',
  // Blank lines, LF before CR, and a CR that ends the input.
  'a\r\n\r\nb\n\rc\r',
  'x:y:z\n::\n\n\n:\r\n',
  // Multi-byte characters: a colon sits at a byte offset, not a character offset.
  '猫: 猫\r\ndata\r\r\n',
]

describe('sse line parser scanning', () => {
  test('should run the handler for every line of a chunk without yielding while handlers return nothing', async () => {
    const { lines, parse } = collectLines()

    const done = parse(encoder.encode('data: a\nid: 1\n\n'))

    // Nothing was awaited yet: awaiting each handler result would have stopped after the first line.
    expect(lines).toHaveLength(3)
    await done
  })

  test('should wait for a promise from the handler before it reads the next line', async () => {
    const gate = Promise.withResolvers<void>()
    const seen: string[] = []
    const parse = createLineParser((line) => {
      seen.push(decoder.decode(line))
      return seen.length === 1 ? gate.promise : undefined
    })

    const done = parse(encoder.encode('a\nb\nc\n'))
    await nextTurn()
    expect(seen).toEqual(['a'])

    gate.resolve()
    await done
    expect(seen).toEqual(['a', 'b', 'c'])
  })

  test('should stop at the line whose handler promise rejects', async () => {
    const failure = new Error('handler failed')
    const seen: string[] = []
    const parse = createLineParser((line) => {
      seen.push(decoder.decode(line))
      return seen.length === 2 ? Promise.reject(failure) : undefined
    })

    await expect(parse(encoder.encode('a\nb\nc\n'))).rejects.toBe(failure)

    expect(seen).toEqual(['a', 'b'])
  })

  test.each([
    ['LF', '\n'],
    ['CR', '\r'],
    ['CRLF', '\r\n'],
  ])('should end lines at %s and report the first colon of each', async (_name, terminator) => {
    const { lines, parse } = collectLines()

    await parse(encoder.encode(['data: a:b', 'id:1', 'retry', '', ': note'].map((line) => line + terminator).join('')))

    expect(lines).toEqual([
      { fieldLength: 4, line: 'data: a:b' },
      { fieldLength: 2, line: 'id:1' },
      { fieldLength: 5, line: 'retry' },
      { fieldLength: -1, line: '' },
      { fieldLength: 0, line: ': note' },
    ])
  })

  test('should treat a CRLF split across chunks as one terminator', async () => {
    const { lines, parse } = collectLines()

    await parse(encoder.encode('data: x\r'))
    // A CR is a complete terminator: the line is out before the LF that may follow arrives.
    expect(lines).toEqual([{ fieldLength: 4, line: 'data: x' }])

    await parse(encoder.encode('\nid: 1\r'))
    await parse(encoder.encode('\n\n'))

    // The first LF of the last chunk closes a CRLF, so only the second one makes a blank line.
    expect(lines).toEqual([
      { fieldLength: 4, line: 'data: x' },
      { fieldLength: 2, line: 'id: 1' },
      { fieldLength: -1, line: '' },
    ])
  })

  test('should start the next line at whatever follows a CR that ends a chunk', async () => {
    const { lines, parse } = collectLines()

    await parse(encoder.encode('a\r'))
    await parse(encoder.encode('b\r'))
    // An empty chunk changes nothing: the LF after it still belongs to the CR before it.
    await parse(new Uint8Array(0))
    await parse(encoder.encode('\nc\n'))

    expect(lines).toEqual([
      { fieldLength: 1, line: 'a' },
      { fieldLength: 1, line: 'b' },
      { fieldLength: 1, line: 'c' },
    ])
  })

  test('should take the field length from the first colon of the line only', async () => {
    const { lines, parse } = collectLines()

    await parse(encoder.encode('data: a:b:c\ndata:x:y\n:::\ndata\nid: 7\n\n:\n'))

    expect(lines).toEqual([
      { fieldLength: 4, line: 'data: a:b:c' },
      { fieldLength: 4, line: 'data:x:y' },
      { fieldLength: 0, line: ':::' },
      // A line without a colon must not borrow the colon of the line after it.
      { fieldLength: 4, line: 'data' },
      { fieldLength: 2, line: 'id: 7' },
      { fieldLength: -1, line: '' },
      { fieldLength: 0, line: ':' },
    ])
  })

  test('should keep the first colon of a line that is split across chunks', async () => {
    const { lines, parse } = collectLines()

    await parse(encoder.encode('da'))
    await parse(encoder.encode('ta: a:'))
    await parse(encoder.encode('b:c\nid'))
    await parse(encoder.encode(': 1\ndata'))
    await parse(encoder.encode('\r\nevent: x'))
    await parse(encoder.encode(':y\n'))

    expect(lines).toEqual([
      { fieldLength: 4, line: 'data: a:b:c' },
      { fieldLength: 2, line: 'id: 1' },
      { fieldLength: 4, line: 'data' },
      { fieldLength: 5, line: 'event: x:y' },
    ])
  })

  test.each([
    ['LF', '\n'],
    ['CR', '\r'],
    ['CRLF', '\r\n'],
  ])('should not count the %s terminator toward maxBufferSize', async (_name, terminator) => {
    const { lines, parse } = collectLines({ maxBufferSize: 6 })

    await parse(encoder.encode(`abcdef${terminator}`))

    expect(lines).toEqual([{ fieldLength: 6, line: 'abcdef' }])
    await expect(parse(encoder.encode(`abcdefg${terminator}`))).rejects.toThrow('SSE parser buffer exceeded maxBufferSize')
  })

  test('should apply maxBufferSize to a line that completes in a later chunk', async () => {
    const fits = collectLines({ maxBufferSize: 10 })
    await fits.parse(encoder.encode('data: a'))
    await fits.parse(encoder.encode('b\n'))
    expect(fits.lines).toEqual([{ fieldLength: 4, line: 'data: ab' }])

    const overflows = collectLines({ maxBufferSize: 10 })
    await overflows.parse(encoder.encode('data: a'))
    await expect(overflows.parse(encoder.encode('bcdef\n'))).rejects.toThrow('SSE parser buffer exceeded maxBufferSize')
    expect(overflows.lines).toEqual([])
  })

  test('should deliver the lines before an oversized one and then fail', async () => {
    const { lines, parse } = collectLines({ maxBufferSize: 6 })

    await expect(parse(encoder.encode('ok\ndata: toolong\nnext\n'))).rejects.toThrow('SSE parser buffer exceeded maxBufferSize')

    expect(lines).toEqual([{ fieldLength: 2, line: 'ok' }])
  })

  test('should count only the unterminated tail of a chunk against maxBufferSize', async () => {
    const { lines, parse } = collectLines({ maxBufferSize: 10 })

    // 25 bytes, but only the 6-byte tail is buffered.
    await parse(encoder.encode('data: one\ndata: two\nid: 12'))
    expect(lines.map(({ line }) => line)).toEqual(['data: one', 'data: two'])

    // The tail grows to exactly the limit, which is still allowed, and one more byte is not.
    await parse(encoder.encode('3456'))
    await expect(parse(encoder.encode('7'))).rejects.toThrow('SSE parser buffer exceeded maxBufferSize')
  })

  test.each(chunkingSources)('should emit the lines of the spec however %j is cut into three chunks', async (source) => {
    const length = encoder.encode(source).length
    for (let first = 0; first <= length; first += 1) {
      for (let second = first; second <= length; second += 1) {
        await expectReferenceLines(source, [first, second])
      }
    }
  })

  test.each(chunkingSources)('should emit the lines of the spec for %j fed one byte at a time', async (source) => {
    const length = encoder.encode(source).length
    await expectReferenceLines(
      source,
      Array.from({ length: length - 1 }, (_, index) => index + 1),
    )
  })
})

describe('sse message parser hand-off', () => {
  test('should return nothing for lines that only update parser state or carry no data', () => {
    const gate = Promise.withResolvers<void>()
    const parse = createMessageParser(noop, noop, () => gate.promise)

    expect(parse(encoder.encode('data: x'), 4)).toBeUndefined()
    expect(parse(encoder.encode(': note'), 0)).toBeUndefined()
    // The blank line dispatches the message above. A second one has no data, so there is nothing to hand back.
    expect(parse(new Uint8Array(0), -1)).toBe(gate.promise)
    expect(parse(new Uint8Array(0), -1)).toBeUndefined()
  })

  test('should hand back the promise of an asynchronous consumer so the line parser can wait for it', async () => {
    const gate = Promise.withResolvers<void>()
    const dispatched: string[] = []
    const parseLine = createLineParser(
      createMessageParser(noop, noop, (message) => {
        dispatched.push(message.data)
        return dispatched.length === 1 ? gate.promise : undefined
      }),
    )

    const done = parseLine(encoder.encode('data: one\n\ndata: two\n\n'))
    await nextTurn()
    expect(dispatched).toEqual(['one'])

    gate.resolve()
    await done
    expect(dispatched).toEqual(['one', 'two'])
  })

  test('should return nothing when a synchronous consumer takes the message', () => {
    const parse = createMessageParser(noop, noop, noop)

    parse(encoder.encode('data: x'), 4)

    expect(parse(new Uint8Array(0), -1)).toBeUndefined()
  })
})
