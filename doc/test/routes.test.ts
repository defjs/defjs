import { expect, test } from 'bun:test'
import { getContentRoute, assertUniqueRoutes, collectPrerenderPaths } from '../app/lib/routes'
import { locales } from '../app/lib/i18n'

test('locale directories map to static root URLs for Markdown and MDX', () => {
  expect(getContentRoute('en-US/index.md').url).toBe('/')
  expect(getContentRoute('zh-Hans/docs/start.mdx').url).toBe('/zh-Hans/docs/start')
  expect(getContentRoute('ar/docs/start.md').url).toBe('/ar/docs/start')
})
test('unknown locales and duplicate static URLs fail before building', () => {
  expect(() => getContentRoute('unknown/docs/start.md')).toThrow('locale')
  expect(() => assertUniqueRoutes(['en-US/docs/start.md', 'en-US/docs/start.mdx'])).toThrow('Duplicate')
})
test('every locale prerenders its own search index', async () => {
  const paths = await collectPrerenderPaths()
  for (const locale of locales) expect(paths).toContain(`/api/search/${locale}.json`)
  expect(paths).not.toContain('/api/search')
})
