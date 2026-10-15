import { createClient, type Client } from '@defjs/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, type App } from 'vue'
import { createClientPlugin, injectClient } from '../src'

describe('injectClient', () => {
  it('describes both requirements outside an injection context even with the plugin installed', () => {
    const app = createApp({})
    app.use(createClientPlugin(createClient()))

    expect(() => injectClient()).toThrow(/injection context.*app\.use\(createClientPlugin\(client\)\).*provide\(HTTP_CLIENT, client\)/)
  })

  it('returns the exact client inside a synchronous app.runWithContext callback', () => {
    const client = createClient()
    const app = createApp({})
    app.use(createClientPlugin(client))

    expect(app.runWithContext(injectClient)).toBe(client)
  })

  it('throws when no client is provided', () => {
    const app = createApp({
      setup() {
        injectClient()
        return () => h('div')
      },
    })
    app.config.warnHandler = () => {}

    expect(() => app.mount(document.createElement('div'))).toThrow(
      'No Defjs client available. Call injectClient() in a Vue injection context (such as synchronous setup() or app.runWithContext()) and provide a client with app.use(createClientPlugin(client)) or provide(HTTP_CLIENT, client).',
    )
  })
})

describe('createClientPlugin', () => {
  const mountedApps: App[] = []

  afterEach(() => {
    for (const app of mountedApps.splice(0)) {
      app.unmount()
    }
  })

  it('provides the exact client instance supplied by the caller', () => {
    const client = createClient()
    let injectedClient: Client | undefined
    const app = createApp({
      setup() {
        injectedClient = injectClient()
        return () => h('div')
      },
    })

    const plugin = createClientPlugin(client)
    expect(plugin).toHaveProperty('install')
    app.use(plugin)
    app.mount(document.createElement('div'))
    mountedApps.push(app)

    expect(injectedClient).toBe(client)
  })
})
