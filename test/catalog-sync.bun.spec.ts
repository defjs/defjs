import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const root = join(import.meta.dirname, "..");
const packages = ["packages/core", "packages/opentelemetry-server"] as const;
const npmProtocols = ["catalog:", "workspace:", "file:", "link:"] as const;

test.each(packages)(
  "should keep %s dependency specifiers readable by npm",
  (pkg) => {
    const merged = mergedDependencies(readManifest(pkg));
    const offenders = Object.entries(merged)
      .filter(([, spec]) =>
        npmProtocols.some((protocol) => spec.startsWith(protocol)),
      )
      .map(([name, spec]) => `${name}@${spec}`);
    expect(offenders).toEqual([]);
  },
);

test.each(packages)(
  "should match the root catalog for shared dependencies in %s",
  (pkg) => {
    const catalog = catalogSpecifiers();
    const mismatches = Object.entries(mergedDependencies(readManifest(pkg)))
      .filter(([name]) => catalog[name] !== undefined)
      .filter(([name, spec]) => spec !== catalog[name])
      .map(([name, spec]) => `${name}@${spec}!=${catalog[name]}`);
    expect(mismatches).toEqual([]);
  },
);

test.each(packages)(
  "should ship .npmrc with legacy-peer-deps and a package-lock.json in %s",
  (pkg) => {
    const dir = join(root, pkg);
    expect(readFileSync(join(dir, ".npmrc"), "utf8")).toBe(
      "legacy-peer-deps=true\n",
    );
    expect(existsSync(join(dir, "package-lock.json"))).toBe(true);
  },
);

test.each(packages)(
  "should keep the lockfile root dependency maps equal to package.json in %s",
  (pkg) => {
    const manifest = readManifest(pkg);
    const lock: unknown = JSON.parse(
      readFileSync(join(root, pkg, "package-lock.json"), "utf8"),
    );
    const lockRoot = recordField(
      recordField(expectRecord(lock, "package-lock.json"), "packages"),
      "",
    );
    expect(stringMap(lockRoot["dependencies"])).toEqual(
      stringMap(manifest["dependencies"]),
    );
    expect(stringMap(lockRoot["devDependencies"])).toEqual(
      stringMap(manifest["devDependencies"]),
    );
    expect(stringMap(lockRoot["peerDependencies"])).toEqual(
      stringMap(manifest["peerDependencies"]),
    );
  },
);

function readManifest(pkg: string): Record<string, unknown> {
  const manifest: unknown = JSON.parse(
    readFileSync(join(root, pkg, "package.json"), "utf8"),
  );
  return expectRecord(manifest, `${pkg}/package.json`);
}

function catalogSpecifiers(): Record<string, string> {
  const rootManifest: unknown = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  );
  const workspaces = recordField(
    expectRecord(rootManifest, "package.json"),
    "workspaces",
  );
  return stringMap(workspaces["catalog"]);
}

function mergedDependencies(
  manifest: Record<string, unknown>,
): Record<string, string> {
  return {
    ...stringMap(manifest["dependencies"]),
    ...stringMap(manifest["devDependencies"]),
  };
}

function stringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const entries: Record<string, string> = {};
  for (const [name, spec] of Object.entries(value)) {
    if (typeof spec === "string") entries[name] = spec;
  }
  return entries;
}

function recordField(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  return expectRecord(record[key], key);
}

function expectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} is not an object`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
