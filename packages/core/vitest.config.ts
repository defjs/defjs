import { defineConfig } from "vitest/config";
import { coverageConfig, globalSetupPath } from "./test/shared.ts";

/**
 * Package-level workspace aggregator.
 *
 * Runs all Vitest projects defined for @defjs/core:
 * - Server tests (Bun process, Vitest default environment)
 * - Browser runtime tests (Chromium + Firefox)
 *
 * Coverage configuration is centralized here so it applies across all projects
 * when running via the package test script.
 */
export default defineConfig({
  test: {
    globalSetup: globalSetupPath,
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
    projects: ["./vitest.config.server.ts", "./vitest.config.browser.ts"],
  },
});
