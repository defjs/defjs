import catalog from './api-entries.json'
export interface ApiEntry {
  package: string
  name: string
  kind: string
  slug: string
  related: string[]
}
export const apiEntries: ApiEntry[] = catalog
export function filterApiEntries(entries: readonly ApiEntry[], query: string, packageName: string, kind: string): ApiEntry[] {
  const normalized = query.trim().toLowerCase()
  return entries.filter(
    (entry) =>
      entry.name.toLowerCase().includes(normalized) && (!packageName || entry.package === packageName) && (!kind || entry.kind === kind),
  )
}
export function validateApiEntries(entries: readonly ApiEntry[]): void {
  const identities = new Set<string>(),
    slugs = new Set<string>()
  for (const entry of entries) {
    const identity = `${entry.package}:${entry.name}`
    if (identities.has(identity)) throw new Error(`Duplicate API identity: ${identity}`)
    if (slugs.has(entry.slug) || !/^[a-z0-9/-]+$/.test(entry.slug)) throw new Error(`Invalid or duplicate API slug: ${entry.slug}`)
    identities.add(identity)
    slugs.add(entry.slug)
  }
  for (const entry of entries)
    for (const target of entry.related) if (!identities.has(target)) throw new Error(`Missing related API target: ${target}`)
}
validateApiEntries(apiEntries)
