import { expect, test } from "vitest";
import { specExclude, specInclude } from "./spec-matrix.ts";

test("specInclude selects every spec by default", () => {
  expect(specInclude()).toEqual(["**/*.spec.{ts,tsx}"]);
});

test("specInclude returns one pattern per directory", () => {
  expect(specInclude(["test/**", "x/**"])).toEqual([
    "test/**/*.spec.{ts,tsx}",
    "x/**/*.spec.{ts,tsx}",
  ]);
});

test("specExclude keeps the own runtime selectable and always excludes type", () => {
  expect(specExclude("node")).toEqual([
    "**/node_modules/**",
    "**/dist/**",
    "**/coverage/**",
    "**/test-out/**",
    "**/*.{chrome,firefox,bun,type}.spec.{ts,tsx}",
  ]);
});
