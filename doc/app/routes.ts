import { index, route, type RouteConfig } from '@react-router/dev/routes'
export default [
  index('routes/home.tsx'),
  route('sitemap.xml', 'routes/sitemap.ts'),
  route('api/search/:locale.json', 'routes/search.ts'),
  route('llms.txt', 'llms/index.ts'),
  route('llms-full.txt', 'llms/full.ts'),
  route('llms.mdx/*', 'llms/mdx.ts'),
  route('404', 'routes/not-found.tsx'),
  route('*', 'routes/page.tsx'),
] satisfies RouteConfig
