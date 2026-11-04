import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const plugin = join(import.meta.dir, "..", "lint", "plugin.ts");

// `bun lint` prints XML-ish diagnostics on macOS and a human-readable block on
// Linux, so this test matches the rule name and the quoted subject, never a format.
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

test("prefer-typeof-switch reports a stable subject chain and nothing else", async () => {
  const dir = mkdtempSync(join(tmpdir(), "defjs-lint-"));
  writeFileSync(
    join(dir, "bunfig.toml"),
    `[lint]\nplugins = ["${plugin}"]\n[lint.rules]\n"defjs/prefer-typeof-switch" = "error"\n`,
  );
  writeFileSync(join(dir, "a.ts"), source);
  const run = Bun.spawn(["bun", "lint", "--no-script"], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = `${await new Response(run.stdout).text()}${await new Response(run.stderr).text()}`;
  const exitCode = await run.exited;

  expect(exitCode).toBe(1);
  expect(output.split("defjs/prefer-typeof-switch")).toHaveLength(2);
  expect(output).toContain("typeof x");
  expect(output).not.toContain("typeof next()");
  expect(output).not.toContain("typeof y");
});
