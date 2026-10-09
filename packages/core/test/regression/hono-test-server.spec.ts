import { once } from 'node:events'
import { connect } from 'node:net'
import { upgradeWebSocket } from '@hono/node-server'
import { Hono } from 'hono'
import { expect, test } from 'vitest'
import { WebSocketServer } from 'ws'
import { startHonoTestServer } from '../../../../test/hono-test-server'

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
  const server = await startHonoTestServer(app, { websocket: { server: wss } })
  const socket = new WebSocket(`${server.host.replace('http:', 'ws:')}/ws`)
  const opened = new Promise<string>((resolve) => {
    socket.addEventListener('open', () => resolve('open'), { once: true })
    socket.addEventListener('error', () => resolve('error'), { once: true })
  })
  const closed = new Promise<void>((resolve) => socket.addEventListener('close', () => resolve(), { once: true }))

  try {
    expect(await opened).toBe('open')
    const message = new Promise<MessageEvent>((resolve) => socket.addEventListener('message', resolve, { once: true }))
    socket.send('probe')
    expect((await message).data).toBe('probe')

    await server.close()
    await closed
    expect(socket.readyState).toBe(WebSocket.CLOSED)
    const connection = connect({ host: '127.0.0.1', port: Number(new URL(server.host).port) })
    try {
      await expect(once(connection, 'connect', { signal: AbortSignal.timeout(500) })).rejects.toMatchObject({ code: 'ECONNREFUSED' })
    } finally {
      connection.destroy()
    }
  } finally {
    socket.close()
    await server.close()
    wss.close()
  }
})
