import { defineConfig } from "vitest/config";
import { coverageConfig } from "./test/shared.ts";

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
      enabled: coverageConfig.enabled,
      provider: coverageConfig.provider,
      reporter: [...coverageConfig.reporter],
      reportsDirectory: coverageConfig.reportsDirectory,
      include: [...coverageConfig.include],
      exclude: [...coverageConfig.exclude],
      thresholds: {
        branches: coverageConfig.thresholds.branches,
        functions: coverageConfig.thresholds.functions,
        lines: coverageConfig.thresholds.lines,
        statements: coverageConfig.thresholds.statements,
      },
    },
    projects: ["./vitest.config.browser.ts"],
  },
});
