import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { expect, onTestFinished, test } from "vitest";

const root = resolve(import.meta.dirname, "..");

function createPackDir(
  manifest: Record<string, unknown>,
  files: Record<string, string>,
): string {
  const dir = mkdtempSync(join(tmpdir(), "defjs-assert-pack-"));
  onTestFinished(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  writeFileSync(join(dir, "LICENSE"), "MIT\n");
  writeFileSync(join(dir, "README.md"), "# Test\n");
  writeFileSync(join(dir, "package.json"), `${JSON.stringify(manifest)}\n`);
  for (const [relPath, contents] of Object.entries(files)) {
    const absPath = join(dir, relPath);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, contents);
  }
  return dir;
}

function runAssertPack(dir: string) {
  return Bun.spawnSync(
    [process.execPath, resolve(root, "test/assert-pack.ts"), dir],
    { cwd: root, stdout: "pipe", stderr: "pipe" },
  );
}

test("accepts normalized object bin and ./ main entry", () => {
  const dir = createPackDir(
    {
      name: "@defjs/tmp-bin-ok",
      version: "0.0.1",
      main: "./index.js",
      bin: { defjs: "index.js" },
    },
    { "index.js": "#!/usr/bin/env node\n" },
  );
  const res = runAssertPack(dir);
  expect(res.exitCode, res.stderr.toString()).toBe(0);
  expect(res.stdout.toString()).toContain("assert-pack: ok");
});

test("accepts normalized string bin entry", () => {
  const dir = createPackDir(
    {
      name: "@defjs/tmp-bin-str",
      version: "0.0.1",
      bin: "bin/cli.js",
    },
    { "bin/cli.js": "#!/usr/bin/env node\n" },
  );
  const res = runAssertPack(dir);
  expect(res.exitCode, res.stderr.toString()).toBe(0);
  expect(res.stdout.toString()).toContain("assert-pack: ok");
});

test("rejects bin entry with leading ./", () => {
  const dir = createPackDir(
    {
      name: "@defjs/tmp-bin-dot-slash",
      version: "0.0.1",
      bin: { defjs: "./index.js" },
    },
    { "index.js": "#!/usr/bin/env node\n" },
  );
  const res = runAssertPack(dir);
  expect(res.exitCode).not.toBe(0);
  expect(res.stderr.toString()).toContain(
    'must be a normalized relative path without leading "./"',
  );
});

test("rejects traversal and non-string bin entries", () => {
  const traversalDir = createPackDir(
    {
      name: "@defjs/tmp-bin-traversal",
      version: "0.0.1",
      bin: { defjs: "../index.js" },
    },
    {},
  );
  const traversalRes = runAssertPack(traversalDir);
  expect(traversalRes.exitCode).not.toBe(0);
  expect(traversalRes.stderr.toString()).toContain(
    'must be a normalized relative path without leading "./"',
  );

  const nonStringDir = createPackDir(
    {
      name: "@defjs/tmp-bin-non-string",
      version: "0.0.1",
      bin: { defjs: 123 },
    },
    {},
  );
  const nonStringRes = runAssertPack(nonStringDir);
  expect(nonStringRes.exitCode).not.toBe(0);
  expect(nonStringRes.stderr.toString()).toContain(
    "bin field must be a string or record of strings",
  );
});

test("rejects missing normalized bin target file", () => {
  const dir = createPackDir(
    {
      name: "@defjs/tmp-bin-missing",
      version: "0.0.1",
      bin: { defjs: "missing.js" },
    },
    {},
  );
  const res = runAssertPack(dir);
  expect(res.exitCode).not.toBe(0);
  expect(res.stderr.toString()).toContain(
    "missing from npm pack --dry-run: missing.js",
  );
});
