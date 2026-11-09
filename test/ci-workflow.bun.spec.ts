import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { listRepoFiles } from "./spec-naming.ts";

const root = resolve(import.meta.dirname, "..");
const ciPath = resolve(root, ".github/workflows/ci.yml");
const npmCi = "npm ci --ignore-scripts --workspaces=false";
const setupNode = "actions/setup-node@v7";

const jobOrder = [
  "checks",
  "build-e2e",
  "unit-chrome",
  "unit-firefox",
  "unit-bun",
  "unit-node",
] as const;

interface JobCommands {
  uses: string[];
  runs: string[];
  needs: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJobs(text: string): Map<string, JobCommands> {
  const parsed: unknown = Bun.YAML.parse(text);
  if (!isRecord(parsed)) throw new Error("workflow is not a mapping");
  const jobs = parsed["jobs"];
  if (!isRecord(jobs)) throw new Error("workflow has no jobs");
  const result = new Map<string, JobCommands>();
  for (const [id, job] of Object.entries(jobs)) {
    if (!isRecord(job)) throw new Error(`job ${id} is not a mapping`);
    const uses: string[] = [];
    const runs: string[] = [];
    collectSteps(job["steps"], uses, runs);
    result.set(id, { uses, runs, needs: job["needs"] });
  }
  return result;
}

function collectSteps(steps: unknown, uses: string[], runs: string[]): void {
  if (!Array.isArray(steps)) return;
  for (const step of steps) {
    if (!isRecord(step)) continue;
    const use = step["uses"];
    const run = step["run"];
    if (typeof use === "string") uses.push(use);
    if (typeof run === "string") runs.push(run);
  }
}

function workflowJobs(): Map<string, JobCommands> {
  return readJobs(readFileSync(ciPath, "utf8"));
}

function requireJob(
  jobs: Map<string, JobCommands>,
  id: string,
): JobCommands | undefined {
  const job = jobs.get(id);
  expect(job, id).toBeDefined();
  return job;
}

function scriptValues(manifest: unknown): string[] {
  if (!isRecord(manifest) || !("scripts" in manifest)) return [];
  const scripts = manifest["scripts"];
  if (!isRecord(scripts)) return [];
  const values: string[] = [];
  for (const value of Object.values(scripts)) {
    if (typeof value === "string") values.push(value);
  }
  return values;
}

function isPackageManifest(file: string): boolean {
  return file === "package.json" || file.endsWith("/package.json");
}

function isVitestConfig(file: string): boolean {
  const name = file.slice(file.lastIndexOf("/") + 1);
  return name.startsWith("vitest.config") && name.endsWith(".ts");
}

test("checks runs first and every other job waits for it", () => {
  const jobs = workflowJobs();
  expect([...jobs.keys()]).toEqual([...jobOrder]);
  for (const [id, job] of jobs) {
    expect(job.needs, id).toBe(id === "checks" ? undefined : "checks");
  }
});

test("checks runs only the install and the static checks", () => {
  const checks = requireJob(workflowJobs(), "checks");
  if (!checks) return;
  expect(checks.runs).toEqual([
    "bun ci",
    "bun run --cwd doc typegen",
    "bun lint",
    "bun fmt --check",
    "bun run typecheck",
  ]);
});

test("build-e2e builds before it runs the E2E suite", () => {
  const job = requireJob(workflowJobs(), "build-e2e");
  if (!job) return;
  const build = job.runs.indexOf("bun run build");
  expect(build).toBeGreaterThanOrEqual(0);
  expect(job.runs.indexOf("bun run test:e2e")).toBeGreaterThan(build);
});

test("bun jobs install canary bun, the node job does not", () => {
  const jobs = workflowJobs();
  const node = requireJob(jobs, "unit-node");
  if (!node) return;
  expect(node.uses.some((use) => use.includes(setupNode))).toBe(true);
  expect(node.uses.some((use) => use.includes("setup-bun"))).toBe(false);
  for (const [id, job] of jobs) {
    if (id === "unit-node") continue;
    expect(job.uses.some((use) => use.includes("oven-sh/setup-bun@v2"))).toBe(
      true,
    );
  }
});

test("each unit job runs exactly its runtime script", () => {
  const jobs = workflowJobs();
  const expected = [
    ["unit-chrome", "bun run unit:chrome"],
    ["unit-firefox", "bun run unit:firefox"],
    ["unit-bun", "bun run unit:bun"],
    ["unit-node", "node --run unit:node"],
  ] as const;
  for (const [id, command] of expected) {
    const job = requireJob(jobs, id);
    if (!job) continue;
    expect(job.runs.some((run) => run.includes(command))).toBe(true);
  }
  const bun = requireJob(jobs, "unit-bun");
  if (!bun) return;
  const typegen = bun.runs.findIndex((run) =>
    run.includes("bun run --cwd doc typegen"),
  );
  const unit = bun.runs.findIndex((run) => run.includes("bun run unit:bun"));
  expect(typegen).toBeGreaterThanOrEqual(0);
  expect(unit).toBeGreaterThan(typegen);
});

test("npm ci runs once, only in unit-node", () => {
  const hits: string[] = [];
  for (const [id, job] of workflowJobs()) {
    for (const run of job.runs) {
      if (run.includes(npmCi)) hits.push(id);
    }
  }
  expect(hits).toEqual(["unit-node"]);
});

test("no unit run passes --passWithNoTests", () => {
  expect(readFileSync(ciPath, "utf8")).not.toContain("passWithNoTests");
  for (const file of listRepoFiles(root)) {
    const text = readFileSync(resolve(root, file), "utf8");
    if (isPackageManifest(file)) {
      const parsed: unknown = JSON.parse(text);
      for (const script of scriptValues(parsed)) {
        expect(script).not.toContain("passWithNoTests");
      }
    }
    if (isVitestConfig(file)) {
      expect(text).not.toContain("passWithNoTests");
    }
  }
});
