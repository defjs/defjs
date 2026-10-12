import { flattenTree, type Folder, type Item, type Node, type Root } from 'fumadocs-core/page-tree'
import type { LayoutTab } from 'fumadocs-ui/layouts/shared'
import { localePrefix } from './i18n'
import { getNav } from './navigation-copy'

const guideGroups = [
  ['', '/docs/start'],
  ['/docs/struct', '/docs/commands', '/docs/client'],
  ['/docs/http', '/docs/sse', '/docs/web-socket'],
  ['/docs/errors', '/docs/interceptors'],
  ['/docs/integrations/react', '/docs/integrations/vue', '/docs/integrations/opentelemetry-server'],
] as const
export const exampleGroups = [
  ['/recipes/post-json', '/recipes/get-declared-404', '/recipes/cancel-http', '/recipes/etag-revalidate', '/recipes/graphql-http-envelope'],
  ['/recipes/refresh-bearer-once'],
  ['/recipes/consume-sse', '/recipes/websocket-session'],
  ['/recipes/test-with-handle', '/recipes/publish-http-sdk'],
] as const

export function getNavigationTree(tree: Root, locale: string): Root {
  const copy = getNav(locale)
  const prefix = localePrefix(locale)
  const pages = new Map(flattenTree(tree.children).map((page) => [page.url, page]))
  function page(path: string, name?: string): Item {
    const url = prefix + path || '/'
    const item = pages.get(url)
    if (!item) throw new Error(`Missing navigation page: ${url}`)
    return name ? { ...item, name } : item
  }
  function grouped(groups: readonly (readonly string[])[], headings: readonly string[], names: Record<string, string> = {}): Node[] {
    return groups.flatMap((paths, group): Node[] => [
      { type: 'separator', name: headings[group] },
      ...paths.map((path) => page(path, names[path])),
    ])
  }
  const children = (['docs', 'recipes', 'api'] as const).map((area): Folder => {
    const url = `${prefix}/${area}`
    const folder = tree.children.find(
      (node): node is Folder => node.type === 'folder' && flattenTree(node.children).some((child) => child.url === url),
    )
    if (!folder) throw new Error(`Missing reading area: ${url}`)
    const root = page(`/${area}`)
    const index = area === 'api' ? { ...root, name: copy.apiIndex } : root
    const integrations = ['/api/react', '/api/vue', '/api/opentelemetry-server'].map((path) => prefix + path)
    const isIntegration = (node: Node) =>
      node.type === 'page'
        ? integrations.includes(node.url)
        : node.type === 'folder' && flattenTree(node.children).every((item) => integrations.some((url) => item.url.startsWith(url + '/')))
    const other = folder.children.filter((node) => node.type !== 'page' || node.url !== url)
    const chapters =
      area === 'docs'
        ? [
            index,
            ...grouped(guideGroups, copy.groups, { '': copy.home }),
            { type: 'separator' as const, $id: `${locale}:navigation:standalone` },
            page('/docs/design-decisions'),
          ]
        : area === 'recipes'
          ? [index, ...grouped(exampleGroups, copy.exampleGroups)]
          : [
              index,
              { type: 'separator' as const, name: copy.coreModules },
              ...other.filter((node) => !isIntegration(node)),
              { type: 'separator' as const, name: copy.integrations },
              ...other.filter(isIntegration),
            ]
    return { ...folder, name: root.name, children: chapters }
  })
  const result = { ...tree, children }
  const before = [...pages.keys()].sort()
  const after = flattenTree(result.children)
    .map((item) => item.url)
    .sort()
  if (before.length !== after.length || before.some((url, i) => url !== after[i]))
    throw new Error(`Navigation dropped or duplicated content: ${locale}`)
  return result
}

/** Fixed reading-area destinations avoid native same-path projection between roots. */
export function getNavigationTabs(tree: Root): LayoutTab[] {
  return tree.children
    .filter((node): node is Folder => node.type === 'folder')
    .map((folder) => {
      const pages = flattenTree(folder.children)
      const index = pages[0]
      if (!index) throw new Error('Reading area has no index page')
      return { title: folder.name, url: index.url, urls: new Set(pages.map((page) => page.url)) }
    })
}

const relatedTopics = [
  ['/docs/start', '/docs/http', '/docs/commands', '/api/http', ...exampleGroups[0], ...exampleGroups[1], ...exampleGroups[3]],
  ['/docs/struct', '/api/struct', '/recipes/post-json', '/recipes/get-declared-404', '/recipes/consume-sse', '/recipes/websocket-session'],
  ['/docs/client', '/docs/commands', '/api/client', '/recipes/cancel-http', '/recipes/publish-http-sdk', '/recipes/test-with-handle'],
  ['/docs/sse', '/docs/commands', '/api/sse', '/recipes/consume-sse'],
  ['/docs/web-socket', '/docs/commands', '/api/web-socket', '/recipes/websocket-session'],
  ['/docs/errors', '/api/errors', '/recipes/get-declared-404', '/recipes/cancel-http', '/recipes/refresh-bearer-once'],
  ['/docs/interceptors', '/api/interceptors', '/recipes/refresh-bearer-once'],
  ['/docs/integrations/react', '/api/react'],
  ['/docs/integrations/vue', '/api/vue'],
  ['/docs/integrations/opentelemetry-server', '/api/opentelemetry-server'],
] as const

export function getRelatedNavigation(tree: Root, locale: string, url: string): Folder[] {
  const prefix = localePrefix(locale)
  const current = url.replace(/\/$/, '') || '/'
  const targets = new Set(
    relatedTopics.filter((topic) => topic.some((path) => prefix + path === current)).flatMap((topic) => topic.map((path) => prefix + path)),
  )
  targets.delete(current)
  const pages = new Set(flattenTree(tree.children).map((page) => page.url))
  for (const target of targets) if (!pages.has(target)) throw new Error(`Missing related navigation page: ${target}`)
  return tree.children
    .filter((node): node is Folder => node.type === 'folder')
    .map((folder) => ({
      ...folder,
      children: flattenTree(folder.children).filter((page) => targets.has(page.url)),
    }))
    .filter((folder) => folder.children.length > 0)
}
