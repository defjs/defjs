import { apiEntries } from "../data/api-catalog";
import { localePrefix } from "./i18n";
import { tabItems } from "./tab-items";
interface TableField {
  type: string;
  required?: boolean;
}
function isTableField(value: unknown): value is TableField {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string" &&
    (!("required" in value) || typeof value.required === "boolean")
  );
}
function isTableFields(value: unknown): value is Record<string, TableField> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every(isTableField)
  );
}
function tableFields(data: string): Record<string, TableField> {
  const parsed: unknown = JSON.parse(data);
  if (!isTableFields(parsed))
    throw new Error(`Invalid TypeTable data: ${data}`);
  return parsed;
}
function table(fields: Record<string, TableField>): string {
  return (
    "| Name | Type | Required |\n| --- | --- | --- |\n" +
    Object.entries(fields)
      .map(
        ([name, field]) =>
          `| ${name} | \`${field.type}\` | ${field.required ? "required" : "optional"} |`,
      )
      .join("\n")
  );
}
/** Applies `convert` to every line outside fenced code blocks. */
export function mapOutsideFences(
  text: string,
  convert: (line: string) => string,
): string {
  let fence: string | undefined;
  return text
    .split("\n")
    .map((line) => {
      const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
      if (marker) {
        if (!fence) fence = marker;
        else if (marker[0] === fence[0] && marker.length >= fence.length)
          fence = undefined;
        return line;
      }
      return fence ? line : convert(line);
    })
    .join("\n");
}
export function readableMarkdown(text: string, locale: string): string {
  const prefix = localePrefix(locale);
  // A `<Tab>` takes its heading from the enclosing `<Tabs items>` by position.
  let items: string[] = [];
  let tab = 0;
  return mapOutsideFences(text, (line) => {
    if (/^\s*<Tabs\b/.test(line)) {
      items = tabItems(line) ?? [];
      tab = 0;
    }
    const converted = line
      .replace(/^(#{1,6} .*?)\s*\[#[^\]]+\]$/, "$1")
      .replace(/<Tabs\b[^>]*>|<\/Tabs>|<\/Tab>/g, "")
      .replace(/^\s*<Tab>/g, () => `### ${items[tab++] ?? ""}`)
      .replace(/<ApiIndex\s*\/>/g, () =>
        apiEntries
          .map(
            (entry) =>
              `- [${entry.name}](${prefix}/api/${entry.slug}) — ${entry.package}, ${entry.kind}`,
          )
          .join("\n"),
      )
      .replace(/<TypeTable type=\{(\{.*\})\}\s*\/>/g, (_match, data: string) =>
        table(tableFields(data)),
      );
    // `\<Type>` is an escaped type argument, not an MDX component.
    if (
      /<[A-Z][A-Za-z]+\b/.test(
        converted.replace(/(`+).*?\1/g, "").replace(/\\</g, ""),
      )
    )
      throw new Error(`Unknown Markdown component: ${converted}`);
    return converted;
  });
}
