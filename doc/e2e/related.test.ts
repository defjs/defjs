import { expect, test } from 'bun:test'
import { chromium, firefox } from 'playwright'
import { assertFreshBuild, buildFingerprint } from '../scripts/build-state'
import { withPreviewBrowser } from './browser'

for (const browserType of [chromium, firefox]) {
  test(`${browserType.name()} connects HTTP guides, examples and module API without truncating related links`, async () => {
    await assertFreshBuild(new URL('../build/client/', import.meta.url).pathname, await buildFingerprint())
    await withPreviewBrowser(browserType, async (browser, server) => {
      const page = await browser.newPage()
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text())
      })
      for (const [path, targets] of [
        ['/zh-Hans/docs/http', ['/zh-Hans/recipes/post-json', '/zh-Hans/recipes/publish-http-sdk', '/zh-Hans/api/http']],
        ['/zh-Hans/recipes/post-json', ['/zh-Hans/docs/http', '/zh-Hans/docs/commands', '/zh-Hans/api/http', '/zh-Hans/api/struct']],
        ['/zh-Hans/api/http', ['/zh-Hans/docs/http', '/zh-Hans/recipes/post-json', '/zh-Hans/recipes/publish-http-sdk']],
      ] as const) {
        await page.goto(new URL(path, server.url).href, { waitUntil: 'networkidle' })
        const related = page.getByRole('navigation', { name: '相关阅读', exact: true })
        expect(await related.count()).toBe(1)
        for (const href of targets) expect(await related.locator(`a[href="${href}"]`).count()).toBe(1)
        expect(await related.locator(`a[href="${path}"]`).count()).toBe(0)
      }
      {
        await using noJS = await browser.newContext({ javaScriptEnabled: false })
        const reading = await noJS.newPage()
        await reading.goto(new URL('/zh-Hans/recipes/post-json', server.url).href)
        const related = reading.getByRole('navigation', { name: '相关阅读', exact: true })
        await related.locator('a[href="/zh-Hans/api/http"]').click()
        await reading.waitForURL('**/zh-Hans/api/http')
        expect(await related.locator('a[href="/zh-Hans/docs/http"]').isVisible()).toBe(true)
      }
      expect(errors).toEqual([])
    })
  }, 60_000)
}
