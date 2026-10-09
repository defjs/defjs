import { resolve } from 'node:path'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'
import { browserLaunchEnv } from '../../test/firefox-app-data.ts'
import { packageRoot } from './test/shared.ts'

export default defineConfig({
  root: packageRoot,
  resolve: {
    alias: {
      '@defjs/core': resolve(packageRoot, '../core/src'),
    },
    dedupe: ['react', 'react-dom', 'react-dom/client'],
  },
  optimizeDeps: {
    include: ['react', 'react-dom/client', '@testing-library/react'],
  },
  test: {
    api: 63317,
    name: 'react-browser',
    globalSetup: resolve(packageRoot, '../../test/browser-api-server-setup.ts'),
    browser: {
      enabled: true,
      provider: playwright(),
      connectTimeout: 120_000,
      headless: true,
      screenshotFailures: false,
      instances: [
        {
          browser: 'chromium',
          include: ['src/**/*.browser.spec.ts', 'src/**/*.chrome.spec.ts'],
        },
        {
          browser: 'firefox',
          provider: playwright({ launchOptions: { env: browserLaunchEnv() } }),
          include: ['src/**/*.browser.spec.ts', 'src/**/*.firefox.spec.ts'],
        },
      ],
    },
  },
})
