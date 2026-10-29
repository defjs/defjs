import { defined } from "./api-model";

export interface DocTag {
  name: string;
  text?: string | undefined;
}

export function splitDoc(comment: string): { prose: string; tags: string } {
  const trimmed = comment.trim();
  if (!trimmed.startsWith("/**") || !trimmed.endsWith("*/"))
    throw new Error("not a JSDoc comment");
  const lines = trimmed
    .slice(3, -2)
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, ""));
  const tagAt = lines.findIndex((line) => /^[ \t]*@[A-Za-z]/.test(line));
  if (tagAt < 0) return { prose: lines.join("\n").trim(), tags: "" };
  return {
    prose: lines.slice(0, tagAt).join("\n").trim(),
    tags: lines.slice(tagAt).join("\n").trim(),
  };
}

/** Index of the JSDoc opener. Leading banner comments are not part of the doc. */
export function jsDocOffset(comment: string): number {
  const start = comment.lastIndexOf("/**");
  if (start < 0) throw new Error("not a JSDoc comment");
  return start;
}

/** Full comment prose. Compiler documentation comments stop at the first paragraph. */
export function jsDocProse(comment: string): string {
  return splitDoc(comment.slice(jsDocOffset(comment))).prose;
}

export function lastDocProse(
  docs: readonly { getText(): string }[] | undefined,
): string {
  const last = docs?.at(-1);
  if (!last) return "";
  return jsDocProse(last.getText());
}

export function firstProse(
  groups: readonly (readonly { getText(): string }[] | undefined)[],
): string {
  for (const group of groups) {
    const prose = lastDocProse(group);
    if (prose) return prose;
  }
  return "";
}

export function textsFor(
  tags: readonly DocTag[],
  names: readonly string[],
): string[] {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  const texts: string[] = [];
  for (const tag of tags) {
    if (!wanted.has(tag.name.toLowerCase())) continue;
    const text = tag.text?.trim() ?? "";
    if (text) texts.push(text);
  }
  return texts;
}

export function seeTarget(text: string): string {
  const trimmed = text.trim();
  const link = /^\{@link\s+([^}|]+?)(?:\s*\|[^}]*)?\}$/.exec(trimmed);
  if (link) return defined(link[1], "see target").trim();
  const identity = /^@defjs\/[a-z0-9-]+:(.+)$/.exec(trimmed);
  if (identity) return defined(identity[1], "see identity").trim();
  if (/^[A-Za-z0-9_.]+$/.test(trimmed)) return trimmed;
  throw new Error(`invalid @see: ${text}`);
}

const exampleFilePattern = /^(\S+)#([A-Za-z0-9_-]+)$/;

export function parseExampleFile(text: string): {
  path: string;
  region: string;
} {
  const trimmed = text.trim();
  const match = exampleFilePattern.exec(trimmed);
  if (!match || trimmed.includes(".."))
    throw new Error(`invalid @exampleFile: ${text}`);
  return {
    path: defined(match[1], "example path"),
    region: defined(match[2], "example region"),
  };
}

const hoistedTags = new Set([
  "param",
  "returns",
  "return",
  "throws",
  "throw",
  "group",
  "see",
  "examplefile",
]);

export function storedTags(
  tags: readonly DocTag[],
): { name: string; text: string }[] {
  const stored: { name: string; text: string }[] = [];
  for (const tag of tags) {
    if (hoistedTags.has(tag.name.toLowerCase())) continue;
    stored.push({ name: tag.name, text: tag.text?.trim() ?? "" });
  }
  return stored;
}

function paramBody(text: string): string {
  const head = defined(text.split(/\s+/, 1)[0], "param head");
  return text.slice(head.length).trim().replace(/^- /, "");
}

export function paramDescription(
  tags: readonly DocTag[],
  paramName: string,
): string {
  const bare = paramName.replace(/^\.\.\./, "");
  const params = tags.filter((tag) => tag.name.toLowerCase() === "param");
  for (const tag of params) {
    const text = tag.text?.trim() ?? "";
    const head = defined(text.split(/\s+/, 1)[0], "param head");
    if (head !== bare && head !== paramName) continue;
    return paramBody(text);
  }
  if (!/[{\s[]/.test(paramName) || params.length !== 1) return "";
  return paramBody(defined(params[0], "param").text?.trim() ?? "");
}
