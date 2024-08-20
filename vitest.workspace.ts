import { join } from 'node:path'
import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  {
    resolve: {
      alias: {
        '@src': join(process.cwd(), 'packages/core/src'),
      },
    },
    test: {
      name: 'chrome',
      include: ['packages/core/src/**/*.spec.ts'],
      browser: {
        enabled: true,
        name: 'chromium',
        provider: 'playwright',
      },
      globalSetup: 'packages/core/test-setup.ts',
    },
  },
  {
    resolve: {
      alias: {
        '@src': join(process.cwd(), 'packages/core/src'),
      },
    },
    test: {
      name: 'firefox',
      include: ['packages/core/src/**/*.spec.ts'],
      browser: {
        enabled: true,
        name: 'firefox',
        provider: 'playwright',
      },
      globalSetup: 'packages/core/test-setup.ts',
    },
  },
  {
    resolve: {
      alias: {
        '@src': join(process.cwd(), 'packages/core/src'),
      },
    },
    test: {
      name: 'webkit',
      include: ['packages/core/src/**/*.spec.ts'],
      browser: {
        enabled: true,
        name: 'webkit',
        provider: 'playwright',
      },
      globalSetup: 'packages/core/test-setup.ts',
    },
  },
])
