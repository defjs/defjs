import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page'
import { use, useMemo } from 'react'
import { docs, source } from '../lib/source'
import { locales, localePrefix } from '../lib/i18n'
import { getUi } from '../lib/ui-copy'
import { apiEntries } from '../data/api-catalog'
import { getNavigationTree, getNavigationTabs } from '../lib/navigation'
import { siteUrl, repository } from '../lib/site'
import { navigationSlots, navigationComponents, StaticNavigation, RelatedNavigation } from '../components/navigation'
import { getMDXComponents } from '../components/mdx'
import type { Route } from './+types/page'
export async function loader({ params }: Route.LoaderArgs) {
  const parts = (params['*'] ?? '').split('/').filter(Boolean)
  const locale = locales.includes(parts[0] ?? '') ? parts.shift() : 'en-US'
  const page = source.getPage(parts, locale)
  if (!page) throw new Response('Not Found', { status: 404 })
  return {
    hasContentTitle: /^# /m.test(await page.data.getText('processed')),
    path: page.path,
    home: parts.length === 0,
    slugs: parts,
    canonical: new URL(page.url, siteUrl).href,
    locale: locale ?? 'en-US',
  }
}
/** API module and symbol pages share titles with each other and with guides, so the title names the package (symbols) or "API" (modules). */
function apiTitle(title: string, slugs: string[]) {
  if (slugs[0] !== 'api' || slugs.length < 2) return title
  const entry = apiEntries.find((entry) => `api/${entry.slug}` === slugs.join('/'))
  return `${title} (${entry?.package ?? 'API'})`
}
export default function Page({ loaderData }: Route.ComponentProps) {
  const { path, home, slugs, locale, canonical, hasContentTitle } = loaderData
  // The client already bundles every page's metadata, so deriving the tree here avoids serializing it into each page's HTML and .data.
  const pageTree = useMemo(() => getNavigationTree(source.getPageTree(locale), locale), [locale])
  const components = useMemo(() => getMDXComponents(locale), [locale])
  const page = docs.getPage(path)
  if (!page) throw new Error(`Missing content: ${path}`)
  const { toc } = use(page.load())
  const Content = page.body
  const prefix = localePrefix(locale)
  const ui = getUi(locale)
  return (
    <DocsLayout
      tree={pageTree}
      i18n
      nav={{
        title: (
          <>
            <img src="/logo.jpg" alt="" width="28" height="28" /> Defjs
          </>
        ),
        url: prefix || '/',
      }}
      githubUrl={repository}
      tabMode="top"
      themeSwitch={{ mode: 'light-dark-system' }}
      tabs={getNavigationTabs(pageTree)}
      slots={navigationSlots}
      sidebar={{ components: navigationComponents }}
      containerProps={{
        style: {
          gridTemplateAreas:
            '"sidebar sidebar header toc toc" "sidebar sidebar toc-popover toc toc" "sidebar sidebar tabs toc toc" "sidebar sidebar main toc toc"',
          gridTemplateRows: 'auto auto auto 1fr',
        },
      }}
    >
      <DocsPage toc={toc}>
        <link rel="canonical" href={canonical} />
        <title>{home ? page.title : `${apiTitle(page.title, slugs)} | Defjs`}</title>
        {page.description && <meta name="description" content={page.description} />}
        {!hasContentTitle && <DocsTitle>{page.title}</DocsTitle>}
        <DocsDescription>{page.description}</DocsDescription>
        <StaticNavigation tree={pageTree} locale={locale} />
        <DocsBody>
          <Content components={components} />
        </DocsBody>
        <RelatedNavigation tree={pageTree} locale={locale} />
        <a href={`${repository}/edit/main/doc/content/${path}`}>{ui.edit}</a>
        <footer className="mt-8 text-sm text-fd-muted-foreground">
          {ui.message} · {ui.copyright}
        </footer>
      </DocsPage>
    </DocsLayout>
  )
}
