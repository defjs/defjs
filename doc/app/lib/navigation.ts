import {
  flattenTree,
  type Folder,
  type Item,
  type Node,
  type Root,
} from "fumadocs-core/page-tree";
import type { LayoutTab } from "fumadocs-ui/layouts/shared";
import { localePrefix, type Locale } from "./i18n";
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
  {
    titleKey: "nav.guide.bestPractices",
    paths: [
      "/docs/best-practices",
      "/docs/application-api",
      "/docs/public-sdk",
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

const integrationApis = ["/api/react", "/api/vue", "/api/opentelemetry-server"];

/** What the four reading areas are built from. */
interface NavigationContext {
  tree: Root;
  /** Every page of the content tree by URL. */
  pages: ReadonlyMap<string, Item>;
  prefix: string;
  t: Translator;
}

function page(nav: NavigationContext, path: string, name?: string): Item {
  const url = nav.prefix + path || "/";
  const item = nav.pages.get(url);
  if (!item) throw new Error(`Missing navigation page: ${url}`);
  return name ? { ...item, name } : item;
}

function grouped(
  nav: NavigationContext,
  groups: readonly NavigationGroup[],
  names: Record<string, string> = {},
): Node[] {
  return groups.flatMap(({ titleKey, paths }): Node[] => [
    { type: "separator", name: nav.t(titleKey) },
    ...paths.map((path) => page(nav, path, names[path])),
  ]);
}

/** The content folder that holds the page at `path`. */
function areaFolder(nav: NavigationContext, path: string): Folder {
  const url = nav.prefix + path;
  const folder = nav.tree.children.find(
    (node): node is Folder =>
      node.type === "folder" &&
      flattenTree(node.children).some((child) => child.url === url),
  );
  if (!folder) throw new Error(`Missing reading area: ${url}`);
  return folder;
}

function guideArea(nav: NavigationContext): Folder {
  const folder = areaFolder(nav, "/docs");
  const index = page(nav, "/docs");
  return {
    ...folder,
    name: index.name,
    index,
    children: grouped(nav, guideGroups, {
      "": nav.t("nav.home"),
      "/docs/struct": nav.t("nav.guide.dataStructures"),
      "/docs/client": nav.t("nav.guide.client"),
      "/docs/interceptors": nav.t("nav.guide.middleware"),
      "/docs/errors": nav.t("nav.guide.errors"),
    }),
  };
}

/** The integration guides live inside the guide folder; this area is a second view of it. */
function integrationArea(nav: NavigationContext): Folder {
  return {
    ...areaFolder(nav, "/docs/integrations"),
    name: nav.t("nav.integrations"),
    children: grouped(nav, integrationGroups),
  };
}

function exampleArea(nav: NavigationContext): Folder {
  const folder = areaFolder(nav, "/recipes");
  const index = page(nav, "/recipes");
  return {
    ...folder,
    name: index.name,
    index,
    children: grouped(nav, exampleGroups),
  };
}

/** The generated order of the API folder, split into core modules and integration packages. */
function apiArea(nav: NavigationContext): Folder {
  const folder = areaFolder(nav, "/api");
  const index = page(nav, "/api");
  const targets = integrationApis.map((path) => nav.prefix + path);
  function isIntegration(node: Node): boolean {
    if (node.type === "page") return targets.includes(node.url);
    return (
      node.type === "folder" &&
      flattenTree(node.children).every((item) =>
        targets.some((target) => item.url.startsWith(`${target}/`)),
      )
    );
  }
  const core: Node[] = [];
  const integrations: Node[] = [];
  for (const node of folder.children) {
    if (node.type === "page" && node.url === index.url) continue;
    (isIntegration(node) ? integrations : core).push(node);
  }
  return {
    ...folder,
    name: index.name,
    children: [
      { ...index, name: nav.t("nav.apiIndex") },
      { type: "separator", name: nav.t("nav.coreModules") },
      ...core,
      { type: "separator", name: nav.t("nav.integrations") },
      ...integrations,
    ],
  };
}

export function getNavigationTree(
  tree: Root,
  locale: Locale,
  t: Translator = getTranslator(locale),
): Root {
  const nav: NavigationContext = {
    tree,
    pages: new Map(flattenTree(tree.children).map((item) => [item.url, item])),
    prefix: localePrefix(locale),
    t,
  };
  return {
    ...tree,
    children: [
      guideArea(nav),
      integrationArea(nav),
      exampleArea(nav),
      apiArea(nav),
    ],
  };
}

/** Fixed reading-area destinations avoid native same-path projection between roots. */
export function getNavigationTabs(tree: Root): LayoutTab[] {
  return tree.children
    .filter((node): node is Folder => node.type === "folder")
    .map((folder) => {
      const pages = flattenTree([folder]);
      const first = folder.index ?? pages[0];
      if (!first) throw new Error("Reading area has no index page");
      return {
        title: folder.name,
        url: first.url,
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
    "/docs/best-practices",
    "/docs/application-api",
    "/docs/public-sdk",
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
  locale: Locale,
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
