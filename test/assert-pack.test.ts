import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'

test.each(['main', 'module', 'typings', 'unpkg', 'jsdelivr'])(
  'pack assertion requires the %s entry',
  async (field) => {
    const directory = await mkdtemp(join(import.meta.dirname, '.assert-pack-'))
    try {
      await Bun.write(
        join(directory, 'package.json'),
        JSON.stringify({ name: 'defjs-pack-fixture', version: '1.0.0', files: ['entry.js'], [field]: './entry.js' }),
      )
      await Bun.write(join(directory, 'LICENSE'), 'MIT')
      await Bun.write(join(directory, 'README.md'), 'fixture')
      const run = () => Bun.spawnSync([process.execPath, join(import.meta.dirname, 'assert-pack.ts'), directory])
      const missing = run()
      expect(missing.exitCode).toBe(1)
      expect(missing.stderr.toString()).toContain('missing from npm pack --dry-run: entry.js')
      await Bun.write(join(directory, 'entry.js'), 'export {}')
      const complete = run()
      expect(complete.exitCode).toBe(0)
      expect(complete.stdout.toString()).toContain('assert-pack: ok')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
  30_000,
)
