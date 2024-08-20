import { type Server, createServer } from 'node:http'
import { createApp, createRouter, defineEventHandler, eventHandler, getQuery, handleCors, readBody, toNodeListener } from 'h3'
import type { GlobalSetupContext } from 'vitest/node'

declare module 'vitest' {
  export interface ProvidedContext {
    testServerHost: string
  }
}

let testServer: Server
let testServerAddr: string

export function setup({ provide }: GlobalSetupContext) {
  const app = createApp()

  app.use(
    defineEventHandler(event => {
      handleCors(event, {
        origin: () => true,
        allowHeaders: ['Content-Type'],
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        preflight: {
          statusCode: 204,
        },
      })
    }),
  )

  app.use(
    createRouter()
      .head(
        '/',
        eventHandler(() => new Response(undefined, { status: 204 })),
      )
      .get(
        '/',
        eventHandler(() => new Response(undefined, { status: 200 })),
      )
      .post(
        '/',
        eventHandler(async event => await readBody(event)),
      )
      .get(
        '/text',
        eventHandler(() => new Response('Hello World!')),
      )
      .get(
        '/json',
        eventHandler(() => Response.json({ id: 1 })),
      )
      .get(
        '/null',
        eventHandler(() => new Response()),
      )
      .get(
        '/500',
        eventHandler(
          () =>
            new Response(undefined, {
              status: 500,
              statusText: 'Internal Server Error',
            }),
        ),
      )
      .head(
        '/head',
        eventHandler(
          () =>
            new Response(undefined, {
              status: 204,
              statusText: 'No Content',
            }),
        ),
      )
      .post(
        '/account',
        eventHandler(() => Response.json({ id: 1, name: 'Jack' })),
      )
      .get(
        '/delay',
        eventHandler(async req => {
          const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
          const { ms } = getQuery<{ ms: string }>(req)
          await delay(Number(ms))
          return new Response(undefined, { status: 200 })
        }),
      ),
  )

  testServer = createServer(toNodeListener(app)).listen(() => {
    const addr = testServer.address()
    if (typeof addr === 'object' && addr !== null) {
      testServerAddr = `http://localhost:${addr.port}`
      provide('testServerHost', testServerAddr)
    } else {
      throw new Error('Cannot get test server address')
    }

    console.log(`Test server is running on ${testServerAddr}`)
  })
}

export function teardown() {
  testServer.closeAllConnections()
  testServer.close(() => {
    console.log(`Stop test server ${testServerAddr}`)
  })
}
