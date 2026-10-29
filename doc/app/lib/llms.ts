import { mapOutsideFences } from "./markdown";
export function absoluteMarkdownLinks(text: string, siteUrl: string): string {
  return mapOutsideFences(text, (line) =>
    line.replace(
      /(`+).*?\1|\]\((\/[^)]*)\)/g,
      (match, code: string | undefined, path: string) =>
        code ? match : `](${new URL(path, siteUrl).href})`,
    ),
  );
}
export function llmsMarkdownSlugs(
  splat: string | undefined,
): string[] | undefined {
  const slugs = (splat ?? "").split("/").filter(Boolean);
  if (slugs.pop() !== "content.md") return undefined;
  return slugs;
}
export function llmsIndexMarkdown(text: string, siteUrl: string): string {
  return text.replace(/\]\((\/[^)]*)\)/g, (_match, path: string) => {
    const segments = path.split("/").filter(Boolean);
    return `](${new URL("/llms.mdx/" + [...segments, "content.md"].join("/"), siteUrl).href})`;
  });
}
