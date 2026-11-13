/** POSIX path join for the documentation scripts, which run on Bun. */
export function joinPath(...parts: readonly string[]): string {
  return parts
    .filter((part) => part.length > 0)
    .join("/")
    .replace(/\/+/g, "/");
}

/** The documentation workspace, with a trailing slash. */
export const docRoot = Bun.fileURLToPath(new URL("..", import.meta.url));

/** The repository root, with a trailing slash. */
export const repoRoot = Bun.fileURLToPath(new URL("../..", import.meta.url));
