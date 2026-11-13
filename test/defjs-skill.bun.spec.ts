import { expect, test } from "vitest";

const skillFile = new URL("../skills/defjs/SKILL.md", import.meta.url);
const coreExports = new Set([
  ...Object.keys(await import("../packages/core/src/index.ts")),
  ...Object.keys(await import("../packages/core/src/xsrf/index.ts")),
]);
// Names that start like a Core export but belong to the documented integrations or Vue itself.
const otherNames = new Set([
  "createApp",
  "createClientPlugin",
  "defineProps",
  "withOpenTelemetryServer",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

test("Defjs skill has valid metadata, routes the 4 task references, and links English official docs", async () => {
  const text = await Bun.file(skillFile).text();
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!match?.[1]) throw new Error("SKILL.md requires YAML frontmatter");
  const metadata: unknown = Bun.YAML.parse(match[1]);
  if (!isRecord(metadata)) throw new Error("Expected a YAML mapping");
  expect(metadata["name"]).toBe("defjs");
  const description = metadata["description"];
  if (typeof description !== "string") throw new Error("Expected description");
  expect(description.startsWith("Use when ")).toBe(true);
  expect(description.length).toBeLessThanOrEqual(1024);

  const routed = Array.from(
    new Set(
      Array.from(
        text.matchAll(/\]\((references\/[^)]+\.md)\)/g),
        (route) => route[1],
      ),
    ),
  ).sort();
  const references = await Array.fromAsync(
    new Bun.Glob("references/*.md").scan({
      cwd: Bun.fileURLToPath(new URL(".", skillFile)),
    }),
  );
  expect(routed).toEqual([
    "references/client-retry-interceptors.md",
    "references/http-and-struct.md",
    "references/integrations-and-testing.md",
    "references/realtime-sse-ws.md",
  ]);
  expect(routed).toEqual(references.sort());

  expect(text).toContain("https://defjs.lyz.cloud/llms.txt");
  expect(text).toContain("https://defjs.lyz.cloud/llms-full.txt");
  expect(text).toContain("https://defjs.lyz.cloud/llms.mdx/");
});

test("Defjs skill and reference files have clean Markdown, no locale slugs, and valid Core exports", async () => {
  const directory = new URL("references/", skillFile);
  const files = [
    skillFile,
    ...(await Array.fromAsync(
      new Bun.Glob("*.md").scan(Bun.fileURLToPath(directory)),
      (name) => new URL(name, directory),
    )),
  ];
  for (const file of files) {
    const text = await Bun.file(file).text();
    expect(text, `${file.pathname} contains MDX <Tabs>/<Tab>`).not.toMatch(
      /<\/?Tabs?\b/,
    );
    expect(text, `${file.pathname} contains heading anchor [#...]`).not.toMatch(
      /\[#[a-z0-9-]+\]/,
    );
    expect(
      text,
      `${file.pathname} contains locale-prefixed official doc URL`,
    ).not.toMatch(
      /https:\/\/defjs\.lyz\.cloud\/(?:en-US|zh-Hans|zh-Hant-TW|zh-Hant-HK|ja-JP|ko-KR|de-DE|fr-FR|es-ES|ru-RU|ar)(?:\/|$)/,
    );

    for (const slugMatch of text.matchAll(
      /\b((?:docs|recipes|api)\/[a-z0-9-]+(?:\/[a-z0-9-]+)*?)(?:\/content\.md\b|(?![a-z0-9/-]))/g,
    )) {
      const slug = slugMatch[1];
      if (!slug) continue;
      const md = new URL(`../doc/content/en-US/${slug}.md`, import.meta.url);
      const mdx = new URL(`../doc/content/en-US/${slug}.mdx`, import.meta.url);
      expect(
        (await Bun.file(md).exists()) || (await Bun.file(mdx).exists()),
        `${file.pathname}: doc slug "${slug}" does not exist in doc/content/en-US/`,
      ).toBe(true);
    }

    const code = Array.from(
      text.matchAll(/```[^\n]*\n([\s\S]*?)```|`([^`\n]+)`/g),
      (match) => match[1] ?? match[2] ?? "",
    ).join("\n");
    for (const match of code.matchAll(
      /\b(?:with|define|create)[A-Z][A-Za-z0-9_]*/g,
    )) {
      const name = match[0];
      if (otherNames.has(name)) continue;
      expect(
        coreExports.has(name),
        `${file.pathname}: ${name} is not a public Core export`,
      ).toBe(true);
    }
  }
});
