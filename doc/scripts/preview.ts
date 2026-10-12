import { resolve, relative } from 'node:path'
import type { Server } from 'bun'
export function startPreview(directory = resolve(import.meta.dir, '../build/client'), port = 3000): Server<undefined> {
  const root = resolve(directory)
  return Bun.serve({
    port,
    async fetch(request) {
      const pathname = decodeURIComponent(new URL(request.url).pathname)
      const path = resolve(root, '.' + pathname)
      if (relative(root, path).startsWith('..')) return new Response('Forbidden', { status: 403 })
      for (const candidate of [path, resolve(path, 'index.html')]) {
        const file = Bun.file(candidate)
        if ((await file.exists()) && file.size) return new Response(file)
      }
      const notFound = Bun.file(resolve(root, '404.html'))
      return new Response((await notFound.exists()) ? notFound : 'Not Found', { status: 404 })
    },
  })
}
if (import.meta.main) {
  const server = startPreview()
  console.log(`Static documentation: ${server.url}`)
}
