import { describe, expect, test } from 'vitest'
import { createClient, withEndpoint, withSSEHandle, withSSEOnInvalidEvent } from '../client'
import { struct } from '../struct'
import { defineEventStream } from './index'

type InvalidEventObserver = Parameters<typeof withSSEOnInvalidEvent>[0]

const encoder = new TextEncoder()

// `message` carries text, `count` a JSON number, and any other event name has no struct at all.
const useStream = defineEventStream({
  events: { count: struct.number(), message: struct.string() },
  maxBufferSize: 1024,
  maxQueueSize: 16,
  path: '/events',
})

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
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

function watchSettled(promise: Promise<unknown>): () => boolean {
  let settled = false
  void promise.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )
  return () => settled
}

// A body the test feeds by hand, so a consumer can already be waiting when the bytes arrive.
function createFeed() {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  const body = new ReadableStream<Uint8Array>({
    start(started) {
      controller = started
    },
  })
  return {
    body,
    end: () => controller?.close(),
    push: (text: string) => controller?.enqueue(encoder.encode(text)),
  }
}

async function openStream(options: { body: BodyInit; onInvalidEvent?: InvalidEventObserver; signal?: AbortSignal }) {
  const client = createClient(
    withEndpoint('https://api.example.com'),
    withSSEHandle(
      (async () => new Response(options.body, { headers: { 'content-type': 'text/event-stream' } })) as unknown as typeof fetch,
    ),
    ...(options.onInvalidEvent ? [withSSEOnInvalidEvent(options.onInvalidEvent)] : []),
  )
  const [error, stream] = await client.execute(useStream(), options.signal ? { signal: options.signal } : undefined)
  expect(error).toBeNull()
  if (!stream) {
    throw new Error('Expected stream')
  }
  return stream
}

describe('event stream invalid events', () => {
  test('should queue every valid event of a chunk in one synchronous pass', async () => {
    const feed = createFeed()
    const stream = await openStream({ body: feed.body })
    const iterator = stream[Symbol.asyncIterator]()
    // The consumer is already waiting when the bytes arrive.
    const first = iterator.next()

    feed.push('data: one\n\ndata: two\n\ndata: three\n\n')
    expect((await first).value).toMatchObject({ data: 'one' })

    // The consumer resumes only after the pass over the whole chunk, so the rest is queued by now.
    const second = watchSettled(iterator.next())
    const third = watchSettled(iterator.next())
    await Promise.resolve()
    expect([second(), third()]).toEqual([true, true])

    stream.close()
    await stream.closed
  })

  test('should finish an invalid event before the next event of the same chunk is delivered', async () => {
    const feed = createFeed()
    const log: string[] = []
    const stream = await openStream({
      body: feed.body,
      async onInvalidEvent({ message, reason }) {
        // Work that takes real time: an event delivered meanwhile would reach the log before this one.
        await nextTurn()
        log.push(`${reason} ${message.data} done`)
      },
    })
    const consumed = (async () => {
      for await (const event of stream) {
        log.push(`event ${event.data}`)
      }
    })()

    feed.push('data: one\n\nevent: unknown\ndata: two\n\nevent: count\ndata: nope\n\ndata: four\n\n')
    feed.end()
    await consumed

    expect(log).toEqual(['event one', 'missing-struct two done', 'validation-failed nope done', 'event four'])
  })

  test('should hold later events back until an asynchronous onInvalidEvent settles', async () => {
    const gate = Promise.withResolvers<void>()
    const observed: string[] = []
    const stream = await openStream({
      body: 'data: one\n\nevent: unknown\ndata: two\n\nevent: unknown\ndata: three\n\ndata: four\n\n',
      onInvalidEvent({ message }) {
        observed.push(message.data)
        return message.data === 'two' ? gate.promise : undefined
      },
    })
    const received: string[] = []
    const consumed = (async () => {
      for await (const event of stream) {
        received.push(String(event.data))
      }
    })()
    await nextTurn()

    // "one" comes before the invalid events and is out. While "two" is pending, nothing behind it is observed or delivered.
    expect(received).toEqual(['one'])
    expect(observed).toEqual(['two'])

    gate.resolve()
    await consumed

    expect(observed).toEqual(['two', 'three'])
    expect(received).toEqual(['one', 'four'])
  })

  test.each(['throws', 'rejects'] as const)('should keep the stream alive when onInvalidEvent %s', async (mode) => {
    const reasons: string[] = []
    const stream = await openStream({
      body: 'event: unknown\ndata: a\n\nevent: count\ndata: nope\n\ndata: after\n\n',
      onInvalidEvent({ reason }) {
        reasons.push(reason)
        if (mode === 'throws') {
          throw new Error('observer failed')
        }
        return Promise.reject(new Error('observer failed'))
      },
    })

    const received: string[] = []
    for await (const event of stream) {
      received.push(String(event.data))
    }

    expect(reasons).toEqual(['missing-struct', 'validation-failed'])
    expect(received).toEqual(['after'])
    await expect(stream.closed).resolves.toEqual({ kind: 'eof' })
  })

  test('should settle with the abort when the request is aborted while onInvalidEvent is pending', async () => {
    const gate = Promise.withResolvers<void>()
    const started = Promise.withResolvers<AbortSignal>()
    const controller = new AbortController()
    const stream = await openStream({
      body: 'event: unknown\ndata: bad\n\ndata: after\n\n',
      onInvalidEvent({ signal }) {
        started.resolve(signal)
        return gate.promise
      },
      signal: controller.signal,
    })
    const next = stream[Symbol.asyncIterator]().next()
    const observerSignal = await started.promise

    const reason = new Error('stop')
    controller.abort(reason)

    // The abort wins at once: neither the pending observer nor the event behind it is waited for.
    await expect(settleWithin(next)).resolves.toEqual({ done: true, value: undefined })
    await expect(settleWithin(stream.closed)).resolves.toMatchObject({ cause: reason, kind: 'aborted' })
    expect(observerSignal.aborted).toBe(true)

    // The observer failing afterwards changes nothing.
    gate.reject(new Error('observer failed late'))
    await nextTurn()
    await expect(stream.closed).resolves.toMatchObject({ cause: reason, kind: 'aborted' })
  })
})
