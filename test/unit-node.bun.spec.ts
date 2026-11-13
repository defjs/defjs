import { basename } from "node:path";
import { expect, test } from "vitest";
import { runUnitNode } from "./run-unit-node.ts";

const dirs = ["/repo/packages/a", "/repo/packages/b"];

test("runUnitNode runs unit:node in every directory, in order", () => {
  const called: string[] = [];
  const status = runUnitNode(dirs, (dir) => {
    called.push(dir);
    return 0;
  });
  expect(called).toEqual(dirs);
  expect(status).toBe(0);
});

test("runUnitNode keeps running after a failure and reports failure", () => {
  const called: string[] = [];
  const status = runUnitNode(dirs, (dir) => {
    called.push(dir);
    return basename(dir) === "a" ? 1 : 0;
  });
  expect(called).toEqual(dirs);
  expect(status).toBe(1);
});

test("runUnitNode treats a missing exit status as failure", () => {
  expect(runUnitNode(dirs, () => null)).toBe(1);
});
