import type {
  BrowserProviderOption,
  CoverageOptions,
  InlineConfig,
} from "vitest/node";
import { NoSkipReporter } from "./no-skip-reporter.ts";
import type { Runtime } from "./spec-matrix.ts";

/** The runtime of a project and the `test` options that only that runtime sets. */
export interface RuntimeProject {
  readonly runtime: Runtime;
  readonly test: InlineConfig;
}

export function serverProject(
  pkg: string,
  runtime: "node" | "bun",
): RuntimeProject {
  return { runtime, test: { name: `${pkg}-${runtime}`, pool: "threads" } };
}

const engines = { chrome: "chromium", firefox: "firefox" } as const;

/** The package passes `provider`: only the packages depend on `@vitest/browser-playwright`. */
export function browserProject(
  pkg: string,
  runtime: "chrome" | "firefox",
  provider: BrowserProviderOption,
): RuntimeProject {
  const name = `${pkg}-${runtime}`;
  return {
    runtime,
    test: {
      name,
      api: { host: "127.0.0.1" },
      browser: {
        enabled: true,
        provider,
        connectTimeout: 120_000,
        headless: true,
        screenshotFailures: false,
        instances: [{ browser: engines[runtime], name }],
      },
    },
  };
}

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
