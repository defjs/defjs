import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import { globalSetupPath, packageRoot } from './test/shared.ts'

export default defineConfig({
  root: packageRoot,
  resolve: {
    alias: {
      '@defjs/core': resolve(packageRoot, '../core/src'),
    },
  },
  test: {
    name: 'opentelemetry-server',
    globals: true,
    include: ['src/**/*.spec.ts', 'e2e.spec.ts'],
    globalSetup: globalSetupPath,
  },
})
