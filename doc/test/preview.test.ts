import '../../test/loopback-proxy-bypass'
import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { startPreview } from '../scripts/preview'

test.each([
  { name: 'serves nested directory indexes', pathname: '/docs/start', statuses: [200], body: '<h1>Start</h1>' },
  { name: 'keeps the regular 404 page', pathname: '/unknown', statuses: [404], body: '<h1>Page not found</h1>' },
  { name: 'controls malformed percent escapes', pathname: '/%', statuses: [400, 404] },
  { name: 'controls invalid UTF-8 escapes', pathname: '/%C3%28', statuses: [400, 404] },
  { name: 'serves legitimate dot-prefixed files', pathname: '/..hidden.txt', statuses: [200], body: 'inside the preview root' },
  { name: 'serves empty files', pathname: '/empty.js', statuses: [200], body: '' },
  // Encoding the slash too keeps URL normalization from removing the traversal before the guard sees it.
  { name: 'rejects the exact parent directory', pathname: '/%2e%2e%2f', statuses: [403], body: 'Forbidden' },
  { name: 'rejects files outside the root', pathname: '/%2e%2e%2foutside.txt', statuses: [403], body: 'Forbidden' },
])('preview $name', async ({ pathname, statuses, body }) => {
  const directory = await mkdtemp(join(tmpdir(), 'defjs-preview-'))
  const root = join(directory, 'public')
  let server: ReturnType<typeof startPreview> | undefined
  try {
    await Bun.write(join(root, 'docs/start/index.html'), '<h1>Start</h1>')
    await Bun.write(join(root, '404.html'), '<h1>Page not found</h1>')
    await Bun.write(join(root, '..hidden.txt'), 'inside the preview root')
    await Bun.write(join(root, 'empty.js'), '')
    await Bun.write(join(directory, 'outside.txt'), 'outside the preview root')
    server = startPreview(root, 0)
    const response = await fetch(new URL(pathname, server.url))
    expect(response.status).toBeOneOf(statuses)
    if (body !== undefined) expect(await response.text()).toBe(body)
  } finally {
    try {
      await server?.stop(true)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
})
