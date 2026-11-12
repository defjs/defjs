import { expect, test } from "vitest";

const skillFile = new URL("../skills/defjs/SKILL.md", import.meta.url);
const coreExports = new Set([
  ...Object.keys(await import("../packages/core/src/index.ts")),
  ...Object.keys(await import("../packages/core/src/xsrf/index.ts")),
]);
// These names belong to the explicitly documented integrations, not Core.
const integrationNames = new Set([
  "createClientPlugin",
  "withOpenTelemetryServer",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

test("Defjs skill has valid metadata and routes every generated reference", async () => {
  const text = await Bun.file(skillFile).text();
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!match?.[1]) throw new Error("SKILL.md requires YAML frontmatter");
  const metadata: unknown = Bun.YAML.parse(match[1]);
  if (!isRecord(metadata)) throw new Error("Expected a YAML mapping");
  expect(metadata["name"]).toBe("defjs");
  const description = metadata["description"];
  if (typeof description !== "string") throw new Error("Expected description");
  expect(description.length).toBeGreaterThan(0);
  expect(description.length).toBeLessThanOrEqual(1024);
  const routed = Array.from(
    text.matchAll(/\]\((references\/[^)]+\.md)\)/g),
    (route) => route[1],
  ).sort();
  const generated = await Array.fromAsync(
    new Bun.Glob("references/*.md").scan({
      cwd: Bun.fileURLToPath(new URL(".", skillFile)),
    }),
  );
  expect(routed).toEqual(generated.sort());
});

test("Defjs skill code names resolve to public Core exports", async () => {
  const text = await Bun.file(skillFile).text();
  const code = Array.from(
    text.matchAll(/```[^\n]*\n([\s\S]*?)```|`([^`\n]+)`/g),
    (match) => match[1] ?? match[2] ?? "",
  ).join("\n");
  for (const match of code.matchAll(
    /\b(?:with|define|create)[A-Z][A-Za-z0-9_]*/g,
  )) {
    const name = match[0];
    if (integrationNames.has(name)) continue;
    expect(
      coreExports.has(name),
      `SKILL.md: ${name} is not a public Core export`,
    ).toBe(true);
  }
});
