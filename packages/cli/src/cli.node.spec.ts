import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../../..");

describe("@defjs/cli (Node.js entrypoint)", () => {
  test("executes src/cli.ts directly under Node.js native type stripping", () => {
    const cliEntry = join(repoRoot, "packages/cli/src/cli.ts");
    const helpProc = spawnSync(process.execPath, [cliEntry], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(helpProc.status).toBe(0);
    expect(helpProc.stdout).toContain("USAGE");
    expect(helpProc.stdout).toContain("defjs openapi");

    const verProc = spawnSync(process.execPath, [cliEntry, "--version"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(verProc.status).toBe(0);
    expect(verProc.stdout.trim()).toBe("0.1.0");
  });
});
