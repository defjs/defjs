/**
 * Reads the labels from a single-line `<Tabs items={["a", "b"]}>` tag.
 * Returns `undefined` when the tag has no parsable string array.
 */
export function tabItems(tag: string): string[] | undefined {
  const raw = /\bitems=\{(\[.*?\])\}/.exec(tag)?.[1];
  if (raw === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) &&
      parsed.every((item): item is string => typeof item === "string")
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}
