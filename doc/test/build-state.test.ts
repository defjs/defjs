import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { assertFreshBuild, buildFingerprint, writeBuildStamp } from '../scripts/build-state'
test('site acceptance rejects missing or stale build stamps', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'defjs-build-'))
  try {
    await expect(assertFreshBuild(directory, 'current')).rejects.toThrow('Missing')
    await writeBuildStamp(directory, 'previous')
    await expect(assertFreshBuild(directory, 'current')).rejects.toThrow('Stale')
    await writeBuildStamp(directory, 'current')
    await expect(assertFreshBuild(directory, 'current')).resolves.toBeUndefined()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

import { finalizeBuild } from '../scripts/build'
test('static build finalization rejects changed inputs, supplies GitHub Pages 404.html and drops unused search .data copies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'defjs-finalize-'))
  try {
    await Bun.write(join(directory, '404/index.html'), '<main><h1>404</h1></main>')
    await Bun.write(join(directory, 'api/search/en-US.json'), '{}')
    await Bun.write(join(directory, 'api/search/en-US.json.data'), '[]')
    await expect(finalizeBuild(directory, 'before', 'after')).rejects.toThrow('changed')
    expect(await Bun.file(join(directory, 'build-stamp.txt')).exists()).toBe(false)
    await finalizeBuild(directory, 'current', 'current')
    expect(await Bun.file(join(directory, '404.html')).text()).toContain('<h1>404</h1>')
    expect(await Bun.file(join(directory, 'api/search/en-US.json')).exists()).toBe(true)
    expect(await Bun.file(join(directory, 'api/search/en-US.json.data')).exists()).toBe(false)
    await expect(assertFreshBuild(directory, 'current')).resolves.toBeUndefined()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('build fingerprint covers included examples, public assets and tsconfig', async () => {
  const root = await mkdtemp(join(tmpdir(), 'defjs-fingerprint-'))
  try {
    for (const file of [
      'app/a.ts',
      'content/a.mdx',
      'examples/a.ts',
      'public/a.txt',
      'tsconfig.json',
      'vite.config.ts',
      'react-router.config.ts',
      'package.json',
      'scripts/build.ts',
      'scripts/build-state.ts',
      'scripts/check-links.ts',
    ])
      await Bun.write(join(root, file), 'one')
    let previous = await buildFingerprint(root)
    for (const file of ['examples/a.ts', 'public/a.txt', 'tsconfig.json']) {
      await Bun.write(join(root, file), `changed ${file}`)
      const next = await buildFingerprint(root)
      expect(next).not.toBe(previous)
      previous = next
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
