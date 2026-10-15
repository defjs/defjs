import type { IncomingMessage, ServerResponse } from 'node:http'
import { Hono } from 'hono'
import type { Plugin } from 'vite'
import { registerXsrfRoutes } from './xsrf-middleware.ts'

function toRequest(req: IncomingMessage, body: Buffer): Request {
  const host = req.headers.host ?? 'localhost'
  return new Request(`http://${host}${req.url}`, {
    method: req.method,
    headers: req.headers as unknown as { [key: string]: string },
    body: body.length > 0 ? (body as unknown as BodyInit) : undefined,
  })
}

async function sendResponse(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status
  response.headers.forEach((value, key) => res.setHeader(key, value))
  const buffer = Buffer.from(await response.arrayBuffer())
  res.end(buffer)
}

async function forward(req: IncomingMessage, res: ServerResponse, app: Hono): Promise<void> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const request = toRequest(req, Buffer.concat(chunks))
  const response = await app.fetch(request)
  await sendResponse(response, res)
}

export function xsrfProxyPlugin(): Plugin {
  const app = new Hono()
  registerXsrfRoutes(app)

  return {
    name: 'xsrf-test-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/xsrf-')) {
          next()
          return
        }
        forward(req, res, app).catch(next)
      })
    },
  }
}
