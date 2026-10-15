import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    benchmark: { include: ['test-out/struct-bench/struct.bench.js'] },
    pool: 'threads',
    experimental: { viteModuleRunner: false },
  },
})
