import { expect, test } from 'bun:test'
import { chromium, firefox } from 'playwright'
import { assertFreshBuild, buildFingerprint } from '../scripts/build-state'
import { locales } from '../app/lib/i18n'
import { uiCopy } from '../app/lib/ui-copy'
import { siteUrl } from '../app/lib/site'
import { captureBrowserErrors, selectSearchResult, waitForHydration, withPreviewBrowser } from './browser'

for (const browserType of [chromium, firefox]) {
  test(`${browserType.name()} accepts the built static site, locale routing and reading interactions`, async () => {
    await assertFreshBuild(new URL('../build/client/', import.meta.url).pathname, await buildFingerprint())
    await withPreviewBrowser(browserType, async (browser, server) => {
      const page = await browser.newPage()
      const errors = await captureBrowserErrors(page)
      await page.goto(new URL('/', server.url).href, { waitUntil: 'networkidle' })
      await waitForHydration(page)
      expect(await page.locator('main').count()).toBe(1)
      expect(await page.getByRole('heading', { level: 1 }).count()).toBe(1)
      expect(await page.title()).toBe('Defjs')
      expect((await page.request.get(new URL('/404.html', server.url).href)).status()).toBe(200)
      for (const locale of locales) {
        const prefix = locale === 'en-US' ? '' : `/${locale}`
        const response = await page.goto(new URL(`${prefix}/docs/start`, server.url).href, { waitUntil: 'networkidle' })
        await waitForHydration(page)
        expect(response?.status()).toBe(200)
        await page.reload({ waitUntil: 'networkidle' })
        await waitForHydration(page)
        expect(await page.locator('html').getAttribute('lang')).toBe(locale)
        expect(await page.locator('html').getAttribute('dir')).toBe(locale === 'ar' ? 'rtl' : 'ltr')
        expect(await page.getByRole('heading', { level: 1 }).count()).toBe(1)
        expect(await page.title()).not.toBe('')
        for (const area of ['docs', 'recipes', 'api'])
          expect((await page.request.get(new URL(`${prefix}/${area}`, server.url).href)).status()).toBe(200)
      }
      await page.goto(new URL('/docs/start', server.url).href, { waitUntil: 'networkidle' })
      await waitForHydration(page)
      let selected = 'en-US'
      for (const target of [...locales.filter((locale) => locale !== 'en-US'), 'en-US']) {
        await page
          .getByRole('button', {
            name: uiCopy[selected as keyof typeof uiCopy].translations['Choose a language(language switcher)(aria-label)'],
            exact: true,
          })
          .first()
          .click()
        await page
          .getByRole('button', { name: uiCopy[target as keyof typeof uiCopy].label, exact: true })
          .last()
          .click()
        const prefix = target === 'en-US' ? '' : `/${target}`
        await page.waitForURL(new URL(`${prefix}/docs/start`, server.url).href)
        await page.locator(`html[lang="${target}"]`).waitFor()
        expect(await page.locator('html').getAttribute('lang')).toBe(target)
        await page.keyboard.press('Escape')
        selected = target
      }
      expect((await page.request.get(new URL('/missing-path', server.url).href)).status()).toBe(404)
      for (const resource of [
        '/api/search/en-US.json',
        '/llms.txt',
        '/llms-full.txt',
        '/llms.mdx/docs/start/content.md',
        '/sitemap.xml',
        '/logo.jpg',
      ]) {
        const response = await page.request.get(new URL(resource, server.url).href)
        expect(response.status()).toBe(200)
        expect((await response.body()).length).toBeGreaterThan(0)
      }
      const llmsIndex = await (await page.request.get(new URL('/llms.txt', server.url).href)).text()
      const markdownURLs = [...llmsIndex.matchAll(/\]\((https?:\/\/[^)]+)\)/g)].map((match) => new URL(match[1] ?? ''))
      expect(markdownURLs.length).toBeGreaterThan(0)
      for (const url of markdownURLs) {
        expect(url.origin).toBe(new URL(siteUrl).origin)
        expect(url.pathname.startsWith('/llms.mdx/')).toBe(true)
        const response = await page.request.get(new URL(url.pathname, server.url).href)
        expect(response.status()).toBe(200)
        expect((await response.body()).length).toBeGreaterThan(0)
      }
      await page.goto(new URL('/api', server.url).href, { waitUntil: 'networkidle' })
      await waitForHydration(page)
      await page.getByLabel('Name', { exact: true }).fill('CREATECLIENT')
      await page.getByLabel('Package', { exact: true }).selectOption('@defjs/core')
      await page.getByLabel('Category', { exact: true }).selectOption('function')
      await page.getByRole('link', { name: 'createClient', exact: true }).last().click()
      await page.waitForURL('**/api/core/createclient')
      await page.getByRole('link', { name: 'ClientOption', exact: true }).last().click()
      await page.waitForURL('**/api/core/clientoption-type')
      await page.getByRole('heading', { level: 1, name: 'ClientOption', exact: true }).first().waitFor()
      expect(await page.locator('main').textContent()).toContain('ClientConfig')
      await page.goto(new URL('/api', server.url).href, { waitUntil: 'networkidle' })
      await waitForHydration(page)
      await page.getByLabel('Name', { exact: true }).fill('does-not-exist')
      expect(await page.getByRole('status').textContent()).toContain('0')
      expect(await page.getByText(uiCopy['en-US'].noResults, { exact: true }).count()).toBe(1)
      for (const locale of ['en-US', 'zh-Hans', 'ja-JP', 'ar']) {
        const prefix = locale === 'en-US' ? '' : `/${locale}`
        await page.goto(new URL(`${prefix}/docs/start`, server.url).href, { waitUntil: 'networkidle' })
        await waitForHydration(page)
        await page.keyboard.press('Control+k')
        const dialog = page.getByRole('dialog')
        await dialog.waitFor()
        await dialog.locator('input').fill('createClient')
        await dialog.getByRole('option').first().waitFor()
        // Option ids are the result URL, with a -N suffix for heading/text matches inside that page.
        const links = await dialog
          .getByRole('option')
          .evaluateAll((nodes) => nodes.map((node) => node.id.replace('fd-search-option-', '').replace(/-\d+$/, '')))
        expect(links.length).toBeGreaterThan(0)
        expect(
          links.every((href) =>
            locale === 'en-US'
              ? !locales.filter((language) => language !== 'en-US').some((language) => href.startsWith(`/${language}/`))
              : href === prefix || href.startsWith(prefix + '/'),
          ),
        ).toBe(true)
        expect(await dialog.textContent()).not.toContain('<ApiReference')
        await selectSearchResult(page)
      }
      await page.goto(new URL('/docs/start', server.url).href, { waitUntil: 'networkidle' })
      await waitForHydration(page)
      await page.getByRole('button', { name: 'Dark', exact: true }).first().click()
      await page.locator('html.dark').waitFor()
      expect(await page.locator('html').getAttribute('class')).toContain('dark')
      await page.setViewportSize({ width: 390, height: 844 })
      await page
        .getByRole('button', { name: /Toggle Menu|Open Sidebar/ })
        .first()
        .click()
      expect(await page.getByRole('link', { name: /Quick start/ }).count()).toBeGreaterThan(0)
      await page.keyboard.press('Escape')
      {
        await using noJS = await browser.newContext({ javaScriptEnabled: false })
        const reading = await noJS.newPage()
        await reading.goto(new URL('/', server.url).href)
        expect(await reading.locator('main').count()).toBe(1)
        expect(await reading.getByRole('heading', { level: 1 }).count()).toBe(1)
        expect(await reading.title()).toBe('Defjs')
        for (const path of ['/docs/start', '/docs', '/api/core/withtimeout']) {
          await reading.goto(new URL(path, server.url).href)
          expect(await reading.locator('meta[name="description"]:not([content])').count()).toBe(0)
        }
        await reading.goto(new URL('/docs/start', server.url).href)
        expect(await reading.locator('meta[name="description"][content]').count()).toBe(1)
        expect(await reading.title()).toBe('Quick start | Defjs')
        await reading.goto(new URL('/api/core/createclient', server.url).href)
        expect(await reading.locator('main').textContent()).toContain('ClientOption')
        await reading.goto(new URL('/api', server.url).href)
        expect(await reading.getByRole('link', { name: 'createClient', exact: true }).count()).toBeGreaterThan(0)
      }
      expect(errors).toEqual([])
    })
  }, 120_000)
}
