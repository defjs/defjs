import type { ApiReferenceEntry, StoredEntry } from "../../scripts/api-model";
import { apiTargets, requireApiReference } from "../data/api-reference";
import {
  apiPageHref,
  codeLanguage,
  firstParagraph,
  parameterSections,
  resolveDocLinks,
  withoutFirstParagraph,
  type ApiField,
  type ApiParameterSection,
} from "./api-text";

export interface ApiExampleView {
  type: "markdown" | "code";
  text: string;
  lang: string;
}

export interface ApiEntryView {
  package: string;
  name: string;
  kind: ApiReferenceEntry["kind"];
  /** Repo-relative declaration file, used by the edit link. */
  source: string;
  group: string;
  summary: string;
  /** Description after the paragraph already shown above the page body. */
  description: string;
  signatures: string[];
  parameterTables: ApiParameterSection[];
  members: ApiField[];
  returns: string[];
  throws: string[];
  examples: ApiExampleView[];
  related: { name: string; href: string }[];
  overviewHref: string;
}

export function apiEntryView(slug: string, locale: string): ApiEntryView {
  return buildApiEntryView(requireApiReference(slug), locale, apiTargets());
}

export function buildApiEntryView(
  entry: ApiReferenceEntry,
  locale: string,
  targets: ReadonlyMap<string, string>,
): ApiEntryView {
  const resolve = (text: string) => resolveDocLinks(text, locale, targets);
  const prose = (parts: readonly string[]) =>
    parts.map((part) => resolve(part).trim()).filter(Boolean);
  return {
    package: entry.package,
    name: entry.name,
    kind: entry.kind,
    source: entry.source,
    group: entry.group,
    summary: firstParagraph(entry.description),
    description: withoutFirstParagraph(resolve(entry.description)),
    signatures: [...entry.signatures],
    parameterTables: parameterSections(
      entry.overloads.map((overload) => ({
        signature: overload.signature,
        parameters: fields(overload.parameters, resolve),
      })),
    ),
    members: entry.typeTable ? fields(entry.typeTable, resolve) : [],
    returns: prose(entry.returns),
    throws: prose(entry.throws),
    examples: examples(entry, resolve),
    related: entry.related.map((identity) => {
      const name = identity.slice(identity.indexOf(":") + 1);
      const slug = targets.get(name);
      if (!slug) throw new Error(`Unknown related API: ${identity}`);
      return { name, href: apiPageHref(locale, slug) };
    }),
    overviewHref: apiPageHref(locale, entry.group),
  };
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

function examples(
  entry: ApiReferenceEntry,
  resolve: (text: string) => string,
): ApiExampleView[] {
  const views: ApiExampleView[] = [];
  for (const tag of entry.tags) {
    if (tag.name.toLowerCase() !== "example") continue;
    const text = resolve(tag.text).trim();
    if (text) views.push({ type: "markdown", text, lang: "" });
  }
  for (const file of entry.exampleFiles)
    views.push({
      type: "code",
      text: file.code,
      lang: codeLanguage(file.path),
    });
  return views;
}
