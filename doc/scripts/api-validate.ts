import { defined } from "./api-model";
import type { ApiReferenceEntry } from "./api-model";
import { apiSlug } from "./api-slug";
import { seeTarget } from "./api-tags";

export const overviewGroups = [
  "client",
  "http",
  "sse",
  "web-socket",
  "errors",
  "interceptors",
  "struct",
  "vue",
  "react",
  "opentelemetry-server",
] as const;

export interface DescribedEntry {
  package: string;
  name: string;
  description: string;
}

export function singleGroup(values: readonly string[]): string {
  if (values.length !== 1) return "";
  return defined(values[0], "group");
}

const siteLink = /\]\(\/(?:docs|api|recipes)\//;

/** Published `.d.ts` text cannot point at root-relative documentation URLs. */
export function assertNoSiteLinks(entries: readonly ApiReferenceEntry[]): void {
  const offenders: string[] = [];
  for (const entry of entries) {
    const texts = [
      entry.description,
      ...entry.returns,
      ...entry.throws,
      ...entry.tags.map((tag) => tag.text),
      ...(entry.typeTable ?? []).map((row) => row.description),
      ...entry.overloads.flatMap((overload) =>
        overload.parameters.map((parameter) => parameter.description),
      ),
    ];
    if (texts.some((text) => siteLink.test(text)))
      offenders.push(`${entry.package}:${entry.name}`);
  }
  if (offenders.length > 0)
    throw new Error(
      `root-relative site links in TSDoc:\n${offenders.sort().join("\n")}`,
    );
}

export function assertDescribed(entries: readonly DescribedEntry[]): void {
  const missing = entries
    .filter((entry) => entry.description.trim() === "")
    .map((entry) => `${entry.package}:${entry.name}`)
    .sort();
  if (missing.length > 0)
    throw new Error(
      `public exports missing a description:\n${missing.join("\n")}`,
    );
}

export function identityIndex(
  entries: readonly { package: string; name: string }[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of entries) {
    const identity = `${entry.package}:${entry.name}`;
    for (const key of [entry.name, identity]) {
      const existing = map.get(key);
      if (existing !== undefined && existing !== identity)
        throw new Error(`duplicate API name: ${key}`);
      map.set(key, identity);
    }
  }
  return map;
}

export function resolveSee(
  text: string,
  identities: ReadonlyMap<string, string>,
): string {
  const name = seeTarget(text);
  const identity = identities.get(name) ?? identities.get(text.trim());
  if (identity === undefined) throw new Error(`Unknown @see target: ${text}`);
  return identity;
}

export function validateReference(
  entries: readonly ApiReferenceEntry[],
  identities: ReadonlyMap<string, string>,
): void {
  assertDescribed(entries);
  assertNoSiteLinks(entries);
  const badGroup: string[] = [];
  const badSee: string[] = [];
  const badSlug: string[] = [];
  for (const entry of entries) {
    const identity = `${entry.package}:${entry.name}`;
    const groups: readonly string[] = overviewGroups;
    if (!groups.includes(entry.group))
      badGroup.push(`${identity} @group ${entry.group || "(missing)"}`);
    for (const target of entry.related)
      if (!identities.has(target)) badSee.push(`${identity} -> ${target}`);
    const expected = apiSlug(entry.package, entry.name, entry.kind);
    if (entry.slug !== expected)
      badSlug.push(`${identity} ${entry.slug} != ${expected}`);
  }
  const problems: string[] = [];
  if (badGroup.length > 0)
    problems.push(`invalid @group:\n${badGroup.sort().join("\n")}`);
  if (badSee.length > 0)
    problems.push(`unknown @see target:\n${badSee.sort().join("\n")}`);
  if (badSlug.length > 0)
    problems.push(`slug mismatch:\n${badSlug.sort().join("\n")}`);
  if (problems.length > 0) throw new Error(problems.join("\n"));
}
