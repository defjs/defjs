import { describe, expect, inject, test } from 'vitest'
import { ERR_ABORTED } from '../../error'
import type { HttpRequest } from '../../http'
import type { FetchEventStreamOptions } from './event_stream'
import { fetchEventStream as fetchEventStreamInternal, getErrorOpenInfo } from './event_stream'
import type { EventStreamMessage } from './parser'

type TestOptions<T> = Omit<FetchEventStreamOptions<T>, 'maxBufferSize' | 'maxQueueSize'> & {
  maxBufferSize?: number
  maxQueueSize?: number
}

function fetchEventStream<T = EventStreamMessage>(request: HttpRequest, options: TestOptions<T> = {}) {
  return fetchEventStreamInternal(request, {
    maxBufferSize: 1024,
    maxQueueSize: 16,
    ...options,
  } as FetchEventStreamOptions<T>)
}

// One scripted connection: the chunks it sends, then either a lost connection or a clean end.
function scriptedConnection(chunks: readonly string[], end: 'drop' | 'eof'): Response {
  let index = 0
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[index++]
        if (chunk !== undefined) {
          controller.enqueue(new TextEncoder().encode(chunk))
        } else if (end === 'eof') {
          controller.close()
        } else {
          controller.error(new Error('connection lost'))
        }
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  )
}

