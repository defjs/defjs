// Heap retained after many requests that share one long-lived caller signal (node --expose-gc).
// Linear growth across rounds is a leak; a flat line is only Node's own AbortSignal.any bookkeeping.
import { createClient, defineEventStream, defineRequest, struct, withEndpoint, withHTTPHandle, withSSEHandle } from '__CORE__'

const json = JSON.stringify({ id: 1, name: 'Ada' })
const http = createClient(
  withEndpoint('https://api.example.com'),
  withHTTPHandle(() => Promise.resolve(new Response(json, { headers: { 'content-type': 'application/json' } }))),
)
const get = defineRequest({ method: 'GET', path: '/u', output: struct.object({ id: struct.number(), name: struct.string() }) })
const payload = new TextEncoder().encode('event: tick\ndata: {"seq":1}\n\n')
const sse = createClient(
  withEndpoint('https://api.example.com'),
  withSSEHandle(() =>
    Promise.resolve(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(payload)
            controller.close()
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
    ),
  ),
)
const feed = defineEventStream({
  events: { tick: struct.object({ seq: struct.number() }) },
  maxBufferSize: 65536,
  maxQueueSize: 16,
  path: '/feed',
})

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    if (globalThis.gc) globalThis.gc()
    else globalThis.Bun.gc(true)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

async function measure(label, once, rounds) {
  const longLived = new AbortController()
  for (let i = 0; i < 500; i += 1) await once(longLived.signal)
  await settle()
  const start = process.memoryUsage().heapUsed
  let total = 0
  const growth = []
  for (const count of rounds) {
    for (let i = 0; i < count; i += 1) await once(longLived.signal)
    total += count
    await settle()
    growth.push(`${total}: +${((process.memoryUsage().heapUsed - start) / 1024).toFixed(0)} KiB`)
  }
  console.log(`${label}\t${growth.join('\t')}`)
}

const expectOk = (result) => {
  if (result[0]) throw result[0]
}
await measure('http { signal }', async (signal) => expectOk(await http.execute(get(), { signal })), [20000, 40000])
await measure('http { signal, timeout }', async (signal) => expectOk(await http.execute(get(), { signal, timeout: 60000 })), [20000, 40000])
await measure('http { timeout }', async () => expectOk(await http.execute(get(), { timeout: 60000 })), [20000, 40000])
await measure(
  'sse { signal }',
  async (signal) => {
    const [error, stream] = await sse.execute(feed(), { signal })
    if (error) throw error
    for await (const _event of stream);
  },
  [5000, 10000],
)
