import { source } from '../lib/source'
import { siteUrl } from '../lib/site'
export function loader() {
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    source
      .getPages()
      .map((page) => `<url><loc>${new URL(page.url, siteUrl).href}</loc></url>`)
      .join('') +
    '</urlset>'
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } })
}
