import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, onTestFinished, test } from "vitest";
import {
  expectedProjects,
  listRepoFiles,
  nameViolations,
  ownershipViolations,
  parseListOutput,
  selectionDiff,
  type ListEntry,
  type Owner,
} from "./spec-naming.ts";

const mismatch =
  "name does not match <stem>[.chrome|.firefox|.node|.bun|.type].spec.ts(x)";

test("accepts valid names", () => {
  expect(
    nameViolations([
      "a/x.spec.ts",
      "a/x.spec.tsx",
      "a/x.node.spec.ts",
      "a/x.type.spec.ts",
      "a/balancer.end.spec.ts",
      "a/http.upload_progress.worker.chrome.spec.ts",
      "a/x.bench.ts",
      "a/x.worker.ts",
    ]),
  ).toEqual([]);
});

test.each([
  [
    "a/x.browser.spec.ts",
    'a/x.browser.spec.ts: reserved word "browser" as last name segment',
  ],
  [
    "a/x.server.spec.ts",
    'a/x.server.spec.ts: reserved word "server" as last name segment',
  ],
  [
    "a/x.chrome.node.spec.ts",
    'a/x.chrome.node.spec.ts: reserved word "chrome" as last name segment',
  ],
  [
    "a/x.type.node.spec.ts",
    'a/x.type.node.spec.ts: reserved word "type" as last name segment',
  ],
  ["a/x.test.ts", "a/x.test.ts: forbidden .test. file; rename it to *.spec"],
  [
    "a/x.type.test.ts",
    "a/x.type.test.ts: forbidden .test. file; rename it to *.spec",
  ],
  ["a/X.spec.ts", `a/X.spec.ts: ${mismatch}`],
  ["a/x.spec.mts", `a/x.spec.mts: ${mismatch}`],
])("rejects %s", (file, message) => {
  expect(nameViolations([file])).toEqual([message]);
});

test("checks only the basename", () => {
  expect(nameViolations(["browser/x.spec.ts", "node/x.node.spec.ts"])).toEqual(
    [],
  );
});

