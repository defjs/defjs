import { requireApiReference, apiTargets } from "../data/api-reference";
import type { ApiReferenceEntry, StoredEntry } from "../../scripts/api-model";
import {
  apiPageHref,
  codeLanguage,
  firstParagraph,
  parameterSections,
  resolveDocLinks,
  type ApiField,
} from "./api-text";

export function renderApiEntryMarkdownBySlug(
  slug: string,
  locale: string,
): string {
  return renderApiEntryMarkdown(
    requireApiReference(slug),
    locale,
    apiTargets(),
  );
}

export function renderApiEntryMarkdown(
  entry: ApiReferenceEntry,
  locale: string,
  targets: ReadonlyMap<string, string>,
): string {
  const resolve = (text: string) => resolveDocLinks(text, locale, targets);
  const lines = [`${entry.package} · ${entry.kind}`];
  for (const signature of entry.signatures)
    lines.push("", fenced(signature, "ts"));
  const description = resolve(entry.description).trim();
  if (description) lines.push("", description);
  for (const section of parameterSections(
    entry.overloads.map((overload) => ({
      signature: overload.signature,
      parameters: fields(overload.parameters, resolve),
    })),
  )) {
    lines.push("", "## Parameters");
    if (section.signature) lines.push("", fenced(section.signature, "ts"));
    lines.push("", markdownTable(section.rows));
  }
  if (entry.typeTable && entry.typeTable.length > 0)
    lines.push(
      "",
      "## Members",
      "",
      markdownTable(fields(entry.typeTable, resolve)),
    );
  pushProse(lines, "Returns", entry.returns, resolve);
  pushProse(lines, "Throws", entry.throws, resolve);
  const examples = exampleBlocks(entry, resolve);
  if (examples.length > 0)
    lines.push("", "## Examples", "", examples.join("\n\n"));
  if (entry.related.length > 0)
    lines.push("", "## See also", "", relatedLinks(entry, targets, locale));
  lines.push(
    "",
    "## Overview",
    "",
    `[Overview](${apiPageHref(locale, entry.group)})`,
  );
  return `${lines.join("\n")}\n`;
}

export function entrySummary(entry: ApiReferenceEntry): string {
  return firstParagraph(entry.description);
}

function fields(
  rows: readonly StoredEntry[],
  resolve: (text: string) => string,
): ApiField[] {
  return rows.map((row) => ({
    name: row.name,
    type: row.type,
    required: row.required,
    deprecated: row.deprecated,
    description: resolve(row.description),
  }));
}

function pushProse(
  lines: string[],
  heading: string,
  parts: readonly string[],
  resolve: (text: string) => string,
): void {
  const prose = parts.map((part) => resolve(part).trim()).filter(Boolean);
  if (prose.length === 0) return;
  lines.push("", `## ${heading}`, "", prose.join("\n\n"));
}

function exampleBlocks(
  entry: ApiReferenceEntry,
  resolve: (text: string) => string,
): string[] {
  const blocks: string[] = [];
  for (const tag of entry.tags) {
    if (tag.name.toLowerCase() !== "example") continue;
    const text = resolve(tag.text).trim();
    if (text) blocks.push(text);
  }
  for (const file of entry.exampleFiles)
    blocks.push(fenced(file.code, codeLanguage(file.path)));
  return blocks;
}

function relatedLinks(
  entry: ApiReferenceEntry,
  targets: ReadonlyMap<string, string>,
  locale: string,
): string {
  return entry.related
    .map((identity) => {
      const name = identity.slice(identity.indexOf(":") + 1);
      const slug = targets.get(name);
      if (!slug) throw new Error(`Unknown related API: ${identity}`);
      return `[${name}](${apiPageHref(locale, slug)})`;
    })
    .join(" · ");
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
