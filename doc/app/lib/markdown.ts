import { apiEntries } from "../data/api-catalog";
import { localePrefix, type Locale } from "./i18n";
import { tabItems } from "./tab-items";
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
export function readableMarkdown(text: string, locale: Locale): string {
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
