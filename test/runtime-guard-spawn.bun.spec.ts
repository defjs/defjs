import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { envWithoutVitest, run } from "./spawn.ts";

const root = resolve(import.meta.dirname, "..");

// Coverage and fsModuleCache are off in the nested runs: Vitest cleans the Node
// report directory before the guard fails and shares `node_modules/.vitest-cache`
// across lockfiles, which wipes reports or races with concurrent Vitest runs.
const cases = [
  {
    label: "core vitest config",
    cwd: "packages/core",
    args: [
      "--bun",
      "vitest",
      "run",
      "--config",
      "vitest.config.node.ts",
      "--coverage.enabled=false",
      "--no-fsModuleCache",
    ],
  },
  {
    label: "core unit:node script",
    cwd: "packages/core",
    args: [
      "run",
      "unit:node",
      "--",
      "--coverage.enabled=false",
      "--no-fsModuleCache",
    ],
  },
  {
    label: "cli unit:node script",
    cwd: "packages/cli",
    args: [
      "run",
      "unit:node",
      "--",
      "--coverage.enabled=false",
      "--no-fsModuleCache",
    ],
  },
  {
    label: "opentelemetry-server unit:node script",
    cwd: "packages/opentelemetry-server",
    args: [
      "run",
      "unit:node",
      "--",
      "--coverage.enabled=false",
      "--no-fsModuleCache",
    ],
  },
] as const;

describe("node projects under Bun", () => {
  test.each(cases)(
    "$label fails with the Node.js guard message",
    // Starts a nested Vitest process.
    { timeout: 60_000 },
    async ({ cwd, args }) => {
      // A file in the Node report directory must survive the nested run.
      const reports = resolve(root, cwd, "coverage/node");
      const sentinel = resolve(reports, `sentinel-${randomUUID()}.txt`);
      const created = mkdirSync(reports, { recursive: true });
      writeFileSync(sentinel, "kept");
      try {
        const result = await run([process.execPath, ...args], {
          cwd: resolve(root, cwd),
          env: envWithoutVitest(),
          timeout: 50_000,
        });
        expect(result.code).toBe(1);
        expect(`${result.stdout}${result.stderr}`).toContain(
          "This project must run on Node.js",
        );
        expect(existsSync(sentinel)).toBe(true);
      } finally {
        rmSync(sentinel, { force: true });
        if (created !== undefined) {
          rmSync(created, { recursive: true, force: true });
        }
      }
    },
  );
});
