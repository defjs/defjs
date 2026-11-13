import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { StaticNavigation } from "./navigation";
import { TestI18nProvider } from "./test-i18n";
import { expect, test } from "vitest";
import { loader, type VirtualFile } from "fumadocs-core/source";
import {
  flattenTree,
  findPath,
  findNeighbour,
  type Folder,
  type Node,
} from "fumadocs-core/page-tree";
import { isLayoutTabActive } from "fumadocs-ui/layouts/shared";
import {
  getNavigationTree,
  getNavigationTabs,
  getRelatedNavigation,
} from "../lib/navigation";
import { getTranslator } from "../lib/translations";
import { i18n, locales } from "../lib/i18n";
import { apiVirtualFiles } from "../lib/api-virtual";
import { apiEntries } from "../data/api-catalog";

function metaData(value: unknown): {
  title?: string;
  root?: boolean | string;
  pages?: string[];
} {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("meta file is not an object");
  const data: { title?: string; root?: boolean | string; pages?: string[] } =
    {};
  if ("title" in value && typeof value.title === "string")
    data.title = value.title;
  if (
    "root" in value &&
    (typeof value.root === "boolean" || typeof value.root === "string")
  )
    data.root = value.root;
  if ("pages" in value && Array.isArray(value.pages)) {
    const pages: string[] = [];
    for (const item of value.pages)
      if (typeof item === "string") pages.push(item);
      else throw new Error("meta pages must be strings");
    data.pages = pages;
  }
  return data;
}

function localeRow(
  table: object,
  locale: string,
): readonly [string, string, string] {
  if (!Object.hasOwn(table, locale))
    throw new Error(`missing locale ${locale}`);
  const value: unknown = Reflect.get(table, locale);
  if (!Array.isArray(value)) throw new Error(`missing locale ${locale}`);
  const row: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") throw new Error(`missing locale ${locale}`);
    row.push(item);
  }
  const group = row[0];
  const assistedTitle = row[1];
  const apiTitle = row[2];
  if (
    group === undefined ||
    assistedTitle === undefined ||
    apiTitle === undefined
  )
    throw new Error(`missing locale ${locale}`);
  return [group, assistedTitle, apiTitle];
}

function guideFolder(children: readonly Node[]): Folder {
  const guide = children[0];
  if (guide?.type !== "folder") throw new Error("expected a guide folder");
  return guide;
}

function integrationsFolder(children: readonly Node[]): Folder {
  const integrations = children[1];
  if (integrations?.type !== "folder")
    throw new Error("expected an integrations folder");
  return integrations;
}

const files: VirtualFile[] = [];
for await (const path of new Bun.Glob("**/*.{md,mdx,json}").scan(
  new URL("../../content/", import.meta.url).pathname,
)) {
  const text = await Bun.file(
    new URL(`../../content/${path}`, import.meta.url),
  ).text();
  files.push(
    path.endsWith(".json")
      ? {
          type: "meta",
          path,
          data: metaData(JSON.parse(text)),
        }
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
  ...apiVirtualFiles(apiEntries, locales, existingPages, () =>
    Promise.resolve(""),
  ),
);
const source = loader({ source: { files }, baseUrl: "/", i18n });

const guidePaths = [
  "",
  "/docs/start",
  "/docs/design-decisions",
  "/docs/struct",
  "/docs/http",
  "/docs/sse",
  "/docs/web-socket",
  "/docs/client",
  "/docs/errors",
  "/docs/interceptors",
  "/docs/load-balancing",
  "/docs/testing",
  "/docs/ai",
  "/docs/ai-api",
];
const integrationPaths = [
  "/docs/integrations",
  "/docs/integrations/react",
  "/docs/integrations/vue",
  "/docs/integrations/opentelemetry-server",
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
    expect(new Set(pages.map((p) => p.url)).size).toBe(238);
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
    const guide = tree.children[0];
    const integrations = tree.children[1];
    const recipes = tree.children[2];
    if (
      guide?.type !== "folder" ||
      integrations?.type !== "folder" ||
      recipes?.type !== "folder"
    )
      throw new Error("Missing guide, integrations, or example reading area");
    expect(
      guide.children.filter((n) => n.type === "separator" && Boolean(n.name))
        .length,
    ).toBe(4);
    expect(
      integrations.children.filter(
        (n) => n.type === "separator" && Boolean(n.name),
      ).length,
    ).toBe(2);
    expect(
      recipes.children.filter((n) => n.type === "separator" && Boolean(n.name))
        .length,
    ).toBe(4);
    expect(flattenTree([guide]).map((n) => n.url)).toEqual([
      `${prefix}/docs`,
      ...guidePaths.map((path) => prefix + path || "/"),
    ]);
    expect(flattenTree(integrations.children).map((n) => n.url)).toEqual(
      integrationPaths.map((path) => prefix + path),
    );
    expect(flattenTree([recipes]).map((n) => n.url)).toEqual([
      `${prefix}/recipes`,
      ...recipePaths.map((path) => prefix + path),
    ]);
    const tabs = getNavigationTabs(tree);
    expect(tabs.map((tab) => tab.url)).toEqual(
      ["docs", "docs/integrations", "recipes", "api"].map(
        (area) => `${prefix}/${area}`,
      ),
    );
    for (const page of pages)
      expect(
        tabs.filter((tab) => isLayoutTabActive(tab, page.url)).length,
      ).toBe(1);
    expect(JSON.stringify(original)).toBe(snapshot);
  }
});

