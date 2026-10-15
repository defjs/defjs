/**
 * Runtime smoke test for the built `@defjs/core` bundle on Deno.
 *
 * Builds nothing. Run after `bun run build` (or at least `packages/core` build):
 *   deno run -A test/deno-smoke.ts
 *
 * Claims: HTTP JSON GET with a struct-decoded output, an SSE stream of a few
 * events, a WebSocket echo, and a `struct.parse` failure tuple.
 */
import type {
  createClient as sourceCreateClient,
  defineEventStream as sourceDefineEventStream,
  defineRequest as sourceDefineRequest,
  defineWebSocket as sourceDefineWebSocket,
  struct as sourceStruct,
  withEndpoint as sourceWithEndpoint,
} from '../packages/core/src/index'

const {
  createClient,
  defineEventStream,
  defineRequest,
  defineWebSocket,
  struct,
  withEndpoint,
}: {
  createClient: typeof sourceCreateClient
  defineEventStream: typeof sourceDefineEventStream
  defineRequest: typeof sourceDefineRequest
  defineWebSocket: typeof sourceDefineWebSocket
  struct: typeof sourceStruct
  withEndpoint: typeof sourceWithEndpoint
} = await import(new URL('../packages/core/dist/index.js', import.meta.url).href)

interface DenoNetAddr {
  hostname: string
  port: number
  transport: string
}

interface DenoServer {
  addr: DenoNetAddr
  shutdown(): Promise<void>
}

interface DenoUpgrade {
  response: Response
  socket: WebSocket
}

interface DenoRuntime {
  exit(code: number): never
  serve(options: { hostname: string; port: number }, handler: (request: Request) => Response | Promise<Response>): DenoServer
  upgradeWebSocket(request: Request): DenoUpgrade
}

function denoRuntime(): DenoRuntime {
  const runtime = (globalThis as unknown as { Deno?: DenoRuntime }).Deno
  if (!runtime) {
    throw new Error('deno-smoke: this file must run on Deno')
  }
  return runtime
}

function fail(message: string): never {
  throw new Error(`deno-smoke: ${message}`)
}

const User = struct.object({
  id: struct.number(),
  name: struct.string(),
})

const Message = struct.object({
  text: struct.string(),
  type: struct.literal('message'),
})

function handle(request: Request, deno: DenoRuntime): Response {
  const url = new URL(request.url)
  if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
    const upgraded = deno.upgradeWebSocket(request)
    upgraded.socket.onmessage = (event: { data: unknown }) => {
      if (typeof event.data === 'string') {
        upgraded.socket.send(event.data)
      }
    }
    return upgraded.response
  }

  if (request.method === 'GET' && url.pathname === '/users/7') {
    return Response.json({ id: 7, name: 'Ada' })
  }

  if (request.method === 'GET' && url.pathname === '/events') {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const text of ['one', 'two', 'three']) {
          controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify({ text })}\n\n`))
        }
        controller.close()
      },
    })
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
  }

  return new Response('not found', { status: 404 })
}

async function checkHttp(base: string): Promise<void> {
  const client = createClient(withEndpoint(base))
  const getUser = defineRequest({
    builder: (input) => ({ path: input }),
    input: struct.object({ id: struct.number() }),
    method: 'GET',
    output: User,
    path: '/users/:id',
  })
  const [error, user, response] = await client.execute(getUser({ id: 7 }))
  if (error || !user || !response) {
    fail(`HTTP GET failed: ${error ? error.code : 'missing output'}`)
  }
  if (user.id !== 7 || user.name !== 'Ada' || response.status !== 200) {
    fail(`HTTP output mismatch: ${JSON.stringify({ name: user.name, id: user.id, status: response.status })}`)
  }
}

async function checkSse(base: string): Promise<void> {
  const client = createClient(withEndpoint(base))
  const notifications = defineEventStream({
    events: { message: struct.object({ text: struct.string() }) },
    maxBufferSize: 64 * 1024,
    maxQueueSize: 16,
    path: '/events',
  })
  const [error, stream] = await client.execute(notifications())
  if (error || !stream) {
    fail(`SSE open failed: ${error ? error.code : 'missing stream'}`)
  }

  const texts: string[] = []
  {
    await using owned = stream
    for await (const event of owned) {
      if (event.event !== 'message') {
        fail(`SSE unexpected event ${event.event}`)
      }
      texts.push(event.data.text)
    }
    const closed = await owned.closed
    if (closed.kind !== 'eof') {
      fail(`SSE closed as ${closed.kind}`)
    }
  }
  if (texts.join(',') !== 'one,two,three') {
    fail(`SSE events mismatch: ${texts.join(',')}`)
  }
}

async function checkWebSocket(base: string): Promise<void> {
  const client = createClient(withEndpoint(base))
  const room = defineWebSocket({
    incoming: Message,
    maxIncomingQueueSize: 8,
    outgoing: Message,
    path: '/chat',
  })
  const [error, session] = await client.execute(room())
  if (error || !session) {
    fail(`WebSocket open failed: ${error ? error.code : 'missing session'}`)
  }

  {
    await using owned = session
    owned.send({ text: 'ping', type: 'message' })
    for await (const message of owned.receive) {
      if (message.type !== 'message' || message.text !== 'ping') {
        fail(`WebSocket echo mismatch: ${JSON.stringify(message)}`)
      }
      break
    }
  }
}

function checkStructParse(): void {
  const parsed = struct.parse(User, { id: 'not-a-number', name: 'Ada' })
  if (!Array.isArray(parsed) || parsed.length !== 2) {
    fail('struct.parse did not return a 2-tuple')
  }
  const [error, value] = parsed
  if (error === null || value !== undefined) {
    fail('struct.parse failure tuple was not [error, undefined]')
  }
  if (typeof error !== 'object' || !('issues' in error) || !Array.isArray(error.issues) || error.issues.length === 0) {
    fail('struct.parse failure tuple has no issues')
  }
}

const failures: string[] = []

async function claim(name: string, run: () => Promise<void> | void): Promise<void> {
  try {
    await run()
    console.log(`deno-smoke: ${name} ok`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    failures.push(`${name}: ${message}`)
    console.error(`deno-smoke: ${name} FAILED: ${message}`)
  }
}

const deno = denoRuntime()
const server = deno.serve({ hostname: '127.0.0.1', port: 0 }, (request) => handle(request, deno))
const watchdog = setTimeout(() => {
  console.error('deno-smoke: timed out after 15s')
  deno.exit(1)
}, 15_000)

try {
  const { hostname, port, transport } = server.addr
  if (transport !== 'tcp' || !Number.isInteger(port) || port <= 0) {
    fail(`listener did not bind a tcp port (transport=${transport}, port=${port})`)
  }
  const base = `http://${hostname}:${port}`
  console.log(`deno-smoke: ${base}`)

  await claim('http', () => checkHttp(base))
  await claim('sse', () => checkSse(base))
  await claim('websocket', () => checkWebSocket(base))
  await claim('struct.parse', () => checkStructParse())

  if (failures.length > 0) {
    fail(failures.join('\n'))
  }
  console.log('deno-smoke ok')
} finally {
  await server.shutdown()
  clearTimeout(watchdog)
}
