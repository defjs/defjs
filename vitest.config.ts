import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    watch: false,
    coverage: {
      enabled: true,
      provider: 'istanbul',
      reporter: ['lcov', 'json', 'html', 'text'],
      reportsDirectory: 'coverage',
      include: ['**/src/**/*.ts'],
      exclude: ['**/node_modules/**', '**/test/**', '**/src/**/*.spec.ts'],
      thresholds: {
        ['100']: true,
      },
    },
  },
})
