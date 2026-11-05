import {
  flattenTree,
  type Folder,
  type Item,
  type Node,
  type Root,
} from "fumadocs-core/page-tree";
import type { LayoutTab } from "fumadocs-ui/layouts/shared";
import { localePrefix } from "./i18n";
import { getTranslator, type Translator } from "./translations";
import type { MessageKey } from "./messages";

interface NavigationGroup {
  titleKey: MessageKey;
  paths: readonly string[];
}

const guideGroups = [
  {
    titleKey: "nav.guide.preface",
    paths: ["", "/docs/start", "/docs/design-decisions"],
  },
  {
    titleKey: "nav.guide.definingSdks",
    paths: ["/docs/struct", "/docs/http", "/docs/sse", "/docs/web-socket"],
  },
  {
    titleKey: "nav.guide.clientExecution",
    paths: [
      "/docs/client",
      "/docs/errors",
      "/docs/interceptors",
      "/docs/load-balancing",
      "/docs/testing",
    ],
  },
  { titleKey: "nav.guide.ai", paths: ["/docs/ai", "/docs/ai-api"] },
] as const satisfies readonly NavigationGroup[];
export const integrationGroups = [
  {
    titleKey: "nav.integrations.overview",
    paths: ["/docs/integrations"],
  },
  {
    titleKey: "nav.integrations.official",
    paths: [
      "/docs/integrations/react",
      "/docs/integrations/vue",
      "/docs/integrations/opentelemetry-server",
    ],
  },
] as const satisfies readonly NavigationGroup[];
export const exampleGroups = [
  {
    titleKey: "nav.examples.http",
    paths: [
      "/recipes/post-json",
      "/recipes/get-declared-404",
      "/recipes/cancel-http",
      "/recipes/etag-revalidate",
      "/recipes/graphql-http-envelope",
    ],
  },
  {
    titleKey: "nav.examples.authentication",
    paths: ["/recipes/refresh-bearer-once"],
  },
  {
    titleKey: "nav.examples.realtime",
    paths: ["/recipes/consume-sse", "/recipes/websocket-session"],
  },
  {
    titleKey: "nav.examples.sdkTestingPublishing",
    paths: ["/recipes/test-with-handle", "/recipes/publish-http-sdk"],
  },
] as const satisfies readonly NavigationGroup[];

export function getNavigationTree(
  tree: Root,
  locale: string,
  t: Translator = getTranslator(locale),
): Root {
  const prefix = localePrefix(locale);
  const pages = new Map(
    flattenTree(tree.children).map((page) => [page.url, page]),
  );
  function page(path: string, name?: string): Item {
    const url = prefix + path || "/";
    const item = pages.get(url);
    if (!item) throw new Error(`Missing navigation page: ${url}`);
    return name ? { ...item, name } : item;
  }
  function grouped(
    groups: readonly NavigationGroup[],
    names: Record<string, string> = {},
  ): Node[] {
    return groups.flatMap(({ titleKey, paths }): Node[] => [
      { type: "separator", name: t(titleKey) },
      ...paths.map((path) => page(path, names[path])),
    ]);
  }
  const children = (["docs", "integrations", "recipes", "api"] as const).map(
    (area): Folder => {
      const path = area === "integrations" ? "/docs/integrations" : `/${area}`;
      const url = `${prefix}${path}`;
      const folder = tree.children.find(
        (node): node is Folder =>
          node.type === "folder" &&
          flattenTree(node.children).some((child) => child.url === url),
      );
      if (!folder) throw new Error(`Missing reading area: ${url}`);
      const root = page(path);
      const index =
        area === "api" ? { ...root, name: t("nav.apiIndex") } : root;
      const integrations = [
        "/api/react",
        "/api/vue",
        "/api/opentelemetry-server",
      ].map((item) => prefix + item);
      const isIntegration = (node: Node) =>
        node.type === "page"
          ? integrations.includes(node.url)
          : node.type === "folder" &&
            flattenTree(node.children).every((item) =>
              integrations.some((target) => item.url.startsWith(target + "/")),
            );
      const other = folder.children.filter(
        (node) => node.type !== "page" || node.url !== url,
      );
      const chapters =
        area === "docs"
          ? [
              index,
              ...grouped(guideGroups, {
                "": t("nav.home"),
                "/docs/struct": t("nav.guide.dataStructures"),
                "/docs/client": t("nav.guide.client"),
                "/docs/interceptors": t("nav.guide.middleware"),
                "/docs/errors": t("nav.guide.errors"),
              }),
            ]
          : area === "integrations"
            ? grouped(integrationGroups)
            : area === "recipes"
              ? [index, ...grouped(exampleGroups)]
              : [
                  index,
                  { type: "separator" as const, name: t("nav.coreModules") },
                  ...other.filter((node) => !isIntegration(node)),
                  { type: "separator" as const, name: t("nav.integrations") },
                  ...other.filter(isIntegration),
                ];
      return {
        ...folder,
        name: area === "integrations" ? t("nav.integrations") : root.name,
        children: chapters,
      };
    },
  );
  const result = { ...tree, children };
  const before = [...pages.keys()].sort();
  const after = flattenTree(result.children)
    .map((item) => item.url)
    .sort();
  if (
    before.length !== after.length ||
    before.some((url, i) => url !== after[i])
  )
    throw new Error(`Navigation dropped or duplicated content: ${locale}`);
  return result;
}

