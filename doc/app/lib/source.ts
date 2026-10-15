import { llms, loader } from 'fumadocs-core/source'
import { defineDocs } from 'fumadocs-mdx/macro'
import { absoluteMarkdownLinks } from './llms'
import { siteUrl } from './site'
import { readableMarkdown, titledMarkdown } from './markdown'
import { i18n } from './i18n'
export const docs = defineDocs({ dir: 'content', docs: { async: true, postprocess: { includeProcessedMarkdown: true } } })
export const source = loader({ source: docs.toFumadocsSource(), baseUrl: '/', i18n })
export const docsLlms = llms(source, {
  renderPage: async (page) =>
    titledMarkdown(
      page.data.title,
      new URL(page.url, siteUrl).href,
      absoluteMarkdownLinks(readableMarkdown(await page.data.getText('processed'), page.locale ?? 'en-US'), siteUrl),
    ),
})
