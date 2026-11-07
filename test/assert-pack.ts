/**
 * Fail the release if `npm pack --dry-run` omits LICENSE, README.md, package.json,
 * or any file referenced by the package's entry fields.
 *
 * Run it in the publish directory (the directory `npm publish` uses):
 *   bun test/assert-pack.ts packages/core/dist
 */
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Collect relative file paths from entry fields, skipping URLs and bare package names. */
function collectPaths(value: unknown, into: Set<string>): void {
  if (typeof value === "string") {
    const path = value.replace(/^\.\//, "");
    if (path && !path.includes("://") && !path.startsWith("#")) {
      if (path.includes(".") || path.includes("/")) into.add(path);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) collectPaths(entry, into);
    return;
  }

  if (isRecord(value)) {
    for (const entry of Object.values(value)) collectPaths(entry, into);
  }
}

function fail(message: string): never {
  throw new Error(message);
}

const publishDirArg = Bun.argv[2];
if (!publishDirArg || Bun.argv.length > 3) {
  fail("usage: bun test/assert-pack.ts <publish-directory>");
}

const publishDir = publishDirArg;
let manifest: Record<string, unknown>;
try {
  const parsed: unknown = JSON.parse(
    await Bun.file(`${publishDir}/package.json`).text(),
  );
  if (!isRecord(parsed)) throw new TypeError("package.json is not an object");
  manifest = parsed;
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
  const result = Bun.spawnSync({
    cmd: ["npm", "pack", "--dry-run", "--json", "--silent"],
    cwd: publishDir,
    stderr: "pipe",
    stdout: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString() || "npm pack failed");
  }
  packed = parsePackedFiles(result.stdout.toString());
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