/** Fixed reading-area destinations avoid native same-path projection between roots. */
export function getNavigationTabs(tree: Root): LayoutTab[] {
  return tree.children
    .filter((node): node is Folder => node.type === "folder")
    .map((folder) => {
      const pages = flattenTree(folder.children);
      const index = pages[0];
      if (!index) throw new Error("Reading area has no index page");
      return {
        title: folder.name,
        url: index.url,
        urls: new Set(pages.map((page) => page.url)),
      };
    });
}

const relatedTopics = [
  [
    "/docs/start",
    "/docs/http",
    "/api/http",
    ...exampleGroups[0].paths,
    ...exampleGroups[1].paths,
    ...exampleGroups[3].paths,
  ],
  [
    "/docs/struct",
    "/api/struct",
    "/recipes/post-json",
    "/recipes/get-declared-404",
    "/recipes/consume-sse",
    "/recipes/websocket-session",
  ],
  [
    "/docs/client",
    "/docs/load-balancing",
    "/docs/testing",
    "/api/client",
    "/recipes/cancel-http",
    "/recipes/publish-http-sdk",
    "/recipes/test-with-handle",
  ],
  ["/docs/sse", "/api/sse", "/recipes/consume-sse"],
  ["/docs/web-socket", "/api/web-socket", "/recipes/websocket-session"],
  [
    "/docs/errors",
    "/api/errors",
    "/recipes/get-declared-404",
    "/recipes/cancel-http",
    "/recipes/refresh-bearer-once",
  ],
  ["/docs/interceptors", "/api/interceptors", "/recipes/refresh-bearer-once"],
  ["/docs/integrations", "/docs/integrations/react", "/api/react"],
  ["/docs/integrations", "/docs/integrations/vue", "/api/vue"],
  [
    "/docs/integrations",
    "/docs/integrations/opentelemetry-server",
    "/api/opentelemetry-server",
    "/docs/interceptors",
  ],
] as const;

export function getRelatedNavigation(
  tree: Root,
  locale: string,
  url: string,
): Folder[] {
  const prefix = localePrefix(locale);
  const current = url.replace(/\/$/, "") || "/";
  const targets = new Set(
    relatedTopics
      .filter((topic) => topic.some((path) => prefix + path === current))
      .flatMap((topic) => topic.map((path) => prefix + path)),
  );
  targets.delete(current);
  const pages = new Set(flattenTree(tree.children).map((page) => page.url));
  for (const target of targets)
    if (!pages.has(target))
      throw new Error(`Missing related navigation page: ${target}`);
  return tree.children
    .filter((node): node is Folder => node.type === "folder")
    .map((folder) => ({
      ...folder,
      children: flattenTree(folder.children).filter((page) =>
        targets.has(page.url),
      ),
    }))
    .filter((folder) => folder.children.length > 0);
}
