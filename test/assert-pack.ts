/**
 * Fail the release if `npm pack --dry-run` omits LICENSE, README.md, package.json,
 * or any file referenced by the package's entry fields.
 *
 * Pass the publish directory (the directory `npm publish` uses):
 *   bun test/assert-pack.ts packages/core/dist
 */

const entryFields = [
  "exports",
  "types",
  "main",
  "module",
  "typings",
  "unpkg",
  "jsdelivr",
];
const requiredRootFiles = ["LICENSE", "README.md", "package.json"];

interface PackEntry {
  files: { path: string }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPackEntry(value: unknown): value is PackEntry {
  return (
    isRecord(value) &&
    Array.isArray(value["files"]) &&
    value["files"].every(
      (file: unknown) => isRecord(file) && typeof file["path"] === "string",
    )
  );
}

async function readManifest(dir: string): Promise<Record<string, unknown>> {
  const manifest: unknown = await Bun.file(`${dir}/package.json`).json();
  if (!isRecord(manifest)) {
    throw new Error(`assert-pack: package.json in ${dir} is not an object`);
  }
  return manifest;
}

// The build writes every entry as a path from the package root, so any other
// string means the manifest is not the one this check was written for.
function collectPaths(value: unknown, into: Set<string>): void {
  if (typeof value === "string") {
    if (!value.startsWith("./")) {
      throw new Error(`assert-pack: entry "${value}" does not start with "./"`);
    }
    into.add(value.slice(2));
    return;
  }
  for (const entry of Object.values(value ?? {})) collectPaths(entry, into);
}

function packedFiles(dir: string): Set<string> {
  const result = Bun.spawnSync({
    cmd: ["npm", "pack", "--dry-run", "--json", "--silent"],
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `assert-pack: npm pack --dry-run failed in ${dir}\n${result.stderr.toString()}`,
    );
  }
  const stdout = result.stdout.toString();
  const end = Math.max(stdout.lastIndexOf("]"), stdout.lastIndexOf("}"));
  const parsed: unknown = JSON.parse(
    stdout.slice(stdout.search(/[[{]/), end + 1),
  );
  // npm 11 prints an array and npm 12 an object keyed by package name; the
  // first value describes the package either way.
  const entry: unknown = Object.values(parsed ?? {})[0];
  if (!isPackEntry(entry)) {
    throw new Error(
      `assert-pack: npm pack output in ${dir} has no list of packed files`,
    );
  }
  return new Set(
    entry.files.map((file) => file.path.replace(/^package\//, "")),
  );
}

const [dir, ...extra] = Bun.argv.slice(2);
if (dir === undefined || extra.length > 0) {
  throw new Error("usage: bun test/assert-pack.ts <publish-directory>");
}

const required = new Set(requiredRootFiles);
const manifest = await readManifest(dir);
for (const field of entryFields) collectPaths(manifest[field], required);

const packed = packedFiles(dir);
console.log(`packed: ${[...packed].sort().join(", ")}`);
console.log(`required: ${[...required].sort().join(", ")}`);

const missing = [...required].filter((file) => !packed.has(file)).sort();
if (missing.length > 0) {
  throw new Error(
    `assert-pack: missing from npm pack --dry-run: ${missing.join(", ")}`,
  );
}

console.log("assert-pack: ok");
