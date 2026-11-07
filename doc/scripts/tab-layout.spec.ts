import { expect, test } from "vitest";
import { loadExample } from "./api-examples";
import { tabLayoutIssues } from "./tab-layout";

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

function group(body: string): string {
  return `<Tabs items={["sdk/health.ts", "app/main.ts"]}>${body}</Tabs>`;
}

test("displayed layouts resolve included and inline imports within their own group", async () => {
  const markdown = group(`
<Tab value="sdk/health.ts"><include>health</include></Tab>
<Tab value="app/main.ts"><include>app</include></Tab>
<Tab value="app/View.vue">\`\`\`vue
<script setup lang="ts">import '../sdk/health.js';</script><template />
\`\`\`</Tab>
<Tab value="app/index.ts">\`\`\`ts
export * from '../sdk/health';
import type { Health } from '../sdk/health.ts';
export type { Health } from '../sdk/health.ts';
const note = \`import './not-a-module'\`;
void import('../sdk/health.ts');
import './lib';
import './empty';
import './view.jsx';
// import './not-a-module';
\`\`\`</Tab>
<Tab value="app/lib/index.ts"><include>empty</include></Tab>
<Tab value="app/view.tsx"><include>empty</include></Tab>
<Tab value="package.json">\`\`\`json
{}
\`\`\`</Tab>
<Tab value="Explanation"><include>not-read</include></Tab>
<Tab value="app/empty.ts"></Tab>
<Tab value=""><include>not-read</include></Tab>`);
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
});

test("a file in another group cannot hide a missing displayed dependency", async () => {
  const markdown = `${group('<Tab value="app/main.ts"><include>app</include></Tab>')}
${group('<Tab value="app/get-health.ts"><include>health</include></Tab>')}`;
  expect(
    await tabLayoutIssues(markdown, (reference) =>
      Promise.resolve(reference === "app" ? 'import "./get-health.ts";' : ""),
    ),
  ).toEqual([
    "app/main.ts: ./get-health.ts has no labelled file in this Tabs group",
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
