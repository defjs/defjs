import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { struct } from '../struct'
import type { HeartbeatSession } from './heartbeat'
import { startHeartbeat, stopHeartbeat, validateHeartbeatConfig } from './heartbeat'

describe('heartbeat', () => {
  let sessions: HeartbeatSession<unknown>[]

  beforeEach(() => {
    sessions = []
    vi.useFakeTimers()
  })

  afterEach(() => {
    const errors: unknown[] = []
    for (const session of sessions) {
      try {
        stopHeartbeat(session)
      } catch (error) {
        errors.push(error)
      }
    }
    try {
      const remainingTimers = vi.getTimerCount()
      if (remainingTimers !== 0) {
        throw new Error(`Heartbeat timers remaining after stop: ${remainingTimers}`)
      }
    } catch (error) {
      errors.push(error)
    }
    try {
      vi.useRealTimers()
    } catch (error) {
      errors.push(error)
    }
    try {
      vi.unstubAllGlobals()
    } catch (error) {
      errors.push(error)
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, 'Heartbeat test cleanup failed')
    }
  })

  function createMockSocket(readyState: number = WebSocket.OPEN) {
    return {
      bufferedAmount: 0,
      readyState,
      send: vi.fn(),
    } as unknown as WebSocket
  }

  function createMockSession(currentSocket?: WebSocket): HeartbeatSession<unknown> {
    const session: HeartbeatSession<unknown> = {
      currentSocket,
      heartbeat: undefined,
    }
    sessions.push(session)
    return session
  }

  test.each([
    ['intervalMs', { intervalMs: 0 }],
    ['intervalMs', { intervalMs: -1 }],
    ['intervalMs', { intervalMs: Number.NaN }],
    ['intervalMs', { intervalMs: Number.POSITIVE_INFINITY }],
    ['intervalMs', { intervalMs: 2_147_483_648 }],
    ['timeoutMs', { intervalMs: 100, timeoutMs: 0 }],
    ['timeoutMs', { intervalMs: 100, timeoutMs: Number.POSITIVE_INFINITY }],
    ['timeoutMs', { intervalMs: 100, timeoutMs: 2_147_483_648 }],
  ])('should reject invalid %s before creating a platform timer', (field, config) => {
    expect(() => validateHeartbeatConfig(config)).toThrow(`WebSocket heartbeat ${field}`)
  })

  test('should accept the maximum platform timer delay', () => {
    expect(() => validateHeartbeatConfig({ intervalMs: 2_147_483_647, timeoutMs: 2_147_483_647 })).not.toThrow()
  })

  test('should do nothing when config is undefined', () => {
    const session = createMockSession()
    startHeartbeat(createMockSocket(), session, undefined, undefined, vi.fn(), WebSocket.OPEN)
    expect(session.heartbeat).toBeUndefined()
  })

  test('should stop existing heartbeat before starting new one', () => {
    const session = createMockSession()
    const existingHeartbeat = {
      isAck: undefined,
      markAck: vi.fn(),
      stop: vi.fn(),
    }
    session.heartbeat = existingHeartbeat

    startHeartbeat(createMockSocket(), session, { intervalMs: 1000 }, undefined, vi.fn(), WebSocket.OPEN)

    expect(existingHeartbeat.stop).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(1)
    stopHeartbeat(session)
    expect(vi.getTimerCount()).toBe(0)
  })

  test('should send heartbeat messages at the configured interval', () => {
    const socket = createMockSocket()
    const session = createMockSession(socket)
    const message = vi.fn().mockReturnValue({ type: 'ping' })

    startHeartbeat(socket, session, { intervalMs: 100, message }, struct.object({ type: struct.literal('ping') }), vi.fn(), WebSocket.OPEN)

    vi.advanceTimersByTime(200)
    expect(message).toHaveBeenCalledTimes(2)
    expect(socket.send).toHaveBeenCalledTimes(2)
  })

  test('should call the heartbeat message factory without a receiver', () => {
    const socket = createMockSocket()
    const session = createMockSession(socket)
    const onFatal = vi.fn()
    function message(this: unknown) {
      expect(this).toBeUndefined()
      return { type: 'ping' as const }
    }

    startHeartbeat(socket, session, { intervalMs: 100, message }, struct.object({ type: struct.literal('ping') }), onFatal, WebSocket.OPEN)

    vi.advanceTimersByTime(100)
    expect(onFatal).not.toHaveBeenCalled()
  })

  test('should ignore a falsy non-function heartbeat message at the runtime boundary', () => {
    const socket = createMockSocket()
    const session = createMockSession(socket)
    const onFatal = vi.fn()

    startHeartbeat(socket, session, { intervalMs: 100, message: false as never }, undefined, onFatal, WebSocket.OPEN)

    vi.advanceTimersByTime(100)
    expect(socket.send).not.toHaveBeenCalled()
    expect(onFatal).not.toHaveBeenCalled()
  })

  test('should not send when outgoing serialization stops the active heartbeat runtime', () => {
    const socket = createMockSocket()
    const session = createMockSession(socket)
    const message = {
      get text() {
        stopHeartbeat(session)
        return 'late'
      },
      type: 'ping' as const,
    }

    startHeartbeat(
      socket,
      session,
      { intervalMs: 100, message: () => message, timeoutMs: 200 },
      struct.object({ type: struct.literal('ping'), text: struct.string() }),
      vi.fn(),
      WebSocket.OPEN,
    )

    vi.advanceTimersByTime(100)
    expect(socket.send).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  test('should not arm an acknowledgement timeout when native send stops the active heartbeat runtime', () => {
    const socket = createMockSocket()
    const session = createMockSession(socket)
    socket.send = vi.fn(() => stopHeartbeat(session))

    startHeartbeat(
      socket,
      session,
      { intervalMs: 100, message: () => ({ type: 'ping' as const }), timeoutMs: 200 },
      struct.object({ type: struct.literal('ping') }),
      vi.fn(),
      WebSocket.OPEN,
    )

    vi.advanceTimersByTime(100)
    expect(socket.send).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  test('should skip heartbeat when socket is not open or message is undefined', () => {
    const closedSocket = createMockSocket(WebSocket.CONNECTING)
    const openSocket = createMockSocket()
    const closedSession = createMockSession(closedSocket)
    const openSession = createMockSession(openSocket)

    startHeartbeat(
      closedSocket,
      closedSession,
      { intervalMs: 100, message: () => ({ type: 'ping' }) as never },
      undefined,
      vi.fn(),
      WebSocket.OPEN,
    )
    startHeartbeat(openSocket, openSession, { intervalMs: 100 }, undefined, vi.fn(), WebSocket.OPEN)

    vi.advanceTimersByTime(100)
    expect(closedSocket.send).not.toHaveBeenCalled()
    expect(openSocket.send).not.toHaveBeenCalled()
  })

  test('should report message factory, serialization, and native send failures as fatal', () => {
    for (const setup of [
      () => ({
        message: () => {
          throw new Error('factory failed')
        },
        outgoing: undefined,
        socket: createMockSocket(),
      }),
      () => ({
        message: () => ({ type: 'unknown' }) as unknown as { type: 'ping' },
        outgoing: struct.object({ type: struct.literal('ping') }),
        socket: createMockSocket(),
      }),
      () => {
        const socket = createMockSocket()
        socket.send = vi.fn(() => {
          throw new Error('send failed')
        })
        return { message: () => ({ type: 'ping' as const }), outgoing: struct.object({ type: struct.literal('ping') }), socket }
      },
    ]) {
      const onFatal = vi.fn()
      const { message, outgoing, socket } = setup()
      startHeartbeat(socket, createMockSession(socket), { intervalMs: 100, message }, outgoing, onFatal, WebSocket.OPEN)
      vi.advanceTimersByTime(100)
      expect(onFatal).toHaveBeenCalledTimes(1)
    }
  })

  test('should report timeout without owning socket close or queues', () => {
    const socket = createMockSocket()
    const onFatal = vi.fn()
    const session = createMockSession(socket)

    startHeartbeat(
      socket,
      session,
      { intervalMs: 100, timeoutMs: 50, message: () => ({ type: 'ping' as const }) },
      struct.object({ type: struct.literal('ping') }),
      onFatal,
      WebSocket.OPEN,
    )

    vi.advanceTimersByTime(150)
    expect(onFatal).toHaveBeenCalledWith(new Error('WebSocket heartbeat timeout'))
  })

  test('should keep one acknowledgement deadline when interval is shorter than timeout', () => {
    const socket = createMockSocket()
    const onFatal = vi.fn()
    const session = createMockSession(socket)

    startHeartbeat(
      socket,
      session,
      { intervalMs: 5, timeoutMs: 20, message: () => ({ type: 'ping' as const }) },
      struct.object({ type: struct.literal('ping') }),
      onFatal,
      WebSocket.OPEN,
    )

    vi.advanceTimersByTime(24)
    expect(socket.send).toHaveBeenCalledTimes(1)
    expect(onFatal).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onFatal).toHaveBeenCalledOnce()
    expect(onFatal).toHaveBeenCalledWith(new Error('WebSocket heartbeat timeout'))

    vi.advanceTimersByTime(100)
    expect(socket.send).toHaveBeenCalledTimes(1)
    expect(onFatal).toHaveBeenCalledOnce()
  })

  test('should clear timeout on ack and expose isAck', () => {
    const socket = createMockSocket()
    const onFatal = vi.fn()
    const session = createMockSession(socket)
    const isAck = vi.fn().mockReturnValue(true)

    startHeartbeat(
      socket,
      session,
      { intervalMs: 100, isAck, timeoutMs: 200, message: () => ({ type: 'ping' as const }) },
      struct.object({ type: struct.literal('ping') }),
      onFatal,
      WebSocket.OPEN,
    )

    vi.advanceTimersByTime(100)
    expect(session.heartbeat?.isAck?.('pong')).toBe(true)
    session.heartbeat?.markAck()
    vi.advanceTimersByTime(200)
    expect(onFatal).not.toHaveBeenCalled()
    expect(socket.send).toHaveBeenCalledTimes(2)
    expect(isAck).toHaveBeenCalledWith('pong')
  })

  test('should stop heartbeat', () => {
    const socket = createMockSocket()
    const session = createMockSession(socket)

    startHeartbeat(socket, session, { intervalMs: 100, message: () => ({ type: 'ping' }) as never }, undefined, vi.fn(), WebSocket.OPEN)
    stopHeartbeat(session)

    expect(session.heartbeat).toBeUndefined()
    vi.advanceTimersByTime(100)
    expect(socket.send).not.toHaveBeenCalled()
  })

  test('should use the injected constructor open state when global WebSocket is unavailable', () => {
    const socket = createMockSocket(1)
    const onFatal = vi.fn()
    vi.stubGlobal('WebSocket', undefined)

    startHeartbeat(
      socket,
      createMockSession(socket),
      { intervalMs: 100, message: () => ({ type: 'ping' as const }) },
      struct.object({ type: struct.literal('ping') }),
      onFatal,
      1,
    )
    vi.advanceTimersByTime(100)

    expect(socket.send).toHaveBeenCalledTimes(1)
    expect(onFatal).not.toHaveBeenCalled()
  })
})
