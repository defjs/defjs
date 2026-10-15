import { describe, expect, test, vi } from 'vitest'
import { createClient, withEndpoint, withInterceptors, withSSEHandle, withSSEReconnect } from '../client'
import { createSSEInterceptor } from '../interceptor'
import { makeResponse } from '../internal/http_response'
import { struct } from '../struct'
import { defineEventStream } from './index'
import type { EventStreamCloseInfo, EventStreamHandle, EventStreamOpenInfo } from './transport/event_stream'

const useStream = defineEventStream({
  events: { message: struct.string() },
  maxBufferSize: 1024,
  maxQueueSize: 8,
  path: '/events',
})

function controlledResponse(connection: string, attempt: number) {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const cancel = vi.fn()
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value
    },
    cancel,
  })
  const response = new Response(body, {
    headers: { 'content-type': 'text/event-stream', 'x-connection': connection, 'x-attempt': String(attempt) },
  })
  return { response, controller, cancel }
}

describe('F031 SSE first successful handshake snapshot', () => {
  test.each([
    { label: 'the only connection', count: 1, selected: 0, wrapper: false },
    { label: 'the first of two connections', count: 2, selected: 0, wrapper: false },
    { label: 'the second of two connections', count: 2, selected: 1, wrapper: false },
    { label: 'a wrapper of the first connection', count: 2, selected: 0, wrapper: true },
    { label: 'a wrapper of the second connection', count: 2, selected: 1, wrapper: true },
  ])(
    'should return the initial handshake of $label after reconnecting inside the interceptor chain',
    async ({ count, selected, wrapper }) => {
      const responses = Array.from(
        { length: count },
        (_, index) => [controlledResponse(String(index), 1), controlledResponse(String(index), 2)] as const,
      )
      const attempts = Array.from({ length: count }, () => 0)
      const opened: EventStreamHandle<unknown>[] = []
      const initialOpens: EventStreamOpenInfo[] = []
      let delivered: EventStreamHandle<unknown> | undefined
      const client = createClient(
        withEndpoint('https://example.test'),
        withSSEHandle(async (input) => {
          const connection = Number(new Request(input).headers.get('x-connection'))
          const attempt = attempts[connection] ?? 0
          attempts[connection] = attempt + 1
          const source = responses[connection]?.[attempt]
          if (!source) throw new Error('Unexpected SSE attempt')
          return source.response
        }),
        withSSEReconnect({ attempts: 1, delayMs: 0 }),
        withInterceptors(
          createSSEInterceptor(async (request, next) => {
            const connections: EventStreamHandle<unknown>[] = []
            for (let index = 0; index < count; index += 1) {
              const headers = new Headers(request.headers)
              headers.set('x-connection', String(index))
              connections.push(await next({ ...request, headers }))
            }
            const inner = connections[selected]
            if (!inner) throw new Error('Expected selected connection')
            delivered = wrapper
              ? {
                  get open() {
                    return inner.open
                  },
                  closed: inner.closed,
                  close: (reason) => inner.close(reason),
                  [Symbol.asyncDispose]: () => inner[Symbol.asyncDispose](),
                  [Symbol.asyncIterator]: () => inner[Symbol.asyncIterator](),
                }
              : inner
            return delivered
          }),
          createSSEInterceptor(async (request, next) => {
            const inner = await next(request)
            const index = opened.length
            opened.push(inner)
            initialOpens.push(inner.open)
            const source = responses[index]?.[0]
            if (!source) throw new Error('Expected initial response')
            source.controller.error(new TypeError('connection interrupted'))
            await vi.waitFor(() => expect(inner.open.response.headers.get('x-attempt')).toBe('2'))
            return inner
          }),
        ),
      )

      try {
        const [error, stream, open] = await client.execute(useStream())

        expect(error).toBeNull()
        expect(stream).toBe(delivered)
        expect(attempts).toEqual(Array.from({ length: count }, () => 2))
        expect(stream?.open.response.headers.get('x-attempt')).toBe('2')
        expect(stream?.open.response.headers.get('x-connection')).toBe(String(selected))
        expect(initialOpens[selected]?.response.headers.get('x-attempt')).toBe('1')
        expect(open?.response.headers.get('x-connection')).toBe(String(selected))
        for (const [index, inner] of opened.entries()) {
          if (index !== selected) {
            await expect(inner.closed).resolves.toMatchObject({ kind: 'aborted' })
            await vi.waitFor(() => expect(responses[index]?.[1].cancel).toHaveBeenCalledOnce())
          }
        }
        expect(responses[selected]?.[1].cancel).not.toHaveBeenCalled()
        expect(open?.response.headers.get('x-attempt')).toBe('1')
        expect(open).toBe(initialOpens[selected])
      } finally {
        for (const stream of opened) stream.close('test complete')
        await Promise.all(opened.map((stream) => stream.closed))
      }
    },
  )

  test.each([false, true])('should preserve transformed wrapper open with reconnect = %s', async (reconnect) => {
    const first = controlledResponse('wrapped', 1)
    const second = controlledResponse('wrapped', 2)
    first.response.headers.set('x-private', 'internal-only')
    second.response.headers.set('x-private', 'internal-only')
    const handle = vi.fn().mockResolvedValueOnce(first.response).mockResolvedValueOnce(second.response)
    const readOpen = vi.fn((open: EventStreamOpenInfo) => {
      const headers = new Headers(open.response.headers)
      headers.delete('x-private')
      return { ...open, url: 'https://public.example/events', response: { ...open.response, headers } }
    })
    let transport: EventStreamHandle<unknown> | undefined
    const client = createClient(
      withEndpoint('https://example.test'),
      withSSEHandle(handle),
      withSSEReconnect({ attempts: 1, delayMs: 0 }),
      withInterceptors(
        createSSEInterceptor(async (request, next) => {
          const inner = await next(request)
          transport = inner
          if (reconnect) {
            first.controller.error(new TypeError('connection interrupted'))
            await vi.waitFor(() => expect(inner.open.response.headers.get('x-attempt')).toBe('2'))
          }
          return {
            get open() {
              return readOpen(inner.open)
            },
            closed: inner.closed,
            close: (reason) => inner.close(reason),
            [Symbol.asyncDispose]: () => inner[Symbol.asyncDispose](),
            [Symbol.asyncIterator]: () => inner[Symbol.asyncIterator](),
          }
        }),
      ),
    )
    const activeSource = reconnect ? second : first

    try {
      const [error, stream, startupOpen] = await client.execute(useStream())

      expect(error).toBeNull()
      expect(handle).toHaveBeenCalledTimes(reconnect ? 2 : 1)
      expect(readOpen).toHaveBeenCalledOnce()
      expect(activeSource.cancel).not.toHaveBeenCalled()
      const publicOpen = stream?.open
      expect(publicOpen?.url).toBe('https://public.example/events')
      expect(publicOpen?.response.headers.has('x-private')).toBe(false)
      expect(publicOpen?.response.headers.get('x-attempt')).toBe(reconnect ? '2' : '1')
      expect.soft(startupOpen?.url).toBe('https://public.example/events')
      expect.soft(startupOpen?.response.headers.has('x-private')).toBe(false)
      expect.soft(startupOpen?.response.headers.get('x-attempt')).toBe(reconnect ? '2' : '1')
      expect(startupOpen).toBe(readOpen.mock.results[0]?.value)
    } finally {
      transport?.close('test complete')
      await transport?.closed
      await vi.waitFor(() => expect(activeSource.cancel).toHaveBeenCalledOnce())
    }
  })

  test.each([false, true])('should return a short-circuit handle own open with discarded transport = %s', async (discardTransport) => {
    const closed = Promise.withResolvers<EventStreamCloseInfo>()
    const open = {
      response: makeResponse({ status: 200, headers: new Headers({ 'x-attempt': 'short-circuit' }) }),
      url: 'https://short-circuit.example/events',
    }
    const shortCircuit: EventStreamHandle<unknown> = {
      open,
      closed: closed.promise,
      close: (cause) => closed.resolve({ cause, kind: 'aborted' }),
      async [Symbol.asyncDispose]() {
        shortCircuit.close()
        await shortCircuit.closed
      },
      [Symbol.asyncIterator]() {
        return { next: async () => ({ done: true, value: undefined }) }
      },
    }
    const source = controlledResponse('discarded', 1)
    const handle = vi.fn(async () => source.response)
    let discarded: EventStreamHandle<unknown> | undefined
    const client = createClient(
      withEndpoint('https://example.test'),
      withSSEHandle(handle),
      withInterceptors(
        createSSEInterceptor(async (request, next) => {
          if (discardTransport) discarded = await next(request)
          return shortCircuit
        }),
      ),
    )

    try {
      const [error, stream, snapshot] = await client.execute(useStream())

      expect(error).toBeNull()
      expect(stream).toBe(shortCircuit)
      expect(snapshot).toBe(open)
      expect(snapshot?.response.headers.get('x-attempt')).toBe('short-circuit')
      expect(handle).toHaveBeenCalledTimes(discardTransport ? 1 : 0)
      if (discardTransport) {
        await expect(discarded?.closed).resolves.toMatchObject({ kind: 'aborted' })
        await vi.waitFor(() => expect(source.cancel).toHaveBeenCalledOnce())
      }
    } finally {
      shortCircuit.close('test complete')
      discarded?.close('test complete')
      await Promise.all([shortCircuit.closed, discarded?.closed])
    }
  })
})
