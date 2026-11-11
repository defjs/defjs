import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { resolveConfig } from "vitest/node";
import { NoSkipReporter } from "./no-skip-reporter.ts";

const root = resolve(import.meta.dirname, "..");

interface RuntimeConfig {
  file: string;
  name: string;
  thresholds: boolean;
  browser?: "chromium" | "firefox";
}

const loadable: readonly RuntimeConfig[] = [
  {
    file: "packages/core/vitest.config.ts",
    name: "core-plain",
    thresholds: true,
  },
  {
    file: "packages/core/vitest.config.chrome.ts",
    name: "core-chrome",
    thresholds: true,
    browser: "chromium",
  },
  {
    file: "packages/core/vitest.config.firefox.ts",
    name: "core-firefox",
    thresholds: true,
    browser: "firefox",
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
    file: "packages/react/vitest.config.ts",
    name: "",
    thresholds: true,
  },
  {
    file: "packages/react/vitest.config.chrome.ts",
    name: "react-chrome",
    thresholds: true,
    browser: "chromium",
  },
  {
    file: "packages/react/vitest.config.firefox.ts",
    name: "react-firefox",
    thresholds: true,
    browser: "firefox",
  },
  {
    file: "packages/vue/vitest.config.ts",
    name: "",
    thresholds: true,
  },
  {
    file: "packages/vue/vitest.config.chrome.ts",
    name: "vue-chrome",
    thresholds: true,
    browser: "chromium",
  },
  {
    file: "packages/vue/vitest.config.firefox.ts",
    name: "vue-firefox",
    thresholds: true,
    browser: "firefox",
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
];

function isNoSkipReporter(reporter: unknown): boolean {
  // The config is bundled by Vite, so the reporter class is a separate copy and
  // `instanceof` cannot match; its name still identifies it.
  return (
    typeof reporter === "object" &&
    reporter !== null &&
    reporter.constructor.name === NoSkipReporter.name
  );
}

describe("resolved runtime configs", () => {
  test.each(loadable)(
    "config $file is registered correctly",
    async ({ file, name, thresholds, browser }) => {
      const { test: resolved } = await resolveConfig({
        config: resolve(root, file),
      });
      expect(resolved.name).toBe(name);
      if (thresholds) {
        expect(resolved.coverage.enabled).toBe(true);
        expect(resolved.coverage.provider).toBe("istanbul");
        expect(resolved.coverage.thresholds).toEqual({
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        });
      }
      expect(resolved.browser.enabled).toBe(browser !== undefined);
      if (browser) {
        expect(
          resolved.browser.instances?.map((instance) => ({
            browser: instance.browser,
            name: instance.name,
          })),
        ).toEqual([{ browser, name }]);
      }
      expect(resolved.reporters.some(isNoSkipReporter)).toBe(true);
    },
  );
});
