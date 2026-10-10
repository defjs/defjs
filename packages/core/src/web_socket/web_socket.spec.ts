import { beforeEach, describe, expect, inject, test, vi } from 'vitest'
import { createClient, withEndpoint, withInterceptors, withWebSocketHandle, type Client } from '../client'
import { ERR_ABORTED } from '../error'
import { createWebSocketInterceptor, type WebSocketSessionLike } from '../interceptor'
import { StructError, struct } from '../struct'
import { createControllableSocketClass, openControllableSocket } from '../../test/regression/controllable_socket'
import { defineWebSocket, type SocketAwaitResult } from './index'

async function withDeadline<T>(label: string, promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} exceeded 2000ms`)), 2_000)
        timeout.unref?.()
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

describe('web socket runtime', () => {
  let client: Client

  beforeEach(() => {
    client = createClient(withEndpoint(inject('testServerHost')))
  })

  async function run(command: unknown, options?: unknown): Promise<SocketAwaitResult<unknown, unknown>> {
    return client.execute(command as never, options as never) as Promise<SocketAwaitResult<unknown, unknown>>
  }

  test('should return transport error with invalid client', async () => {
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.unknown(),
      path: '/ws/basic',
    })

    const client = createClient(
      withEndpoint('http://localhost'),
      withWebSocketHandle(
        class {
          constructor() {
            throw new Error('invalid client')
          }
        } as unknown as typeof WebSocket,
      ),
    )

    const [error, socket, connection] = await client.execute(useSocket())

    expect(socket).toBeUndefined()
    expect(connection).toBeUndefined()
    expect(error?.code.startsWith('NET_')).toBe(true)
  })

  test('should reject with abort and timeout before starting websocket transport', async () => {
    const controller = new AbortController()
    let beforeConnectCalls = 0
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.unknown(),
      path: '/ws/basic',
    })

    const command = useSocket()
    const [error, socket, connection] = await run(command, {
      abort: controller.signal,
      beforeConnect: () => {
        beforeConnectCalls += 1
      },
      timeout: 1,
    })

    expect(socket).toBeUndefined()
    expect(connection).toBeUndefined()
    expect(error?.code.startsWith('REQ_')).toBe(true)
    expect(error?.code).toBe('REQ_OPTIONS_INVALID')
    expect(error?.message).toBe('abort and timeout cannot be used together')
    expect(beforeConnectCalls).toBe(0)
  })

  test('should prefer websocket cancellation config conflict over an already aborted signal', async () => {
    const controller = new AbortController()
    controller.abort(ERR_ABORTED)
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.unknown(),
      path: '/ws/basic',
    })

    const command = useSocket()
    const [error, socket, connection] = await run(command, {
      abort: controller.signal,
      timeout: 1,
    })

    expect(socket).toBeUndefined()
    expect(connection).toBeUndefined()
    expect(error?.code.startsWith('REQ_')).toBe(true)
    expect(error?.code).toBe('REQ_OPTIONS_INVALID')
    expect(error?.message).toBe('abort and timeout cannot be used together')
  })

  test.each([
    { options: { heartbeat: { intervalMs: Number.POSITIVE_INFINITY } }, source: 'heartbeat' },
    { options: { reconnect: { attempts: Number.POSITIVE_INFINITY, delayMs: 0 } }, source: 'reconnect' },
  ])('should reject invalid $source timer config before constructing a socket', async ({ options }) => {
    let constructorCalls = 0
    const isolated = createClient(
      withEndpoint(inject('testServerHost')),
      withWebSocketHandle(
        class {
          constructor() {
            constructorCalls += 1
          }
        } as unknown as typeof WebSocket,
      ),
    )
    const useSocket = defineWebSocket({ maxIncomingQueueSize: 1, incoming: struct.unknown(), path: '/ws/basic' })

    const [error, socket, connection] = await isolated.execute(useSocket(), options as never)

    expect(error?.code.startsWith('REQ_')).toBe(true)
    expect(error?.code).toBe('REQ_OPTIONS_INVALID')
    expect(socket).toBeUndefined()
    expect(connection).toBeUndefined()
    expect(constructorCalls).toBe(0)
  })

  test('should resolve execute and receive typed messages', async () => {
    const useChatSocket = defineWebSocket({
      builder: (input) => input,
      maxIncomingQueueSize: 16,
      incoming: struct.discriminatedUnion('type', [
        struct.object({ type: struct.literal('joined'), roomId: struct.string(), userId: struct.number() }),
        struct.object({ type: struct.literal('message'), text: struct.string(), userId: struct.number() }),
      ]),
      input: struct.object({
        query: struct.object({
          roomId: struct.string(),
        }),
      }),
      outgoing: struct.object({ type: struct.literal('message'), text: struct.string() }),
      path: '/ws/basic',
      protocols: ['json'],
    })

    const [error, socket, connection] = await run(useChatSocket({ query: { roomId: 'room-1' } }))

    expect(error).toBeNull()
    expect(connection?.protocol).toBe('json')
    expect(connection?.url).toContain('/ws/basic?roomId=room-1')

    if (!socket) {
      throw new Error('Expected socket session')
    }

    const messages: unknown[] = []
    for await (const message of socket.receive) {
      messages.push(message)
    }

    expect(messages).toEqual([
      { roomId: 'room-1', type: 'joined', userId: 1 },
      { text: 'welcome:room-1', type: 'message', userId: 1 },
    ])
    await expect(socket.closed).resolves.toMatchObject({ code: 1000 })
  })

  test('should validate outgoing messages and echo typed responses', async () => {
    const useEchoSocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.discriminatedUnion('type', [
        struct.object({ type: struct.literal('message'), text: struct.string() }),
        struct.object({ type: struct.literal('ready'), ok: struct.boolean() }),
      ]),
      outgoing: struct.object({ type: struct.literal('message'), text: struct.string() }),
      path: '/ws/echo',
      protocols: ['json'],
    })

    const [error, socket, connection] = await run(useEchoSocket())

    expect(error).toBeNull()
    expect(connection?.protocol).toBe('json')

    if (!socket) {
      throw new Error('Expected socket session')
    }

    const iterator = socket.receive[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { ok: true, type: 'ready' },
    })

    socket.send({
      text: 'hello',
      type: 'message',
    })

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { text: 'hello', type: 'message' },
    })

    socket.close(1000, 'done')
    await expect(socket.closed).resolves.toMatchObject({ code: 1000 })
  })

  test('should use await using for a real local websocket handshake, message, and close', async () => {
    const useEchoSocket = defineWebSocket({
      maxIncomingQueueSize: 2,
      incoming: struct.discriminatedUnion('type', [
        struct.object({ type: struct.literal('message'), text: struct.string() }),
        struct.object({ type: struct.literal('ready'), ok: struct.boolean() }),
      ]),
      outgoing: struct.object({ type: struct.literal('message'), text: struct.string() }),
      path: '/ws/echo',
      protocols: ['json'],
    })
    const [error, session, connection] = await run(useEchoSocket())

    expect(error).toBeNull()
    expect(connection?.protocol).toBe('json')
    if (!session) {
      throw new Error('Expected socket session')
    }

    {
      await using socket = session
      const iterator = socket.receive[Symbol.asyncIterator]()
      await expect(iterator.next()).resolves.toEqual({ done: false, value: { ok: true, type: 'ready' } })
      socket.send({ text: 'owned', type: 'message' })
      await expect(iterator.next()).resolves.toEqual({ done: false, value: { text: 'owned', type: 'message' } })
    }

    await expect(session.closed).resolves.toMatchObject({ kind: 'closed' })
  })

  test('should support heartbeat with timeout', async () => {
    vi.useFakeTimers()
    const { Socket, latest } = createControllableSocketClass()
    try {
      const useHeartbeatSocket = defineWebSocket({
        maxIncomingQueueSize: 16,
        incoming: struct.object({ type: struct.literal('pong'), ok: struct.boolean() }),
        outgoing: struct.object({ type: struct.literal('ping') }),
        path: '/ws/heartbeat-silent',
      })
      const handled = createClient(withEndpoint('https://example.test'), withWebSocketHandle(Socket as unknown as typeof WebSocket))
      const [error, socket] = await openControllableSocket(
        handled.execute(useHeartbeatSocket(), {
          heartbeat: {
            intervalMs: 10,
            message: () => ({ type: 'ping' as const }),
            timeoutMs: 5,
          },
        }),
        latest,
      )

      expect(error).toBeNull()
      if (!socket) {
        throw new Error('Expected socket')
      }

      let runtimeError: unknown
      socket.onRuntimeError((err: unknown) => {
        runtimeError = err
      })

      // The ack deadline is armed only after the first ping. Advancing both timers explicitly keeps a
      // stalled event loop from observing the deadline before this assertion.
      await vi.advanceTimersByTimeAsync(15)
      await expect(socket.closed).resolves.toMatchObject({
        cause: expect.objectContaining({ message: 'WebSocket heartbeat timeout' }),
        kind: 'error',
      })
      expect(runtimeError).toEqual(expect.objectContaining({ message: 'WebSocket heartbeat timeout' }))
    } finally {
      vi.useRealTimers()
    }
  })

  test('should mark heartbeat ack when server responds with pong', async () => {
    vi.useFakeTimers()
    const { Socket, latest } = createControllableSocketClass()
    try {
      const useHeartbeatSocket = defineWebSocket({
        maxIncomingQueueSize: 16,
        incoming: struct.object({ type: struct.literal('pong'), ok: struct.boolean() }),
        outgoing: struct.object({ type: struct.literal('ping') }),
        path: '/ws/heartbeat',
      })
      const handled = createClient(withEndpoint('https://example.test'), withWebSocketHandle(Socket as unknown as typeof WebSocket))
      const [error, socket] = await openControllableSocket(
        handled.execute(useHeartbeatSocket(), {
          heartbeat: {
            intervalMs: 10,
            isAck: (message: { type: string }) => message.type === 'pong',
            message: () => ({ type: 'ping' as const }),
            timeoutMs: 1_000,
          },
        }),
        latest,
      )
      const native = latest()

      expect(error).toBeNull()
      if (!socket || !native) {
        throw new Error('Expected socket')
      }

      let runtimeError: unknown
      socket.onRuntimeError((err: unknown) => {
        runtimeError = err
      })
      await vi.advanceTimersByTimeAsync(10)
      expect(JSON.parse(native.sent[0] ?? '')).toEqual({ type: 'ping' })
      native.triggerMessage('{"ok":true,"type":"pong"}')
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(1_000)

      expect(runtimeError).toBeUndefined()
      expect(socket.state).toBe('open')
      const iterator = socket.receive[Symbol.asyncIterator]()
      socket.close(1000, 'heartbeat-ok')
      native.triggerClose({ code: 1000, reason: 'heartbeat-ok', wasClean: true })
      await expect(socket.closed).resolves.toMatchObject({ code: 1000, reason: 'heartbeat-ok' })
      await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
    } finally {
      vi.useRealTimers()
    }
  })

  test('should report malformed JSON, drop the frame, and keep the session alive', async () => {
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.object({ type: struct.literal('message'), text: struct.string() }),
      path: '/ws/invalid',
    })

    const [error, socket] = await run(useSocket())

    expect(error).toBeNull()
    if (!socket) {
      throw new Error('Expected socket')
    }

    let runtimeError: unknown
    socket.onRuntimeError((error) => {
      runtimeError = error
    })
    const events: unknown[] = []
    for await (const event of socket.receive) {
      events.push(event)
    }

    expect(events).toEqual([])
    expect(runtimeError).toBeInstanceOf(SyntaxError)
    await expect(socket.closed).resolves.toMatchObject({ code: 1000, reason: 'done' })
  })

  test('should emit runtime error when incoming message struct validation fails', async () => {
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.object({ type: struct.literal('message'), text: struct.string() }),
      path: '/ws/error-before-close',
    })

    const [error, socket] = await run(useSocket())

    expect(error).toBeNull()
    if (!socket) {
      throw new Error('Expected socket')
    }

    let runtimeError: unknown
    socket.onRuntimeError((err: unknown) => {
      runtimeError = err
    })

    await expect(socket.closed).resolves.toMatchObject({ code: 1000, reason: 'done' })
    expect(runtimeError).toBeDefined()
  })

  test('should skip undeclared incoming message types', async () => {
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.object({ type: struct.literal('message'), text: struct.string() }),
      path: '/ws/unknown-message',
    })

    const [error, socket] = await run(useSocket())

    expect(error).toBeNull()
    if (!socket) {
      throw new Error('Expected socket')
    }

    const events: unknown[] = []
    for await (const event of socket.receive) {
      events.push(event)
    }

    expect(events).toEqual([])
    await expect(socket.closed).resolves.toMatchObject({ code: 1000, reason: 'done' })
  })

  test('should expose session state transitions and allow unsubscribing listeners', async () => {
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.object({ type: struct.literal('ready'), ok: struct.boolean() }),
      path: '/ws/echo',
    })

    const [error, socket, connection] = await run(useSocket())

    expect(error).toBeNull()
    expect(connection?.url).toContain('/ws/echo')

    if (!socket) {
      throw new Error('Expected socket')
    }

    const states: string[] = []
    const unsubscribeSocketState = socket.onStateChange((state) => {
      states.push(state)
    })
    const unsubscribeSocketError = socket.onRuntimeError(() => {
      throw new Error('Unexpected socket runtime error')
    })

    expect(socket.connection.url).toContain('/ws/echo')
    expect(socket.state).toBe('open')

    unsubscribeSocketState()
    unsubscribeSocketError()

    socket.close(1000, 'done')
    await expect(socket.closed).resolves.toMatchObject({ code: 1000, reason: 'done' })
    expect(states).toEqual([])
  })

  test('should support abort after startup and ignore socket.close after cleanup', async () => {
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.object({ type: struct.literal('ready'), ok: struct.boolean() }),
      path: '/ws/echo',
    })

    const controller = new AbortController()
    const [error, socket] = await run(useSocket(), { signal: controller.signal })

    expect(error).toBeNull()
    if (!socket) {
      throw new Error('Expected socket')
    }

    controller.abort('manual')
    await expect(socket.closed).resolves.toBeDefined()

    socket.close(1000, 'after-cleanup')
    socket.close(1000, 'after-cleanup-2')
  })

  test('should abort before startup and surface aborted transport error', async () => {
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.unknown(),
      path: '/ws/basic',
    })

    const controller = new AbortController()
    const executePromise = run(useSocket(), { signal: controller.signal })
    controller.abort(ERR_ABORTED)

    const [error, socket, connection] = await executePromise

    expect(socket).toBeUndefined()
    expect(connection).toBeUndefined()
    expect(error?.code.startsWith('NET_')).toBe(true)
    expect(error?.code).toBe('NET_ABORTED')
  })

  test('should return definition error when input validation fails', async () => {
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.unknown(),
      builder: () => ({}),
      input: struct.object({
        id: struct.number(),
      }),
      path: '/ws/basic',
    })

    const [error, socket, connection] = await run(useSocket({ id: 'bad' } as never))

    expect(socket).toBeUndefined()
    expect(connection).toBeUndefined()
    expect(error?.code).toBe('REQ_INPUT_INVALID')
    expect(error?.code).toBe('REQ_INPUT_INVALID')
  })

  test('should return definition error when build throws', async () => {
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      builder: () => {
        throw new Error('build failed')
      },
      incoming: struct.unknown(),
      input: struct.object({}),
      path: '/ws/basic',
    })

    const [error, socket, connection] = await run(useSocket({}))

    expect(socket).toBeUndefined()
    expect(connection).toBeUndefined()
    expect(error?.code).toBe('REQ_BUILD_FAILED')
    expect(error?.code).toBe('REQ_BUILD_FAILED')
  })

  test('should return definition error when websocket url creation fails', async () => {
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.unknown(),
      path: '/ws/basic',
    })

    const badClient = createClient(withEndpoint('not-a-valid-url'))
    const [error, socket, connection] = await badClient.execute(useSocket())

    expect(socket).toBeUndefined()
    expect(connection).toBeUndefined()
    expect(error?.code).toBe('REQ_BUILD_FAILED')
    expect(error?.code).toBe('REQ_BUILD_FAILED')
  })

  test('should report a throwing beforeConnect as an extension hook fault', async () => {
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.unknown(),
      path: '/ws/basic',
    })

    const command = useSocket()
    const [error, socket, connection] = await run(command, {
      beforeConnect: async () => {
        throw new Error('beforeConnect failed')
      },
    })

    expect(socket).toBeUndefined()
    expect(connection).toBeUndefined()
    expect(error?.code).toBe('EXT_HOOK_FAILED')
  })

  test('should support reconnect, queued sends, and abort during reconnect delay', async () => {
    const useSocket = defineWebSocket({
      builder: (input) => input,
      maxIncomingQueueSize: 16,
      maxOutgoingQueueSize: 1,
      input: struct.object({ query: struct.object({ key: struct.string() }) }),
      incoming: struct.discriminatedUnion('type', [
        struct.object({ type: struct.literal('message'), text: struct.string() }),
        struct.object({ type: struct.literal('reconnected'), attempt: struct.number() }),
      ]),
      outgoing: struct.object({ type: struct.literal('message'), text: struct.string() }),
      path: '/ws/reconnect',
    })

    const controller = new AbortController()
    const testKey = `reconnect-queue-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const command = useSocket({ query: { key: testKey } })
    const [error, socket] = await run(command, {
      abort: controller.signal,
      reconnect: { attempts: 2, delayMs: 20 },
    })

    expect(error).toBeNull()
    if (!socket) {
      throw new Error('Expected socket')
    }

    const iterator = socket.receive[Symbol.asyncIterator]()
    await new Promise<void>((resolve) => {
      if (socket.state === 'reconnecting') {
        resolve()
        return
      }
      const unsubscribe = socket.onStateChange((state) => {
        if (state === 'reconnecting') {
          unsubscribe()
          resolve()
        }
      })
    })
    socket.send({ type: 'message', text: 'queued-before-reconnect' })

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { attempt: 2, type: 'reconnected' },
    })
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { text: 'queued-before-reconnect', type: 'message' },
    })

    controller.abort('stop reconnect loop')
    await expect(socket.closed).resolves.toBeDefined()
    expect(socket.state).toBe('aborted')
  }, 5000)

  test('should abort during reconnect delay with aborted state', async () => {
    const useSocket = defineWebSocket({
      builder: (input) => input,
      maxIncomingQueueSize: 16,
      input: struct.object({ query: struct.object({ key: struct.string() }) }),
      incoming: struct.object({ type: struct.literal('reconnected'), attempt: struct.number() }),
      path: '/ws/reconnect',
    })

    const controller = new AbortController()
    const command = useSocket({ query: { key: 'abort-during-delay' } })
    const [error, socket] = await run(command, {
      abort: controller.signal,
      // The delay is the clock under test: abort is joined to the reconnecting signal, so the
      // delay only has to outlive that observation instead of a fixed sleep.
      reconnect: { attempts: 2, delayMs: 60_000 },
    })

    expect(error).toBeNull()
    if (!socket) {
      throw new Error('Expected socket')
    }

    await new Promise<void>((resolve) => {
      if (socket.state === 'reconnecting') {
        resolve()
        return
      }
      const unsubscribe = socket.onStateChange((state) => {
        if (state === 'reconnecting') {
          unsubscribe()
          resolve()
        }
      })
    })
    controller.abort(ERR_ABORTED)

    await expect(socket.closed).resolves.toBeDefined()
    expect(socket.state).toBe('aborted')
  })

  test('should reconnect immediately when delay is zero', async () => {
    const useSocket = defineWebSocket({
      builder: (input) => input,
      maxIncomingQueueSize: 16,
      input: struct.object({ query: struct.object({ key: struct.string() }) }),
      incoming: struct.object({ type: struct.literal('reconnected'), attempt: struct.number() }),
      path: '/ws/reconnect',
    })

    const command = useSocket({ query: { key: 'immediate-case' } })
    const [error, socket] = await run(command, {
      reconnect: { attempts: 1, delayMs: 0 },
    })

    expect(error).toBeNull()
    if (!socket) {
      throw new Error('Expected socket')
    }

    const iterator = socket.receive[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { attempt: 2, type: 'reconnected' },
    })

    socket.close(1000, 'done')
    await expect(socket.closed).resolves.toMatchObject({ code: 1000 })
  })

  test('should allow websocket interceptors to short-circuit startup', async () => {
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.unknown(),
      path: '/ws/basic',
    })

    const clientWithInterceptor = createClient(
      withEndpoint(inject('testServerHost')),
      withInterceptors(
        createWebSocketInterceptor(async () => {
          throw new Error('blocked by interceptor')
        }),
      ),
    )

    const [error, socket, connection] = await clientWithInterceptor.execute(useSocket())

    expect(socket).toBeUndefined()
    expect(connection).toBeUndefined()
    expect(error).toBeInstanceOf(Error)
  })

  test('should settle every session created before an interceptor chain fails', async () => {
    const useSocket = defineWebSocket({ maxIncomingQueueSize: 16, incoming: struct.unknown(), path: '/ws/echo' })
    const interceptorFailure = new Error('outer interceptor failed')
    const createdSessions: WebSocketSessionLike[] = []
    const clientWithInterceptor = createClient(
      withEndpoint(inject('testServerHost')),
      withInterceptors(
        createWebSocketInterceptor(async (request, next) => {
          createdSessions.push(await next(request))
          throw interceptorFailure
        }),
      ),
    )

    const [error, socket] = await clientWithInterceptor.execute(useSocket())

    // The startup catch classifies an unclassified throw and keeps the original on `cause`.
    expect(error).toMatchObject({ cause: interceptorFailure, code: 'EXT_INTERCEPTOR_FAILED' })
    expect(socket).toBeUndefined()
    expect(createdSessions).toHaveLength(1)
    const terminal = await Promise.race([
      Promise.all(createdSessions.map((session) => session.closed)),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 50)),
    ])
    expect(terminal).not.toBe(false)
    expect(createdSessions.every((session) => ['aborted', 'closed', 'error'].includes(session.state))).toBe(true)
  })

  test('should reject a second websocket interceptor next call and settle the first session', async () => {
    const useSocket = defineWebSocket({ maxIncomingQueueSize: 16, incoming: struct.unknown(), path: '/ws/echo' })
    let firstSession: WebSocketSessionLike | undefined
    const clientWithInterceptor = createClient(
      withEndpoint(inject('testServerHost')),
      withInterceptors(
        createWebSocketInterceptor(async (request, next) => {
          firstSession = await next(request)
          return next(request)
        }),
      ),
    )

    const [error, socket] = await clientWithInterceptor.execute(useSocket())

    if (socket) {
      socket.close(1000, 'unexpected second session')
      await socket.closed
    }

    expect(error).toMatchObject({ message: 'WebSocket interceptor next() may only be called once' })
    expect(socket).toBeUndefined()
    expect(firstSession).toBeDefined()
    const terminal = await Promise.race([firstSession?.closed, new Promise<false>((resolve) => setTimeout(() => resolve(false), 50))])
    expect(terminal).not.toBe(false)
  })

  test('should close a created session discarded by a successful interceptor', async () => {
    const useSocket = defineWebSocket({ maxIncomingQueueSize: 16, incoming: struct.unknown(), path: '/ws/echo' })
    let discardedSession: WebSocketSessionLike | undefined
    const shortCircuitSession: WebSocketSessionLike = {
      bufferedAmount: 0,
      close() {},
      closed: Promise.resolve({ kind: 'closed' }),
      connection: { generation: 99 },
      onRuntimeError: () => () => {},
      onStateChange: () => () => {},
      receive: {
        async *[Symbol.asyncIterator]() {},
      },
      send() {},
      state: 'closed',
      [Symbol.asyncDispose]() {
        this.close()
        return this.closed.then(() => undefined)
      },
    }
    const clientWithInterceptor = createClient(
      withEndpoint(inject('testServerHost')),
      withInterceptors(
        createWebSocketInterceptor(async (request, next) => {
          discardedSession = await next(request)
          return shortCircuitSession
        }),
      ),
    )

    const [error, socket] = await clientWithInterceptor.execute(useSocket())

    expect(error).toBeNull()
    expect(socket).toBe(shortCircuitSession)
    expect(discardedSession).toBeDefined()
    const terminal = await Promise.race([discardedSession?.closed, new Promise<false>((resolve) => setTimeout(() => resolve(false), 50))])
    expect(terminal).not.toBe(false)
  })

  test('should preserve a wrapper that delegates the created session closed promise', async () => {
    const useSocket = defineWebSocket({ maxIncomingQueueSize: 16, incoming: struct.unknown(), path: '/ws/echo' })
    let createdSession: WebSocketSessionLike | undefined
    const clientWithInterceptor = createClient(
      withEndpoint(inject('testServerHost')),
      withInterceptors(
        createWebSocketInterceptor(async (request, next) => {
          createdSession = await next(request)
          return new Proxy(createdSession, {})
        }),
      ),
    )

    const [error, socket] = await clientWithInterceptor.execute(useSocket())

    expect(error).toBeNull()
    expect(socket).toBeDefined()
    expect(socket).not.toBe(createdSession)
    expect(socket?.state).toBe('open')
    socket?.close(1000, 'done')
    await expect(socket?.closed).resolves.toMatchObject({ kind: 'closed' })
  })

  test('should connect with request changes made by websocket interceptors', async () => {
    const useSocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.object({ type: struct.literal('joined'), roomId: struct.string(), userId: struct.number() }),
      path: '/ws/basic',
    })

    const clientWithInterceptor = createClient(
      withEndpoint(inject('testServerHost')),
      withInterceptors(
        createWebSocketInterceptor(async (request, next) =>
          next({
            ...request,
            queryString: 'roomId=from-interceptor',
          }),
        ),
      ),
    )

    const [error, socket, connection] = await clientWithInterceptor.execute(useSocket())

    expect(error).toBeNull()
    expect(connection?.url).toContain('roomId=from-interceptor')
    if (!socket) {
      throw new Error('Expected socket session')
    }

    const iterator = socket.receive[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { roomId: 'from-interceptor', type: 'joined', userId: 1 },
    })

    socket.close(1000, 'done')
    await expect(socket.closed).resolves.toMatchObject({ code: 1000 })
  })

  test('encodes provider commands with aliases and decodes wire frames', async () => {
    const useProviderSocket = defineWebSocket({
      builder: (input) => input,
      incoming: struct.or(
        struct.object({
          method: struct.literal('subscribe'),
          result: struct.object({ channel: struct.string() }),
          success: struct.boolean(),
        }),
        struct.object({ channel: struct.literal('heartbeat') }),
        struct.object({
          channel: struct.literal('ticker'),
          data: struct.array(struct.object({ last: struct.number(), symbol: struct.string() })),
          type: struct.literal('update'),
        }),
        struct.object({
          method: struct.literal('wire'),
          result: struct.object({
            attempt: struct.number(),
            hasType: struct.boolean(),
            keys: struct.array(struct.string()),
            method: struct.string(),
            reqId: struct.number().alias('req_id'),
          }),
          success: struct.boolean(),
        }),
      ),
      input: struct.object({ query: struct.object({ key: struct.string(), mode: struct.literal('queue') }) }),
      maxIncomingQueueSize: 3,
      maxOutgoingQueueSize: 1,
      outgoing: struct.object({
        method: struct.literal('subscribe'),
        params: struct.object({ channel: struct.string() }),
        reqId: struct.number().alias('req_id'),
      }),
      path: '/ws/provider-envelopes',
    })
    const key = `provider-queue-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const [error, socket] = await withDeadline(
      'provider queue execute',
      client.execute(useProviderSocket({ query: { key, mode: 'queue' } }), {
        reconnect: { attempts: 1, delayMs: 0 },
      }),
    )

    expect(error).toBeNull()
    if (!socket) {
      throw new Error('Expected provider socket')
    }

    const iterator = socket.receive[Symbol.asyncIterator]()
    const queued = Promise.withResolvers<void>()
    let queuedOnce = false
    const unsubscribe = socket.onStateChange((state) => {
      if (state !== 'reconnecting' || queuedOnce) {
        return
      }
      queuedOnce = true
      try {
        socket.send({ method: 'subscribe', params: { channel: 'book' }, reqId: 2 })
        queued.resolve()
      } catch (cause) {
        queued.reject(cause)
      }
    })

    try {
      await expect(withDeadline('provider subscribe frame', iterator.next())).resolves.toEqual({
        done: false,
        value: { method: 'subscribe', result: { channel: 'ticker' }, success: true },
      })
      await expect(withDeadline('provider heartbeat frame', iterator.next())).resolves.toEqual({
        done: false,
        value: { channel: 'heartbeat' },
      })
      await expect(withDeadline('provider ticker frame', iterator.next())).resolves.toEqual({
        done: false,
        value: {
          channel: 'ticker',
          data: [{ last: 1, symbol: 'BTC/USD' }],
          type: 'update',
        },
      })

      socket.send({ method: 'subscribe', params: { channel: 'ticker' }, reqId: 1 })
      await expect(withDeadline('direct provider wire reply', iterator.next())).resolves.toEqual({
        done: false,
        value: {
          method: 'wire',
          result: {
            attempt: 1,
            hasType: false,
            keys: ['method', 'params', 'req_id'],
            method: 'subscribe',
            reqId: 1,
          },
          success: true,
        },
      })
      await withDeadline('queued provider send', queued.promise)
      await expect(withDeadline('reconnect provider heartbeat', iterator.next())).resolves.toEqual({
        done: false,
        value: { channel: 'heartbeat' },
      })
      await expect(withDeadline('queued provider wire reply', iterator.next())).resolves.toEqual({
        done: false,
        value: {
          method: 'wire',
          result: {
            attempt: 2,
            hasType: false,
            keys: ['method', 'params', 'req_id'],
            method: 'subscribe',
            reqId: 2,
          },
          success: true,
        },
      })
    } finally {
      unsubscribe()
      socket.close(1000, 'done')
      await withDeadline('provider queue close', socket.closed)
    }
  })

  test('throws outgoing struct failures synchronously', async () => {
    const useProviderSocket = defineWebSocket({
      builder: (input) => input,
      incoming: struct.unknown(),
      input: struct.object({ query: struct.object({ key: struct.string(), mode: struct.literal('throw') }) }),
      maxIncomingQueueSize: 1,
      outgoing: struct.object({ method: struct.literal('command') }),
      path: '/ws/provider-envelopes',
    })
    const key = `provider-throw-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const [error, socket] = await withDeadline(
      'provider throw execute',
      client.execute(useProviderSocket({ query: { key, mode: 'throw' } })),
    )

    expect(error).toBeNull()
    if (!socket) {
      throw new Error('Expected provider socket')
    }

    try {
      let thrown: unknown
      try {
        // @ts-expect-error method is not a declared outgoing literal
        socket.send({ method: 'nope' })
      } catch (cause) {
        thrown = cause
      }
      expect(thrown).toBeInstanceOf(StructError)
    } finally {
      socket.close(1000, 'done')
      await withDeadline('provider throw close', socket.closed)
    }
  })

  test('encodes heartbeat commands with aliases and consumes the decoded pong as ack', async () => {
    vi.useFakeTimers()
    const { Socket, latest } = createControllableSocketClass()
    try {
      const useProviderSocket = defineWebSocket({
        builder: (input) => input,
        incoming: struct.or(
          struct.object({ channel: struct.literal('heartbeat') }),
          struct.object({ method: struct.literal('pong'), reqId: struct.number().alias('req_id') }),
          struct.object({
            method: struct.literal('wire'),
            result: struct.object({
              attempt: struct.number(),
              hasType: struct.boolean(),
              keys: struct.array(struct.string()),
              method: struct.string(),
              reqId: struct.number().alias('req_id'),
            }),
            success: struct.boolean(),
          }),
        ),
        input: struct.object({ query: struct.object({ key: struct.string(), mode: struct.literal('heartbeat') }) }),
        maxIncomingQueueSize: 64,
        outgoing: struct.object({ method: struct.literal('ping'), reqId: struct.number().alias('req_id') }),
        path: '/ws/provider-envelopes',
      })
      const acks: Array<{ method: 'pong'; reqId: number }> = []
      const handled = createClient(withEndpoint('https://example.test'), withWebSocketHandle(Socket as unknown as typeof WebSocket))
      const [error, socket] = await openControllableSocket(
        handled.execute(useProviderSocket({ query: { key: 'provider-heartbeat', mode: 'heartbeat' } }), {
          heartbeat: {
            intervalMs: 20,
            isAck(message) {
              if ('method' in message && message.method === 'pong') {
                acks.push({ method: 'pong', reqId: message.reqId })
              }
              return 'method' in message && message.method === 'pong'
            },
            message: () => ({ method: 'ping' as const, reqId: 7 }),
            timeoutMs: 200,
          },
        }),
        latest,
      )
      const native = latest()

      expect(error).toBeNull()
      if (!socket || !native) {
        throw new Error('Expected provider socket')
      }

      const runtimeErrors: unknown[] = []
      const unsubscribe = socket.onRuntimeError((runtimeError) => {
        runtimeErrors.push(runtimeError)
      })
      const iterator = socket.receive[Symbol.asyncIterator]()
      const wireReply = {
        method: 'wire' as const,
        result: {
          attempt: 1,
          hasType: false,
          keys: ['method', 'req_id'],
          method: 'ping',
          reqId: 7,
        },
        success: true,
      }

      try {
        native.triggerMessage(JSON.stringify({ channel: 'heartbeat' }))
        await expect(iterator.next()).resolves.toEqual({
          done: false,
          value: { channel: 'heartbeat' },
        })

        await vi.advanceTimersByTimeAsync(20)
        expect(native.sent).toHaveLength(1)
        echoProviderPing(native, native.sent[0] ?? '')
        await vi.advanceTimersByTimeAsync(0)
        expect(acks).toEqual([{ method: 'pong', reqId: 7 }])
        await expect(iterator.next()).resolves.toEqual({ done: false, value: wireReply })

        // The second ping re-arms the ack deadline. Acknowledge it before advancing past timeoutMs.
        await vi.advanceTimersByTimeAsync(20)
        expect(native.sent).toHaveLength(2)
        echoProviderPing(native, native.sent[1] ?? '')
        await vi.advanceTimersByTimeAsync(0)
        expect(acks).toEqual([
          { method: 'pong', reqId: 7 },
          { method: 'pong', reqId: 7 },
        ])
        await expect(iterator.next()).resolves.toEqual({ done: false, value: wireReply })
        await vi.advanceTimersByTimeAsync(200)

        expect(socket.state).toBe('open')
        expect(runtimeErrors).toEqual([])
      } finally {
        unsubscribe()
        socket.close(1000, 'done')
        native.triggerClose({ code: 1000, reason: 'done', wasClean: true })
        await socket.closed
      }
    } finally {
      vi.useRealTimers()
    }
  })
})

function echoProviderPing(socket: { triggerMessage(data: unknown): void }, payload: string): void {
  const decoded = JSON.parse(payload) as Record<string, unknown>
  socket.triggerMessage(
    JSON.stringify({
      method: 'wire',
      result: {
        attempt: 1,
        hasType: Object.hasOwn(decoded, 'type'),
        keys: Object.keys(decoded).sort(),
        method: decoded['method'],
        req_id: decoded['req_id'],
      },
      success: true,
    }),
  )
  socket.triggerMessage(JSON.stringify({ method: 'pong', req_id: decoded['req_id'] }))
}
