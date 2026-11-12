import type { Locale } from "./i18n";
import { apiEntryView, type ApiEntryView } from "./api-entry-view";
import type { ApiField } from "./api-text";

export function renderApiEntryMarkdownBySlug(
  slug: string,
  locale: Locale,
): string {
  return renderApiEntryMarkdown(apiEntryView(slug, locale));
}

/** The entry page as plain Markdown, for search and the LLM resources. */
export function renderApiEntryMarkdown(view: ApiEntryView): string {
  const lines = [`${view.package} · ${view.kind}`];
  for (const signature of view.signatures)
    lines.push("", fenced(signature, "ts"));
  const description = view.description.trim();
  if (description) lines.push("", description);
  for (const section of view.parameterTables) {
    lines.push("", "## Parameters");
    if (section.signature) lines.push("", fenced(section.signature, "ts"));
    lines.push("", markdownTable(section.rows));
  }
  if (view.members.length > 0)
    lines.push("", "## Members", "", markdownTable(view.members));
  pushProse(lines, "Returns", view.returns);
  pushProse(lines, "Throws", view.throws);
  if (view.examples.length > 0)
    lines.push(
      "",
      "## Examples",
      "",
      view.examples
        .map((example) =>
          example.type === "code"
            ? fenced(example.text, example.lang)
            : example.text,
        )
        .join("\n\n"),
    );
  if (view.related.length > 0)
    lines.push(
      "",
      "## See also",
      "",
      view.related
        .map((target) => `[${target.name}](${target.href})`)
        .join(" · "),
    );
  lines.push("", "## Overview", "", `[Overview](${view.overviewHref})`);
  return `${lines.join("\n")}\n`;
}

function pushProse(
  lines: string[],
  heading: string,
  parts: readonly string[],
): void {
  if (parts.length === 0) return;
  lines.push("", `## ${heading}`, "", parts.join("\n\n"));
}

function markdownTable(rows: readonly ApiField[]): string {
  const body = rows
    .map((row) => {
      const description = row.deprecated
        ? `deprecated. ${row.description}`
        : row.description;
      return `| ${cell(row.name)} | \`${cell(row.type)}\` | ${row.required ? "required" : "optional"} | ${cell(description)} |`;
    })
    .join("\n");
  return `| Name | Type | Required | Description |\n| --- | --- | --- | --- |\n${body}`;
}

function cell(text: string): string {
  return text.replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}

function fenced(code: string, lang: string): string {
  const ticks = code.includes("```") ? "````" : "```";
  return `${ticks}${lang}\n${code}\n${ticks}`;
}
