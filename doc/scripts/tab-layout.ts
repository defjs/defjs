import { posix } from "node:path";

import { createScanner, LanguageVariant, SyntaxKind } from "typescript/ast";

import { tabItems } from "../app/lib/tab-items";

function importPaths(code: string): string[] {
  const scanner = createScanner(true, LanguageVariant.JSX, code);
  const paths: string[] = [];
  let before = SyntaxKind.Unknown;
  let previous = SyntaxKind.Unknown;
  for (
    let token = scanner.scan();
    token !== SyntaxKind.EndOfFile;
    token = scanner.scan()
  ) {
    if (
      token === SyntaxKind.StringLiteral &&
      (previous === SyntaxKind.FromKeyword ||
        previous === SyntaxKind.ImportKeyword ||
        (previous === SyntaxKind.OpenParenToken &&
          before === SyntaxKind.ImportKeyword))
    )
      paths.push(scanner.getTokenValue());
    before = previous;
    previous = token;
  }
  return paths;
}

const tabsGroup = /(<Tabs\b[^>]*>)([\s\S]*?)<\/Tabs>/g;

function tabGroups(markdown: string): { open: string; body: string }[] {
  const groups: { open: string; body: string }[] = [];
  markdown.replace(tabsGroup, (match, open: string, body: string) => {
    groups.push({ open, body });
    return match;
  });
  return groups;
}
const tabElement = /<Tab(?:\s[^>]*)?>[\s\S]*?<\/Tab>/g;

/**
 * A `<Tab>` is matched to its trigger by position in `<Tabs items>`, so every
 * `Tabs` needs a parsable `items` array, no `Tab` may carry a `value` (a
 * translated label there silently hides the panel), and the counts must match.
 */
export function tabStructureIssues(markdown: string): string[] {
  const issues: string[] = [];
  for (const { open, body } of tabGroups(markdown)) {
    const items = tabItems(open);
    const label = open.replace(/\s+/g, " ");
    if (!items) {
      issues.push(`${label}: items must be a literal array of strings`);
      continue;
    }
    const tabs = [...body.matchAll(/<Tab\b[^>]*>/g)];
    for (const [tag] of tabs) {
      if (tag !== "<Tab>")
        issues.push(`${label}: ${tag} must be <Tab>; labels come from items`);
    }
    if (tabs.length !== items.length)
      issues.push(
        `${label}: ${tabs.length} <Tab> children for ${items.length} items`,
      );
  }
  return issues;
}

export async function tabLayoutIssues(
  markdown: string,
  readInclude: (reference: string) => Promise<string>,
): Promise<string[]> {
  const issues: string[] = [];
  for (const { open, body: group } of tabGroups(markdown)) {
    const files = new Map<string, string>();
    const items = tabItems(open) ?? [];
    let index = 0;
    for (const tab of group.matchAll(tabElement)) {
      const label = items[index++];
      if (!label || !/\.[a-z0-9]+$/i.test(label)) continue;
      const body = tab[0].slice(
        tab[0].indexOf(">") + 1,
        tab[0].lastIndexOf("</Tab>"),
      );
      let code = "";
      for (const include of body.matchAll(
        /<include\b[^>]*>([\s\S]*?)<\/include>/g,
      )) {
        code += `${await readInclude(include[0].replace(/<[^>]+>/g, "").trim())}\n`;
      }
      for (const fence of body.matchAll(
        /`{3,}(?:ts|tsx|typescript|js|jsx|javascript|vue)\b[^\n]*\n([\s\S]*?)\n\s*`{3,}/g,
      )) {
        code += fence[0].replace(/^`{3,}[^\n]*\n|\n\s*`{3,}$/g, "");
      }
      files.set(posix.normalize(label), code);
    }
    for (const [file, code] of files) {
      if (!/\.(?:[jt]sx?|vue)$/.test(file)) continue;
      const script = file.endsWith(".vue")
        ? code.replace(/^[\s\S]*?<script\b[^>]*>|<\/script>[\s\S]*$/g, "")
        : code;
      for (const path of importPaths(script)) {
        if (!path.startsWith(".")) continue;
        const target = posix.normalize(posix.join(posix.dirname(file), path));
        const candidates = [
          target,
          `${target}.ts`,
          `${target}.tsx`,
          `${target}/index.ts`,
        ];
        if (/\.jsx?$/.test(target))
          candidates.push(target.replace(/\.js(x?)$/, ".ts$1"));
        if (!candidates.some((candidate) => files.has(candidate))) {
          issues.push(
            `${file}: ${path} has no labelled file in this Tabs group`,
          );
        }
      }
    }
  }
  return issues;
}
