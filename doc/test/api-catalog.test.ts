import { expect, spyOn, test } from 'bun:test'
import { apiEntries, filterApiEntries, validateApiEntries } from '../app/data/api-catalog'
import type { ApiEntry } from '../app/data/api-catalog'
const entries: ApiEntry[] = [
  { package: '@defjs/core', name: 'createClient', kind: 'function', slug: 'core/create-client', related: [] },
  { package: '@defjs/react', name: 'createClient', kind: 'function', slug: 'react/create-client', related: [] },
  { package: '@defjs/core', name: 'ClientOption', kind: 'type', slug: 'core/client-option', related: [] },
]
test('API search ignores case and combines package and category filters', () => {
  expect(filterApiEntries(entries, 'CREATE', '@defjs/core', 'function').map((entry) => entry.slug)).toEqual(['core/create-client'])
  expect(filterApiEntries(entries, '', '', 'function')).toHaveLength(2)
  expect(filterApiEntries(entries, 'missing', '', '')).toEqual([])
  expect(() => validateApiEntries(entries)).not.toThrow()
})
test('API search matches ASCII identifiers independently of Turkish locale folding', () => {
  const localeLowerCase = String.prototype.toLocaleLowerCase
  const turkishFold = spyOn(String.prototype, 'toLocaleLowerCase').mockImplementation(function (this: string) {
    return localeLowerCase.call(this, 'tr-TR')
  })
  try {
    expect(filterApiEntries(apiEntries, 'interceptor', '@defjs/core', 'function').map((entry) => entry.name)).toContain(
      'createHttpInterceptor',
    )
    expect(filterApiEntries(entries, 'CREATECLIENT', '@defjs/core', 'function').map((entry) => entry.slug)).toEqual(['core/create-client'])
    expect(filterApiEntries(entries, 'I', '@defjs/core', 'function').map((entry) => entry.slug)).toEqual(['core/create-client'])
    expect(filterApiEntries(entries, 'ı', '@defjs/core', 'function')).toEqual([])
  } finally {
    turkishFold.mockRestore()
  }
})
test('API identities, slugs and related targets are validated before rendering', () => {
  const first = entries[0],
    second = entries[1]
  if (!first || !second) throw new Error('Missing fixture entries')
  expect(() => validateApiEntries([...entries, { ...first, slug: 'unique' }])).toThrow('identity')
  expect(() => validateApiEntries([{ ...first, related: ['@defjs/core:Missing'] }])).toThrow('related')
  expect(() => validateApiEntries([{ ...first }, { ...second, slug: 'core/create-client' }])).toThrow('slug')
})
