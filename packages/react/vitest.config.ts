import { defineConfig } from 'vitest/config'
import { coverageConfig } from './test/shared.ts'

export default defineConfig({
  test: {
    coverage: {
      ...coverageConfig,
    },
    projects: ['./vitest.config.browser.ts'],
  },
})