test("lists tracked and untracked files, drops files deleted from disk, honors .gitignore", () => {
  const dir = mkdtempSync(join(tmpdir(), "spec-naming-"));
  onTestFinished(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  execFileSync("git", ["init", "-q"], { cwd: dir });
  writeFileSync(join(dir, ".gitignore"), "ignored.spec.ts\n");
  writeFileSync(join(dir, "a.spec.ts"), "");
  writeFileSync(join(dir, "b.spec.ts"), "");
  writeFileSync(join(dir, "ignored.spec.ts"), "");
  execFileSync("git", ["add", ".gitignore", "a.spec.ts", "b.spec.ts"], {
    cwd: dir,
  });
  rmSync(join(dir, "b.spec.ts"));
  writeFileSync(join(dir, "c.node.spec.ts"), "");
  expect(listRepoFiles(dir)).toEqual([
    ".gitignore",
    "a.spec.ts",
    "c.node.spec.ts",
  ]);
});

const mini: readonly Owner[] = [
  {
    dir: "e2e/",
    runtimes: ["chrome"],
    project: () => "pkg-e2e",
    suffixOnly: true,
  },
  { dir: "pkg/", runtimes: ["node", "bun"], project: (rt) => `pkg-${rt}` },
];

test.each([
  ["pkg/a.spec.ts", ["pkg-node", "pkg-bun"]],
  ["pkg/b.node.spec.ts", ["pkg-node"]],
  ["pkg/c.chrome.spec.ts", []],
  ["pkg/d.type.spec.ts", []],
  ["e2e/f.chrome.spec.ts", ["pkg-e2e"]],
  ["e2e/g.spec.ts", []],
  ["other/h.spec.ts", []],
  ["pkg/X.spec.ts", []],
])("expectedProjects(%s)", (file, projects) => {
  expect(expectedProjects(file, mini)).toEqual(projects);
});

test("reports specs that no project runs", () => {
  expect(
    ownershipViolations(
      ["pkg/c.chrome.spec.ts", "e2e/g.spec.ts", "other/h.spec.ts"],
      mini,
    ),
  ).toEqual([
    "pkg/c.chrome.spec.ts: selected by no runtime project",
    "e2e/g.spec.ts: selected by no runtime project",
    "other/h.spec.ts: selected by no runtime project",
  ]);
});

test("ignores type specs and non-spec files", () => {
  expect(
    ownershipViolations(["pkg/d.type.spec.ts", "pkg/x.bench.ts"], mini),
  ).toEqual([]);
});

test("makes paths repo-relative and collapses duplicates", () => {
  const stdout = JSON.stringify([
    { file: "/r/pkg/a.spec.ts", projectName: "pkg-node" },
    { file: "/r/pkg/a.spec.ts", projectName: "pkg-node" },
    { file: "/r/pkg/a.spec.ts", projectName: "pkg-bun" },
  ]);
  expect(parseListOutput(stdout, "/r")).toEqual([
    { file: "pkg/a.spec.ts", projectName: "pkg-node" },
    { file: "pkg/a.spec.ts", projectName: "pkg-bun" },
  ]);
});

test("rejects an unexpected shape", () => {
  expect(() => parseListOutput('{"a":1}', "/r")).toThrow(
    "unexpected vitest list output",
  );
});

const miniSpecs = [
  "pkg/a.spec.ts",
  "pkg/b.node.spec.ts",
  "pkg/c.bun.spec.ts",
  "pkg/d.type.spec.ts",
];

function listed(project: string, files: readonly string[]): ListEntry[] {
  return files.map((file) => ({ file, projectName: project }));
}

test("selectionDiff reports files a project ran that no spec expects", () => {
  expect(
    selectionDiff(
      "pkg-node",
      listed("pkg-node", [
        "pkg/a.spec.ts",
        "pkg/b.node.spec.ts",
        "pkg/e.bench.ts",
      ]),
      miniSpecs,
      mini,
    ),
  ).toEqual({ missing: [], unexpected: ["pkg/e.bench.ts"] });
});

test("selectionDiff reports a runtime spec the project did not run", () => {
  expect(
    selectionDiff(
      "pkg-bun",
      listed("pkg-bun", ["pkg/a.spec.ts"]),
      miniSpecs,
      mini,
    ),
  ).toEqual({ missing: ["pkg/c.bun.spec.ts"], unexpected: [] });
});

test("selectionDiff reports a type spec selected by a runtime project", () => {
  expect(
    selectionDiff(
      "pkg-bun",
      listed("pkg-bun", [
        "pkg/a.spec.ts",
        "pkg/c.bun.spec.ts",
        "pkg/d.type.spec.ts",
      ]),
      miniSpecs,
      mini,
    ),
  ).toEqual({ missing: [], unexpected: ["pkg/d.type.spec.ts"] });
});

const root = resolve(import.meta.dirname, "..");

const owners: readonly Owner[] = [
  {
    dir: "doc/e2e/",
    runtimes: ["chrome"],
    project: () => "doc-e2e",
    suffixOnly: true,
  },
  { dir: "doc/app/", runtimes: ["bun"], project: () => "doc-bun" },
  { dir: "doc/scripts/", runtimes: ["bun"], project: () => "doc-bun" },
  { dir: "doc/examples/", runtimes: ["bun"], project: () => "doc-bun" },
  {
    dir: "packages/core/",
    runtimes: ["chrome", "firefox", "node", "bun"],
    project: (runtime) => `core-${runtime}`,
  },
  {
    dir: "packages/react/",
    runtimes: ["chrome", "firefox"],
    project: (runtime) => `react-${runtime}`,
  },
  {
    dir: "packages/vue/",
    runtimes: ["chrome", "firefox"],
    project: (runtime) => `vue-${runtime}`,
  },
  {
    dir: "packages/opentelemetry-server/",
    runtimes: ["node", "bun"],
    project: (runtime) => `opentelemetry-server-${runtime}`,
  },
  { dir: "test/", runtimes: ["bun"], project: () => "root-bun" },
];

const lists: readonly { cwd: string; config: string; project: string }[] = [
  {
    cwd: "packages/core",
    config: "vitest.config.chrome.ts",
    project: "core-chrome",
  },
  {
    cwd: "packages/core",
    config: "vitest.config.firefox.ts",
    project: "core-firefox",
  },
  {
    cwd: "packages/core",
    config: "vitest.config.node.ts",
    project: "core-node",
  },
  { cwd: "packages/core", config: "vitest.config.bun.ts", project: "core-bun" },
  {
    cwd: "packages/react",
    config: "vitest.config.chrome.ts",
    project: "react-chrome",
  },
  {
    cwd: "packages/react",
    config: "vitest.config.firefox.ts",
    project: "react-firefox",
  },
  {
    cwd: "packages/vue",
    config: "vitest.config.chrome.ts",
    project: "vue-chrome",
  },
  {
    cwd: "packages/vue",
    config: "vitest.config.firefox.ts",
    project: "vue-firefox",
  },
  {
    cwd: "packages/opentelemetry-server",
    config: "vitest.config.node.ts",
    project: "opentelemetry-server-node",
  },
  {
    cwd: "packages/opentelemetry-server",
    config: "vitest.config.bun.ts",
    project: "opentelemetry-server-bun",
  },
  { cwd: "doc", config: "vitest.config.bun.ts", project: "doc-bun" },
  { cwd: "doc", config: "vitest.config.e2e.ts", project: "doc-e2e" },
  { cwd: ".", config: "vitest.config.bun.ts", project: "root-bun" },
];

const files = listRepoFiles(root);
const specFiles = files.filter((file) => /\.spec\.tsx?$/.test(file));
const selection = new Map<string, ListEntry[]>();

describe("repository spec names", () => {
  test("every test file name is valid", () => {
    expect(nameViolations(files)).toEqual([]);
  });

  test("every non-type spec is selected by at least one runtime project", () => {
    expect(ownershipViolations(specFiles, owners)).toEqual([]);
  });
});

describe("vitest selection", () => {
  // Sequentially starts the 13 Vitest list processes, one config at a time.
  beforeAll(async () => {
    for (const { cwd, config, project } of lists) {
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [
          "--bun",
          "vitest",
          "list",
          "--filesOnly",
          "--json",
          "--config",
          config,
        ],
        {
          cwd: resolve(root, cwd),
          encoding: "utf8",
          maxBuffer: 64 * 1024 * 1024,
        },
      );
      selection.set(project, parseListOutput(stdout, root));
    }
  }, 600_000);

  test.each(lists)("selects the expected files in $project", ({ project }) => {
    const expected = specFiles.filter((file) =>
      expectedProjects(file, owners).includes(project),
    );
    expect(expected.length).toBeGreaterThan(0);
    expect(
      selectionDiff(project, selection.get(project) ?? [], specFiles, owners),
    ).toEqual({ missing: [], unexpected: [] });
  });

  test("type specs are in no runtime project", () => {
    for (const entries of selection.values()) {
      for (const entry of entries) {
        expect(entry.file).not.toMatch(/\.type\.spec\.tsx?$/);
      }
    }
  });

  test("doc e2e specs run only in doc-e2e", () => {
    const tracked = specFiles
      .filter((file) => /^doc\/e2e\/.*\.chrome\.spec\.tsx?$/.test(file))
      .sort();
    const entries = [...selection.values()]
      .flat()
      .filter((entry) => entry.file.startsWith("doc/e2e/"));
    expect(
      [...new Set(entries.map((entry) => entry.projectName))].sort(),
    ).toEqual(["doc-e2e"]);
    expect([...new Set(entries.map((entry) => entry.file))].sort()).toEqual(
      tracked,
    );
  });
});