describe('fetchEventStream', () => {
  test('should read basic sse messages with open and closed info', async () => {
    const request: HttpRequest = {
      baseEndpoint: inject('testServerHost'),
      endpoint: '/sse/basic',
      method: 'GET',
    }

    const stream = await fetchEventStream(request)
    expect(stream.open.response.ok).toBe(true)
    expect(stream.open.response.status).toBe(200)
    expect(stream.open.response.headers.get('x-request-id')).toBe('trace-sse-basic')

    const messages: EventStreamMessage[] = []
    for await (const event of stream) {
      messages.push(event)
    }

    expect(messages).toEqual([
      { id: '1', event: 'message', data: 'first' },
      { id: '2', event: 'message', data: 'second line 1\nsecond line 2' },
    ])

    await expect(stream.closed).resolves.toEqual({ kind: 'eof' })
  })

  test('should retry with last-event-id and update open info', async () => {
    const request: HttpRequest = {
      baseEndpoint: 'https://example.com',
      endpoint: '/events',
      method: 'GET',
    }
    let attempt = 0
    const fetch = async (input: RequestInfo | URL) => {
      attempt += 1
      const lastEventId = new Request(input).headers.get('last-event-id')
      if (attempt === 1) {
        expect(lastEventId).toBeNull()
        let pulled = false
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (!pulled) {
                pulled = true
                controller.enqueue(new TextEncoder().encode('id: 1\ndata: first\n\n'))
                return
              }
              controller.error(new Error('connection lost'))
            },
          }),
          { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'attempt-1' } },
        )
      }

      expect(lastEventId).toBe('1')
      return new Response('id: 2\ndata: second\n\n', {
        headers: { 'content-type': 'text/event-stream', 'x-request-id': 'attempt-2' },
      })
    }

    const stream = await fetchEventStream(request, {
      fetch: fetch as typeof globalThis.fetch,
      onerror() {
        return 0
      },
      reconnect: { attempts: 3, delayMs: 0 },
    })

    const messages: EventStreamMessage[] = []
    for await (const event of stream) {
      messages.push(event)
    }

    expect(messages.map((event) => event.data)).toEqual(['first', 'second'])
    expect(stream.open.response.headers.get('x-request-id')).toBe('attempt-2')
    await expect(stream.closed).resolves.toEqual({ kind: 'eof' })
  })

  test('should drop last-event-id on reconnect after an empty id field', async () => {
    const request: HttpRequest = {
      baseEndpoint: 'https://example.com',
      endpoint: '/events',
      method: 'GET',
    }
    const seen: (string | null)[] = []
    const fetch = async (input: RequestInfo | URL) => {
      seen.push(new Request(input).headers.get('last-event-id'))
      if (seen.length === 1) {
        let pulled = false
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (!pulled) {
                pulled = true
                controller.enqueue(new TextEncoder().encode('id: 1\ndata: first\n\nid:\ndata: second\n\n'))
                return
              }
              controller.error(new Error('connection lost'))
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        )
      }
      return new Response('data: third\n\n', { headers: { 'content-type': 'text/event-stream' } })
    }

    const stream = await fetchEventStream(request, {
      fetch: fetch as typeof globalThis.fetch,
      onerror() {
        return 0
      },
      reconnect: { attempts: 3, delayMs: 0 },
    })
    const messages: string[] = []
    for await (const event of stream) {
      messages.push(event.data)
    }

    expect(messages).toEqual(['first', 'second', 'third'])
    expect(seen).toEqual([null, null])
  })

  test('should send the latest event id on every one of several reconnects', async () => {
    const request: HttpRequest = {
      baseEndpoint: 'https://example.com',
      endpoint: '/events',
      headers: new Headers({ 'Last-Event-ID': 'seed' }),
      method: 'GET',
    }
    const connections: [chunks: string[], end: 'drop' | 'eof'][] = [
      // The caller's id goes out until the stream sends one of its own.
      [['data: one\n\n'], 'drop'],
      [['id: a\ndata: two\n\n'], 'drop'],
      // A connection without an id leaves the last one in place.
      [['data: three\n\n'], 'drop'],
      // An id that contains NUL is ignored.
      [['id: b\0\ndata: four\n\n'], 'drop'],
      // The last id of a connection is the one that counts.
      [['id: c\ndata: five\n\nid: d\ndata: six\n\n'], 'drop'],
      // An empty id clears the stored one, and the header stays off until a real id arrives.
      [['id:\ndata: seven\n\n'], 'drop'],
      [['data: eight\n\n'], 'drop'],
      [['id: e\ndata: nine\n\n'], 'eof'],
    ]
    const seen: (string | null)[] = []
    const fetch = async (input: RequestInfo | URL) => {
      seen.push(new Request(input).headers.get('last-event-id'))
      const [chunks, end] = connections[seen.length - 1] ?? [[], 'eof']
      return scriptedConnection(chunks, end)
    }

    const stream = await fetchEventStream(request, {
      fetch: fetch as typeof globalThis.fetch,
      onerror() {
        return 0
      },
      reconnect: { attempts: 10, delayMs: 0 },
    })
    const messages: string[] = []
    for await (const event of stream) {
      messages.push(event.data)
    }

    expect(messages).toEqual(['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'])
    expect(seen).toEqual(['seed', 'seed', 'a', 'a', 'a', 'd', null, null])
    // The request the caller handed in is not edited to carry the stream's ids.
    expect(request.headers?.get('last-event-id')).toBe('seed')
    await expect(stream.closed).resolves.toEqual({ kind: 'eof' })
  })

  test('should close stream manually', async () => {
    const request: HttpRequest = {
      baseEndpoint: inject('testServerHost'),
      endpoint: '/sse/infinite',
      method: 'GET',
    }

    const stream = await fetchEventStream(request)
    const iterator = stream[Symbol.asyncIterator]()
    const first = await iterator.next()

    expect(first.done).toBe(false)
    expect(first.value).toMatchObject({ event: 'tick', data: '1' })

    stream.close('stop')
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
    await expect(stream.closed).resolves.toEqual({
      kind: 'aborted',
      reason: 'stop',
      cause: 'stop',
    })
  })

  test('should reject when response is not event stream', async () => {
    const request: HttpRequest = {
      baseEndpoint: inject('testServerHost'),
      endpoint: '/json',
      method: 'GET',
    }

    await expect(fetchEventStream(request)).rejects.toThrowError(/Expected content-type/)
  })

  test('should reject non-2xx open responses through response.ok without a synthetic error', async () => {
    const request: HttpRequest = {
      baseEndpoint: 'https://example.com',
      endpoint: '/events',
      method: 'GET',
    }
    let thrown: unknown

    try {
      await fetchEventStream(request, {
        fetch: (async () =>
          new Response('data: ignored\n\n', {
            headers: { 'content-type': 'text/event-stream' },
            status: 503,
            statusText: 'Service Unavailable',
          })) as unknown as typeof fetch,
      })
    } catch (error) {
      thrown = error
    }

    const open = getErrorOpenInfo(thrown)
    expect(thrown).toBeInstanceOf(Error)
    expect(open?.response.ok).toBe(false)
  })

  test('should reject with aborted error when aborted before open', async () => {
    const controller = new AbortController()
    controller.abort()

    const request: HttpRequest = {
      baseEndpoint: inject('testServerHost'),
      endpoint: '/sse/infinite',
      method: 'GET',
      abort: controller.signal,
    }

    await expect(fetchEventStream(request)).rejects.toBe(ERR_ABORTED)
  })
})
