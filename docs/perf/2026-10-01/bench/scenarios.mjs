// Benchmark scenarios. `__CORE__` is replaced by bench.sh with the core `src/index.ts` under test.
import {
  createClient,
  createHttpInterceptor,
  defineEventStream,
  defineRequest,
  defineWebSocket,
  struct,
  withEndpoint,
  withHTTPHandle,
  withInterceptors,
  withSSEHandle,
  withTimeout,
  withWebSocketHandle,
} from '__CORE__'

const JSON_HEADERS = { 'content-type': 'application/json' }
const base = 'https://api.example.com/v1'
const handleOf =
  (body, status = 200) =>
  () =>
    Promise.resolve(new Response(body, { headers: JSON_HEADERS, status }))
const check = (result) => {
  if (result[0] !== null) throw result[0]
  return result
}

// ---- HTTP -------------------------------------------------------------------------------------
const User = struct.object({
  id: struct.number(),
  name: struct.string(),
  email: struct.string(),
  active: struct.boolean(),
  createdAt: struct.string().alias('created_at'),
})
const userJson = JSON.stringify({ id: 1, name: 'Ada', email: 'ada@example.com', active: true, created_at: '2026-01-01T00:00:00Z' })
const listJson = JSON.stringify(
  Array.from({ length: 1000 }, (_, i) => ({ id: i, name: `n${i}`, email: `u${i}@x.io`, active: i % 2 === 0, created_at: '2026-01-01' })),
)
const getUser = defineRequest({
  builder: (input) => ({ path: input }),
  input: struct.object({ id: struct.number() }),
  method: 'GET',
  output: User,
  path: '/users/:id',
})
const getUserWithError = defineRequest({
  builder: (input) => ({ path: input }),
  error: struct.object({ code: struct.string(), message: struct.string() }),
  input: struct.object({ id: struct.number() }),
  method: 'GET',
  output: User,
  path: '/users/:id',
})
const ping = defineRequest({ method: 'GET', path: '/ping' })
const search = defineRequest({
  builder: (input) => ({ query: input }),
  input: struct.object({ keyword: struct.string(), pageSize: struct.number().alias('page_size'), tags: struct.array(struct.string()) }),
  method: 'GET',
  output: struct.array(User),
  path: '/users',
})
const createUser = defineRequest({
  builder: (input) => ({ body: input }),
  input: struct.object({
    name: struct.string(),
    email: struct.string(),
    active: struct.boolean(),
    createdAt: struct.date().alias('created_at'),
    tags: struct.array(struct.string()),
    profile: struct.object({ bio: struct.string(), age: struct.number().optional() }),
    role: struct.enum(['admin', 'user']),
    note: struct.string().nullish(),
  }),
  method: 'POST',
  output: User,
  path: '/users',
})
const Item = struct.object({
  sku: struct.string(),
  qty: struct.number(),
  unitPrice: struct.number().alias('unit_price'),
  note: struct.string().optional(),
  tags: struct.array(struct.string()),
})
const createOrder = defineRequest({
  builder: (input) => ({ body: input }),
  input: struct.object({ customerId: struct.number().alias('customer_id'), items: struct.array(Item) }),
  method: 'POST',
  path: '/orders',
})
const orderInput = {
  customerId: 7,
  items: Array.from({ length: 50 }, (_, i) => ({ sku: `sku-${i}`, qty: i, unitPrice: i * 1.5, tags: ['a', 'b'] })),
}
const listDecl = defineRequest({ method: 'GET', output: struct.array(User), path: '/users' })
const passthrough = createHttpInterceptor((req, next) => next(req))

const small = createClient(withEndpoint(base), withHTTPHandle(handleOf(userJson)))
const empty = createClient(
  withEndpoint(base),
  withHTTPHandle(() => Promise.resolve(new Response(null, { status: 204 }))),
)
const list = createClient(withEndpoint(base), withHTTPHandle(handleOf(listJson)))
const timed = createClient(withEndpoint(base), withTimeout(5000), withHTTPHandle(handleOf(userJson)))
const intercepted = createClient(withEndpoint(base), withInterceptors(passthrough, passthrough), withHTTPHandle(handleOf(userJson)))
const failing = createClient(withEndpoint(base), withHTTPHandle(handleOf(JSON.stringify({ code: 'not_found', message: 'missing' }), 404)))
const orders = createClient(
  withEndpoint(base),
  withHTTPHandle(() => Promise.resolve(new Response(null, { status: 201 }))),
)
const rawHandle = handleOf(userJson)
const createdAt = new Date('2026-01-01T00:00:00Z')

// ---- Loopback HTTP ----------------------------------------------------------------------------
// The default handle against a real socket, so body reads and Request construction cost what they cost in production.
// The server starts on first use; the A and B builds of a pair each get their own, with identical payloads.
let netClient
// The loopback server needs node:http. A runtime specifier keeps this module bundleable for the browser harness.
const netServerModule = './net-server.mjs'
const net = () =>
  (netClient ??= import(netServerModule)
    .then(({ startJsonServer }) => startJsonServer({ '/v1/users/1': userJson, '/v1/users': listJson }))
    .then((url) => createClient(withEndpoint(`${url}/v1`))))

// ---- struct -----------------------------------------------------------------------------------
const ListStruct = struct.array(User)
const listValue = JSON.parse(listJson)
let sink = 0

