import { describe, expect, test, vi } from 'vitest'
import { createClient, withEndpoint, withWebSocketHandle } from '../client'
import { struct } from '../struct'
import { createControllableSocketClass, openControllableSocket } from '../../test/regression/controllable_socket'
import { defineWebSocket } from './index'

describe('web socket runtime heartbeat', () => {
  test('should send heartbeat messages automatically when heartbeat.message is provided', async () => {
    vi.useFakeTimers()
    const { Socket, latest } = createControllableSocketClass()
    try {
      const useHeartbeatSocket = defineWebSocket({
        maxIncomingQueueSize: 16,
        incoming: struct.object({ type: struct.literal('pong'), ok: struct.boolean() }),
        outgoing: struct.object({ type: struct.literal('ping'), at: struct.number() }),
        path: '/ws/heartbeat',
      })
      let runtimeError: unknown
      const client = createClient(withEndpoint('https://example.test'), withWebSocketHandle(Socket as unknown as typeof WebSocket))
      const pending = client.execute(useHeartbeatSocket(), {
        heartbeat: {
          intervalMs: 10,
          isAck(message: { type: string }) {
            return message.type === 'pong'
          },
          message: () => ({
            at: 1,
            type: 'ping' as const,
          }),
          timeoutMs: 100,
        },
      })
      const [error, socket] = await openControllableSocket(pending, latest)
      const native = latest()

      expect(error).toBeNull()
      if (!socket || !native) {
        throw new Error('Expected socket session')
      }

      socket.onRuntimeError((err: unknown) => {
        runtimeError = err
      })
      await vi.advanceTimersByTimeAsync(10)
      expect(JSON.parse(native.sent[0] ?? '')).toEqual({ at: 1, type: 'ping' })
      native.triggerMessage('{"ok":true,"type":"pong"}')
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(100)

      expect(runtimeError).toBeUndefined()
      expect(socket.state).toBe('open')
      socket.close(1000, 'heartbeat-ok')
      native.triggerClose({ code: 1000, reason: 'heartbeat-ok', wasClean: true })
      await expect(socket.closed).resolves.toMatchObject({ code: 1000, reason: 'heartbeat-ok' })
    } finally {
      vi.useRealTimers()
    }
  })
})
