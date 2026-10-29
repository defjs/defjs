import { apiEntries } from "../data/api-catalog";
import { localePrefix } from "./i18n";
interface TableField {
  type: string;
  required?: boolean;
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
  return mapOutsideFences(text, (line) => {
    const converted = line
      .replace(/^(#{1,6} .*?)\s*\[#[^\]]+\]$/, "$1")
      .replace(/<Tabs\b[^>]*>|<\/Tabs>|<\/Tab>/g, "")
      .replace(/<Tab value="([^"]+)"\s*>/g, "### $1")
      .replace(/<ApiIndex\s*\/>/g, () =>
        apiEntries
          .map(
            (entry) =>
              `- [${entry.name}](${prefix}/api/${entry.slug}) — ${entry.package}, ${entry.kind}`,
          )
          .join("\n"),
      )
      .replace(/<TypeTable type=\{(\{.*\})\}\s*\/>/g, (_match, data: string) =>
        table(JSON.parse(data)),
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
