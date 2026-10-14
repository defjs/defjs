import { expect, test, vi } from 'vitest'
import {
  createClient,
  defineEventStream,
  defineRequest,
  defineWebSocket,
  struct,
  withEndpoint,
  withHTTPHandle,
  withSSEHandle,
  withSSEReconnect,
  withWebSocketHandle,
} from '../../src'

function watch(signal: AbortSignal) {
  const add = vi.spyOn(signal, 'addEventListener')
  const remove = vi.spyOn(signal, 'removeEventListener')
  return {
    expectReleased() {
      const added = add.mock.calls.filter(([type]) => type === 'abort')
      expect(remove.mock.calls.filter(([type]) => type === 'abort')).toHaveLength(added.length)
      for (const [type, listener] of added) {
        expect(remove).toHaveBeenCalledWith(type, listener)
      }
      add.mockRestore()
      remove.mockRestore()
    },
  }
}

const httpEndpoint = defineRequest({ method: 'GET', output: struct.null(), path: '/' })
const sseEndpoint = defineEventStream({ events: { message: struct.string() }, maxBufferSize: 1024, maxQueueSize: 4, path: '/' })
const socketEndpoint = defineWebSocket({ incoming: struct.unknown(), maxIncomingQueueSize: 4, path: '/' })

test.each(['success', 'fault', 'abort', 'timeout'] as const)('HTTP releases caller abort listeners after %s', async (mode) => {
  let release: () => void = () => undefined
  const client = createClient(
    withEndpoint('https://example.test'),
    withHTTPHandle(async () => {
      if (mode === 'success') return new Response('null', { headers: { 'content-type': 'application/json' } })
      if (mode === 'fault') return new Response(null, { status: 500 })
      return new Promise<Response>((resolve) => {
        release = () => resolve(new Response('null', { headers: { 'content-type': 'application/json' } }))
      })
    }),
  )
  const caller = new AbortController()
  const signal = watch(caller.signal)
  const pending = client.execute(httpEndpoint(), { signal: caller.signal, ...(mode === 'timeout' ? { timeout: 1 } : {}) })
  if (mode === 'abort') caller.abort('stop')
  const [fault] = await pending
  release()
  expect(fault?.code ?? null).toBe(
    mode === 'success' ? null : mode === 'fault' ? 'HTTP_STATUS' : mode === 'abort' ? 'NET_ABORTED' : 'NET_TIMEOUT',
  )
  signal.expectReleased()
})

test('SSE releases caller abort listeners after a reconnecting stream closes', async () => {
  let attempt = 0
  const client = createClient(
    withEndpoint('https://example.test'),
    withSSEReconnect({ attempts: 1, delayMs: 0 }),
    withSSEHandle(async () => {
      attempt += 1
      if (attempt === 1) {
        let sent = false
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (!sent) {
                sent = true
                controller.enqueue(new TextEncoder().encode('id: 1\ndata: first\n\n'))
              } else {
                controller.error(new Error('connection lost'))
              }
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        )
      }
      return new Response('data: second\n\n', { headers: { 'content-type': 'text/event-stream' } })
    }),
  )
  const caller = new AbortController()
  const signal = watch(caller.signal)
  const [fault, stream] = await client.execute(sseEndpoint(), { signal: caller.signal })
  expect(fault).toBeNull()
  if (!stream) throw new Error('Expected an SSE stream')
  const values: string[] = []
  for await (const event of stream) values.push(event.data)
  await stream.closed
  expect(values).toEqual(['first', 'second'])
  signal.expectReleased()
})

test.each(['fault', 'abort', 'timeout'] as const)('SSE releases caller abort listeners after %s', async (mode) => {
  let release: () => void = () => undefined
  const client = createClient(
    withEndpoint('https://example.test'),
    withSSEHandle(async () => {
      if (mode === 'fault') return new Response(null, { status: 500 })
      return new Promise<Response>((resolve) => {
        release = () => resolve(new Response('data: hi\n\n', { headers: { 'content-type': 'text/event-stream' } }))
      })
    }),
  )
  const caller = new AbortController()
  const signal = watch(caller.signal)
  const pending = client.execute(sseEndpoint(), { signal: caller.signal, ...(mode === 'timeout' ? { timeout: 1 } : {}) })
  if (mode === 'abort') caller.abort('stop')
  const [fault] = await pending
  release()
  expect(fault).toBeTruthy()
  signal.expectReleased()
})

class TestSocket extends EventTarget {
  static readonly OPEN = 1
  static readonly CONNECTING = 0
  static readonly CLOSED = 3
  readonly url: string
  readyState = TestSocket.CONNECTING
  bufferedAmount = 0
  binaryType = 'arraybuffer'
  extensions = ''
  protocol = ''

  constructor(url: string | URL) {
    super()
    this.url = String(url)
    queueMicrotask(() => {
      if (this.readyState !== TestSocket.CONNECTING) return
      this.readyState = TestSocket.OPEN
      this.dispatchEvent(new Event('open'))
    })
  }

  send(): void {}

  close(): void {
    if (this.readyState === TestSocket.CLOSED) return
    this.readyState = TestSocket.CLOSED
    this.dispatchEvent(new Event('close'))
  }
}

class FailingSocket extends TestSocket {
  constructor(url: string | URL) {
    super(url)
    throw new Error('socket failed')
  }
}

class HangingSocket extends TestSocket {
  constructor(url: string | URL) {
    super(url)
    this.readyState = 99
  }
}

test.each(['success', 'fault', 'abort', 'timeout'] as const)('WebSocket releases caller abort listeners after %s', async (mode) => {
  const Socket = mode === 'success' ? TestSocket : mode === 'fault' ? FailingSocket : HangingSocket
  const client = createClient(withEndpoint('https://example.test'), withWebSocketHandle(Socket))
  const caller = new AbortController()
  const signal = watch(caller.signal)
  const pending = client.execute(socketEndpoint(), { signal: caller.signal, ...(mode === 'timeout' ? { timeout: 1 } : {}) })
  if (mode === 'abort') caller.abort('stop')
  const [fault, session] = await pending
  if (mode === 'success') {
    if (!session) throw new Error('Expected a WebSocket session')
    session.close()
    await session.closed
  }
  if (mode === 'success') expect(fault).toBeNull()
  else expect(fault).toBeTruthy()
  signal.expectReleased()
})
