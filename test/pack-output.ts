/**
 * Parse `npm pack --json` stdout into packed file paths.
 *
 * npm 11 prints an array; npm 12 prints an object keyed by package name.
 */
export function parsePackedFiles(stdout: string): Set<string> {
  const start = stdout.search(/[[{]/);
  const end = Math.max(stdout.lastIndexOf("]"), stdout.lastIndexOf("}"));
  const parsed = JSON.parse(stdout.slice(start, end + 1)) as
    | { files: { path: string }[] }[]
    | Record<string, { files: { path: string }[] }>;
  const result = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  return new Set(
    result?.files.map((file) => file.path.replace(/^package\//, "")) ?? [],
  );
}
