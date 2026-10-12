import '../../test/loopback-proxy-bypass'
import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { startPreview } from '../scripts/preview'
test('preview directly serves nested HTML and unknown paths return 404', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'defjs-preview-'))
  await Bun.write(join(directory, 'docs/start/index.html'), '<h1>Start</h1>')
  await Bun.write(join(directory, '404.html'), '<h1>Page not found</h1>')
  const server = startPreview(directory, 0)
  try {
    expect((await fetch(new URL('/docs/start', server.url))).status).toBe(200)
    const missing = await fetch(new URL('/unknown', server.url))
    expect(missing.status).toBe(404)
    expect(await missing.text()).toBe('<h1>Page not found</h1>')
  } finally {
    await server.stop(true)
    await rm(directory, { recursive: true, force: true })
  }
})
