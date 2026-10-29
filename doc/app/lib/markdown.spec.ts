import { expect, test } from "vitest";
import { mapOutsideFences, readableMarkdown, titledMarkdown } from "./markdown";
test("LLM text keeps visible code and converts type tables into readable API text", () => {
  const input =
    '<Tabs items={["Bun"]}>\n<Tab value="Bun">\n\n```tsx\nconst view = <Button />\n```\n</Tab>\n</Tabs>\n<TypeTable type={{"count":{"type":"number","required":true},"note":{"type":"string","required":false}}} />';
  const result = readableMarkdown(input, "en-US");
  expect(result).toContain("### Bun");
  expect(result).toContain("const view = <Button />");
  expect(result).toContain("| count | `number` | required |");
  expect(result).toContain("| note | `string` | optional |");
  expect(result).not.toContain("type={{");
});
test("API catalog has a readable static Markdown representation and unknown components fail", () => {
  expect(readableMarkdown("<ApiIndex />", "en-US")).toContain(
    "[createClient](/api/core/createclient)",
  );
  expect(() => readableMarkdown("<Unknown />", "en-US")).toThrow("Unknown");
});
test("inline generic type signatures are code, not MDX components", () => {
  const text = "`FaultClass<FaultCode>` remains a generic type.";
  expect(readableMarkdown(text, "en-US")).toBe(text);
  expect(readableMarkdown("HttpStatusFault\\<TErr>", "en-US")).toBe(
    "HttpStatusFault\\<TErr>",
  );
});
test("LLM headings drop Fumadocs id syntax and pages carry a single H1", () => {
  const body =
    "# Real title [#real-title]\n\n## Step 1 [#step-1]\n\n```bash\n# comment [#kept]\n```";
  const readable = readableMarkdown(body, "en-US");
  expect(readable).toBe(
    "# Real title\n\n## Step 1\n\n```bash\n# comment [#kept]\n```",
  );
  expect(titledMarkdown("Nav title", "https://x.test/a", readable)).toBe(
    "# Real title (https://x.test/a)\n\n## Step 1\n\n```bash\n# comment [#kept]\n```",
  );
  expect(
    titledMarkdown("Nav title", "https://x.test/a", "## Only section"),
  ).toBe("# Nav title (https://x.test/a)\n\n## Only section");
});

import {
  absoluteMarkdownLinks,
  llmsIndexMarkdown,
  llmsMarkdownSlugs,
} from "./llms";
test("llms markdown paths keep only a content.md suffix", () => {
  expect(llmsMarkdownSlugs("docs/start/content.md")).toEqual(["docs", "start"]);
  expect(llmsMarkdownSlugs("content.md")).toEqual([]);
  expect(llmsMarkdownSlugs("docs/start/anything")).toBeUndefined();
  expect(llmsMarkdownSlugs("anything")).toBeUndefined();
  expect(llmsMarkdownSlugs(undefined)).toBeUndefined();
});
test("LLM index links expose actual per-page Markdown paths on the configured origin", () => {
  const index = llmsIndexMarkdown(
    "- [Home](/)\n- [Start](/docs/start)\n- [External](https://example.com)",
    "https://docs.example.test",
  );
  expect(index).toContain("https://docs.example.test/llms.mdx/content.md");
  expect(index).toContain(
    "https://docs.example.test/llms.mdx/docs/start/content.md",
  );
  expect(index).toContain("[External](https://example.com)");
  expect(
    absoluteMarkdownLinks(
      "[Client](/api/core/client-type)",
      "https://docs.example.test",
    ),
  ).toBe("[Client](https://docs.example.test/api/core/client-type)");
});
test("absolute LLM links do not rewrite visible fenced or inline code", () => {
  const code =
    '```ts\nconst text = "[Client](/api/client)"\n```\n`[Client](/api/client)`';
  expect(absoluteMarkdownLinks(code, "https://docs.example.test")).toBe(code);
});
test("fenced code of any marker length is skipped and converted lines are restored in order", () => {
  const text = "a\n````md\n```\nb\n````\n~~~\nc\n~~~\nd";
  expect(mapOutsideFences(text, (line) => line.toUpperCase())).toBe(
    "A\n````md\n```\nb\n````\n~~~\nc\n~~~\nD",
  );
});
