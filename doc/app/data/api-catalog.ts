import catalog from "./api-entries.json";
export interface ApiEntry {
  package: string;
  name: string;
  kind: string;
  slug: string;
  related: string[];
}
export const apiEntries: ApiEntry[] = catalog;
export function filterApiEntries(
  entries: readonly ApiEntry[],
  query: string,
  packageName: string,
  kind: string,
): ApiEntry[] {
  const normalized = query.trim().toLowerCase();
  return entries.filter(
    (entry) =>
      entry.name.toLowerCase().includes(normalized) &&
      (!packageName || entry.package === packageName) &&
      (!kind || entry.kind === kind),
  );
}
