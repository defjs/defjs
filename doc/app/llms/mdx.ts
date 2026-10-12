import { docsLlms, source } from '../lib/source'
import type { Route } from './+types/mdx'
export async function loader({ params }: Route.LoaderArgs) {
  const slugs = (params['*'] ?? '').split('/').filter(Boolean)
  slugs.pop()
  const page = source.getPage(slugs, 'en-US')
  if (!page) return new Response('Not Found', { status: 404 })
  return new Response(await docsLlms.page(page), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
}
