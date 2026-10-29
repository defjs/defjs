import { llms, loader } from "fumadocs-core/source";
import { defineDocs } from "fumadocs-mdx/macro";
import summaries from "../data/api-summaries.json";
import { absoluteMarkdownLinks } from "./llms";
import { siteUrl } from "./site";
import { readableMarkdown, titledMarkdown } from "./markdown";
import { apiVirtualFiles } from "./api-virtual";
import { readPageTitle, readProcessedText } from "./page-data";
import { i18n, locales } from "./i18n";
export const docs = defineDocs({
  dir: "content",
  docs: { async: true, postprocess: { includeProcessedMarkdown: true } },
});
const content = docs.toFumadocsSource();
const existingPages = new Set(content.files.map((file) => file.path));
// Entry prose stays out of the client graph. Prerender is the only caller.
function loadEntryMarkdown(slug: string, locale: string): Promise<string> {
  if (!import.meta.env.SSR) return Promise.resolve("");
  return import("./api-entry-markdown").then((mod) =>
    mod.renderApiEntryMarkdownBySlug(slug, locale),
  );
}
export const source = loader({
  source: {
    api: {
      files: apiVirtualFiles(
        summaries,
        locales,
        existingPages,
        loadEntryMarkdown,
      ),
    },
    content,
  },
  baseUrl: "/",
  i18n,
});
export const docsLlms = llms(source, {
  renderPage: async (page) =>
    titledMarkdown(
      readPageTitle(page.data),
      new URL(page.url, siteUrl).href,
      absoluteMarkdownLinks(
        readableMarkdown(
          await readProcessedText(page.data),
          page.locale ?? "en-US",
        ),
        siteUrl,
      ),
    ),
});
