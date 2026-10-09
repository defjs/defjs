import { upgradeWebSocket } from '@hono/node-server'
import type { Context, Hono } from 'hono'
import { streamSSE } from 'hono/streaming'

type EchoField = {
  filename?: string
  name: string
  text: string
  type?: string
}

const missHits: string[] = []

export function registerE2eProbe(app: Hono): void {
  // Record before routing so a 404 still counts as a request that reached the server.
  app.use('*', async (c, next) => {
    const path = new URL(c.req.url).pathname
    if (path.startsWith('/e2e/miss/')) {
      missHits.push(`${c.req.method} ${path}`)
    }
    await next()
  })
}

export function registerE2eRoutes(app: Hono): void {
  app.get('/e2e/miss-log', (c) => c.json({ hits: missHits }))

  app.all('/e2e/echo', echoReceived)
  app.all('/e2e/echo/*', echoReceived)

  app.get('/e2e/in/text', (c) => c.text('hello-text'))
  app.get('/e2e/in/text-error', (c) => c.text('bad-text', 400))
  app.get('/e2e/in/json', (c) =>
    c.json({
      birthday: '1815-12-10T00:00:00.000Z',
      user_name: 'Ada',
    }),
  )
  app.get('/e2e/in/json-error', (c) => c.json({ error_code: 'BAD', message: 'nope' }, 422))
  app.get('/e2e/in/blob', (c) => c.body(Uint8Array.from([1, 2, 3, 4]), 200, { 'content-type': 'image/png' }))
  app.get('/e2e/in/blob-error', (c) => c.body(Uint8Array.from([5, 6, 7, 8]), 415, { 'content-type': 'image/png' }))
  app.get('/e2e/in/bytes', (c) => c.body(Uint8Array.from([9, 8, 7]), 200, { 'content-type': 'application/octet-stream' }))
  app.get('/e2e/in/bytes-error', (c) => c.body(Uint8Array.from([4, 5, 6]), 400, { 'content-type': 'application/octet-stream' }))

  app.post('/e2e/sse/:room', async (c) => {
    const room = c.req.param('room')
    const url = new URL(c.req.url)
    const traceId = c.req.header('x-trace-id') ?? ''
    const body = await c.req.text()
    const rawQuery = url.search.startsWith('?') ? url.search.slice(1) : url.search
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ data: 'plain-from-server', event: 'note', id: '1' })
      await stream.writeSSE({
        data: JSON.stringify({
          body,
          rawQuery,
          room,
          trace_id: traceId,
        }),
        event: 'meta',
        id: '2',
      })
    })
  })

  app.get(
    '/e2e/ws/:room',
    upgradeWebSocket((c) => {
      const room = c.req.param('room')
      const rawQuery = new URL(c.req.url).search.replace(/^\?/, '')
      return {
        onMessage(event, ws) {
          ws.send(JSON.stringify({ raw: frameText(event.data), type: 'observed' }))
          setTimeout(() => {
            if (ws.readyState === 1) {
              ws.close(1000, 'done')
            }
          }, 20)
        },
        onOpen(_event, ws) {
          ws.send(JSON.stringify({ query: rawQuery, room_id: room, type: 'joined' }))
        },
      }
    }),
  )
}

async function echoReceived(c: Context): Promise<Response> {
  const url = new URL(c.req.url)
  const headers: { [key: string]: string } = {}
  c.req.raw.headers.forEach((value, key) => {
    headers[key] = value
  })

  const fields: EchoField[] = []
  let bodyBase64 = ''
  let bodyText = ''
  const contentType = headers['content-type']
  if (contentType?.includes('multipart/form-data')) {
    const parsed = await c.req.parseBody({ all: true })
    for (const [name, value] of Object.entries(parsed)) {
      await appendParsedField(fields, name, value)
    }
  } else if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const bytes = new Uint8Array(await c.req.arrayBuffer())
    bodyBase64 = Buffer.from(bytes).toString('base64')
    bodyText = new TextDecoder().decode(bytes)
  }

  return c.json({
    bodyBase64,
    bodyText,
    fields,
    headers,
    method: c.req.method,
    path: url.pathname,
    rawQuery: url.search.startsWith('?') ? url.search.slice(1) : url.search,
  })
}

async function appendParsedField(fields: EchoField[], name: string, value: unknown): Promise<void> {
  if (Array.isArray(value)) {
    for (const entry of value) {
      await appendParsedField(fields, name, entry)
    }
    return
  }
  if (typeof value === 'string') {
    fields.push({ name, text: value })
    return
  }
  if (typeof File !== 'undefined' && value instanceof File) {
    fields.push({
      filename: value.name,
      name,
      text: await value.text(),
      type: value.type,
    })
    return
  }
  throw new TypeError(`Unsupported multipart field "${name}"`)
}

function frameText(data: unknown): string {
  if (typeof data === 'string') {
    return data
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data)
  }
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
  }
  return ''
}
