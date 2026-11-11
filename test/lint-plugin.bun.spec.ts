import { expect, test } from "vitest";

const plugin = `${import.meta.dirname}/../lint/plugin.ts`;
const oxlint = `${import.meta.dirname}/../node_modules/oxlint/bin/oxlint`;

// The default reporter is meant for people, so this reads the JSON reporter instead.
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
declare global { var runtimeKind: unknown; }
let reads = 0;
Object.defineProperty(globalThis, "runtimeKind", { get: () => ++reads === 1 ? 1 : "ready" });
export function globalAccessor() {
  return typeof runtimeKind !== "string" && typeof runtimeKind !== "number";
}
export function memberAccessor(value: { readonly current: unknown }) {
  return typeof value.current !== "string" && typeof value.current !== "number";
}
declare const ambientKind: unknown;
export function ambientAccessor() {
  return typeof ambientKind !== "string" && typeof ambientKind !== "number";
}
`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function lintDiagnostics(report: unknown): Record<string, unknown>[] {
  if (!isRecord(report) || !Array.isArray(report["diagnostics"])) {
    throw new TypeError("expected a lint report");
  }
  return report["diagnostics"].filter(isRecord);
}

function firstLine(diagnostic: Record<string, unknown>): unknown {
  const { labels } = diagnostic;
  if (!Array.isArray(labels) || !isRecord(labels[0])) return undefined;
  const { span } = labels[0];
  return isRecord(span) ? span["line"] : undefined;
}

test(
  "prefer-typeof-switch reports a stable subject chain and nothing else",
  { timeout: 30_000 },
  async () => {
    const dir = `${Bun.env["TMPDIR"] ?? "/tmp"}/defjs-lint-${crypto.randomUUID()}`;
    await Bun.write(
      `${dir}/oxlintrc.json`,
      JSON.stringify({
        jsPlugins: [plugin],
        categories: { correctness: "off" },
        rules: { "defjs/prefer-typeof-switch": "error" },
      }),
    );
    await Bun.write(`${dir}/a.ts`, source);
    const run = Bun.spawn(
      ["bun", oxlint, "--config", "oxlintrc.json", "--format", "json", "a.ts"],
      { cwd: dir, stdout: "pipe", stderr: "pipe" },
    );
    const stdout = await new Response(run.stdout).text();
    expect(await run.exited).toBe(1);

    const report: unknown = JSON.parse(stdout);
    const diagnostics = lintDiagnostics(report);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.["code"]).toBe("defjs(prefer-typeof-switch)");
    expect(firstLine(diagnostics[0] ?? {})).toBe(3);
  },
);
