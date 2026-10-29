import { getSlugs, createGetUrl } from "fumadocs-core/source";
import { apiEntries } from "../data/api-catalog";
import { apiVirtualPath } from "./api-virtual";
import { i18n, locales } from "./i18n";

export interface ContentRoute {
  locale: string;
  slugs: string[];
  url: string;
}
const getUrl = createGetUrl("/", i18n);
export function getContentRoute(relativePath: string): ContentRoute {
  const [locale, ...rest] = relativePath.split("/");
  if (!locale || !locales.includes(locale))
    throw new Error(`Unknown locale: ${locale}`);
  const slugs = getSlugs(rest.join("/"));
  return { locale, slugs, url: getUrl(slugs, locale) };
}
export function assertUniqueRoutes(paths: string[]): ContentRoute[] {
  const seen = new Set<string>();
  return paths.map((path) => {
    const route = getContentRoute(path);
    if (seen.has(route.url)) throw new Error(`Duplicate URL: ${route.url}`);
    seen.add(route.url);
    return route;
  });
}
export function apiEntryContentPaths(
  slugs: readonly string[] = apiEntries.map((entry) => entry.slug),
  localeList: readonly string[] = locales,
): string[] {
  return localeList.flatMap((locale) =>
    slugs.map((slug) => apiVirtualPath(locale, slug)),
  );
}
export function mergeContentPaths(
  content: readonly string[],
  virtual: readonly string[],
): string[] {
  const existing = new Set(content);
  const shadow = virtual.find((path) => existing.has(path));
  if (shadow)
    throw new Error(`Content file shadows a generated API entry: ${shadow}`);
  return [...content, ...virtual];
}
export async function collectPrerenderPaths(): Promise<string[]> {
  const paths = mergeContentPaths(
    await Array.fromAsync(
      new Bun.Glob("**/*.{md,mdx}").scan(
        new URL("../../content/", import.meta.url).pathname,
      ),
    ),
    apiEntryContentPaths(),
  );
  const routes = assertUniqueRoutes(paths);
  return [
    ...routes.map((route) => route.url),
    ...locales.map((locale) => `/api/search/${locale}.json`),
    "/llms.txt",
    "/llms-full.txt",
    "/404",
    "/sitemap.xml",
    ...routes
      .filter((route) => route.locale === "en-US")
      .map((route) => `/llms.mdx/${[...route.slugs, "content.md"].join("/")}`),
  ];
}
