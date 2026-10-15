// Loopback HTTP server for the net-* scenarios: real sockets and real body streams, unlike the in-memory handles of the other
// scenarios. It runs inside the benchmark process, so its cost is shared by every build that is being compared.
import { createServer } from 'node:http'

/** Serves each `{ path: jsonText }` entry and resolves with the server's base URL. It never keeps the process alive. */
export function startJsonServer(routes) {
  const payloads = new Map(Object.entries(routes).map(([path, text]) => [path, { length: Buffer.byteLength(text), text }]))
  const server = createServer((request, response) => {
    const payload = payloads.get(request.url)
    if (!payload) {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'content-length': payload.length, 'content-type': 'application/json' })
    response.end(payload.text)
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      server.unref()
      resolve(`http://127.0.0.1:${server.address().port}`)
    })
  })
}
