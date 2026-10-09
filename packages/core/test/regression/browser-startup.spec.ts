import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, firefox } from 'playwright'
import { build } from 'vite'
import { beforeAll, expect, inject, test } from 'vitest'
import { browserLaunchEnv } from '../../../../test/firefox-app-data'
import type { createClient, defineWebSocket, struct, withEndpoint, withWebSocketHandle } from '../../src'

type BrowserApi = {
  createClient: typeof createClient
  defineWebSocket: typeof defineWebSocket
  struct: typeof struct
  withEndpoint: typeof withEndpoint
  withWebSocketHandle: typeof withWebSocketHandle
}

let moduleUrl: string
beforeAll(async () => {
  const built = await build({
    configFile: false,
    logLevel: 'silent',
    build: { write: false, lib: { entry: fileURLToPath(new URL('../../src/index.ts', import.meta.url)), formats: ['es'] } },
  })
  const result = Array.isArray(built) ? built[0] : built
  if (!result) throw new Error('Expected a bundle result')
  if (!('output' in result)) throw new Error('Expected an in-memory library bundle')
  const chunk = result.output.find((output) => output.type === 'chunk' && output.isEntry)
  if (!chunk || chunk.type !== 'chunk') throw new Error('Expected an entry chunk')
  moduleUrl = `data:text/javascript;base64,${Buffer.from(chunk.code).toString('base64')}`
})

test('isolates the Firefox workaround and leaves the non-macOS branch untouched', () => {
  const before = { ...process.env }
  const env = browserLaunchEnv()
  expect(JSON.stringify(process.env) === JSON.stringify(before)).toBe(true)
  if (process.platform === 'darwin') {
    expect(env?.['MOZ_APP_DATA']).toBe(before['MOZ_APP_DATA'] ?? join(tmpdir(), 'defjs-firefox-app-data', 'roaming'))
    expect(env?.['MOZ_LOCAL_APP_DATA']).toBeTruthy()
  }
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')
  if (!descriptor) throw new Error('Expected a platform descriptor')
  try {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    expect(browserLaunchEnv()).toBeUndefined()
    expect(JSON.stringify(process.env) === JSON.stringify(before)).toBe(true)
  } finally {
    Object.defineProperty(process, 'platform', descriptor)
  }
})

test.each(['chromium', 'firefox'] as const)(
  '%s: immediate clean close settles according to observed native events',
  async (name) => {
    const browser = await (name === 'firefox' ? firefox : chromium).launch({
      headless: true,
      ...(name === 'firefox' ? { env: browserLaunchEnv() } : {}),
    })
    try {
      const page = await browser.newPage()
      page.on('console', (message) => {
        if (message.text().startsWith('ROUND5_')) console.log(name, message.text())
      })
      const endpoint = inject('testServerHost')
      await page.addScriptTag({ type: 'module', content: `import * as api from '${moduleUrl}'; globalThis.round5Api = api` })
      await page.waitForFunction(() => 'round5Api' in globalThis)
      const observations = await page.evaluate(async (endpoint) => {
        const api = (globalThis as unknown as { round5Api: BrowserApi }).round5Api
        const results: { events: string[]; fault: string | null; close: string | undefined }[] = []
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const events: string[] = []
          const cancellation = new AbortController()
          let stage = 'construct'
          let closeNative: () => void = () => undefined
          let finishNative: () => void = () => undefined
          const nativeClosed = new Promise<void>((resolve) => {
            finishNative = resolve
          })
          let watchdog: ReturnType<typeof setTimeout> | undefined
          const trace = () => ({ at: Date.now(), attempt, stage, events: events.slice() })
          const expired = new Promise<never>((_resolve, reject) => {
            watchdog = setTimeout(() => {
              const diagnostic = JSON.stringify(trace())
              console.log('ROUND5_HARNESS_TIMEOUT', diagnostic)
              cancellation.abort(new Error('ROUND5_HARNESS_TIMEOUT'))
              closeNative()
              reject(new Error(`ROUND5_HARNESS_TIMEOUT ${diagnostic}`))
            }, 5_000)
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
              this.addEventListener('open', () => events.push('open'))
              this.addEventListener('error', () => events.push('error'))
              this.addEventListener('close', (event) => {
                events.push(`close:${event.code}:${event.wasClean}`)
                finishNative()
              })
            }
          }
          const work = async () => {
            const client = api.createClient(api.withEndpoint(endpoint), api.withWebSocketHandle(RecordingSocket))
            const connect = api.defineWebSocket({
              incoming: api.struct.unknown(),
              maxIncomingQueueSize: 4,
              path: '/ws/close-immediately',
            })
            stage = 'execute'
            console.log('ROUND5_STAGE', JSON.stringify(trace()))
            const [fault, session] = await client.execute(connect(), { signal: cancellation.signal })
            let closed: string | undefined
            if (session) {
              stage = 'session.closed'
              console.log('ROUND5_STAGE', JSON.stringify(trace()))
              closed = (await session.closed).kind
            }
            stage = 'native-close'
            console.log('ROUND5_STAGE', JSON.stringify(trace()))
            await nativeClosed
            return { events: events.slice(), fault: fault?.code ?? null, close: closed }
          }
          try {
            results.push(await Promise.race([work(), expired]))
          } finally {
            clearTimeout(watchdog)
            cancellation.abort('round5-attempt-finished')
            closeNative()
          }
        }
        return results
      }, endpoint)
      for (const observation of observations) {
        expect(observation.events.some((event) => event.startsWith('close:'))).toBe(true)
        if (observation.events.includes('open')) {
          expect(observation.fault).toBeNull()
          expect(observation.close).toBe('closed')
        } else {
          expect(observation.fault).toBe('NET_UNREACHABLE')
        }
      }
      const counts: { [sequence: string]: number } = {}
      for (const observation of observations) {
        const sequence = `${observation.events.join(',')} => ${observation.fault ?? observation.close}`
        counts[sequence] = (counts[sequence] ?? 0) + 1
      }
      console.log('ROUND5_NATIVE_CLOSE', name, browser.version(), JSON.stringify(counts))
    } finally {
      await browser.close()
    }
  },
  30_000,
)
