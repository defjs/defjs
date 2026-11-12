import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { resolveConfig } from "vitest/node";
import { NoSkipReporter } from "./no-skip-reporter.ts";
import { projects } from "./runtime-matrix.ts";
import type { Runtime } from "./spec-matrix.ts";

const root = resolve(import.meta.dirname, "..");
const engines: Partial<Record<Runtime, string>> = {
  chrome: "chromium",
  firefox: "firefox",
};

// The root specs measure no coverage; every other project enforces the floor.
const configs = projects.map(({ cwd, config, name, runtime }) => ({
  file: `${cwd}/${config}`,
  name,
  thresholds: cwd !== ".",
  browser: engines[runtime],
}));

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
  test.each(configs)(
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
