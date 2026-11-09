import { expect, test } from "vitest";
import {
  runtimes,
  sourceExclude,
  specExclude,
  specInclude,
} from "./spec-matrix.ts";

test("specInclude without a runtime selects only plain specs", () => {
  expect(specInclude(undefined)).toEqual(["**/*.spec.{ts,tsx}"]);
});

test("specInclude adds the runtime pattern", () => {
  expect(specInclude("node")).toEqual([
    "**/*.spec.{ts,tsx}",
    "**/*.node.spec.{ts,tsx}",
  ]);
});

test("specInclude repeats both patterns per directory", () => {
  expect(specInclude("bun", ["test/**", "x/**"])).toEqual([
    "test/**/*.spec.{ts,tsx}",
    "test/**/*.bun.spec.{ts,tsx}",
    "x/**/*.spec.{ts,tsx}",
    "x/**/*.bun.spec.{ts,tsx}",
  ]);
});

test("specExclude without a runtime excludes every runtime and type", () => {
  expect(specExclude(undefined)).toEqual([
    ...sourceExclude,
    "**/*.{chrome,firefox,node,bun,type}.spec.{ts,tsx}",
  ]);
});

test("specExclude keeps the own runtime selectable and always excludes type", () => {
  expect(specExclude("node")).toEqual([
    ...sourceExclude,
    "**/*.{chrome,firefox,bun,type}.spec.{ts,tsx}",
  ]);
});

test("sourceExclude and runtimes match the shared selection table", () => {
  expect(sourceExclude).toEqual([
    "**/node_modules/**",
    "**/dist/**",
    "**/coverage/**",
    "**/test-out/**",
  ]);
  expect(runtimes).toEqual(["chrome", "firefox", "node", "bun"]);
});
