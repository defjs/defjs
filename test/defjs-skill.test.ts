import { expect, test } from "bun:test";

const skillFile = new URL("../skills/defjs/SKILL.md", import.meta.url);
const coreExports = new Set(
  Object.keys(await import("../packages/core/src/index.ts")),
);
// These names belong to the explicitly documented integrations, not Core.
const integrationNames = new Set([
  "createApp",
  "defineProps",
  "createClientPlugin",
  "withOpenTelemetryServer",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

test("Defjs skill has valid metadata and existing reference routes", async () => {
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
  const references = new Set(
    Array.from(
      text.matchAll(/\]\((references\/[^)]+\.md)\)/g),
      (route) => route[1],
    ),
  );
  expect(references.size).toBeGreaterThan(0);
  for (const reference of references) {
    if (!reference) throw new Error("Expected reference path");
    expect(await Bun.file(new URL(reference, skillFile)).exists()).toBe(true);
  }
});

test("Defjs reference code names resolve to public Core exports", async () => {
  const glob = new Bun.Glob("*.md");
  const directory = new URL("../skills/defjs/references/", import.meta.url);
  for await (const path of glob.scan(directory.pathname)) {
    const text = await Bun.file(new URL(path, directory)).text();
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
        `${path}: ${name} is not a public Core export`,
      ).toBe(true);
    }
  }
});
