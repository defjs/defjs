import { expect, test } from 'bun:test'
import { chromium, firefox } from 'playwright'
import { assertFreshBuild, buildFingerprint } from '../scripts/build-state'
import { selectSearchResult, waitForHydration, withPreviewBrowser } from './browser'

for (const browserType of [chromium, firefox]) {
  test(`${browserType.name()} waits for hydration before sending the search shortcut`, async () => {
    await assertFreshBuild(new URL('../build/client/', import.meta.url).pathname, await buildFingerprint())
    await withPreviewBrowser(browserType, async (browser, server) => {
      const release = Promise.withResolvers<void>()
      try {
        const page = await browser.newPage()
        await page.route('**/assets/entry.client-*.js', async (route) => {
          await release.promise
          await route.continue()
        })
        const entryRequested = page.waitForRequest(/\/assets\/entry\.client-.*\.js$/)
        await page.goto(new URL('/docs/start', server.url).href, { waitUntil: 'commit' })
        await entryRequested
        await page.getByRole('heading', { level: 1 }).waitFor()
        expect(await page.locator('body').getAttribute('data-hydrated')).not.toBe('true')
        release.resolve()
        await waitForHydration(page)
        await page.keyboard.press('Control+k')
        await page.getByRole('dialog').waitFor()
        expect(await page.getByRole('combobox').isVisible()).toBe(true)
      } finally {
        release.resolve()
      }
    })
  }, 120_000)

  test(`${browserType.name()} downloads only the search index of the reading language`, async () => {
    await assertFreshBuild(new URL('../build/client/', import.meta.url).pathname, await buildFingerprint())
    await withPreviewBrowser(browserType, async (browser, server) => {
      for (const locale of ['en-US', 'ja-JP']) {
        const page = await browser.newPage()
        const indexes: string[] = []
        page.on('request', (request) => {
          const { pathname } = new URL(request.url())
          if (pathname.startsWith('/api/search/')) indexes.push(pathname)
        })
        await page.goto(new URL(`${locale === 'en-US' ? '' : `/${locale}`}/docs/start`, server.url).href, { waitUntil: 'networkidle' })
        await waitForHydration(page)
        await page.keyboard.press('Control+k')
        const dialog = page.getByRole('dialog')
        await dialog.getByRole('combobox').fill('createClient')
        await dialog.getByRole('option').first().waitFor()
        expect(indexes).toEqual([`/api/search/${locale}.json`])
        await page.close()
      }
    })
  }, 120_000)

  test(`${browserType.name()} waits for the selected search destination while its loader is pending`, async () => {
    await assertFreshBuild(new URL('../build/client/', import.meta.url).pathname, await buildFingerprint())
    await withPreviewBrowser(browserType, async (browser, server) => {
      const release = Promise.withResolvers<void>()
      try {
        const page = await browser.newPage()
        await page.goto(new URL('/docs/start', server.url).href, { waitUntil: 'networkidle' })
        await waitForHydration(page)
        await page.locator('[data-search-full]').first().click()
        const dialog = page.getByRole('dialog')
        await dialog.getByRole('combobox').fill('createClient')
        const selected = dialog.getByRole('option', { selected: true })
        const id = await selected.getAttribute('id')
        if (!id?.startsWith('fd-search-option-')) throw new Error('Search result has no destination')
        const destination = new URL(id.slice('fd-search-option-'.length), server.url)
        await page.route(
          (url) => url.pathname === `${destination.pathname}.data`,
          async (route) => {
            await release.promise
            await route.continue()
          },
        )
        const requested = page.waitForRequest((request) => new URL(request.url()).pathname === `${destination.pathname}.data`)
        let finished = false
        const selection = selectSearchResult(page).then(() => {
          finished = true
        })
        await requested
        await dialog.waitFor({ state: 'hidden' })
        expect(await page.evaluate(() => location.pathname)).toBe('/docs/start')
        expect(finished).toBe(false)
        release.resolve()
        await selection
        expect(page.url()).toBe(destination.href)
      } finally {
        release.resolve()
      }
    })
  }, 120_000)
}
