import { llms, loader, type Source } from "fumadocs-core/source";
import { defineDocs } from "fumadocs-mdx/macro";
import { apiEntries } from "../data/api-catalog";
import { apiVirtualFiles, type ApiSourceConfig } from "./api-virtual";
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
// The named source type is what the loader infers page data from; a bare `{ files }` literal degrades it to `PageData`.
const api: Source<ApiSourceConfig> = {
  files: apiVirtualFiles(apiEntries, locales, existingPages, loadEntryMarkdown),
};
export const source = loader({
  source: { api, content },
  baseUrl: "/",
  i18n,
});
export const docsLlms = llms(source, {
  renderPage: (page) => page.data.getText("processed"),
});
