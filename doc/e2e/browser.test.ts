import { expect, test } from 'bun:test'
import { chromium, firefox } from 'playwright'
import { browserLaunchEnv } from '../../test/firefox-app-data'
import { captureBrowserErrors } from './browser'

for (const browserType of [chromium, firefox]) {
  test(`${browserType.name()} preserves console error details across navigation`, async () => {
    const browser = await browserType.launch({ env: browserLaunchEnv() })
    try {
      const page = await browser.newPage()
      const errors = await captureBrowserErrors(page)
      await page.goto('about:blank')
      await page.evaluate(function reportSearchFailure() {
        console.error('Search render failed', new Error('Original search failure'))
      })
      await page.reload()
      expect(errors).toHaveLength(1)
      expect(errors[0]).toContain('Search render failed')
      expect(errors[0]).toContain('Original search failure')
      expect(errors[0]).toContain('reportSearchFailure')
      expect(errors[0]).not.toContain('JSHandle@object')
      expect(errors[0]).not.toContain('Execution context was destroyed')
    } finally {
      await browser.close()
    }
  }, 30_000)
}
