import { expect, test } from "vitest";
import {
  getContentRoute,
  assertUniqueRoutes,
  collectPrerenderPaths,
  apiEntryContentPaths,
  mergeContentPaths,
} from "./routes";
import { locales } from "./i18n";

test("locale directories map to static root URLs for Markdown and MDX", () => {
  expect(getContentRoute("en-US/index.md").url).toBe("/");
  expect(getContentRoute("zh-Hans/docs/start.mdx").url).toBe(
    "/zh-Hans/docs/start",
  );
  expect(getContentRoute("ar/docs/start.md").url).toBe("/ar/docs/start");
});
test("unknown locales and duplicate static URLs fail before building", () => {
  expect(() => getContentRoute("unknown/docs/start.md")).toThrow("locale");
  expect(() =>
    assertUniqueRoutes(["en-US/docs/start.md", "en-US/docs/start.mdx"]),
  ).toThrow("Duplicate");
});
test("a content file that shadows a generated entry fails before prerender", () => {
  expect(() =>
    mergeContentPaths(
      ["en-US/api/core/createclient.mdx"],
      apiEntryContentPaths(["core/createclient"], ["en-US"]),
    ),
  ).toThrow(
    "Content file shadows a generated API entry: en-US/api/core/createclient.mdx",
  );
  expect(
    mergeContentPaths(
      ["en-US/api/client.mdx"],
      apiEntryContentPaths(["core/createclient"], ["zh-Hans"]),
    ),
  ).toEqual(["en-US/api/client.mdx", "zh-Hans/api/core/createclient.mdx"]);
});
test("every locale prerenders its own search index", async () => {
  const paths = await collectPrerenderPaths();
  for (const locale of locales)
    expect(paths).toContain(`/api/search/${locale}.json`);
  expect(paths).not.toContain("/api/search");
  expect(paths.filter((path) => path === "/api/core/createclient")).toEqual([
    "/api/core/createclient",
  ]);
  expect(
    paths.filter((path) => path === "/zh-Hans/api/core/createclient"),
  ).toEqual(["/zh-Hans/api/core/createclient"]);
});
