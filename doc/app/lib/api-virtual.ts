import type { MetaData, PageData, VirtualFile } from "fumadocs-core/source";
import type { ApiEntry } from "../data/api-catalog";

export interface ApiPageData extends PageData {
  title: string;
  description: string;
  apiSlug: string;
  getText: (type: "raw" | "processed") => Promise<string>;
}

export interface ApiSourceConfig {
  pageData: ApiPageData;
  metaData: MetaData;
}

type ApiVirtualFile = VirtualFile<ApiSourceConfig>;

export function apiVirtualPath(locale: string, slug: string): string {
  return `${locale}/api/${slug}.mdx`;
}

/**
 * Virtual entry pages are the only pages for generated API entries.
 * A content file at the same path is a stale hand-written page.
 */
export function apiVirtualFiles(
  entries: readonly ApiEntry[],
  localeList: readonly string[],
  existing: ReadonlySet<string>,
  load: (slug: string, locale: string) => Promise<string>,
): ApiVirtualFile[] {
  const files: ApiVirtualFile[] = [];
  for (const locale of localeList) {
    for (const entry of entries) {
      const path = apiVirtualPath(locale, entry.slug);
      if (existing.has(path))
        throw new Error(`Content file shadows a generated API entry: ${path}`);
      files.push({
        type: "page",
        path,
        data: {
          title: entry.name,
          description: entry.description,
          apiSlug: entry.slug,
          getText: () => load(entry.slug, locale),
        },
      });
    }
  }
  return files;
}
