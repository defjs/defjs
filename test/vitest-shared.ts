import type { CoverageOptions } from "vitest/node";
import { NoSkipReporter } from "./no-skip-reporter.ts";

export const reporters: ["default", NoSkipReporter] = [
  "default",
  new NoSkipReporter(),
];

const coverageExclude = [
  "**/node_modules/**",
  "**/dist/**",
  "**/coverage/**",
  "**/test/**",
  "**/*.spec.{ts,tsx}",
  "**/*.bench.ts",
] as const;

export function coverageSettings(o: {
  reportsDirectory: string;
  extraExclude?: readonly string[];
}): CoverageOptions {
  return {
    enabled: true,
    provider: "istanbul",
    reporter: ["lcov", "json", "html", "text"],
    reportsDirectory: o.reportsDirectory,
    exclude: [...coverageExclude, ...(o.extraExclude ?? [])],
    thresholds: {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  };
}
