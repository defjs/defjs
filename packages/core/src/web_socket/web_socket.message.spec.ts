import { beforeEach, describe, expect, inject, test, vi } from 'vitest'
import { createClient, withEndpoint, withWebSocketHandle, type Client } from '../client'
import { StructError, struct } from '../struct'
import { serializeOutgoingWebSocketMessage, transformWebSocketMessage } from './codec'
import { createControllableSocketClass, openControllableSocket } from '../../test/regression/controllable_socket'
import { defineWebSocket, type SocketAwaitResult } from './index'

const ChatIncoming = struct.discriminatedUnion('type', [
  struct.object({
    roomId: struct.string(),
    type: struct.literal('joined'),
    userId: struct.number(),
  }),
  struct.object({
    text: struct.string().alias('message_text'),
    type: struct.literal('message'),
    userId: struct.number(),
  }),
])

const ChatOutgoing = struct.object({
  text: struct.string().alias('message_text'),
  type: struct.literal('message'),
})

const HeartbeatIncoming = struct.object({
  ok: struct.boolean(),
  type: struct.literal('pong'),
})

const HeartbeatOutgoing = struct.object({
  at: struct.number().alias('sent_at'),
  type: struct.literal('ping'),
})

const BasicIncoming = struct.discriminatedUnion('type', [
  struct.object({
    roomId: struct.string(),
    type: struct.literal('joined'),
    userId: struct.number(),
  }),
  struct.object({
    text: struct.string(),
    type: struct.literal('message'),
    userId: struct.number(),
  }),
])

