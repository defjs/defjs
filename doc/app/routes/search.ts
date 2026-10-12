import { createFromSource } from 'fumadocs-core/search/server'
import { locales } from '../lib/i18n'
import { readableMarkdown } from '../lib/markdown'
import { source } from '../lib/source'
import type { Route } from './+types/search'

// One static index per locale, so readers only download the language they are reading.
function createServer(locale: string) {
  return createFromSource(
    { ...source, getPages: () => source.getPages(locale) },
    {
      buildIndex: async (page) => ({
        id: page.url,
        title: page.data.title,
        description: page.data.description,
        url: page.url,
        structuredData: {
          headings: [],
          contents: [{ heading: undefined, content: readableMarkdown(await page.data.getText('processed'), locale) }],
        },
      }),
    },
  )
}
const servers = new Map(locales.map((locale) => [locale, createServer(locale)]))
export async function loader({ params }: Route.LoaderArgs) {
  const server = servers.get(params['locale'] ?? '')
  if (!server) throw new Response('Not Found', { status: 404 })
  return server.staticGET()
}
