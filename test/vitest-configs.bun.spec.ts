import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { NoSkipReporter } from "./no-skip-reporter.ts";

const root = resolve(import.meta.dirname, "..");

const loadable = [
  {
    file: "packages/core/vitest.config.ts",
    name: "core-plain",
    thresholds: true,
  },
  {
    file: "packages/core/vitest.config.node.ts",
    name: "core-node",
    thresholds: true,
  },
  {
    file: "packages/core/vitest.config.bun.ts",
    name: "core-bun",
    thresholds: true,
  },
  {
    file: "packages/opentelemetry-server/vitest.config.ts",
    name: "opentelemetry-server-plain",
    thresholds: true,
  },
  {
    file: "packages/opentelemetry-server/vitest.config.node.ts",
    name: "opentelemetry-server-node",
    thresholds: true,
  },
  {
    file: "packages/opentelemetry-server/vitest.config.bun.ts",
    name: "opentelemetry-server-bun",
    thresholds: true,
  },
  { file: "doc/vitest.config.ts", name: "doc-plain", thresholds: true },
  { file: "doc/vitest.config.bun.ts", name: "doc-bun", thresholds: true },
  { file: "vitest.config.ts", name: "root-plain", thresholds: false },
  { file: "vitest.config.bun.ts", name: "root-bun", thresholds: false },
  { file: "doc/vitest.config.e2e.ts", name: "doc-e2e", thresholds: false },
] as const;

const browserConfigs = [
  ["core", "chrome"],
  ["core", "firefox"],
  ["react", "chrome"],
  ["react", "firefox"],
  ["vue", "chrome"],
  ["vue", "firefox"],
] as const;

function readTest(module: unknown): {
  name: unknown;
  reporters: unknown;
  coverage: unknown;
} {
  if (typeof module !== "object" || module === null || Array.isArray(module)) {
    throw new Error("config module is not an object");
  }
  if (!("default" in module)) {
    throw new Error("config module has no default export");
  }
  const exported = module.default;
  if (
    typeof exported !== "object" ||
    exported === null ||
    Array.isArray(exported) ||
    !("test" in exported)
  ) {
    throw new Error("config default export has no test field");
  }
  const testConfig = exported.test;
  if (
    typeof testConfig !== "object" ||
    testConfig === null ||
    Array.isArray(testConfig)
  ) {
    throw new Error("config test field is not an object");
  }
  return {
    name: "name" in testConfig ? testConfig.name : undefined,
    reporters: "reporters" in testConfig ? testConfig.reporters : undefined,
    coverage: "coverage" in testConfig ? testConfig.coverage : undefined,
  };
}

function thresholdRecord(coverage: unknown): {
  branches: unknown;
  functions: unknown;
  lines: unknown;
  statements: unknown;
} {
  if (
    typeof coverage !== "object" ||
    coverage === null ||
    Array.isArray(coverage) ||
    !("thresholds" in coverage)
  ) {
    throw new Error("coverage has no thresholds");
  }
  const thresholds = coverage.thresholds;
  if (
    typeof thresholds !== "object" ||
    thresholds === null ||
    Array.isArray(thresholds)
  ) {
    throw new Error("coverage thresholds are not an object");
  }
  return {
    branches: "branches" in thresholds ? thresholds.branches : undefined,
    functions: "functions" in thresholds ? thresholds.functions : undefined,
    lines: "lines" in thresholds ? thresholds.lines : undefined,
    statements: "statements" in thresholds ? thresholds.statements : undefined,
  };
}

function includesNoSkipReporter(reporters: unknown): boolean {
  return (
    Array.isArray(reporters) &&
    reporters.some(
      (reporter) =>
        reporter === NoSkipReporter || reporter instanceof NoSkipReporter,
    )
  );
}

describe("loadable runtime configs", () => {
  test.each(loadable)(
    "config $file is registered correctly",
    async ({ file, name, thresholds }) => {
      const loaded: unknown = await import(resolve(root, file));
      const config = readTest(loaded);
      expect(config.name).toBe(name);
      if (thresholds) {
        expect(thresholdRecord(config.coverage)).toEqual({
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        });
      }
      expect(Array.isArray(config.reporters)).toBe(true);
      expect(includesNoSkipReporter(config.reporters)).toBe(true);
    },
  );
});

describe("browser runtime configs", () => {
  test.each(browserConfigs)(
    "packages/%s/vitest.config.%s.ts names its project",
    (pkg, runtime) => {
      const text = readFileSync(
        resolve(root, `packages/${pkg}/vitest.config.${runtime}.ts`),
        "utf8",
      );
      expect(text).toContain(`baseConfig("${runtime}")`);
      expect(text).toContain(`name: "${pkg}-${runtime}"`);
      expect(text).toContain(
        `browser: "${runtime === "chrome" ? "chromium" : "firefox"}"`,
      );
    },
  );
});