// ---- SSE --------------------------------------------------------------------------------------
const EVENTS = 2000
let sseText = ''
for (let i = 0; i < EVENTS; i += 1) sseText += `id: ${i}\nevent: tick\ndata: {"seq":${i},"value":"payload-${i}","ok":true}\n\n`
const sseBytes = new TextEncoder().encode(sseText)
const sseBody = () => {
  let offset = 0
  return new ReadableStream({
    pull(controller) {
      if (offset >= sseBytes.length) return controller.close()
      controller.enqueue(sseBytes.subarray(offset, offset + 16 * 1024))
      offset += 16 * 1024
    },
  })
}
const sseClient = createClient(
  withEndpoint(base),
  withSSEHandle(() => Promise.resolve(new Response(sseBody(), { headers: { 'content-type': 'text/event-stream' } }))),
)
const feed = defineEventStream({
  events: { tick: struct.object({ seq: struct.number(), value: struct.string(), ok: struct.boolean() }) },
  maxBufferSize: 1024 * 1024,
  maxQueueSize: 1_000_000,
  method: 'GET',
  path: '/feed',
})

// ---- WebSocket --------------------------------------------------------------------------------
const MESSAGES = 2000
const frames = Array.from({ length: MESSAGES }, (_, i) => JSON.stringify({ type: 'tick', seq: i, value: `payload-${i}` }))
let latestSocket
class MockSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  binaryType = 'blob'
  bufferedAmount = 0
  extensions = ''
  protocol = ''
  readyState = 0
  listeners = Object.create(null)
  constructor(url) {
    this.url = url
    latestSocket = this
    queueMicrotask(() => {
      this.readyState = 1
      this.emit('open', {})
    })
  }
  addEventListener(type, listener) {
    ;(this.listeners[type] ??= []).push(listener)
  }
  removeEventListener(type, listener) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((item) => item !== listener)
  }
  send() {}
  close(code = 1000, reason = '') {
    this.readyState = 3
    queueMicrotask(() => this.emit('close', { code, reason, wasClean: true }))
  }
  emit(type, event) {
    for (const listener of [...(this.listeners[type] ?? [])]) listener(event)
  }
}
const wsClient = createClient(withEndpoint('ws://localhost'), withWebSocketHandle(MockSocket))
const socketFeed = defineWebSocket({
  incoming: struct.object({ type: struct.literal('tick'), seq: struct.number(), value: struct.string() }),
  maxIncomingQueueSize: 100_000,
  path: '/ws',
})

export const scenarios = {
  'raw-fetch-json': async () => (await rawHandle()).json(),
  'ping-no-decl': async () => check(await empty.execute(ping())),
  'get-small': async () => check(await small.execute(getUser({ id: 1 }))),
  'get-small-timeout': async () => check(await timed.execute(getUser({ id: 1 }))),
  'get-small-2-interceptors': async () => check(await intercepted.execute(getUser({ id: 1 }))),
  // The body is one object, so the array output fails: this measures the decode-failure path.
  'get-query': async () => small.execute(search({ keyword: 'ada lovelace', pageSize: 10, tags: ['a', 'b'] })),
  'post-json': async () =>
    check(
      await small.execute(
        createUser({
          active: true,
          createdAt,
          email: 'ada@example.com',
          name: 'Ada',
          note: null,
          profile: { bio: 'hi', age: 36 },
          role: 'admin',
          tags: ['a', 'b', 'c'],
        }),
      ),
    ),
  'post-order-50': async () => check(await orders.execute(createOrder(orderInput))),
  'error-404-declared': async () => {
    const result = await failing.execute(getUserWithError({ id: 1 }))
    if (result[0] === null) throw new Error('expected a fault')
    return result
  },
  'get-list-1000': async () => check(await list.execute(listDecl())),
  'net-get-small': async () => check(await (await net()).execute(getUser({ id: 1 }))),
  'net-get-list': async () => check(await (await net()).execute(listDecl())),
  'struct-decode-1000': async () => check(struct.parse(ListStruct, listValue, { aliases: true })),
  'struct-decode-1000+read': async () => {
    const [, value] = check(struct.parse(ListStruct, listValue, { aliases: true }))
    for (let round = 0; round < 5; round += 1) {
      for (const item of value) sink += item.id + item.name.length + item.email.length + (item.active ? 1 : 0) + item.createdAt.length
    }
    return value
  },
  'sse-2000-events': async () => {
    const [error, stream] = await sseClient.execute(feed())
    if (error) throw error
    let count = 0
    for await (const event of stream) count += event.data.seq >= 0 ? 1 : 0
    if (count !== EVENTS) throw new Error(`received ${count} events`)
    return count
  },
  'ws-2000-messages': async () => {
    const [error, socket] = await wsClient.execute(socketFeed())
    if (error) throw error
    const mock = latestSocket
    const iterator = socket.receive[Symbol.asyncIterator]()
    let count = 0
    for (let i = 0; i < MESSAGES; i += 1) {
      mock.emit('message', { data: frames[i] })
      if ((i & 63) === 63) {
        while (count <= i) {
          if ((await iterator.next()).done) throw new Error('closed early')
          count += 1
        }
      }
    }
    while (count < MESSAGES) {
      if ((await iterator.next()).done) throw new Error('closed early')
      count += 1
    }
    socket.close(1000, 'done')
    await socket.closed
    return count
  },
}

export const sinkValue = () => sink
