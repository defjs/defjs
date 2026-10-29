import { createElement, type ComponentProps, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { highlight } from "fumadocs-core/highlight";
import { createMarkdownRenderer } from "fumadocs-core/content/md";
import { remarkGfm } from "fumadocs-core/mdx-plugins/remark-gfm";
import { rehypeCode } from "fumadocs-core/mdx-plugins/rehype-code";
import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import { wrapEnglishHtml } from "./api-entry-actions";
import type { ApiEntryView } from "./api-entry-view";
import type { ApiField } from "./api-text";
import type { getUi } from "./ui-copy";

const themes = { light: "github-light", dark: "github-dark" } as const;

const { MarkdownServer } = createMarkdownRenderer({
  remarkPlugins: [remarkGfm],
  rehypePlugins: [rehypeCode],
});

export interface RenderedParameterSection {
  signatureHtml: string;
  tableHtml: string;
}

export interface RenderedApiEntry {
  packageName: string;
  name: string;
  kind: ApiEntryView["kind"];
  summary: string;
  signaturesHtml: string[];
  descriptionHtml: string;
  parameterSections: RenderedParameterSection[];
  membersHtml: string;
  returnsHtml: string[];
  throwsHtml: string[];
  examplesHtml: string[];
  related: { name: string; href: string }[];
  overviewHref: string;
  overviewTitle: string;
}

type UiCopy = ReturnType<typeof getUi>;

export interface CopyLabels {
  copy: string;
  copied: string;
}

export function copyLabels(ui: UiCopy): CopyLabels {
  return {
    copy: ui.translations["Copy Text(code block)(aria-label)"],
    copied: ui.translations["Copied Text(code block)(aria-label)"],
  };
}

/** The MDX copy control, tagged so a delegated handler can run it after injection. */
export function tagCopyButton(html: string, labels: CopyLabels): string {
  const button = `<button type="button" data-api-copy="true" data-copied-label="${escapeHtml(labels.copied)}"`;
  const label = `<span class="sr-only">${escapeHtml(labels.copy)}</span>`;
  return html
    .replaceAll('<button type="button"', button)
    .replaceAll('<span class="sr-only">Copy Text</span>', label);
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function preBlock(props: ComponentProps<"pre">): ReactElement {
  return createElement(
    CodeBlock,
    { ...props, allowCopy: true },
    createElement(Pre, null, props.children),
  );
}

/** Same dual-theme Shiki block the MDX pages use, including the copy control markup. */
export async function highlightCode(
  code: string,
  lang: string,
  labels: CopyLabels,
): Promise<string> {
  const node = (await highlight(code, {
    lang,
    themes,
    defaultColor: false,
  })) as ReactElement<ComponentProps<"pre">>;
  return tagCopyButton(
    renderToStaticMarkup(
      preBlock({
        className: node.props.className,
        style: node.props.style,
        children: node.props.children,
      }),
    ),
    labels,
  );
}

export async function renderMarkdown(
  text: string,
  labels: CopyLabels,
): Promise<string> {
  if (!text.trim()) return "";
  const element = await MarkdownServer({
    components: {
      pre: (props: ComponentProps<"pre">) => preBlock(props),
      a: ({ href, children }: ComponentProps<"a">) =>
        createElement("a", { href }, children),
    },
    children: text,
  });
  return tagCopyButton(renderToStaticMarkup(element), labels);
}

export async function renderFieldTable(
  rows: readonly ApiField[],
  ui: UiCopy,
  locale = "en-US",
): Promise<string> {
  if (rows.length === 0) return "";
  const labels = copyLabels(ui);
  const body: string[] = [];
  for (const row of rows) {
    const name = `${escapeHtml(row.name)}${row.required ? "" : "?"}`;
    const prose = row.deprecated
      ? `deprecated. ${row.description}`.trim()
      : row.description;
    body.push(
      `<div class="border-t px-3 py-2"><code>${name}</code> <code>${escapeHtml(row.type)}</code>${wrapEnglishHtml(await renderMarkdown(prose, labels), locale)}</div>`,
    );
  }
  const prop = escapeHtml(ui.translations["Prop(type table)"]);
  const type = escapeHtml(ui.translations["Type(type table)"]);
  return `<div class="my-6 rounded-2xl border bg-fd-card text-sm overflow-hidden"><div class="flex px-3 py-1 text-fd-muted-foreground"><p class="w-1/4">${prop}</p><p>${type}</p></div>${body.join("")}</div>`;
}

export async function renderApiEntry(
  view: ApiEntryView,
  ui: UiCopy,
  overviewTitle: string,
  locale = "en-US",
): Promise<RenderedApiEntry> {
  const labels = copyLabels(ui);
  const parameterSections: RenderedParameterSection[] = [];
  for (const section of view.parameterTables) {
    parameterSections.push({
      signatureHtml: section.signature
        ? await highlightCode(section.signature, "ts", labels)
        : "",
      tableHtml: await renderFieldTable(section.rows, ui, locale),
    });
  }
  const examplesHtml: string[] = [];
  for (const example of view.examples) {
    examplesHtml.push(
      example.type === "code"
        ? await highlightCode(example.text, example.lang, labels)
        : await renderMarkdown(example.text, labels),
    );
  }
  return {
    packageName: view.package,
    name: view.name,
    kind: view.kind,
    summary: view.summary,
    signaturesHtml: await Promise.all(
      view.signatures.map((code) => highlightCode(code, "ts", labels)),
    ),
    descriptionHtml: await renderMarkdown(view.description, labels),
    parameterSections,
    membersHtml: await renderFieldTable(view.members, ui, locale),
    returnsHtml: await Promise.all(
      view.returns.map((part) => renderMarkdown(part, labels)),
    ),
    throwsHtml: await Promise.all(
      view.throws.map((part) => renderMarkdown(part, labels)),
    ),
    examplesHtml,
    related: view.related,
    overviewHref: view.overviewHref,
    overviewTitle,
  };
}
