import { expect, test } from "vitest";
import { coverageSettings } from "./vitest-shared.ts";

const baseExclude = [
  "**/node_modules/**",
  "**/dist/**",
  "**/coverage/**",
  "**/test/**",
  "**/*.spec.{ts,tsx}",
  "**/*.bench.ts",
];

test("coverageSettings reports istanbul at 100 without an include list", () => {
  const result = coverageSettings({ reportsDirectory: "/x" });
  expect(result.enabled).toBe(true);
  expect(result.provider).toBe("istanbul");
  expect(result.reporter).toEqual(["lcov", "json", "html", "text"]);
  expect(result.reportsDirectory).toBe("/x");
  expect(Object.hasOwn(result, "include")).toBe(false);
  expect(result.exclude).toEqual(baseExclude);
  expect(result.thresholds).toMatchObject({
    branches: 100,
    functions: 100,
    lines: 100,
    statements: 100,
  });
});

test("coverageSettings appends extraExclude", () => {
  const result = coverageSettings({
    reportsDirectory: "/x",
    extraExclude: ["src/test-utils.ts"],
  });
  expect(result.exclude).toEqual([...baseExclude, "src/test-utils.ts"]);
});
