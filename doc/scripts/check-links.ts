import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
export async function checkLinks(directory: string): Promise<void> {
  const root = resolve(directory)
  const pages = new Map<string, { ids: Set<string>; links: string[] }>()
  for await (const filename of new Bun.Glob('**/*.html').scan(root)) {
    if (filename === '__spa-fallback.html') continue
    const page = { ids: new Set<string>(), links: [] as string[] }
    await new HTMLRewriter()
      .on('[id]', {
        element(element) {
          const id = element.getAttribute('id')
          if (id !== null) page.ids.add(id)
        },
      })
      .on('[href]', {
        element(element) {
          const href = element.getAttribute('href')
          if (href !== null) page.links.push(href)
        },
      })
      .on('[src]', {
        element(element) {
          const src = element.getAttribute('src')
          if (src !== null) page.links.push(src)
        },
      })
      .transform(new Response(Bun.file(resolve(root, filename))))
      .text()
    pages.set(resolve(root, filename), page)
  }
  if (!pages.size) throw new Error('No generated documentation pages found')
  const failures = new Set<string>()
  for (const [filename, page] of pages) {
    const pathname = '/' + filename.slice(root.length + 1).replace(/index\.html$/, '')
    const base = new URL(pathname, 'https://docs.invalid')
    for (const href of page.links) {
      const url = new URL(href, base)
      if (url.origin !== base.origin || !['http:', 'https:'].includes(url.protocol)) continue
      const path = resolve(root, '.' + decodeURIComponent(url.pathname))
      const target = [path, resolve(path, 'index.html')].find((candidate) => pages.has(candidate))
      if (!target) {
        if (!existsSync(path)) failures.add(`${base.pathname}: missing page ${href}`)
        continue
      }
      if (url.hash && !pages.get(target)?.ids.has(decodeURIComponent(url.hash.slice(1))))
        failures.add(`${base.pathname}: missing anchor ${href}`)
    }
  }
  if (failures.size) throw new Error(`Broken documentation links (${failures.size}):\n${[...failures].join('\n')}`)
  console.log(`Documentation links verified across ${pages.size} generated pages`)
}
if (import.meta.main) await checkLinks(new URL('../build/client/', import.meta.url).pathname)
