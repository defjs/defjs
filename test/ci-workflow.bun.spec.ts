import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { listRepoFiles } from "./spec-naming.ts";

const root = resolve(import.meta.dirname, "..");
const ciPath = resolve(root, ".github/workflows/ci.yml");
const setupNode = "actions/setup-node@v7";

interface Job {
  uses: string[];
  runs: string[];
  nodeVersions: unknown[];
  needs: unknown;
}

// Every command of every job, in workflow order. A suffix such as `|| true`
// changes the string and fails the comparison.
const expectedRuns: Record<string, string[]> = {
  checks: [
    "bun ci",
    "bun run --cwd doc typegen",
    "bun run lint",
    "bun fmt --check",
    "bun run typecheck",
  ],
  build: ["bun ci", "bun run build"],
  "unit-chrome": [
    "bun ci",
    "bunx --bun playwright install --with-deps chromium",
    "bun run unit:chrome",
  ],
  "unit-firefox": [
    "bun ci",
    "bunx --bun playwright install --with-deps firefox",
    "bun run unit:firefox",
  ],
  "unit-bun": ["bun ci", "bun run unit:bun"],
  "unit-node": [
    `for lock in packages/*/package-lock.json; do\n  (cd "$(dirname "$lock")" && npm ci --ignore-scripts --workspaces=false)\ndone`,
    "node --run unit:node",
  ],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function workflowDocument(): Record<string, unknown> {
  const parsed: unknown = Bun.YAML.parse(readFileSync(ciPath, "utf8"));
  if (!isRecord(parsed)) throw new Error("workflow is not a mapping");
  return parsed;
}

// Only `bash` and `sh` are documented to stop a multi-command `run` at the
// first failing command (`set -e`). `pwsh` and `powershell` report the last exit
// code and `cmd` has no fail-fast, so they are not allowed.
const failFastShells = new Set(["bash", "sh"]);

// GitHub Actions keeps a job green when `continue-on-error` is true, treats a
// skipped job (`if` false) as a passed required check, and a custom `shell`
// template (`command [options] {0}`) replaces the built-in wrapper that fails
// fast. None of them may appear anywhere in the workflow. A skipped step does
// not fail its job either, so `if` is also rejected on every step that has a
// `run` command: each of those is a gate command. A step that only `uses` an
// action may carry an `if` (for example `if: failure()` on an artifact upload).
function isUsesStep(path: string, value: Record<string, unknown>): boolean {
  return (
    /\.steps\[\d+\]$/.test(path) &&
    typeof value["uses"] === "string" &&
    !("run" in value)
  );
}

function bypassFindings(value: unknown, path = "workflow"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      bypassFindings(item, `${path}[${index}]`),
    );
  }
  if (!isRecord(value)) return [];
  const found: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (key === "continue-on-error") found.push(childPath);
    else if (key === "if" && !isUsesStep(path, value)) found.push(childPath);
    else if (
      key === "shell" &&
      !(typeof child === "string" && failFastShells.has(child))
    ) {
      found.push(childPath);
    }
    found.push(...bypassFindings(child, childPath));
  }
  return found;
}

function readJob(id: string, job: unknown): Job {
  if (!isRecord(job)) throw new Error(`job ${id} is not a mapping`);
  const steps: Record<string, unknown>[] = Array.isArray(job["steps"])
    ? job["steps"].filter(isRecord)
    : [];
  const uses: string[] = [];
  const runs: string[] = [];
  const nodeVersions: unknown[] = [];
  for (const { uses: use, run, with: inputs } of steps) {
    if (typeof run === "string") runs.push(run.trim());
    if (typeof use !== "string") continue;
    uses.push(use);
    if (use.includes(setupNode)) {
      nodeVersions.push(isRecord(inputs) ? inputs["node-version"] : undefined);
    }
  }
  return { uses, runs, nodeVersions, needs: job["needs"] };
}

function workflowJobs(): Record<string, Job> {
  const { jobs } = workflowDocument();
  if (!isRecord(jobs)) throw new Error("workflow has no jobs");
  return Object.fromEntries(
    Object.entries(jobs).map(([id, job]) => [id, readJob(id, job)]),
  );
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
  expect(Object.keys(jobs)).toEqual(Object.keys(expectedRuns));
  for (const [id, job] of Object.entries(jobs)) {
    expect(job.needs, id).toBe(id === "checks" ? undefined : "checks");
  }
});

test("bun jobs install bun, the node job does not", () => {
  const { "unit-node": node, ...bunJobs } = workflowJobs();
  for (const [id, job] of Object.entries(bunJobs)) {
    expect(job.uses, id).toContain("oven-sh/setup-bun@v2");
  }
  expect(node?.uses).toContain(setupNode);
  // Any version of the action, not only the one the Bun jobs pin.
  expect(node?.uses.filter((use) => use.includes("setup-bun"))).toEqual([]);
});

test.each(Object.entries(expectedRuns))(
  "%s runs exactly its commands",
  (id, commands) => {
    expect(workflowJobs()[id]?.runs).toEqual(commands);
  },
);

test("no job, step or default can ignore a failure or skip itself", () => {
  expect(bypassFindings(workflowDocument())).toEqual([]);
});

test("bypassFindings reports every ignored-failure key with its path", () => {
  const workflow = {
    defaults: { run: { shell: "bash {0}" } },
    jobs: {
      a: {
        "continue-on-error": true,
        if: false,
        steps: [
          { run: "x", shell: "bash" },
          { run: "x", shell: "sh" },
          { run: "y", shell: "true {0}", if: "always()" },
          { run: "z", "continue-on-error": true },
          { run: "p", shell: "pwsh" },
          { run: "c", shell: "cmd" },
          { run: "q", shell: "python" },
          { uses: "u", with: { shell: "bash" } },
          { uses: "d", if: "failure()" },
          { uses: "e", if: "false", "continue-on-error": true },
        ],
      },
      b: { steps: [{ run: "w" }] },
      c: { uses: "./.github/workflows/w.yml", if: "false" },
    },
  };
  expect(bypassFindings(workflow)).toEqual([
    "workflow.defaults.run.shell",
    "workflow.jobs.a.continue-on-error",
    "workflow.jobs.a.if",
    "workflow.jobs.a.steps[2].shell",
    "workflow.jobs.a.steps[2].if",
    "workflow.jobs.a.steps[3].continue-on-error",
    "workflow.jobs.a.steps[4].shell",
    "workflow.jobs.a.steps[5].shell",
    "workflow.jobs.a.steps[6].shell",
    "workflow.jobs.a.steps[9].continue-on-error",
    "workflow.jobs.c.if",
  ]);
  expect(bypassFindings({ jobs: { c: { steps: [] } } })).toEqual([]);
});

test("unit-node tests on the LTS line", () => {
  expect(workflowJobs()["unit-node"]?.nodeVersions).toEqual(["lts/*"]);
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
