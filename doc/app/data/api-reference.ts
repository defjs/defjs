import type { ApiReferenceEntry } from "../../scripts/api-model";
import { linkTargets } from "../lib/api-text";
import reference from "./api-reference.json";

export const apiReference = reference as ApiReferenceEntry[];

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
