import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { collectNotRun } from "./no-skip-reporter.ts";
import { envWithoutVitest, run } from "./spawn.ts";

const repoRoot = `${import.meta.dirname}/..`;

test("collectNotRun lists skipped and todo tests only", () => {
  const passed = {
    fullName: "passed case",
    options: { mode: "run" },
    result: () => ({ state: "passed" }),
  };
  const skipped = {
    fullName: "skipped case",
    options: { mode: "skip" },
    result: () => ({ state: "skipped" }),
  };
  const todo = {
    fullName: "todo case",
    options: { mode: "todo" },
    result: () => ({ state: "skipped" }),
  };
  expect(
    collectNotRun([
      {
        children: {
          allTests: () => [passed, skipped, todo],
        },
      },
    ]),
  ).toEqual([skipped.fullName, todo.fullName]);
});

test(
  "a skipped test fails the run and names the test",
  { timeout: 60_000 },
  async () => {
    const result = await runIsolated(`import { test } from "vitest";
test.skip("skipped one", () => {});
`);
    expect(result.code).toBe(1);
    expect(result.output).toContain("skipped one");
  },
);

test("a fully executed run exits 0", { timeout: 60_000 }, async () => {
  const result = await runIsolated(`import { expect, test } from "vitest";
test("passes", () => {
  expect(1).toBe(1);
});
`);
  expect(result.code).toBe(0);
});

async function runIsolated(specSource: string): Promise<{
  code: number;
  output: string;
}> {
  const dir = await mkdtemp(`${repoRoot}/node_modules/.no-skip-`);
  try {
    await writeFile(`${dir}/a.spec.ts`, specSource);
    await writeFile(
      `${dir}/vitest.config.ts`,
      `import { defineConfig } from "vitest/config";
import { NoSkipReporter } from "../../test/no-skip-reporter.ts";

export default defineConfig({
  test: {
    reporters: ["default", new NoSkipReporter()],
  },
});
`,
    );
    // The nested run sees neither the outer Vitest variables nor CI.
    const { CI, ...env } = envWithoutVitest();
    const { code, stdout, stderr } = await run(
      [process.execPath, "run", "vitest", "run", "--root", dir],
      { cwd: repoRoot, env },
    );
    return { code, output: `${stdout}\n${stderr}` };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
