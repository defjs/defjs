import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const plugin = join(import.meta.dir, "..", "lint", "plugin.ts");

const source = `declare function next(): unknown;
export function chain(x: unknown) {
  if (typeof x !== "string" && typeof x !== "number") throw new TypeError("x");
}
export function effectful() {
  if (typeof next() !== "string" && typeof next() !== "number") throw new TypeError("x");
}
export function positive(x: unknown) {
  return typeof x === "string" || typeof x === "number";
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
  await run.exited;
  const lines = [...output.matchAll(/rule="defjs\/prefer-typeof-switch"/g)];
  expect(lines).toHaveLength(1);
  expect(output).toContain('line="3"');
});
