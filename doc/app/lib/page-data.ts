export function readPageTitle(data: object): string {
  if (!("title" in data) || typeof data.title !== "string" || !data.title)
    throw new Error("Page has no title");
  return data.title;
}

function hasTextReader(
  data: object,
): data is { getText(kind: string): unknown } {
  return "getText" in data && typeof data.getText === "function";
}

export async function readProcessedText(data: object): Promise<string> {
  if (!hasTextReader(data)) throw new Error("Page has no processed text");
  const text: unknown = await data.getText("processed");
  if (typeof text !== "string") throw new Error("Page text is not a string");
  return text;
}
