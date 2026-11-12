import type { MetaData, PageData, VirtualFile } from "fumadocs-core/source";

export interface ApiPageSummary {
  slug: string;
  name: string;
  description: string;
}

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
  summaries: readonly ApiPageSummary[],
  localeList: readonly string[],
  existing: ReadonlySet<string>,
  load: (slug: string, locale: string) => Promise<string>,
): ApiVirtualFile[] {
  const files: ApiVirtualFile[] = [];
  for (const locale of localeList) {
    for (const summary of summaries) {
      const path = apiVirtualPath(locale, summary.slug);
      if (existing.has(path))
        throw new Error(`Content file shadows a generated API entry: ${path}`);
      files.push({
        type: "page",
        path,
        data: {
          title: summary.name,
          description: summary.description,
          apiSlug: summary.slug,
          getText: () => load(summary.slug, locale),
        },
      });
    }
  }
  return files;
}
