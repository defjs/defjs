import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { StaticNavigation } from "./navigation";
import { expect, test } from "vitest";
import { loader, type VirtualFile } from "fumadocs-core/source";
import {
  flattenTree,
  findPath,
  findNeighbour,
  type Folder,
} from "fumadocs-core/page-tree";
import { isLayoutTabActive } from "fumadocs-ui/layouts/shared";
import {
  getNavigationTree,
  getNavigationTabs,
  getRelatedNavigation,
} from "../lib/navigation";
import { i18n, localePrefix, locales } from "../lib/i18n";
import { apiVirtualFiles } from "../lib/api-virtual";
import summaries from "../data/api-summaries.json";

const files: VirtualFile[] = [];
for await (const path of new Bun.Glob("**/*.{md,mdx,json}").scan(
  new URL("../../content/", import.meta.url).pathname,
)) {
  const text = await Bun.file(
    new URL(`../../content/${path}`, import.meta.url),
  ).text();
  files.push(
    path.endsWith(".json")
      ? { type: "meta", path, data: JSON.parse(text) }
      : {
          type: "page",
          path,
          data: {
            title:
              /^title:\s*(.+)$/m.exec(text)?.[1]?.replace(/^['"]|['"]$/g, "") ??
              path,
          },
        },
  );
}
const existingPages = new Set(
  files.filter((file) => file.type === "page").map((file) => file.path),
);
files.push(
  ...apiVirtualFiles(summaries, locales, existingPages, async () => ""),
);
const source = loader({ source: { files }, baseUrl: "/", i18n });

const guidePaths = [
  "",
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
const recipePaths = [
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

test("actual eleven-language content trees preserve every unique URL and page reference in grouped reading order", () => {
  for (const locale of locales) {
    const prefix = locale === "en-US" ? "" : `/${locale}`;
    const original = source.getPageTree(locale);
    const snapshot = JSON.stringify(original);
    const tree = getNavigationTree(original, locale);
    const pages = flattenTree(tree.children);
    expect(pages.map((p) => p.url).sort()).toEqual(
      source
        .getPages(locale)
        .map((p) => p.url)
        .sort(),
    );
    expect(new Set(pages.map((p) => p.url)).size).toBe(208);
    for (const page of pages) {
      expect(source.getPageByUrl(page.url, locale)?.path).toBe(
        `${locale}/${page.$ref}`,
      );
      expect(
        findPath(tree.children, (node) => node === page)?.filter(
          (node) => node.type === "page",
        ).length,
      ).toBe(1);
    }
    const areas = tree.children as Folder[];
    const guide = areas[0];
    const recipes = areas[1];
    if (!guide || !recipes)
      throw new Error("Missing guide or example reading area");
    expect(
      guide.children.filter((n) => n.type === "separator" && n.name).length,
    ).toBe(5);
    expect(
      recipes.children.filter((n) => n.type === "separator" && n.name).length,
    ).toBe(4);
    expect(flattenTree(guide.children).map((n) => n.url)).toEqual([
      `${prefix}/docs`,
      ...guidePaths.map((path) => prefix + path || "/"),
    ]);
    expect(flattenTree(recipes.children).map((n) => n.url)).toEqual([
      `${prefix}/recipes`,
      ...recipePaths.map((path) => prefix + path),
    ]);
    const tabs = getNavigationTabs(tree);
    expect(tabs.map((tab) => tab.url)).toEqual(
      ["docs", "recipes", "api"].map((area) => `${prefix}/${area}`),
    );
    for (const page of pages)
      expect(
        tabs.filter((tab) => isLayoutTabActive(tab, page.url)).length,
      ).toBe(1);
    expect(JSON.stringify(original)).toBe(snapshot);
  }
});

test("reading-area and chapter labels come from page frontmatter, except the guide home and API index overrides", () => {
  for (const locale of locales) {
    const prefix = locale === "en-US" ? "" : `/${locale}`;
    const tree = getNavigationTree(source.getPageTree(locale), locale);
    for (const [i, area] of ["docs", "recipes", "api"].entries())
      expect(tree.children[i]?.name).toBe(
        source.getPageByUrl(`${prefix}/${area}`, locale)?.data.title,
      );
    for (const page of flattenTree(tree.children))
      if (page.url !== (prefix || "/") && page.url !== `${prefix}/api`)
        expect(page.name).toBe(
          source.getPageByUrl(page.url, locale)?.data.title,
        );
  }
});

test("simplified Chinese navigation names describe tasks instead of repeating raw directory names", () => {
  const tree = getNavigationTree(source.getPageTree("zh-Hans"), "zh-Hans");
  expect(tree.children.map((n) => n.name)).toEqual([
    "指南",
    "操作示例",
    "API 参考",
  ]);
  const guide = tree.children[0] as Folder;
  expect(
    guide.children
      .filter((n) => n.type === "separator" && n.name)
      .map((n) => n.name),
  ).toEqual(["SDK 开发", "契约与执行", "请求与实时通信", "错误与拦截", "插件"]);
  expect(
    flattenTree(guide.children)
      .slice(1, 6)
      .map((n) => n.name),
  ).toEqual([
    "项目概览",
    "快速开始",
    "数据契约 / Struct",
    "定义与执行 / Command",
    "客户端配置 / Client",
  ]);
});

test("static guide and example overviews expose all grouped articles to readers, search and Markdown export", async () => {
  for (const locale of locales) {
    for (const [area, paths, groups] of [
      ["docs", guidePaths.slice(1), 5],
      ["recipes", recipePaths, 4],
    ] as const) {
      const text = await Bun.file(
        new URL(`../../content/${locale}/${area}/index.md`, import.meta.url),
      ).text();
      expect((text.match(/^## /gm) ?? []).length).toBe(groups);
      for (const path of paths)
        expect(text).toContain(`](${localePrefix(locale)}${path})`);
    }
  }
});

test("SSR mobile directory resolves a trailing-slash article from the same navigation tree", () => {
  const tree = getNavigationTree(source.getPageTree("zh-Hans"), "zh-Hans");
  const html = renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: ["/zh-Hans/docs/http/"] },
      createElement(StaticNavigation, { tree, locale: "zh-Hans" }),
    ),
  );
  expect(html).toContain('href="/zh-Hans/docs/start"');
  expect(html).toContain('href="/zh-Hans/docs/http" aria-current="page"');
});

test("design decisions stand outside the framework group and native previous/next follows the reading order", () => {
  for (const locale of locales) {
    const prefix = locale === "en-US" ? "" : `/${locale}`;
    const tree = getNavigationTree(source.getPageTree(locale), locale);
    const path = findPath(
      tree.children,
      (node) =>
        node.type === "page" && node.url === `${prefix}/docs/design-decisions`,
    );
    expect(
      path?.filter((node) => node.type === "separator" && node.name).length,
    ).toBe(0);
    expect(findNeighbour(tree, `${prefix}/docs/start`).previous?.url).toBe(
      prefix || "/",
    );
    expect(findNeighbour(tree, `${prefix}/docs/start`).next?.url).toBe(
      `${prefix}/docs/struct`,
    );
    expect(
      findNeighbour(tree, `${prefix}/docs/integrations`).previous?.url,
    ).toBe(`${prefix}/docs/interceptors`);
    expect(
      findNeighbour(tree, `${prefix}/docs/integrations/react`).previous?.url,
    ).toBe(`${prefix}/docs/integrations`);
    expect(findNeighbour(tree, `${prefix}/recipes/post-json`).next?.url).toBe(
      `${prefix}/recipes/get-declared-404`,
    );
  }
});

test("related reading resolves real localized articles and preserves every API destination", () => {
  for (const locale of locales) {
    const prefix = locale === "en-US" ? "" : `/${locale}`;
    const tree = getNavigationTree(source.getPageTree(locale), locale);
    for (const page of flattenTree(tree.children)) {
      const groups = getRelatedNavigation(tree, locale, page.url);
      const related = flattenTree(groups);
      expect(related.some((item) => item.url === page.url)).toBe(false);
      expect(new Set(related.map((item) => item.url)).size).toBe(
        related.length,
      );
      for (const item of related)
        expect(source.getPageByUrl(item.url, locale)).toBeDefined();
    }
    const http = flattenTree(
      getRelatedNavigation(tree, locale, `${prefix}/docs/http`),
    ).map((item) => item.url);
    for (const path of [
      "/api/http",
      "/recipes/post-json",
      "/recipes/publish-http-sdk",
    ])
      expect(http).toContain(prefix + path);
    const command = flattenTree(
      getRelatedNavigation(tree, locale, `${prefix}/docs/commands`),
    ).filter((item) => item.url.startsWith(`${prefix}/api/`));
    expect(command.map((item) => item.url).sort()).toEqual(
      ["/api/client", "/api/http", "/api/sse", "/api/web-socket"]
        .map((path) => prefix + path)
        .sort(),
    );
  }
});

test("navigation rejects a page that the reading areas would drop", () => {
  const tree = structuredClone(source.getPageTree("en-US"));
  const docs = tree.children.find(
    (node): node is Folder =>
      node.type === "folder" &&
      flattenTree(node.children).some((page) => page.url === "/docs/start"),
  );
  if (!docs) throw new Error("The guide folder is missing");
  docs.children.push({ type: "page", name: "Extra", url: "/docs/extra" });
  expect(() => getNavigationTree(tree, "en-US")).toThrow(
    "Navigation dropped or duplicated content: en-US",
  );
});

test("related reading rejects a destination that has no page", () => {
  expect(() =>
    getRelatedNavigation({ name: "Docs", children: [] }, "en-US", "/docs/http"),
  ).toThrow("Missing related navigation page: /docs/start");
});

test("navigation rejects a tree without the reading areas", () => {
  expect(() =>
    getNavigationTree({ name: "Docs", children: [] }, "en-US"),
  ).toThrow("Missing reading area: /docs");
});

test("navigation rejects a reading area that lacks a grouped chapter", () => {
  const area: Folder = {
    type: "folder",
    name: "Guide",
    children: [{ type: "page", name: "Guide", url: "/docs" }],
  };
  expect(() =>
    getNavigationTree({ name: "Docs", children: [area] }, "en-US"),
  ).toThrow("Missing navigation page: /");
});

test("navigation tabs reject a reading area without any page", () => {
  expect(() =>
    getNavigationTabs({
      name: "Docs",
      children: [{ type: "folder", name: "Empty", children: [] }],
    }),
  ).toThrow("Reading area has no index page");
});
