import { afterAll, beforeAll } from 'bun:test'
import * as Bun from 'bun'
import { createApp, createRouter, getQuery, toWebHandler } from 'h3'
import { type Client, createClient } from './src/client'

export let testServer: Bun.Server
export let testClient: Client

beforeAll(() => {
  const app = createApp()

  const router = createRouter()
    .use('/', req => new Response(req._requestBody, { status: 200 }))
    .get('/text', () => new Response('Hello World!'))
    .get('/json', () => Response.json({ id: 1 }))
    .get('/null', () => new Response())
    .get(
      '/500',
      () =>
        new Response(undefined, {
          status: 500,
          statusText: 'Internal Server Error',
        }),
    )
    .post('/account', () => Response.json({ id: 1, name: 'Jack' }))
    .get('/delay', async req => {
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
      const { ms } = getQuery<{ ms: string }>(req)
      await delay(Number(ms))
      return new Response(undefined, { status: 200 })
    })

  app.use(router)

  testServer = Bun.serve({
    port: 0,
    fetch: req => toWebHandler(app)(req),
  })

  testClient = createClient({
    host: testServer.url.origin,
  })
})

afterAll(() => {
  testServer?.stop()
})