describe('web socket single struct messages', () => {
  let client: Client

  beforeEach(() => {
    client = createClient(withEndpoint(inject('testServerHost')))
  })

  async function run(command: unknown, options?: unknown): Promise<SocketAwaitResult<unknown, unknown>> {
    return client.execute(command as never, options as never) as Promise<SocketAwaitResult<unknown, unknown>>
  }

  test('decodes a discriminated incoming frame as the struct value', async () => {
    const decoded = await transformWebSocketMessage(ChatIncoming, JSON.stringify({ message_text: 'hi', type: 'message', userId: 7 }))

    expect(decoded).toEqual({ text: 'hi', type: 'message', userId: 7 })
  })

  test('delivers discriminated incoming frames from the socket as decoded values', async () => {
    const useChat = defineWebSocket({
      incoming: BasicIncoming,
      maxIncomingQueueSize: 4,
      path: '/ws/basic',
    })

    const [error, socket] = await run(useChat())
    expect(error).toBeNull()
    if (!socket) {
      throw new Error('Expected socket session')
    }

    const messages: unknown[] = []
    for await (const message of socket.receive) {
      messages.push(message)
    }

    expect(messages).toEqual([
      { roomId: 'default', type: 'joined', userId: 1 },
      { text: 'welcome:default', type: 'message', userId: 1 },
    ])
  })

  test('reports an incoming assertion failure to the runtime error listener without closing the session', async () => {
    const useSocket = defineWebSocket({
      incoming: struct.object({
        text: struct.string(),
        type: struct.literal('message'),
      }),
      maxIncomingQueueSize: 4,
      path: '/ws/error-before-close',
    })
    const [error, socket] = await run(useSocket())
    expect(error).toBeNull()
    if (!socket) {
      throw new Error('Expected socket session')
    }

    const runtimeErrors: unknown[] = []
    socket.onRuntimeError((runtimeError) => {
      runtimeErrors.push(runtimeError)
    })
    const messages: unknown[] = []
    for await (const message of socket.receive) {
      messages.push(message)
    }

    expect(messages).toEqual([])
    expect(runtimeErrors).toHaveLength(1)
    expect(runtimeErrors[0]).toBeInstanceOf(StructError)
    await expect(socket.closed).resolves.toMatchObject({ code: 1000, kind: 'closed', reason: 'done' })
  })

  test('encodes an outgoing struct with aliases before JSON.stringify', () => {
    const wire = serializeOutgoingWebSocketMessage(ChatOutgoing, { text: 'hello', type: 'message' })

    expect(JSON.parse(wire)).toEqual({ message_text: 'hello', type: 'message' })
  })

  test('echoes an alias-encoded outgoing frame and decodes it back', async () => {
    const useEcho = defineWebSocket({
      incoming: struct.discriminatedUnion('type', [
        struct.object({
          ok: struct.boolean(),
          type: struct.literal('ready'),
        }),
        struct.object({
          text: struct.string().alias('message_text'),
          type: struct.literal('message'),
        }),
      ]),
      maxIncomingQueueSize: 4,
      outgoing: ChatOutgoing,
      path: '/ws/echo',
    })
    const [error, socket] = await run(useEcho())
    expect(error).toBeNull()
    if (!socket) {
      throw new Error('Expected socket session')
    }

    const iterator = socket.receive[Symbol.asyncIterator]()
    await iterator.next()
    socket.send({ text: 'hello', type: 'message' })

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { text: 'hello', type: 'message' },
    })
    socket.close(1000, 'done')
    await expect(socket.closed).resolves.toMatchObject({ code: 1000, kind: 'closed' })
  })

  test('sends a heartbeat through the outgoing struct and classifies the decoded ack', async () => {
    vi.useFakeTimers()
    const { Socket, latest } = createControllableSocketClass()
    try {
      const useHeartbeat = defineWebSocket({
        incoming: HeartbeatIncoming,
        maxIncomingQueueSize: 4,
        outgoing: HeartbeatOutgoing,
        path: '/ws/heartbeat',
      })
      const acks: Array<{ ok: boolean; type: 'pong' }> = []
      const client = createClient(withEndpoint('https://example.test'), withWebSocketHandle(Socket as unknown as typeof WebSocket))
      const pending = client.execute(useHeartbeat(), {
        heartbeat: {
          intervalMs: 10,
          isAck(message: { ok: boolean; type: 'pong' }) {
            acks.push(message)
            return message.type === 'pong' && message.ok
          },
          message: () => ({ at: 1, type: 'ping' as const }),
          timeoutMs: 1_000,
        },
      })
      const [error, socket] = await openControllableSocket(pending, latest)
      const native = latest()

      expect(error).toBeNull()
      if (!socket || !native) {
        throw new Error('Expected socket session')
      }

      const runtimeErrors: unknown[] = []
      socket.onRuntimeError((runtimeError) => {
        runtimeErrors.push(runtimeError)
      })
      await vi.advanceTimersByTimeAsync(10)
      expect(JSON.parse(native.sent[0] ?? '')).toEqual({ sent_at: 1, type: 'ping' })
      native.triggerMessage('{"ok":true,"type":"pong"}')
      await vi.advanceTimersByTimeAsync(0)
      expect(acks).toEqual([{ ok: true, type: 'pong' }])
      await vi.advanceTimersByTimeAsync(1_000)

      expect(runtimeErrors).toEqual([])
      expect(socket.state).toBe('open')
      const iterator = socket.receive[Symbol.asyncIterator]()
      socket.close(1000, 'heartbeat-ok')
      native.triggerClose({ code: 1000, reason: 'heartbeat-ok', wasClean: true })
      await expect(socket.closed).resolves.toMatchObject({ code: 1000, kind: 'closed', reason: 'heartbeat-ok' })
      await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
    } finally {
      vi.useRealTimers()
    }
  })

  test('sends a nullable object field as JSON null', async () => {
    const { Socket, latest } = createControllableSocketClass()
    const profile = struct.object({ name: struct.string().alias('display_name') })
    const endpoint = defineWebSocket({
      incoming: struct.string(),
      maxIncomingQueueSize: 1,
      outgoing: struct.object({ profile: profile.nullable() }),
      path: '/socket',
    })
    const client = createClient(withEndpoint('https://example.test'), withWebSocketHandle(Socket as unknown as typeof WebSocket))
    const [error, session] = await openControllableSocket(client.execute(endpoint()), latest)
    const native = latest()

    expect(error).toBeNull()
    if (!session || !native) {
      throw new Error('Expected socket session')
    }

    session.send({ profile: null })
    expect(native.sent).toEqual(['{"profile":null}'])
    session.close(1000, 'done')
    native.triggerClose({ code: 1000, reason: 'done', wasClean: true })
    await session.closed
  })
})
