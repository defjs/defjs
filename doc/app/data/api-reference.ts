import type { ApiKind, ApiReferenceEntry } from "../../scripts/api-model";
import { linkTargets } from "../lib/api-text";
import reference from "./api-reference.json";

const kinds: ReadonlySet<string> = new Set<ApiKind>([
  "function",
  "type",
  "constant",
]);

function isApiKind(kind: string): kind is ApiKind {
  return kinds.has(kind);
}

export const apiReference = reference.map((entry): ApiReferenceEntry => {
  const { kind } = entry;
  if (!isApiKind(kind))
    throw new Error(`Unknown API kind "${kind}" for ${entry.slug}`);
  return { ...entry, kind };
});

const bySlug = new Map(apiReference.map((entry) => [entry.slug, entry]));
const targets = linkTargets(apiReference);

export function apiTargets(): ReadonlyMap<string, string> {
  return targets;
}

export function requireApiReference(slug: string): ApiReferenceEntry {
  const entry = bySlug.get(slug);
  if (!entry) throw new Error(`Unknown API slug: ${slug}`);
  return entry;
}
