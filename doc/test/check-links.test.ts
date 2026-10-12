import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkLinks } from '../scripts/check-links'
test('static link validation handles encoded paths/resources and rejects missing pages, anchors and empty output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'defjs-links-'))
  try {
    await expect(checkLinks(directory)).rejects.toThrow('No generated')
    await Bun.write(join(directory, 'index.html'), '<a href="/%E4%B8%AD%E6%96%87#target">中文</a><img src="/logo.jpg">')
    await Bun.write(join(directory, '中文/index.html'), '<h1 id="target">title</h1>')
    await Bun.write(join(directory, 'logo.jpg'), 'asset')
    await expect(checkLinks(directory)).resolves.toBeUndefined()
    await Bun.write(join(directory, 'index.html'), '<a href="/missing">missing</a><a href="/中文#missing">missing anchor</a>')
    await expect(checkLinks(directory)).rejects.toThrow('missing page')
    await expect(checkLinks(directory)).rejects.toThrow('missing anchor')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
