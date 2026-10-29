import { mapOutsideFences } from "./markdown";
import { localePrefix } from "./i18n";

export interface ApiField {
  name: string;
  type: string;
  required: boolean;
  description: string;
  deprecated: boolean;
}

export interface ApiParameterSection {
  signature?: string;
  rows: ApiField[];
}

/** The meta description is the opening paragraph, without Markdown markers. */
export function firstParagraph(description: string): string {
  const breakAt = description.search(/\n\s*\n/);
  const block = breakAt === -1 ? description : description.slice(0, breakAt);
  return mapOutsideFences(block, (line) =>
    replaceDocLinks(line, (_name, label) => label),
  )
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`+/g, "")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function localeHref(locale: string, path: string): string {
  if (!path.startsWith("/"))
    throw new Error(`API path must be absolute: ${path}`);
  return `${localePrefix(locale)}${path}`;
}

export function apiPageHref(locale: string, slug: string): string {
  return localeHref(locale, `/api/${slug}`);
}

export function linkTargets(
  entries: readonly { name: string; slug: string }[],
): Map<string, string> {
  const targets = new Map<string, string>();
  for (const entry of entries) {
    if (targets.has(entry.name))
      throw new Error(`Duplicate API name: ${entry.name}`);
    targets.set(entry.name, entry.slug);
  }
  return targets;
}

/** `{@link Name}` and `{@link Name | label}` become locale-prefixed Markdown links. */
export function resolveDocLinks(
  text: string,
  locale: string,
  targets: ReadonlyMap<string, string>,
): string {
  return mapOutsideFences(text, (line) =>
    escapeTypeAngles(
      replaceDocLinks(line, (name, label) => {
        const slug = targets.get(name);
        if (!slug) return label;
        const visible = label.replaceAll("[", "").replaceAll("]", "");
        return `[${visible}](${apiPageHref(locale, slug)})`;
      }),
    ),
  );
}

/** Body prose after the paragraph already shown as the page description. */
export function withoutFirstParagraph(description: string): string {
  const breakAt = description.search(/\n\s*\n/);
  if (breakAt === -1) return "";
  return description.slice(breakAt).trim();
}

export function codeLanguage(path: string): string {
  return path.endsWith(".tsx") ? "tsx" : "ts";
}

/** One shared table when every overload lists the same fields; otherwise one table each. */
export function parameterSections(
  overloads: readonly { signature: string; parameters: readonly ApiField[] }[],
): ApiParameterSection[] {
  const present = overloads.filter(
    (overload) => overload.parameters.length > 0,
  );
  const first = present[0];
  if (!first) return [];
  const expected = fieldFingerprint(first.parameters);
  if (
    present.every(
      (overload) => fieldFingerprint(overload.parameters) === expected,
    )
  )
    return [{ rows: [...first.parameters] }];
  return present.map((overload) => ({
    signature: overload.signature,
    rows: [...overload.parameters],
  }));
}

function fieldFingerprint(rows: readonly ApiField[]): string {
  return rows
    .map((row) =>
      [row.name, row.type, row.required, row.deprecated, row.description].join(
        "\0",
      ),
    )
    .join("\n");
}

/** `<Type>` in prose is a type argument. Inline code keeps search from seeing an MDX component. */
function escapeTypeAngles(line: string): string {
  let out = "";
  for (let index = 0; index < line.length;) {
    if (line[index] === "`") {
      let end = index + 1;
      while (end < line.length && line[end] === "`") end += 1;
      const marker = line.slice(index, end);
      const close = line.indexOf(marker, end);
      const stop = close === -1 ? line.length : close + marker.length;
      out += line.slice(index, stop);
      index = stop;
      continue;
    }
    const next = line[index + 1];
    if (
      line[index] === "<" &&
      next !== undefined &&
      next >= "A" &&
      next <= "Z"
    ) {
      const close = matchingAngle(line, index);
      if (close !== -1) {
        out += `\`${line.slice(index, close + 1)}\``;
        index = close + 1;
        continue;
      }
    }
    out += line[index];
    index += 1;
  }
  return out;
}

function matchingAngle(line: string, open: number): number {
  let depth = 0;
  for (let index = open; index < line.length; index += 1) {
    if (line[index] === "<") depth += 1;
    else if (line[index] === ">") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function replaceDocLinks(
  line: string,
  replace: (name: string, label: string) => string,
): string {
  let out = "";
  for (let index = 0; index < line.length;) {
    if (line[index] === "`") {
      let end = index + 1;
      while (end < line.length && line[end] === "`") end += 1;
      const marker = line.slice(index, end);
      const close = line.indexOf(marker, end);
      const stop = close === -1 ? line.length : close + marker.length;
      out += line.slice(index, stop);
      index = stop;
      continue;
    }
    if (line.startsWith("{@link", index)) {
      const close = line.indexOf("}", index);
      if (close !== -1) {
        const body = line.slice(index + "{@link".length, close).trim();
        const pipe = body.indexOf("|");
        const name = (pipe === -1 ? body : body.slice(0, pipe)).trim();
        const label = (pipe === -1 ? name : body.slice(pipe + 1)).trim();
        out += name
          ? replace(name, label || name)
          : line.slice(index, close + 1);
        index = close + 1;
        continue;
      }
    }
    out += line[index];
    index += 1;
  }
  return out;
}
