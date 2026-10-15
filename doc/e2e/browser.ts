import type { Browser, BrowserType, Page } from 'playwright'
import { browserLaunchEnv } from '../../test/firefox-app-data'
import { startPreview } from '../scripts/preview'

type Preview = Pick<ReturnType<typeof startPreview>, 'url' | 'stop'>

export async function withPreviewBrowser(
  browserType: Pick<BrowserType, 'launch'>,
  body: (browser: Browser, preview: Preview) => Promise<void>,
  createPreview: () => Preview = () => startPreview(undefined, 0),
): Promise<void> {
  const preview = createPreview()
  const errors: unknown[] = []
  let browser: Browser | undefined
  try {
    browser = await browserType.launch({ env: browserLaunchEnv() })
    await body(browser, preview)
  } catch (error) {
    errors.push(error)
  }
  if (browser) {
    try {
      await browser.close()
    } catch (error) {
      errors.push(error)
    }
  }
  try {
    await preview.stop(true)
  } catch (error) {
    errors.push(error)
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, 'Preview browser lifecycle failed', { cause: errors[0] })
}

export async function captureBrowserErrors(page: Page): Promise<string[]> {
  const errors: string[] = []
  const record = (message: string) => {
    errors.push(message)
    console.error(message)
  }
  page.on('pageerror', (error) => record(`${error.name}: ${error.message}\n${error.stack ?? ''}`))
  page.on('console', (message) => {
    if (message.type() === 'error') record(message.text() + ' at ' + page.url())
  })
  await page.addInitScript(() => {
    const report = console.error
    // Firefox stacks omit the error message; serialize both before navigation destroys the handle.
    console.error = (...args) =>
      report(...args.map((value: unknown) => (value instanceof Error ? `${value.name}: ${value.message}\n${value.stack ?? ''}` : value)))
  })
  return errors
}

export async function waitForHydration(page: Page): Promise<void> {
  await page.locator('body[data-hydrated="true"]').waitFor()
}

export async function selectSearchResult(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog')
  const id = await dialog.getByRole('option', { selected: true }).getAttribute('id')
  if (!id?.startsWith('fd-search-option-')) throw new Error('Search result has no destination')
  const destination = new URL(id.slice('fd-search-option-'.length), page.url()).href
  await dialog.locator('input').press('Enter')
  await page.waitForURL(destination)
  await dialog.waitFor({ state: 'hidden' })
}
