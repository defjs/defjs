export function readPageTitle(data: object): string {
  if (!("title" in data) || typeof data.title !== "string" || !data.title)
    throw new Error("Page has no title");
  return data.title;
}

export async function readProcessedText(data: object): Promise<string> {
  if (!("getText" in data) || typeof data.getText !== "function")
    throw new Error("Page has no processed text");
  const text = await data.getText("processed");
  if (typeof text !== "string") throw new Error("Page text is not a string");
  return text;
}