test("top tabs expose four areas and the AI guide sits inside Guide", () => {
  for (const locale of locales) {
    const prefix = locale === "en-US" ? "" : `/${locale}`;
    const tree = getNavigationTree(source.getPageTree(locale), locale);
    const tabs = getNavigationTabs(tree);
    expect(tabs.map((tab) => tab.url)).toEqual(
      ["docs", "docs/integrations", "recipes", "api"].map(
        (area) => `${prefix}/${area}`,
      ),
    );
    const guide = guideFolder(tree.children);
    const guideUrls = flattenTree([guide]).map((node) => node.url);
    expect(guideUrls.indexOf(`${prefix}/docs/design-decisions`)).toBe(
      guideUrls.indexOf(`${prefix}/docs/start`) + 1,
    );
    const ai = `${prefix}/docs/ai`;
    const aiApi = `${prefix}/docs/ai-api`;
    expect(guideUrls.indexOf(ai)).toBe(
      guideUrls.indexOf(`${prefix}/docs/testing`) + 1,
    );
    expect(guideUrls.indexOf(aiApi)).toBe(guideUrls.indexOf(ai) + 1);
    expect(
      tabs.filter((tab) => isLayoutTabActive(tab, ai)).map((tab) => tab.url),
    ).toEqual([`${prefix}/docs`]);
    expect(
      tabs.filter((tab) => isLayoutTabActive(tab, aiApi)).map((tab) => tab.url),
    ).toEqual([`${prefix}/docs`]);
  }
});

test("every locale names the AI group and both of its pages", () => {
  const labels = {
    "en-US": ["AI", "Skill", "llms.txt"],
    "zh-Hans": ["AI", "Skill", "llms.txt"],
    "zh-Hant-TW": ["AI", "Skill", "llms.txt"],
    "zh-Hant-HK": ["AI", "Skill", "llms.txt"],
    "ja-JP": ["AI", "Skill", "llms.txt"],
    "ko-KR": ["AI", "Skill", "llms.txt"],
    "de-DE": ["KI", "Skill", "llms.txt"],
    "fr-FR": ["IA", "Skill", "llms.txt"],
    "es-ES": ["IA", "Skill", "llms.txt"],
    "ru-RU": ["ИИ", "Skill", "llms.txt"],
    ar: ["الذكاء الاصطناعي", "Skill", "llms.txt"],
  } as const;
  for (const locale of locales) {
    const prefix = locale === "en-US" ? "" : `/${locale}`;
    const [group, assistedTitle, apiTitle] = localeRow(labels, locale);
    const tree = getNavigationTree(source.getPageTree(locale), locale);
    const guide = guideFolder(tree.children);
    expect(
      guide.children
        .filter((node) => node.type === "separator" && Boolean(node.name))
        .map((node) => node.name)
        .at(-1),
    ).toBe(group);
    const names = flattenTree([guide]);
    expect(names.find((node) => node.url === `${prefix}/docs/ai`)?.name).toBe(
      assistedTitle,
    );
    expect(
      names.find((node) => node.url === `${prefix}/docs/ai-api`)?.name,
    ).toBe(apiTitle);
  }
});

test("navigation uses the active translator rather than selecting another dictionary", () => {
  const t = getTranslator("zh-Hans");
  const tree = getNavigationTree(
    source.getPageTree("zh-Hans"),
    "zh-Hans",
    (key, options) =>
      key === "nav.guide.ai" ? "Provider AI heading" : t(key, options),
  );
  const guide = guideFolder(tree.children);
  expect(
    guide.children
      .filter((node) => node.type === "separator" && Boolean(node.name))
      .at(-1)?.name,
  ).toBe("Provider AI heading");
});

