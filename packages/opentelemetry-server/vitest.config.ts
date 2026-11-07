import { defineConfig } from "vitest/config";
import { coverageConfig } from "./test/shared.ts";

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
    projects: ["./vitest.config.server.ts"],
  },
});
