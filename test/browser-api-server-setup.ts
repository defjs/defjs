import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { startHonoTestServer, type HonoTestServer } from './hono-test-server'

type TestProject = {
  provide(key: string, value: unknown): void
}

let testServer: HonoTestServer | undefined

export async function setup({ provide }: TestProject) {
  const app = new Hono()

  app.use(
    '*',
    cors({
      origin(origin) {
        return origin || '*'
      },
      allowHeaders: ['*', 'Accept', 'Content-Type'],
      allowMethods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
    }),
  )

  app.get('/api/users', (c) => {
    return c.json([
      { id: 1, name: 'John' },
      { id: 2, name: 'Jane' },
    ])
  })

  app.get('/api/users/:id', (c) => {
    const id = c.req.param('id')
    return c.json({ id: Number(id), name: 'John' })
  })

  testServer = await startHonoTestServer(app)
  provide('testServerHost', testServer.host)
  console.log(`Test server is running on ${testServer.host}`)
}

export async function teardown() {
  await testServer?.close()
  testServer = undefined
}