test("reading-area and chapter labels come from page frontmatter, except the guide home, integrations tab, and API index overrides", () => {
  for (const locale of locales) {
    const prefix = locale === "en-US" ? "" : `/${locale}`;
    const t = getTranslator(locale);
    const tree = getNavigationTree(source.getPageTree(locale), locale);
    expect(tree.children[0]?.name).toBe(
      source.getPageByUrl(`${prefix}/docs`, locale)?.data.title,
    );
    expect(tree.children[1]?.name).toBe(t("nav.integrations"));
    expect(tree.children[2]?.name).toBe(
      source.getPageByUrl(`${prefix}/recipes`, locale)?.data.title,
    );
    expect(tree.children[3]?.name).toBe(
      source.getPageByUrl(`${prefix}/api`, locale)?.data.title,
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
    "插件",
    "操作示例",
    "API 参考",
  ]);
  const guide = guideFolder(tree.children);
  expect(
    guide.children
      .filter((n) => n.type === "separator" && Boolean(n.name))
      .map((n) => n.name),
  ).toEqual(["前言", "定义 SDK", "客户端与执行", "AI"]);
  const integrations = integrationsFolder(tree.children);
  expect(
    integrations.children
      .filter((n) => n.type === "separator" && Boolean(n.name))
      .map((n) => n.name),
  ).toEqual(["概览", "官方插件"]);
  expect(
    flattenTree([guide])
      .slice(1, 5)
      .map((n) => n.name),
  ).toEqual(["项目概览", "快速开始", "设计决策", "数据结构 / Struct"]);
});

test("SSR mobile directory resolves a trailing-slash article from the same navigation tree", () => {
  const tree = getNavigationTree(source.getPageTree("zh-Hans"), "zh-Hans");
  const html = renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: ["/zh-Hans/docs/http/"] },
      createElement(
        TestI18nProvider,
        { locale: "zh-Hans" },
        createElement(StaticNavigation, { tree }),
      ),
    ),
  );
  expect(html).toContain('href="/zh-Hans/docs/start"');
  expect(html).toContain('href="/zh-Hans/docs/http" aria-current="page"');
});

test("design decisions sit in the preface group and native previous/next follows the reading order", () => {
  for (const locale of locales) {
    const prefix = locale === "en-US" ? "" : `/${locale}`;
    const tree = getNavigationTree(source.getPageTree(locale), locale);
    const path = findPath(
      tree.children,
      (node) =>
        node.type === "page" && node.url === `${prefix}/docs/design-decisions`,
    );
    expect(
      path?.filter((node) => node.type === "separator" && Boolean(node.name))
        .length,
    ).toBe(1);
    expect(findNeighbour(tree, `${prefix}/docs/start`).previous?.url).toBe(
      prefix || "/",
    );
    expect(findNeighbour(tree, `${prefix}/docs/start`).next?.url).toBe(
      `${prefix}/docs/design-decisions`,
    );
    expect(
      findNeighbour(tree, `${prefix}/docs/design-decisions`).next?.url,
    ).toBe(`${prefix}/docs/struct`);
    expect(findNeighbour(tree, `${prefix}/docs/testing`).previous?.url).toBe(
      `${prefix}/docs/load-balancing`,
    );
    expect(
      findNeighbour(tree, `${prefix}/docs/integrations`).previous?.url,
    ).toBeUndefined();
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
    expect(http).not.toContain(`${prefix}/docs/ai`);
    expect(http).not.toContain(`${prefix}/docs/commands`);
  }
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

test("the SSR directory keeps one current AI page when the URL has a trailing slash", () => {
  for (const locale of locales) {
    const prefix = locale === "en-US" ? "" : `/${locale}`;
    const tree = getNavigationTree(source.getPageTree(locale), locale);
    const t = getTranslator(locale);
    for (const path of ["/docs/ai", "/docs/ai-api"]) {
      const html = renderToStaticMarkup(
        createElement(
          MemoryRouter,
          { initialEntries: [`${prefix}${path}/`] },
          createElement(
            TestI18nProvider,
            { locale },
            createElement(StaticNavigation, { tree }),
          ),
        ),
      );
      expect(html).toContain(`aria-label="${t("nav.readingAreas")}"`);
      expect(html).toContain(`aria-label="${t("nav.navigation")}"`);
      expect(html).toContain(`>${t("nav.guide.ai")}</h2>`);
      for (const area of ["docs", "docs/integrations", "recipes", "api"])
        expect(html).toContain(`href="${prefix}/${area}"`);
      expect(html.match(/aria-current="page"/g)).toEqual([
        'aria-current="page"',
      ]);
      expect(html).toContain(`href="${prefix}${path}" aria-current="page"`);
    }
  }
});
