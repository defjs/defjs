import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const plugin = join(import.meta.dir, "..", "lint", "plugin.ts");

// The pretty reporter differs per platform (XML-ish on macOS, a block of text on
// Linux), so this reads the JSON reporter instead.
const source = `declare function next(): unknown;
export function chain(x: unknown) {
  if (typeof x !== "string" && typeof x !== "number") throw new TypeError("x");
}
export function effectful() {
  if (typeof next() !== "string" && typeof next() !== "number") throw new TypeError("x");
}
export function positive(y: unknown) {
  return typeof y === "string" || typeof y === "number";
}
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function lintMessages(report: unknown): Record<string, unknown>[] {
  if (!Array.isArray(report)) throw new TypeError("expected a lint report");
  return report.flatMap((file) => {
    if (!isRecord(file) || !Array.isArray(file["messages"])) {
      throw new TypeError("expected a file result");
    }
    return file["messages"].filter(isRecord);
  });
}

test("prefer-typeof-switch reports a stable subject chain and nothing else", async () => {
  const dir = mkdtempSync(join(tmpdir(), "defjs-lint-"));
  writeFileSync(
    join(dir, "bunfig.toml"),
    `[lint]\nplugins = ["${plugin}"]\n[lint.rules]\n"defjs/prefer-typeof-switch" = "error"\n`,
  );
  writeFileSync(join(dir, "a.ts"), source);
  const run = Bun.spawn(["bun", "lint", "--no-script", "--format", "json"], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(run.stdout).text();
  expect(await run.exited).toBe(1);

  const report: unknown = JSON.parse(stdout);
  const messages = lintMessages(report);
  expect(messages).toHaveLength(1);
  expect(messages[0]?.["ruleId"]).toBe("defjs/prefer-typeof-switch");
  expect(messages[0]?.["line"]).toBe(3);
});
