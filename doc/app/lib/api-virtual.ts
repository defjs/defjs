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
  getText: (type: string) => Promise<string>;
}

type ApiVirtualFile = VirtualFile<{
  pageData: ApiPageData;
  metaData: MetaData;
}>;

export function apiVirtualPath(locale: string, slug: string): string {
  return `${locale}/api/${slug}.mdx`;
}

export function apiSlugOf(data: unknown): string | undefined {
  if (!data || typeof data !== "object" || !("apiSlug" in data))
    return undefined;
  const slug = data.apiSlug;
  return typeof slug === "string" && slug.length > 0 ? slug : undefined;
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
          getText: (type: string) => {
            if (type !== "raw" && type !== "processed")
              return Promise.reject(new Error(`Unsupported API text: ${type}`));
            return load(summary.slug, locale);
          },
        },
      });
    }
  }
  return files;
}
