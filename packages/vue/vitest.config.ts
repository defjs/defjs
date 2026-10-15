import { defineConfig } from 'vitest/config'
import { coverageConfig } from './test/shared.ts'

/**
 * Package-level workspace aggregator.
 *
 * Runs the browser Vitest project for @defjs/vue (Chromium + Firefox).
 *
 * Coverage configuration is centralized here so it applies across all projects
 * when running via the package test script.
 */
export default defineConfig({
  test: {
    coverage: {
      ...coverageConfig,
    },
    projects: ['./vitest.config.browser.ts'],
  },
})
