/** POSIX path join for the documentation scripts, which run on Bun. */
export function joinPath(...parts: readonly string[]): string {
  return parts
    .filter((part) => part.length > 0)
    .join("/")
    .replace(/\/+/g, "/");
}
