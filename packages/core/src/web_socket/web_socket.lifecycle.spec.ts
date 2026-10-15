import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, inject, test } from 'vitest'
import { createClient, withEndpoint, withQuerySerializer, type Client } from '../client'
import { struct } from '../struct'
import { defineWebSocket, type SocketAwaitResult } from './index'

describe('web socket runtime lifecycle', () => {
  let client: Client

  beforeEach(() => {
    client = createClient(withEndpoint(inject('testServerHost')))
  })

  afterEach(() => {
    // cleanup only
  })

  async function run(command: unknown, options?: unknown): Promise<SocketAwaitResult<unknown, unknown>> {
    return client.execute(command as never, options as never) as Promise<SocketAwaitResult<unknown, unknown>>
  }

  test('message listener add/remove use the same ref(no leak)', () => {
    // Bun 的 native WebSocket(C++ 实现)让 prototype-level spy 无法拦截 addEventListener/removeEventListener,
    // 因此这里改用 source-level meta-check:断言 web_socket.ts 中 cleanup 用的是 onMessage 而非 handleMessage。
    // 这保护 bug 3(行 541 的 wrap 必须与 cleanup 的 ref 一致)永不回归。
    const source = readFileSync(new URL('./web_socket.ts', import.meta.url), 'utf8')
    expect(source).toMatch(/socket\.addEventListener\('message', onMessage\)/)
    expect(source).toMatch(/socket\.removeEventListener\('message', onMessage\)/)
    // 反向断言：不能重新引入 anonymous arrow wrap
    expect(source).not.toMatch(/socket\.addEventListener\('message', event =>/)
    expect(source).not.toMatch(/socket\.removeEventListener\('message', handleMessage\)/)
  })

  test('should allow closing websocket before startup', async () => {
    const useEchoSocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.object({ type: struct.literal('ready'), ok: struct.boolean() }),
      path: '/ws/echo',
    })

    const controller = new AbortController()
    const executePromise = run(useEchoSocket(), { signal: controller.signal })
    controller.abort()

    const [error, socket, connection] = await executePromise

    expect(socket).toBeUndefined()
    expect(connection).toBeUndefined()
    expect(error?.code.startsWith('NET_')).toBe(true)

    if (!error?.code.startsWith('NET_')) {
      throw new Error('Expected transport error')
    }

    expect(error.code).toBe('NET_ABORTED')
  })

  test('should skip unexpected websocket messages after startup', async () => {
    const useInvalidSocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.object({ type: struct.literal('message'), count: struct.number() }),
      path: '/ws/invalid',
    })

    const [error, socket] = await run(useInvalidSocket())

    expect(error).toBeNull()
    if (!socket) {
      throw new Error('Expected socket session')
    }

    const messages: unknown[] = []
    for await (const message of socket.receive) {
      messages.push(message)
    }

    expect(messages).toEqual([])
    await expect(socket.closed).resolves.toMatchObject({ code: 1000 })
  })

  test('should use request-level beforeConnect hook and client query serializer', async () => {
    const clientWithSerializer = createClient(
      withEndpoint(inject('testServerHost')),
      withQuerySerializer((query) => {
        return `token=${String(query['token'])}&from=serializer`
      }),
    )

    const useBeforeConnectSocket = defineWebSocket({
      builder: (input) => input,
      maxIncomingQueueSize: 16,
      input: struct.object({ query: struct.object({ token: struct.string() }) }),
      incoming: struct.object({ type: struct.literal('connected'), token: struct.string() }),
      path: '/ws/before-connect',
    })

    let callCount = 0

    const command = useBeforeConnectSocket({ query: { token: 'secret-0' } })
    const [error, socket, connection] = await clientWithSerializer.execute(command, {
      beforeConnect: async () => {
        callCount += 1
      },
    })

    expect(error).toBeNull()
    expect(callCount).toBe(1)
    expect(connection?.url).toContain('token=secret-0')
    expect(connection?.url).toContain('from=serializer')

    if (!socket) {
      throw new Error('Expected socket session')
    }

    const iterator = socket.receive[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { token: 'secret-0', type: 'connected' },
    })

    await expect(socket.closed).resolves.toMatchObject({ code: 1000 })
  })
})
