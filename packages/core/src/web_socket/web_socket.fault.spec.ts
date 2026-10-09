import { describe, expect, test } from 'vitest'
import { createClient, withEndpoint, withInterceptors, withWebSocketBeforeConnect, withWebSocketHandle } from '../client'
import { createWebSocketInterceptor } from '../interceptor'
import { struct } from '../struct'
import { defineWebSocket } from './index'

/**
 * Locks WebSocket onto the one fault-code namespace shared with HTTP and SSE.
 *
 * The startup catch used to cast whatever it caught straight to `RequestError`, so a plain
 * `Error` from an interceptor crossed the public boundary with no discriminant at all. That
 * catch is also the funnel for every other startup failure, so classifying it needs a guard:
 * replacing it unconditionally would report a refused connection as an interceptor fault.
 */

const useRoom = defineWebSocket({
  incoming: struct.object({ type: struct.literal('message'), text: struct.string() }),
  maxIncomingQueueSize: 8,
  path: '/ws',
})

function unreachableClient(...options: Parameters<typeof createClient>): ReturnType<typeof createClient> {
  return createClient(withEndpoint('http://127.0.0.1:1'), ...options)
}

describe('web socket startup faults', () => {
  test.each(['abort', 'timeout'] as const)(
    'should classify a pre-cancelled interceptor signal as %s without constructing a socket',
    async (mode) => {
      let constructed = 0
      class Socket extends EventTarget {
        static readonly OPEN = 1
        readyState = 0
        bufferedAmount = 0
        protocol = ''
        extensions = ''
        binaryType = 'blob'
        readonly url: string
        constructor(url: string | URL) {
          super()
          this.url = String(url)
          constructed += 1
        }
        send(_data: string) {}
        close() {
          this.readyState = 3
        }
      }
      const client = createClient(
        withEndpoint('https://example.test'),
        withWebSocketHandle(Socket),
        withInterceptors(
          createWebSocketInterceptor((request, next) =>
            next({
              ...request,
              abort: AbortSignal.abort(mode === 'timeout' ? new DOMException('deadline', 'TimeoutError') : 'stop'),
            }),
          ),
        ),
      )

      const [fault, session] = await client.execute(useRoom())

      expect(constructed).toBe(0)
      expect(session).toBeUndefined()
      expect(fault?.code).toBe(mode === 'timeout' ? 'NET_TIMEOUT' : 'NET_ABORTED')
    },
  )

  test('should report an interceptor throw as EXT_INTERCEPTOR_FAILED and keep the cause', async () => {
    const cause = new Error('interceptor exploded')
    const client = createClient(
      withEndpoint('http://127.0.0.1:1'),
      withInterceptors(
        createWebSocketInterceptor(async () => {
          throw cause
        }),
      ),
    )

    const [fault, session] = await client.execute(useRoom())

    expect(session).toBeUndefined()
    expect(fault?.code).toBe('EXT_INTERCEPTOR_FAILED')
    expect(fault?.cause).toBe(cause)
  })

  test('should report a refused connection as a transport fault, not an interceptor fault', async () => {
    // The startup catch is the funnel for every failure, so it must not relabel this one.
    const [fault, session] = await unreachableClient().execute(useRoom())

    expect(session).toBeUndefined()
    expect(fault?.code).not.toBe('EXT_INTERCEPTOR_FAILED')
    expect(fault?.code.startsWith('NET_')).toBe(true)
  })

  test('should report a throwing beforeConnect hook as EXT_HOOK_FAILED', async () => {
    const cause = new Error('token refresh failed')
    const client = unreachableClient(
      withWebSocketBeforeConnect(() => {
        throw cause
      }),
    )

    const [fault] = await client.execute(useRoom())

    expect(fault?.code).toBe('EXT_HOOK_FAILED')
    expect(fault?.cause).toBe(cause)
  })

  test('should report a missing WebSocket constructor as ENV_UNSUPPORTED', async () => {
    const client = createClient(
      withEndpoint('http://127.0.0.1:1'),
      withWebSocketHandle({} as unknown as Parameters<typeof withWebSocketHandle>[0]),
    )

    const [fault] = await client.execute(useRoom())

    expect(fault?.code).toBe('ENV_UNSUPPORTED')
  })

  test('should report invalid input as REQ_INPUT_INVALID', async () => {
    const useTyped = defineWebSocket({
      incoming: struct.object({ type: struct.literal('message'), text: struct.string() }),
      input: struct.object({ path: struct.object({ room: struct.number() }) }),
      maxIncomingQueueSize: 8,
      path: '/ws/:room',
    })

    const [fault] = await unreachableClient().execute(useTyped({ path: { room: 'nope' } } as never))

    expect(fault?.code).toBe('REQ_INPUT_INVALID')
  })

  test('should report an invalid declared queue limit as REQ_OPTIONS_INVALID', async () => {
    const useBadLimit = defineWebSocket({
      incoming: struct.object({ type: struct.literal('message'), text: struct.string() }),
      maxIncomingQueueSize: 0,
      path: '/ws',
    })

    const [fault] = await unreachableClient().execute(useBadLimit())

    expect(fault?.code).toBe('REQ_OPTIONS_INVALID')
  })
})
