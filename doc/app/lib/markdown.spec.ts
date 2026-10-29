import { expect, test } from "vitest";
import { readExampleRegion } from "../../scripts/api-examples";
import { mapOutsideFences, readableMarkdown } from "./markdown";
import { llmsMarkdownSlugs } from "./llms";

test("processed Markdown keeps visible code and converts type tables into readable API text", () => {
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
test("readable Markdown drops Fumadocs heading ID syntax outside code", () => {
  const body =
    "# Real title [#real-title]\n\n## Step 1 [#step-1]\n\n```bash\n# comment [#kept]\n```";
  expect(readableMarkdown(body, "en-US")).toBe(
    "# Real title\n\n## Step 1\n\n```bash\n# comment [#kept]\n```",
  );
});
test("llms markdown paths keep only a content.md suffix", () => {
  expect(llmsMarkdownSlugs("docs/start/content.md")).toEqual(["docs", "start"]);
  expect(llmsMarkdownSlugs("content.md")).toEqual([]);
  expect(llmsMarkdownSlugs("docs/start/anything")).toBeUndefined();
  expect(llmsMarkdownSlugs("anything")).toBeUndefined();
  expect(llmsMarkdownSlugs(undefined)).toBeUndefined();
});
test("README matches the typechecked minimal HTTP example", async () => {
  const source = await Bun.file(
    new URL("../../examples/http/basic-setup.ts", import.meta.url),
  ).text();
  const readme = await Bun.file(
    new URL("../../../README.md", import.meta.url),
  ).text();
  const example = readExampleRegion(source, "example");
  expect(readme).toContain(`\`\`\`ts\n${example}\n\`\`\``);
});
test("fenced code of any marker length is skipped and converted lines are restored in order", () => {
  const text = "a\n````md\n```\nb\n````\n~~~\nc\n~~~\nd";
  expect(mapOutsideFences(text, (line) => line.toUpperCase())).toBe(
    "A\n````md\n```\nb\n````\n~~~\nc\n~~~\nD",
  );
});
