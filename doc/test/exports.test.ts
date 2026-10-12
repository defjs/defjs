import { expect, test } from 'bun:test'
import { dirname, resolve } from 'node:path'
import { apiEntries } from '../app/data/api-catalog'

const packages = ['core', 'react', 'vue', 'opentelemetry-server']
const entryOf = (pkg: string) => resolve(import.meta.dir, `../../packages/${pkg}/src/index.ts`)

/**
 * Every name a module exports. Type-only exports have no runtime presence, so their names are read from the source
 * (`export { a }`, `export type { a } from`, `export type|interface|class|function|const a`, and `export *` followed
 * recursively). The caller checks the runtime namespace against this set, which catches syntax the scan misses for values.
 */
async function sourceExports(file: string, visited = new Set<string>()): Promise<Set<string>> {
  if (visited.has(file)) return new Set()
  visited.add(file)
  const text = (await Bun.file(file).text()).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''),
    names = new Set<string>()
  for (const match of text.matchAll(/export\s+(?:type\s+)?\{([^}]+)\}/g))
    for (const name of (match[1] ?? '').split(',')) {
      const clean = name
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)
        .at(-1)
      if (clean) names.add(clean)
    }
  for (const match of text.matchAll(
    /export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:type|interface|class|enum|function|const)\s+(\w+)/g,
  ))
    if (match[1]) names.add(match[1])
  for (const match of text.matchAll(/export\s+\*\s+from\s+['"]([^'"]+)['"]/g)) {
    const base = resolve(dirname(file), match[1] ?? '')
    const target = (await Bun.file(base + '.ts').exists()) ? base + '.ts' : resolve(base, 'index.ts')
    for (const name of await sourceExports(target, visited)) names.add(name)
  }
  return names
}

/** A class declares a type, and the catalog has no separate class kind. */
function runtimeKind(value: unknown): string {
  if (typeof value !== 'function') return 'constant'
  return /^class\b/.test(Function.prototype.toString.call(value)) ? 'type' : 'function'
}

test.each(packages)('@defjs/%s catalog matches its public exports, in both directions, with the right kind', async (pkg) => {
  const runtime: Record<string, unknown> = await import(entryOf(pkg)),
    names = await sourceExports(entryOf(pkg)),
    catalog = new Map(
      apiEntries
        .filter((entry) => entry.package === `@defjs/${pkg}` && !entry.name.startsWith('struct.'))
        .map((entry) => [entry.name, entry.kind]),
    )
  expect(Object.keys(runtime).filter((name) => !names.has(name))).toEqual([])
  expect([...names].filter((name) => !catalog.has(name))).toEqual([])
  expect([...catalog.keys()].filter((name) => !names.has(name))).toEqual([])
  const wrongKinds = [...catalog].filter(([name, kind]) => kind !== (name in runtime ? runtimeKind(runtime[name]) : 'type'))
  expect(wrongKinds).toEqual([])
})

test('struct.* catalog entries are exactly the struct facade members', async () => {
  const { struct } = await import(entryOf('core')),
    members = apiEntries.filter((entry) => entry.package === '@defjs/core' && entry.name.startsWith('struct.'))
  expect(members.map((entry) => entry.name.slice('struct.'.length)).sort()).toEqual(Object.keys(struct).sort())
  expect(members.filter((entry) => entry.kind !== 'function')).toEqual([])
})
