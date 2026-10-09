import type { Socket } from 'node:net'
import { fileURLToPath } from 'node:url'
import { createAdaptorServer } from '@hono/node-server'
import { createNodeWebSocket } from '@hono/node-ws'
import { Hono } from 'hono'
import { chromium, firefox } from 'playwright'
import { build } from 'vite'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { browserLaunchEnv } from '../../../../test/firefox-app-data'
import type { createClient, defineWebSocket, struct, withEndpoint, withWebSocketHandle } from '../../src'

type BrowserApi = {
  createClient: typeof createClient
  defineWebSocket: typeof defineWebSocket
  struct: typeof struct
  withEndpoint: typeof withEndpoint
  withWebSocketHandle: typeof withWebSocketHandle
}

let endpoint: string
let moduleUrl: string
let stopServer: (() => Promise<void>) | undefined

beforeAll(async () => {
  const built = await build({
    configFile: false,
    logLevel: 'silent',
    build: { write: false, lib: { entry: fileURLToPath(new URL('../../src/index.ts', import.meta.url)), formats: ['es'] } },
  })
  const result = Array.isArray(built) ? built[0] : built
  if (!result || !('output' in result)) throw new Error('Expected an in-memory library bundle')
  const chunk = result.output.find((output) => output.type === 'chunk' && output.isEntry)
  if (!chunk || chunk.type !== 'chunk') throw new Error('Expected an entry chunk')
  moduleUrl = `data:text/javascript;base64,${Buffer.from(chunk.code).toString('base64')}`

  const app = new Hono()
  const { upgradeWebSocket, injectWebSocket, wss } = createNodeWebSocket({ app, baseUrl: 'http://127.0.0.1' })
  // Clone the two original 10ms fixtures without changing the shared 200ms fixtures.
  app.get(
    '/error-before-close',
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
    '/binary',
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
    '/capture',
    upgradeWebSocket(() => ({
      onMessage(event, socket) {
        socket.send(JSON.stringify({ received: String(event.data) }))
      },
    })),
  )
  const server = createAdaptorServer({ fetch: app.fetch, hostname: '127.0.0.1' })
  const connections = new Set<Socket>()
  server.on('connection', (socket) => {
    connections.add(socket)
    socket.on('close', () => connections.delete(socket))
  })
  injectWebSocket(server)
  stopServer = async () => {
    for (const client of wss.clients) client.terminate()
    await new Promise<void>((resolve, reject) => wss.close((error?: Error) => (error ? reject(error) : resolve())))
    for (const socket of connections) socket.destroy()
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected a server address')
  endpoint = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await stopServer?.()
})

async function openBrowser(name: 'chromium' | 'firefox') {
  console.log('ROUND6_BROWSER_STAGE', name, 'launch-start')
  const browser = await (name === 'firefox' ? firefox : chromium).launch({
    headless: true,
    timeout: 10_000,
    ...(name === 'firefox' ? { env: browserLaunchEnv() } : {}),
  })
  console.log('ROUND6_BROWSER_STAGE', name, 'launch-ready', browser.version())
  try {
    const page = await boundedStage(name, 'new-page', () => browser.newPage(), 5_000)
    page.on('console', (message) => {
      if (message.text().startsWith('ROUND6_')) console.log(name, message.text())
    })
    await boundedStage(
      name,
      'load-source',
      async () => {
        await page.addScriptTag({ type: 'module', content: `import * as api from '${moduleUrl}'; globalThis.round6Api = api` })
        await page.waitForFunction(() => 'round6Api' in globalThis, undefined, { timeout: 5_000 })
      },
      5_000,
    )
    return { browser, page }
  } catch (error) {
    await boundedStage(name, 'setup-cleanup', () => browser.close(), 5_000)
    throw error
  }
}

async function boundedStage<T>(name: string, stage: string, run: () => Promise<T>, timeoutMs: number): Promise<T> {
  console.log('ROUND6_BROWSER_STAGE', name, stage, 'start')
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`ROUND6_BROWSER_STAGE_TIMEOUT ${name}/${stage} after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
    console.log('ROUND6_BROWSER_STAGE', name, stage, 'settled')
  }
}

test.each(['chromium', 'firefox'] as const)(
  '%s: original 10ms closes agree with native-only controls',
  async (name) => {
    const { browser, page } = await openBrowser(name)
    try {
      const observations = await boundedStage(
        name,
        '10ms-evaluate',
        () =>
          page.evaluate(async (endpoint) => {
            const api = (globalThis as unknown as { round6Api: BrowserApi }).round6Api
            const results = []
            const startedAt = performance.now()
            for (const blockMs of [0, 25]) {
              for (const route of ['error-before-close', 'binary']) {
                for (let attempt = 0; attempt < 10; attempt += 1) {
                  for (const mode of ['native', 'library']) {
                    const events: string[] = []
                    const frames: string[] = []
                    const messages: unknown[] = []
                    const runtimeErrors: string[] = []
                    let fault: string | null = null
                    let closed: string | undefined
                    const cancellation = new AbortController()
                    let closeNative: () => void = () => undefined
                    let stage = 'construct'
                    let finishNative: () => void = () => undefined
                    const nativeClosed = new Promise<void>((resolve) => {
                      finishNative = resolve
                    })
                    let watchdog: ReturnType<typeof setTimeout> | undefined
                    const trace = () => ({
                      at: Date.now(),
                      attempt,
                      blockMs,
                      route,
                      mode,
                      stage,
                      events,
                      frames,
                      messages,
                      runtimeErrors,
                      fault,
                      closed,
                    })
                    console.log(
                      'ROUND6_10MS_ATTEMPT',
                      JSON.stringify({ at: Date.now(), attempt, blockMs, route, mode, completed: results.length }),
                    )
                    const expired = new Promise<never>((_resolve, reject) => {
                      watchdog = setTimeout(() => {
                        const diagnostic = JSON.stringify(trace())
                        console.log('ROUND6_10MS_ATTEMPT_TIMEOUT', diagnostic)
                        cancellation.abort(new Error('Audit attempt watchdog'))
                        closeNative()
                        reject(new Error(`ROUND6_10MS_ATTEMPT_TIMEOUT ${diagnostic}`))
                      }, 3_000)
                    })
                    class RecordingSocket extends WebSocket {
                      constructor(url: string | URL, protocols?: string | string[]) {
                        super(url, protocols)
                        closeNative = () => {
                          try {
                            if (this.readyState < WebSocket.CLOSING) this.close()
                          } catch (error) {
                            events.push(`cleanup-error:${error instanceof Error ? error.message : String(error)}`)
                          }
                        }
                        this.binaryType = 'arraybuffer'
                        this.addEventListener('open', () => events.push('open'))
                        this.addEventListener('error', () => events.push('error'))
                        this.addEventListener('message', (event) => {
                          events.push('message')
                          frames.push(typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data))
                        })
                        this.addEventListener('close', (event) => {
                          events.push(`close:${event.code}:${event.wasClean}`)
                          finishNative()
                        })
                        // Hold only this browser's event loop; server close stays at 10ms.
                        const end = performance.now() + blockMs
                        while (performance.now() < end) {
                          /* deliberate scheduling stress */
                        }
                      }
                    }
                    const work = async () => {
                      const protocols = route === 'binary' ? ['json'] : undefined
                      if (mode === 'native') {
                        new RecordingSocket(`${endpoint.replace(/^http/, 'ws')}/${route}`, protocols)
                      } else {
                        const client = api.createClient(api.withEndpoint(endpoint), api.withWebSocketHandle(RecordingSocket))
                        const connect = api.defineWebSocket({
                          incoming: api.struct.object({ type: api.struct.literal('message'), text: api.struct.string() }),
                          maxIncomingQueueSize: 4,
                          path: `/${route}`,
                          protocols,
                        })
                        stage = 'execute'
                        console.log('ROUND6_10MS_STAGE', JSON.stringify(trace()))
                        const [error, session] = await client.execute(connect(), { signal: cancellation.signal })
                        fault = error?.code ?? null
                        if (session) {
                          session.onRuntimeError((error) => runtimeErrors.push(error instanceof Error ? error.name : String(error)))
                          stage = 'session.closed'
                          console.log('ROUND6_10MS_STAGE', JSON.stringify(trace()))
                          closed = (await session.closed).kind
                          stage = 'receive-drain'
                          console.log('ROUND6_10MS_STAGE', JSON.stringify(trace()))
                          for await (const message of session.receive) messages.push(message)
                        }
                      }
                      stage = 'native-close'
                      console.log('ROUND6_10MS_STAGE', JSON.stringify(trace()))
                      await nativeClosed
                    }
                    try {
                      await Promise.race([work(), expired])
                    } catch (error) {
                      console.log('ROUND6_10MS_ATTEMPT_FAILED', JSON.stringify(trace()))
                      throw error
                    } finally {
                      clearTimeout(watchdog)
                      cancellation.abort()
                      closeNative()
                    }
                    results.push({ attempt, blockMs, route, mode, events, frames, messages, runtimeErrors, fault, closed })
                    if (mode === 'library' && (attempt + 1) % 10 === 0) {
                      console.log(
                        'ROUND6_10MS_PROGRESS',
                        JSON.stringify({ attempt, blockMs, route, completed: results.length, elapsedMs: performance.now() - startedAt }),
                      )
                    }
                  }
                }
              }
            }
            return results
          }, endpoint),
        30_000,
      )
      const counts: { [key: string]: number } = {}
      for (const item of observations) {
        const key = `${item.mode}/${item.route}/block=${item.blockMs}: ${item.events.join(',')} => ${item.fault ?? item.closed ?? 'native'}`
        counts[key] = (counts[key] ?? 0) + 1
      }
      console.log('ROUND6_10MS_NATIVE_CONTROL', name, browser.version(), JSON.stringify(counts))
      for (const item of observations) {
        try {
          // Under full load Firefox can close before open even in the native-only control.
          // The independent native trace is the oracle for the library's startup result.
          const opened = item.events.includes('open')
          expect(item.events.map((event) => (event.startsWith('close:') ? 'close' : event))).toEqual(
            opened ? ['open', 'message', 'close'] : ['close'],
          )
          expect(item.events.at(-1)).toMatch(/^close:1000:(true|false)$/)
          expect(item.frames).toEqual(
            opened ? [JSON.stringify({ type: 'message', text: item.route === 'binary' ? 'hello-binary' : 123 })] : [],
          )
          if (item.mode === 'library') {
            expect(item.fault).toBe(opened ? null : 'NET_UNREACHABLE')
            expect(item.closed).toBe(opened ? 'closed' : undefined)
            expect(item.messages).toEqual(opened && item.route === 'binary' ? [{ type: 'message', text: 'hello-binary' }] : [])
            expect(item.runtimeErrors).toEqual(opened && item.route === 'error-before-close' ? ['StructError'] : [])
          }
        } catch (error) {
          console.log('ROUND6_10MS_ASSERTION_FAILED', name, JSON.stringify(item))
          throw error
        }
      }
    } finally {
      await boundedStage(name, '10ms-cleanup', () => browser.close(), 5_000)
    }
  },
  60_000,
)

test.each(['chromium', 'firefox'] as const)(
  '%s: rejects an optional outgoing root that has no JSON representation',
  async (name) => {
    const { browser, page } = await openBrowser(name)
    try {
      const result = await page.evaluate(async (endpoint) => {
        const api = (globalThis as unknown as { round6Api: BrowserApi }).round6Api
        const client = api.createClient(api.withEndpoint(endpoint))
        const connect = api.defineWebSocket({
          incoming: api.struct.object({ received: api.struct.string() }),
          outgoing: api.struct.string().optional(),
          maxIncomingQueueSize: 4,
          path: '/capture',
        })
        const [error, session] = await client.execute(connect(), { timeout: 2_000 })
        if (error || !session) throw new Error(`Startup failed: ${error?.code}`)
        let sendError: string | undefined
        let received: string | undefined
        const watchdog = setTimeout(() => session.close(), 2_000)
        try {
          try {
            session.send(undefined)
          } catch (error) {
            sendError = error instanceof Error ? error.message : String(error)
          }
          if (!sendError) {
            const next = await session.receive[Symbol.asyncIterator]().next()
            if (!next.done) received = next.value.received
          }
        } finally {
          clearTimeout(watchdog)
          session.close()
          await session.closed
        }
        return { sendError, received }
      }, endpoint)
      console.log('ROUND6_OPTIONAL_OUTGOING_WIRE', name, browser.version(), JSON.stringify(result))
      expect(result.sendError).toBeTruthy()
      expect(result.received).toBeUndefined()
    } finally {
      await browser.close()
    }
  },
  15_000,
)
