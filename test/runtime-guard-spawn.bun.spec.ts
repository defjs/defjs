import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";

const root = resolve(import.meta.dirname, "..");
const execFileAsync = promisify(execFile);

// Coverage is off in the nested runs: Vitest cleans the Node report directory before
// the guard fails and still writes an empty report after it, which wipes local results.
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
    ],
  },
  {
    label: "core unit:node script",
    cwd: "packages/core",
    args: ["run", "unit:node", "--", "--coverage.enabled=false"],
  },
  {
    label: "opentelemetry-server unit:node script",
    cwd: "packages/opentelemetry-server",
    args: ["run", "unit:node", "--", "--coverage.enabled=false"],
  },
] as const;

function envWithoutVitest(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key.startsWith("VITEST")) continue;
    env[key] = value;
  }
  return env;
}

function textField(value: object, key: "stdout" | "stderr"): string {
  if (key === "stdout") {
    return "stdout" in value && typeof value.stdout === "string"
      ? value.stdout
      : "";
  }
  return "stderr" in value && typeof value.stderr === "string"
    ? value.stderr
    : "";
}

function commandOutput(result: unknown): { stdout: string; stderr: string } {
  if (typeof result === "string") return { stdout: result, stderr: "" };
  if (typeof result !== "object" || result === null) {
    return { stdout: "", stderr: "" };
  }
  return {
    stdout: textField(result, "stdout"),
    stderr: textField(result, "stderr"),
  };
}

function readExecFailure(error: unknown): {
  code: unknown;
  stdout: string;
  stderr: string;
} {
  const output = commandOutput(error);
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return { code: undefined, ...output };
  }
  return { code: error.code, ...output };
}

async function runNodeProject(
  cwd: string,
  args: readonly string[],
): Promise<{ code: unknown; stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(process.execPath, [...args], {
      cwd,
      encoding: "utf8",
      env: envWithoutVitest(),
      timeout: 50_000,
    });
    return { code: 0, ...commandOutput(result) };
  } catch (error: unknown) {
    return readExecFailure(error);
  }
}

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
        const result = await runNodeProject(resolve(root, cwd), args);
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
