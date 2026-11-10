import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterAll, expect, test, vi } from "vitest";
import {
  isEntryPoint,
  listUnitNodePackages,
  runUnitNode,
} from "./unit-node.ts";

const packagesDir = mkdtempSync(join(tmpdir(), "unit-node-"));

function writePackage(name: string, manifest: unknown): void {
  const dir = join(packagesDir, name);
  mkdirSync(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
}

// `b` is created before `a` so an unsorted listing cannot pass by accident.
writePackage("b", { scripts: { "unit:node": "node --version" } });
writePackage("a", { scripts: { "unit:node": "node --version" } });
writePackage("c", { scripts: { test: "node --version" } });
mkdirSync(join(packagesDir, "d"));
writeFileSync(join(packagesDir, "notes.txt"), "notes");

afterAll(() => {
  rmSync(packagesDir, { recursive: true, force: true });
});

test("listUnitNodePackages returns sorted absolute directories that define unit:node", () => {
  expect(listUnitNodePackages(packagesDir)).toEqual([
    join(packagesDir, "a"),
    join(packagesDir, "b"),
  ]);
});

test("listUnitNodePackages skips files, missing manifests and packages without the script", () => {
  const names = listUnitNodePackages(packagesDir).map((dir) => basename(dir));
  expect(names).not.toContain("c");
  expect(names).not.toContain("d");
  expect(names).not.toContain("notes.txt");
});

test("runUnitNode runs unit:node in sorted order and only where it is defined", () => {
  const called: string[] = [];
  const status = runUnitNode(packagesDir, (packageDir) => {
    called.push(basename(packageDir));
    return 0;
  });
  expect(called).toEqual(["a", "b"]);
  expect(status).toBe(0);
});

test("runUnitNode keeps running after a failure and reports failure", () => {
  const called: string[] = [];
  const status = runUnitNode(packagesDir, (packageDir) => {
    called.push(basename(packageDir));
    return basename(packageDir) === "a" ? 1 : 0;
  });
  expect(called).toEqual(["a", "b"]);
  expect(status).toBe(1);
});

test("runUnitNode treats a missing exit status as failure", () => {
  expect(runUnitNode(packagesDir, () => null)).toBe(1);
});

test("runUnitNode fails when no package defines unit:node", () => {
  const none = mkdtempSync(join(tmpdir(), "unit-node-none-"));
  const solo = join(none, "solo");
  mkdirSync(solo);
  writeFileSync(
    join(solo, "package.json"),
    JSON.stringify({ scripts: { test: "node --version" } }),
  );
  const called: string[] = [];
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    expect(
      runUnitNode(none, (packageDir) => {
        called.push(packageDir);
        return 0;
      }),
    ).toBe(1);
    expect(called).toEqual([]);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith("No package defines unit:node.");
  } finally {
    error.mockRestore();
    rmSync(none, { recursive: true, force: true });
  }
});

test("isEntryPoint returns the boolean it is given", () => {
  expect(isEntryPoint(true)).toBe(true);
  expect(isEntryPoint(false)).toBe(false);
});

test.each([undefined, null, "true", 1])(
  "isEntryPoint rejects %s instead of skipping the run",
  (main) => {
    expect(() => isEntryPoint(main)).toThrow(/import\.meta\.main/);
  },
);
