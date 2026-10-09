import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {} from 'vitest'
import '../../../test/loopback-proxy-bypass.ts'

declare module 'vitest' {
  export interface ProvidedContext {
    testServerHost: string
  }
}

export const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
export const coverageConfig = {
  enabled: true,
  provider: 'istanbul' as const,
  reporter: ['lcov', 'json', 'html', 'text'],
  reportsDirectory: resolve(packageRoot, 'coverage'),
  include: ['src/**/*.ts'],
  exclude: ['**/node_modules/**', '**/test/**', 'src/**/*.spec.ts', 'src/**/*.type.test.ts'],
  thresholds: {
    branches: 100,
    functions: 100,
    lines: 100,
    statements: 100,
  },
}
