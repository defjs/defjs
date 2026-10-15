import type { Server } from 'node:http'
import type { createAdaptorServer } from '@hono/node-server'
import { upgradeWebSocket } from '@hono/node-server'
import { Hono } from 'hono'
import { expect, test, vi } from 'vitest'
import { WebSocketServer } from 'ws'
import { startHonoTestServer } from '../../../../test/hono-test-server'

const adaptor = vi.hoisted(() => ({ servers: [] as Server[] }))

// Records the real server the helper creates while still delegating to the original adapter.
vi.mock('@hono/node-server', async (importOriginal) => {
  const original = await importOriginal<{ createAdaptorServer: typeof createAdaptorServer }>()
  return {
    ...original,
    createAdaptorServer(options: Parameters<typeof createAdaptorServer>[0]) {
      const server = original.createAdaptorServer(options)
      adaptor.servers.push(server as Server)
      return server
    },
  }
})

test('the test server exchanges WebSocket messages and closes active connections on shutdown', async () => {
  const app = new Hono()
  app.get(
    '/ws',
    upgradeWebSocket(() => ({
      onMessage(event, socket) {
        socket.send(String(event.data))
      },
    })),
  )

  const wss = new WebSocketServer({ noServer: true })
  adaptor.servers.length = 0
  const server = await startHonoTestServer(app, { websocket: { server: wss } })
  const [adapter, ...otherAdapters] = adaptor.servers
  if (!adapter || otherAdapters.length > 0) {
    throw new Error('Expected the helper to create exactly one adapter server')
  }
  let closeEvents = 0
  adapter.on('close', () => {
    closeEvents += 1
  })
  const socket = new WebSocket(`${server.host.replace('http:', 'ws:')}/ws`)
  const opened = new Promise<string>((resolve) => {
    socket.addEventListener('open', () => resolve('open'), { once: true })
    socket.addEventListener('error', () => resolve('error'), { once: true })
  })
  const closed = new Promise<void>((resolve) => socket.addEventListener('close', () => resolve(), { once: true }))

  try {
    expect(await opened).toBe('open')
    expect(adapter.listening).toBe(true)
    const message = new Promise<MessageEvent>((resolve) => socket.addEventListener('message', resolve, { once: true }))
    socket.send('probe')
    expect((await message).data).toBe('probe')

    await server.close()
    await closed
    expect(socket.readyState).toBe(WebSocket.CLOSED)
    expect(closeEvents).toBe(1)
    expect(adapter.listening).toBe(false)
    expect(adapter.address()).toBeNull()

    await server.close()
    expect(closeEvents).toBe(1)
  } finally {
    socket.close()
    await server.close()
    wss.close()
  }
})
