import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import type { Workspace } from "./runtime-matrix.ts";

export const TEST_FILE: RegExp = /\.(spec|test)\.[cm]?tsx?$/;
export const SPEC_NAME: RegExp =
  /^(?<stem>[a-z0-9_-]+(?:\.[a-z0-9_-]+)*?)(?:\.(?<suffix>chrome|firefox|node|bun|type))?\.spec\.tsx?$/;
export const RESERVED: readonly string[] = [
  "browser",
  "server",
  "chromium",
  "webkit",
  "safari",
  "deno",
  "edge",
  "workerd",
  "chrome",
  "firefox",
  "node",
  "bun",
  "type",
  "test",
  "spec",
] as const;
export const FORBIDDEN_TEST: RegExp = /\.test\.[cm]?tsx?$/;

export interface ListEntry {
  file: string;
  projectName: string;
}

const mismatch =
  "name does not match <stem>[.chrome|.firefox|.node|.bun|.type].spec.ts(x)";

export function listRepoFiles(cwd: string): string[] {
  const output = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd, encoding: "utf8" },
  );
  const files: string[] = [];
  for (const entry of output.split("\0")) {
    if (entry.length === 0) continue;
    const file = entry.replaceAll("\\", "/");
    if (existsSync(join(cwd, file))) files.push(file);
  }
  files.sort();
  return files;
}

export function nameViolations(files: readonly string[]): string[] {
  const messages: string[] = [];
  for (const file of files) {
    const base = basename(file);
    if (!TEST_FILE.test(base)) continue;
    if (FORBIDDEN_TEST.test(base)) {
      messages.push(`${file}: forbidden .test. file; rename it to *.spec`);
      continue;
    }
    const stem = SPEC_NAME.exec(base)?.groups?.["stem"];
    if (stem === undefined) {
      messages.push(`${file}: ${mismatch}`);
      continue;
    }
    const word = stem.split(".").at(-1);
    if (word !== undefined && RESERVED.includes(word)) {
      messages.push(`${file}: reserved word "${word}" as last name segment`);
    }
  }
  return messages;
}

// The projects that run `file`: every runtime of the workspace that owns it,
// or only the runtime its suffix names. A `type` suffix names no runtime.
export function expectedProjects(
  file: string,
  workspaces: readonly Workspace[],
): string[] {
  const match = SPEC_NAME.exec(basename(file));
  const owner = workspaces.find(({ dirs }) =>
    dirs.some((dir) => file.startsWith(dir)),
  );
  if (match === null || owner === undefined) return [];
  const suffix = match.groups?.["suffix"];
  return owner.runtimes
    .filter((runtime) => suffix === undefined || suffix === runtime)
    .map((runtime) => `${owner.name}-${runtime}`);
}

export function ownershipViolations(
  files: readonly string[],
  workspaces: readonly Workspace[],
): string[] {
  const messages: string[] = [];
  for (const file of files) {
    const match = SPEC_NAME.exec(basename(file));
    if (match === null) continue;
    if (match.groups?.["suffix"] === "type") continue;
    if (expectedProjects(file, workspaces).length === 0) {
      messages.push(`${file}: selected by no runtime project`);
    }
  }
  return messages;
}

export function parseListOutput(stdout: string, root: string): ListEntry[] {
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) {
    throw new Error("unexpected vitest list output");
  }
  const entries: ListEntry[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (!isListItem(item)) throw new Error("unexpected vitest list output");
    const file = relative(root, item.file).split(sep).join("/");
    const key = `${file}\0${item.projectName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ file, projectName: item.projectName });
  }
  return entries;
}

export function selectionDiff(
  project: string,
  actual: readonly ListEntry[],
  specFiles: readonly string[],
  workspaces: readonly Workspace[],
): { missing: string[]; unexpected: string[] } {
  const expected = new Set(
    specFiles.filter((file) =>
      expectedProjects(file, workspaces).includes(project),
    ),
  );
  const seen = new Set(
    actual
      .filter((entry) => entry.projectName === project)
      .map((entry) => entry.file),
  );
  return {
    missing: [...expected].filter((file) => !seen.has(file)).sort(),
    unexpected: [...seen].filter((file) => !expected.has(file)).sort(),
  };
}

function isListItem(
  value: unknown,
): value is { file: string; projectName: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  if (!("file" in value) || !("projectName" in value)) return false;
  return (
    typeof value.file === "string" && typeof value.projectName === "string"
  );
}
