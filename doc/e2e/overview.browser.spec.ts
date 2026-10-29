import { expect, test } from "vitest";
import reference from "../app/data/api-reference.json";
import { locales } from "../app/lib/i18n";
import { openSite } from "./support/site";

const guideArticles = [
  "/docs/start",
  "/docs/struct",
  "/docs/commands",
  "/docs/client",
  "/docs/http",
  "/docs/sse",
  "/docs/web-socket",
  "/docs/errors",
  "/docs/interceptors",
  "/docs/integrations",
  "/docs/integrations/react",
  "/docs/integrations/vue",
  "/docs/integrations/opentelemetry-server",
  "/docs/design-decisions",
];
const recipeArticles = [
  "/recipes/post-json",
  "/recipes/get-declared-404",
  "/recipes/cancel-http",
  "/recipes/etag-revalidate",
  "/recipes/graphql-http-envelope",
  "/recipes/refresh-bearer-once",
  "/recipes/consume-sse",
  "/recipes/websocket-session",
  "/recipes/test-with-handle",
  "/recipes/publish-http-sdk",
];

function catalogSignature(names: readonly string[]): string {
  return names
    .map((name) => {
      const signatures = reference.find(
        (entry) => entry.name === name,
      )?.signatures;
      if (!signatures?.length) throw new Error(`missing signature ${name}`);
      return signatures.map((signature) => signature.trim()).join("\n");
    })
    .join("\n\n");
}

function expectGroupedArticles(
  markdown: string,
  prefix: string,
  paths: readonly string[],
  groups: number,
): void {
  expect((markdown.match(/^## /gm) ?? []).length).toBe(groups);
  for (const path of paths) {
    expect(markdown).toContain(`](${prefix}${path})`);
  }
}

test("grouped overview articles stay visible and clickable in every language", async () => {
  const site = await openSite();
  await using context = await site.browser.newContext({
    javaScriptEnabled: false,
  });
  const page = await context.newPage();
  for (const locale of locales) {
    const prefix = locale === "en-US" ? "" : `/${locale}`;
    for (const [area, paths, groups] of [
      ["docs", guideArticles, 5],
      ["recipes", recipeArticles, 4],
    ] as const) {
      await page.goto(site.url(`${prefix}/${area}`), {
        waitUntil: "networkidle",
      });
      const prose = page.locator("#nd-page div.prose");
      expect(await prose.locator("h2").count()).toBe(groups);
      for (let index = 0; index < groups; index += 1) {
        expect(await prose.locator("h2").nth(index).isVisible()).toBe(true);
      }
      for (const path of paths) {
        const link = prose.locator(`a[href="${prefix}${path}"]`);
        expect(await link.count()).toBeGreaterThan(0);
        await link.first().click({ trial: true });
      }
      const destination = `${prefix}${paths[0]}`;
      await prose.locator(`a[href="${destination}"]`).first().click();
      await page.waitForURL(site.url(destination));
      expect(await page.locator("main h1").first().isVisible()).toBe(true);
    }
  }
});

test("grouped overview articles export as Markdown", async () => {
  const site = await openSite();
  const page = await site.browser.newPage();
  for (const [area, paths, groups] of [
    ["docs", guideArticles, 5],
    ["recipes", recipeArticles, 4],
  ] as const) {
    const exported = await page.request.get(
      site.url(`/llms.mdx/${area}/content.md`),
    );
    expect(await exported.status()).toBe(200);
    expect(await exported.headers()).toMatchObject({
      "content-type": expect.stringContaining("text/markdown"),
    });
    expectGroupedArticles(await exported.text(), "", paths, groups);
  }
  for (const [path, names] of [
    ["/llms.mdx/api/http/content.md", ["defineRequest"]],
    [
      "/llms.mdx/api/interceptors/content.md",
      ["createHttpInterceptor", "InterceptorFn", "HttpInterceptorNext"],
    ],
  ] as const) {
    const exported = await page.request.get(site.url(path));
    expect(await exported.status()).toBe(200);
    expect(await exported.headers()).toMatchObject({
      "content-type": expect.stringContaining("text/markdown"),
    });
    expect(await exported.text()).toContain(
      "```ts\n" + catalogSignature(names) + "\n```",
    );
  }
});
