import { afterEach, beforeEach, describe, expect, inject, test } from 'vitest'

import { createClient, withEndpoint, type Client } from '../client'
import { struct, StructError } from '../struct'
import { defineWebSocket, type SocketAwaitResult } from './index'

describe('web socket browser runtime', () => {
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

  test('should connect and exchange typed messages in real browsers', async () => {
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
      text: 'hello-browser',
      type: 'message',
    })

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { text: 'hello-browser', type: 'message' },
    })

    socket.close(1000, 'done')
    await expect(socket.closed).resolves.toMatchObject({ code: 1000 })
  })

  test('should receive binary websocket frames as typed messages', async () => {
    const useBinarySocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.object({ type: struct.literal('message'), text: struct.string() }),
      path: '/ws/binary',
      protocols: ['json'],
    })

    const [error, socket] = await run(useBinarySocket())

    expect(error).toBeNull()
    if (!socket) {
      throw new Error('Expected socket session')
    }

    const iterator = socket.receive[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { text: 'hello-binary', type: 'message' },
    })
  })

  test('should report incoming Struct failures in real browsers', async () => {
    const useInvalidSocket = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.object({ type: struct.literal('message'), text: struct.string() }),
      path: '/ws/error-before-close',
    })

    const [error, socket] = await run(useInvalidSocket())

    expect(error).toBeNull()
    if (!socket) {
      throw new Error('Expected socket session')
    }

    let runtimeError: unknown
    const unsubscribe = socket.onRuntimeError((error: unknown) => {
      runtimeError = error
    })

    await expect(socket.closed).resolves.toMatchObject({ code: 1000, reason: 'done' })
    unsubscribe()
    expect(runtimeError).toBeInstanceOf(StructError)
    if (!(runtimeError instanceof StructError)) {
      throw new Error('Expected StructError')
    }
    expect(runtimeError.issues[0]).toMatchObject({ code: 'invalid_type', path: ['text'] })
  })

  test('should reconnect in real browsers', async () => {
    const command = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.object({ type: struct.literal('reconnected'), attempt: struct.number() }),
      input: struct.object({
        query: struct.object({
          key: struct.string(),
        }),
      }),
      path: '/ws/reconnect',
    })({ query: { key: 'browser-reconnect' } })
    const [error, socket] = await run(command, {
      reconnect: { attempts: 1, delayMs: 0 },
    })

    expect(error).toBeNull()
    if (!socket) {
      throw new Error('Expected socket session')
    }

    const iterator = socket.receive[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { attempt: 2, type: 'reconnected' },
    })
  })

  test('should abort an open session in real browsers', async () => {
    const controller = new AbortController()
    const command = defineWebSocket({
      maxIncomingQueueSize: 16,
      incoming: struct.object({ type: struct.literal('ready'), ok: struct.boolean() }),
      path: '/ws/echo',
    })()
    const [error, socket] = await run(command, { signal: controller.signal })

    expect(error).toBeNull()
    if (!socket) {
      throw new Error('Expected socket session')
    }
    const iterator = socket.receive[Symbol.asyncIterator]()
    await expect(iterator.next()).resolves.toEqual({ done: false, value: { ok: true, type: 'ready' } })
    const pendingReceive = iterator.next()

    controller.abort()

    await expect(socket.closed).resolves.toMatchObject({ kind: 'aborted' })
    await expect(pendingReceive).rejects.toBeDefined()
    expect(socket.state).toBe('aborted')
  })
})
