import { join } from 'node:path'

export async function buildFingerprint(root = new URL('../', import.meta.url).pathname): Promise<string> {
  const paths = await Array.fromAsync(new Bun.Glob('{app,content,examples,public}/**/*').scan({ cwd: root, onlyFiles: true }))
  paths.push(
    'tsconfig.json',
    'vite.config.ts',
    'react-router.config.ts',
    'package.json',
    'scripts/build.ts',
    'scripts/build-state.ts',
    'scripts/check-links.ts',
    '../bun.lock',
    '../package.json',
  )
  const hash = new Bun.CryptoHasher('sha256')
  for (const path of paths.sort()) {
    hash.update(path)
    hash.update(await Bun.file(join(root, path)).arrayBuffer())
  }
  return hash.digest('hex')
}
export async function assertFreshBuild(directory: string, fingerprint: string): Promise<void> {
  const file = Bun.file(join(directory, 'build-stamp.txt'))
  if (!(await file.exists())) throw new Error('Missing build stamp; build the documentation before site tests')
  if ((await file.text()).trim() !== fingerprint) throw new Error('Stale documentation build; rebuild before site tests')
}
export async function writeBuildStamp(directory: string, fingerprint: string): Promise<void> {
  await Bun.write(join(directory, 'build-stamp.txt'), fingerprint)
}
