import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

export function listUnitNodePackages(packagesDir: string): string[] {
  const packages: string[] = [];
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageDir = join(packagesDir, entry.name);
    const manifestPath = join(packageDir, "package.json");
    if (!existsSync(manifestPath)) continue;
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (!definesUnitNode(parsed)) continue;
    packages.push(packageDir);
  }
  packages.sort((left, right) => basename(left).localeCompare(basename(right)));
  return packages;
}

export function runUnitNode(
  packagesDir: string,
  execute: (packageDir: string) => number | null = defaultExecute,
): number {
  const packages = listUnitNodePackages(packagesDir);
  if (packages.length === 0) {
    console.error("No package defines unit:node.");
    return 1;
  }
  let failed = false;
  for (const packageDir of packages) {
    console.log(`unit:node ${basename(packageDir)}`);
    const status = execute(packageDir);
    if (status !== 0) failed = true;
  }
  return failed ? 1 : 0;
}

function defaultExecute(packageDir: string): number | null {
  return spawnSync(process.execPath, ["--run", "unit:node"], {
    cwd: packageDir,
    stdio: "inherit",
  }).status;
}

function definesUnitNode(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const scripts = value["scripts"];
  if (!isRecord(scripts)) return false;
  return typeof scripts["unit:node"] === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.main) {
  process.exit(runUnitNode(join(import.meta.dirname, "..", "packages")));
}
