import { expect, test } from "vitest";
import { loadExample } from "./api-examples";
import { tabItems } from "../app/lib/tab-items";
import { tabLayoutIssues, tabStructureIssues } from "./tab-layout";

const docRoot = `${import.meta.dirname}/..`;

async function readInclude(reference: string): Promise<string> {
  return (
    await loadExample(docRoot, reference, async (path) =>
      (await Bun.file(path).text())
        .replaceAll("<!-- #region", "// #region")
        .replaceAll("<!-- #endregion", "// #endregion"),
    )
  ).code;
}

/** Builds a group from `[label, body]` pairs; labels live in `items` only. */
function tabs(...entries: [label: string, body: string][]): string {
  return `<Tabs items={${JSON.stringify(entries.map(([label]) => label))}}>${entries
    .map(([, body]) => `<Tab>${body}</Tab>`)
    .join("\n")}</Tabs>`;
}

test("displayed layouts resolve included and inline imports within their own group", async () => {
  const markdown = tabs(
    ["sdk/health.ts", "<include>health</include>"],
    ["app/main.ts", "<include>app</include>"],
    [
      "app/View.vue",
      "```vue\n<script setup lang=\"ts\">import '../sdk/health.js';</script><template />\n```",
    ],
    [
      "app/index.ts",
      `\`\`\`ts
export * from '../sdk/health';
import type { Health } from '../sdk/health.ts';
export type { Health } from '../sdk/health.ts';
const note = \`import './not-a-module'\`;
void import('../sdk/health.ts');
import './lib';
import './empty';
import './view.jsx';
// import './not-a-module';
\`\`\``,
    ],
    ["app/lib/index.ts", "<include>empty</include>"],
    ["app/view.tsx", "<include>empty</include>"],
    ["package.json", "```json\n{}\n```"],
    ["Explanation", "<include>not-read</include>"],
    ["app/empty.ts", ""],
    ["", "<include>not-read</include>"],
  );
  const read = (reference: string) => {
    if (reference === "health")
      return Promise.resolve("export const health = true;");
    if (reference === "app")
      return Promise.resolve(
        'import "../sdk/health.ts"; import "@defjs/core";',
      );
    expect(reference).toBe("empty");
    return Promise.resolve("");
  };
  expect(await tabLayoutIssues(markdown, read)).toEqual([]);
  expect(await tabLayoutIssues("<Tabs></Tabs>", read)).toEqual([]);
  expect(
    await tabLayoutIssues(
      '<Tabs items={["a.ts"]}><Tab>x</Tab><Tab>y</Tab></Tabs>',
      read,
    ),
  ).toEqual([]);
});

test("a file in another group cannot hide a missing displayed dependency", async () => {
  const markdown = `${tabs(["app/main.ts", "<include>app</include>"])}
${tabs(["app/get-health.ts", "<include>health</include>"])}`;
  expect(
    await tabLayoutIssues(markdown, (reference) =>
      Promise.resolve(reference === "app" ? 'import "./get-health.ts";' : ""),
    ),
  ).toEqual([
    "app/main.ts: ./get-health.ts has no labelled file in this Tabs group",
  ]);
});

test("Tab labels come from items alone", () => {
  expect(tabItems('<Tabs items={["a", "b c"]}>')).toEqual(["a", "b c"]);
  expect(tabItems("<Tabs>")).toBeUndefined();
  expect(tabItems("<Tabs items={[a]}>")).toBeUndefined();
  expect(tabItems("<Tabs items={[1]}>")).toBeUndefined();
});

test("tab structure guard rejects a Tab value, a count mismatch and unreadable items", () => {
  expect(tabStructureIssues(tabs(["a", "x"], ["b", "y"]))).toEqual([]);
  expect(tabStructureIssues("no tabs here")).toEqual([]);
  expect(
    tabStructureIssues(
      '<Tabs items={["Switch"]}>\n<Tab value="Switch">\nx\n</Tab>\n</Tabs>',
    ),
  ).toEqual([
    '<Tabs items={["Switch"]}>: <Tab value="Switch"> must be <Tab>; labels come from items',
  ]);
  expect(
    tabStructureIssues('<Tabs items={["a", "b"]}><Tab>x</Tab></Tabs>'),
  ).toEqual(['<Tabs items={["a", "b"]}>: 1 <Tab> children for 2 items']);
  expect(tabStructureIssues("<Tabs><Tab>x</Tab></Tabs>")).toEqual([
    "<Tabs>: items must be a literal array of strings",
  ]);
});

test("English path-labelled Tabs resolve relative imports", async () => {
  const issues: string[] = [];
  for await (const page of new Bun.Glob("**/*.mdx").scan(
    `${docRoot}/content/en-US`,
  )) {
    for (const issue of await tabLayoutIssues(
      await Bun.file(`${docRoot}/content/en-US/${page}`).text(),
      readInclude,
    )) {
      issues.push(`${page}: ${issue}`);
    }
  }
  expect(issues).toEqual([]);
});

test("every Tab in every locale is matched to its trigger by position", async () => {
  const issues: string[] = [];
  for await (const page of new Bun.Glob("**/*.{md,mdx}").scan(
    `${docRoot}/content`,
  )) {
    const text = await Bun.file(`${docRoot}/content/${page}`).text();
    for (const issue of tabStructureIssues(text))
      issues.push(`${page}: ${issue}`);
  }
  expect(issues).toEqual([]);
});

test("path-labelled Tabs resolve relative imports in every locale", async () => {
  const issues: string[] = [];
  for await (const page of new Bun.Glob("**/*.mdx").scan(
    `${docRoot}/content`,
  )) {
    const text = await Bun.file(`${docRoot}/content/${page}`).text();
    for (const issue of await tabLayoutIssues(text, readInclude))
      issues.push(`${page}: ${issue}`);
  }
  expect(issues).toEqual([]);
});
