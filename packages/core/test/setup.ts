import type { Socket } from 'node:net'
import type { ServerType } from '@hono/node-server'
import { createAdaptorServer, upgradeWebSocket } from '@hono/node-server'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import type { TestProject } from 'vitest/node'
import { WebSocketServer } from 'ws'
import { registerBodyRoutes } from './body-routes'
import { registerE2eProbe, registerE2eRoutes } from './e2e-routes'
import { registerXsrfRoutes } from './xsrf-middleware'

declare module 'vitest' {
  export interface ProvidedContext {
    testServerHost: string
  }
}

let testServer: ServerType | undefined
let webSocketServer: WebSocketServer | undefined
let testServerAddr: string
const testServerSockets = new Set<Socket>()
const providerEnvelopeAttempts = new Map<string, number>()
const isDenoRuntime = 'Deno' in globalThis

type ServerConnectionCleanup = {
  closeAllConnections?: () => void
  closeIdleConnections?: () => void
}

export async function setup({ provide }: TestProject) {
  const app = new Hono()
  registerE2eProbe(app)
  registerXsrfRoutes(app)
  const reconnectAttempts = new Map<string, number>()

  const delay = (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve) => {
      if (ms <= 0 || signal?.aborted) {
        resolve()
        return
      }

      const timeout = setTimeout(done, ms)
      timeout.unref?.()

      function done() {
        clearTimeout(timeout)
        signal?.removeEventListener('abort', done)
        resolve()
      }

      signal?.addEventListener('abort', done, { once: true })
    })

  function createSocketMessage(type: string, payload: unknown): string {
    if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
      return JSON.stringify({
        type,
        ...payload,
      })
    }

    return JSON.stringify({
      data: payload,
      type,
    })
  }

  app.use(
    '*',
    cors({
      origin(origin) {
        return origin || '*'
      },
      allowHeaders: ['*', 'Accept', 'Content-Type', 'Last-Event-ID'],
      allowMethods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
      exposeHeaders: ['x-request-id'],
      maxAge: 86_400,
    }),
  )

  app.get('/', (c) => c.body(null, 200))

  app.post('/', async (c) => {
    const contentType = c.req.header('content-type') ?? ''

    if (contentType.includes('application/json')) {
      return c.json(await c.req.json())
    }

    if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('text/plain')) {
      return c.text(await c.req.text())
    }

    return c.body(await c.req.arrayBuffer(), {
      status: 200,
      headers: contentType ? { 'content-type': contentType } : undefined,
    })
  })

  app.post('/json/alias', async (c) => {
    const body = await c.req.json<{ user_name?: unknown }>()
    return c.json({ user_name: body.user_name })
  })

  app.get('/text', (c) => c.text('Hello World!'))
  app.get('/json', (c) => c.json({ id: 1 }))
  app.get('/json/malformed-error', (c) =>
    c.body('{not-json}', {
      headers: { 'content-type': 'application/json' },
      status: 500,
      statusText: 'Server Error',
    }),
  )
  app.get('/null', (c) => c.body(null, 200))
  app.get('/no-content-type', (c) => {
    c.header('content-type', '')
    return c.body('hello', 200)
  })
  app.get('/500', (c) => c.body(null, { status: 500, statusText: 'Internal Server Error' }))
  app.on('HEAD', '/head', (c) => c.body(null, { status: 204, statusText: 'No Content' }))
  app.post('/account', (c) => c.json({ id: 1, name: 'Jack' }))
  app.get('/account/not-found', (c) => c.json({ code: 'ACCOUNT_NOT_FOUND', message: 'Account not found' }, 404))

  app.get('/delay', async (c) => {
    await delay(Number(c.req.query('ms') ?? '0'), c.req.raw.signal)
    return c.body(null, 200)
  })

  // After the cors middleware above, so browsers may read these cross-origin.
  registerBodyRoutes(app)

  const basicSSEHandler = (c: Context) => {
    c.header('x-request-id', 'trace-sse-basic')
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        data: 'first',
        event: 'message',
        id: '1',
      })

      await stream.writeSSE({
        data: 'second line 1\nsecond line 2',
        event: 'message',
        id: '2',
      })
    })
  }

  app.get('/sse/basic', basicSSEHandler)
  app.post('/sse/basic', basicSSEHandler)
  app.post('/sse/redirect/:status', (c) => c.redirect('/sse/basic', Number(c.req.param('status')) as 303 | 307))

  app.get('/sse/retry', (c) => {
    const lastEventId = c.req.header('last-event-id')

    if (lastEventId === '1') {
      c.header('x-request-id', 'trace-sse-retry-2')
      return streamSSE(c, async (stream) => {
        await stream.writeSSE({
          data: 'second',
          event: 'message',
          id: '2',
        })
      })
    }

    c.header('x-request-id', 'trace-sse-retry-1')
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        data: 'first',
        event: 'message',
        id: '1',
        retry: 100,
      })
    })
  })

  app.get('/sse/slow', async (c) => {
    await delay(500, c.req.raw.signal)
    return c.body(null, 500)
  })

  const sseRetryAttempts = new Map<string, number>()

  app.get('/sse/500-once', (c) => {
    const key = c.req.query('key') ?? 'default'
    const attempt = (sseRetryAttempts.get(key) ?? 0) + 1
    sseRetryAttempts.set(key, attempt)

    if (attempt === 1) {
      return c.body(null, 500)
    }

    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ data: 'ok', event: 'message', id: '1' })
    })
  })

  app.get('/sse/500-always', (c) => c.body(null, 500))

  app.get('/sse/no-id', (c) => {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        data: 'no-id-message',
        event: 'message',
      })
    })
  })

  app.get('/sse/empty-id', (c) => {
    c.header('content-type', 'text/event-stream')
    return streamSSE(c, async (stream) => {
      const encoder = new TextEncoder()
      await stream.write(encoder.encode('data: hello\nid:\nevent: message\n\n'))
    })
  })

  app.get('/sse/mixed', (c) => {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ data: JSON.stringify({ uid: 1 }), event: 'userconnect', id: '1' })
      await stream.writeSSE({ data: JSON.stringify({ note: 'default' }), event: 'something-else', id: '2' })
    })
  })

  app.get('/sse/unknown-event', (c) => {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ data: 'hello', event: 'unknown', id: '1' })
    })
  })

  app.get('/sse/empty-data', (c) => {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ data: '', event: 'message', id: '1' })
    })
  })

  app.get('/sse/no-event-name', (c) => {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ data: 'hello', id: '1' })
    })
  })

  app.get('/sse/infinite', (c) => {
    c.header('x-request-id', 'trace-sse-infinite')
    const requestSignal = c.req.raw.signal
    return streamSSE(c, async (stream) => {
      let count = 0

      const writeTick = async () => {
        count += 1
        await stream.writeSSE({
          data: String(count),
          event: 'tick',
          id: String(count),
        })
      }

      await writeTick()

      await new Promise<void>((resolve) => {
        let settled = false
        const interval = setInterval(() => {
          if (stream.aborted) {
            done()
            return
          }

          void writeTick()
        }, 20)
        interval.unref?.()

        function done() {
          if (settled) {
            return
          }

          settled = true
          clearInterval(interval)
          requestSignal.removeEventListener('abort', done)
          resolve()
        }

        stream.onAbort(done)
        requestSignal.addEventListener('abort', done, { once: true })
        if (requestSignal.aborted) {
          done()
        }
      })
    })
  })

  registerE2eRoutes(app)

  app.get(
    '/ws/basic',
    upgradeWebSocket((c) => {
      const roomId = c.req.query('roomId') ?? 'default'

      return {
        onOpen(_event, ws) {
          ws.send(createSocketMessage('joined', { roomId, userId: 1 }))
          setTimeout(() => {
            if (ws.readyState === 1) {
              ws.send(createSocketMessage('message', { text: `welcome:${roomId}`, userId: 1 }))
              ws.close(1000, 'done')
            }
          }, 10)
        },
      }
    }),
  )

  app.get(
    '/ws/echo',
    upgradeWebSocket(() => ({
      onOpen(_event, ws) {
        ws.send(createSocketMessage('ready', { ok: true }))
      },
      onMessage(event, ws) {
        ws.send(typeof event.data === 'string' ? event.data : JSON.stringify(event.data))
      },
    })),
  )

  app.get(
    '/ws/invalid',
    upgradeWebSocket(() => ({
      onOpen(_event, ws) {
        setTimeout(() => {
          if (ws.readyState === 1) {
            ws.send('not-json')
            ws.close(1000, 'done')
          }
        }, 10)
      },
    })),
  )

  app.get(
    '/ws/before-connect',
    upgradeWebSocket((c) => {
      const token = c.req.query('token') ?? 'missing'

      return {
        onOpen(_event, ws) {
          ws.send(createSocketMessage('connected', { token }))
          setTimeout(() => {
            if (ws.readyState === 1) {
              ws.close(1000, 'done')
            }
          }, 10)
        },
      }
    }),
  )

  app.get(
    '/ws/reconnect',
    upgradeWebSocket((c) => {
      const key = c.req.query('key') ?? 'default'
      const attempt = (reconnectAttempts.get(key) ?? 0) + 1
      reconnectAttempts.set(key, attempt)

      return {
        onOpen(_event, ws) {
          if (attempt === 1) {
            setTimeout(() => {
              if (ws.readyState === 1) {
                ws.close(1012, 'restart')
              }
            }, 25)
            return
          }

          ws.send(createSocketMessage('reconnected', { attempt }))
        },
        onMessage(event, ws) {
          ws.send(typeof event.data === 'string' ? event.data : JSON.stringify(event.data))
        },
      }
    }),
  )

  app.get(
    '/ws/provider-envelopes',
    upgradeWebSocket((c) => {
      const key = c.req.query('key') ?? 'default'
      const mode = c.req.query('mode') ?? 'default'
      const attempt = (providerEnvelopeAttempts.get(key) ?? 0) + 1
      providerEnvelopeAttempts.set(key, attempt)

      return {
        onClose() {
          if (mode === 'queue' && attempt === 1) {
            return
          }
          providerEnvelopeAttempts.delete(key)
        },
        onMessage(event, ws) {
          const decoded = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data)) as Record<string, unknown>
          ws.send(
            JSON.stringify({
              method: 'wire',
              success: true,
              result: {
                attempt,
                hasType: Object.hasOwn(decoded, 'type'),
                keys: Object.keys(decoded).sort(),
                method: decoded['method'],
                req_id: decoded['req_id'],
              },
            }),
          )

          if (decoded['method'] === 'ping') {
            ws.send(JSON.stringify({ method: 'pong', req_id: decoded['req_id'] }))
          }
          if (mode === 'queue' && attempt === 1) {
            ws.close(1012, 'restart')
          }
        },
        onOpen(_event, ws) {
          if (mode === 'queue' && attempt === 1) {
            ws.send(JSON.stringify({ method: 'subscribe', success: true, result: { channel: 'ticker' } }))
            ws.send(JSON.stringify({ channel: 'heartbeat' }))
            ws.send(JSON.stringify({ channel: 'ticker', type: 'update', data: [{ symbol: 'BTC/USD', last: 1 }] }))
            return
          }
          if (attempt > 1 || mode === 'heartbeat') {
            ws.send(JSON.stringify({ channel: 'heartbeat' }))
          }
        },
      }
    }),
  )

  app.get(
    '/ws/heartbeat',
    upgradeWebSocket(() => ({
      onMessage(event, ws) {
        try {
          const decoded = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data)) as { type?: string }
          if (decoded.type === 'ping') {
            ws.send(createSocketMessage('pong', { ok: true }))
            ws.close(1000, 'heartbeat-ok')
          }
        } catch {
          // noop
        }
      },
    })),
  )

  app.get(
    '/ws/heartbeat-silent',
    upgradeWebSocket(() => ({
      // Intentionally silent — used to test heartbeat timeout on the client side.
      onMessage() {
        /* intentionally empty */
      },
    })),
  )

  app.get(
    '/ws/close-immediately',
    upgradeWebSocket(() => ({
      onOpen(_event, ws) {
        ws.close(1000, 'bye')
      },
    })),
  )

  app.get(
    '/ws/error-before-close',
    upgradeWebSocket(() => ({
      onOpen(_event, ws) {
        // 10ms failed once under the full coverage suite: Firefox settled this socket as
        // "WebSocket closed before open" (2026-09-29). Listeners are attached in the same
        // turn as `new WebSocket`. Isolated runs, including a 0ms close, were open → message
        // → close on Chromium and Firefox (15/15) and did not show a library reorder.
        // 200ms waits out that load race.
        setTimeout(() => {
          if (ws.readyState === 1) {
            ws.send(createSocketMessage('message', { text: 123 }))
            ws.close(1000, 'done')
          }
        }, 200)
      },
    })),
  )

  app.get(
    '/ws/unknown-message',
    upgradeWebSocket(() => ({
      onOpen(_event, ws) {
        setTimeout(() => {
          if (ws.readyState === 1) {
            ws.send(createSocketMessage('unknown', { note: 'skip-me' }))
            ws.close(1000, 'done')
          }
        }, 10)
      },
    })),
  )

  app.get(
    '/ws/binary',
    upgradeWebSocket(() => ({
      onOpen(_event, ws) {
        ws.send(new TextEncoder().encode(JSON.stringify({ type: 'message', text: 'hello-binary' })))
        // Same pad as /ws/error-before-close: a 10ms close is not stable under the full coverage suite.
        setTimeout(() => {
          if (ws.readyState === 1) {
            ws.close(1000, 'done')
          }
        }, 200)
      },
    })),
  )

  // Preserve the original 10ms closes independently of the padded browser fixtures.
  app.get(
    '/ws/regression/error-before-close',
    upgradeWebSocket(() => ({
      onOpen(_event, socket) {
        setTimeout(() => {
          if (socket.readyState === 1) {
            socket.send(JSON.stringify({ type: 'message', text: 123 }))
            socket.close(1000, 'done')
          }
        }, 10)
      },
    })),
  )
  app.get(
    '/ws/regression/binary',
    upgradeWebSocket(() => ({
      onOpen(_event, socket) {
        socket.send(new TextEncoder().encode(JSON.stringify({ type: 'message', text: 'hello-binary' })))
        setTimeout(() => {
          if (socket.readyState === 1) socket.close(1000, 'done')
        }, 10)
      },
    })),
  )
  app.get(
    '/ws/regression/capture',
    upgradeWebSocket(() => ({
      onMessage(event, socket) {
        socket.send(JSON.stringify({ received: String(event.data) }))
      },
    })),
  )

  const wss = new WebSocketServer({ noServer: true })
  webSocketServer = wss
  const server = createAdaptorServer({
    fetch: app.fetch,
    hostname: '127.0.0.1',
    websocket: { server: wss },
  })
  testServer = server

  server.on('connection', (socket) => {
    testServerSockets.add(socket)
    socket.on('close', () => {
      testServerSockets.delete(socket)
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new TypeError('Failed to resolve test server address')
  }

  testServerAddr = `http://127.0.0.1:${address.port}`
  server.unref()
  provide('testServerHost', testServerAddr)
  console.log(`Test server is running on ${testServerAddr}`)
}

export async function teardown() {
  const failures: Error[] = []

  try {
    const currentWebSocketServer = webSocketServer
    if (currentWebSocketServer) {
      currentWebSocketServer.clients.forEach((client: { terminate(): void }) => {
        client.terminate()
      })
      try {
        await teardownDeadline(
          new Promise<void>((resolve, reject) => {
            currentWebSocketServer.close((error: Error | undefined) => {
              if (error) {
                reject(error)
                return
              }
              resolve()
            })
          }),
          'WebSocket server close timed out',
        )
      } catch (cause) {
        currentWebSocketServer.clients.forEach((client: { terminate(): void }) => {
          client.terminate()
        })
        failures.push(labeledTeardownFailure('WebSocket server close failed', cause))
      }
    }

    const currentServer = testServer
    if (currentServer?.listening) {
      if (!isDenoRuntime) {
        const serverWithCleanup = currentServer as ServerType & ServerConnectionCleanup
        serverWithCleanup.closeIdleConnections?.()
        serverWithCleanup.closeAllConnections?.()
      }

      try {
        await teardownDeadline(
          new Promise<void>((resolve, reject) => {
            currentServer.close((error) => {
              if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
                reject(error)
                return
              }
              resolve()
            })
          }),
          'HTTP server close timed out',
        )
      } catch (cause) {
        testServerSockets.forEach((socket) => {
          socket.destroy()
        })
        failures.push(labeledTeardownFailure('HTTP server close failed', cause))
      }
    }
  } finally {
    providerEnvelopeAttempts.clear()
    testServerSockets.clear()
    webSocketServer = undefined
    testServer = undefined
  }

  if (failures.length > 0) {
    throw new AggregateError(failures, 'Test server teardown failed')
  }
}

async function teardownDeadline<T>(promise: Promise<T>, timeoutMessage: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(timeoutMessage)), 500)
        timeout.unref?.()
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

function labeledTeardownFailure(label: string, cause: unknown): Error {
  const detail = cause instanceof Error ? cause.message : String(cause)
  return new Error(`${label}: ${detail}`, { cause })
}
