/**
 * Fail the release if `npm pack --dry-run` omits LICENSE, README.md, package.json,
 * or any file referenced by the package's entry fields.
 *
 * Run it in the publish directory (the directory `npm publish` uses):
 *   bun test/assert-pack.ts packages/core/dist
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { parsePackedFiles } from "./pack-output";

const ENTRY_FIELDS = [
  "exports",
  "types",
  "main",
  "module",
  "typings",
  "unpkg",
  "jsdelivr",
];
const REQUIRED_ROOT_FILES = ["LICENSE", "README.md", "package.json"];

/** Collect relative file paths from entry fields, skipping URLs and bare package names. */
function collectPaths(value: unknown, into: Set<string>): void {
  if (typeof value === "string") {
    const path = value.replace(/^\.\//, "");
    if (path && !path.includes("://") && !path.startsWith("#")) {
      if (path.includes(".") || path.includes("/"))
        into.add(posix.normalize(path));
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) collectPaths(entry, into);
    return;
  }

  if (typeof value === "object" && value !== null) {
    for (const entry of Object.values(value)) collectPaths(entry, into);
  }
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const publishDirArg = process.argv[2];
if (!publishDirArg || process.argv.length > 3) {
  fail("usage: bun test/assert-pack.ts <publish-directory>");
}

const publishDir = resolve(publishDirArg);
let manifest: Record<string, unknown>;
try {
  manifest = JSON.parse(
    readFileSync(resolve(publishDir, "package.json"), "utf8"),
  );
} catch (error) {
  fail(
    `assert-pack: cannot read package.json in ${publishDir}\n${String(error)}`,
  );
}

const required = new Set(REQUIRED_ROOT_FILES);
for (const field of ENTRY_FIELDS) {
  if (field in manifest) collectPaths(manifest[field], required);
}

let packed: Set<string>;
try {
  const stdout = execFileSync(
    "npm",
    ["pack", "--dry-run", "--json", "--silent"],
    { cwd: publishDir, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  packed = parsePackedFiles(stdout);
} catch (error) {
  fail(
    `assert-pack: npm pack --dry-run failed in ${publishDir}\n${String(error)}`,
  );
}

const missing = [...required].filter((file) => !packed.has(file)).sort();
console.log(`packed: ${[...packed].sort().join(", ")}`);
console.log(`required: ${[...required].sort().join(", ")}`);

if (missing.length > 0) {
  fail(`assert-pack: missing from npm pack --dry-run: ${missing.join(", ")}`);
}

console.log("assert-pack: ok");
