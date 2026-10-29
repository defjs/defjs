export function llmsMarkdownSlugs(
  splat: string | undefined,
): string[] | undefined {
  const slugs = (splat ?? "").split("/").filter(Boolean);
  if (slugs.pop() !== "content.md") return undefined;
  return slugs;
}
