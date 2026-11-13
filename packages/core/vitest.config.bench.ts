import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    benchmark: { include: ["test-out/*-bench/*.bench.js"] },
    pool: "threads",
    experimental: { viteModuleRunner: false },
  },
});
