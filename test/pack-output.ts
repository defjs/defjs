interface PackEntry {
  files: { path: string }[];
}

function isPackEntry(value: unknown): value is PackEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    "files" in value &&
    Array.isArray(value.files) &&
    value.files.every(
      (file: unknown) =>
        typeof file === "object" &&
        file !== null &&
        "path" in file &&
        typeof file.path === "string",
    )
  );
}

/**
 * Parse `npm pack --json` stdout into packed file paths.
 *
 * npm 11 prints an array; npm 12 prints an object keyed by package name.
 */
export function parsePackedFiles(stdout: string): Set<string> {
  const start = stdout.search(/[[{]/);
  const end = Math.max(stdout.lastIndexOf("]"), stdout.lastIndexOf("}"));
  const parsed: unknown = JSON.parse(stdout.slice(start, end + 1));
  let first: unknown;
  if (Array.isArray(parsed)) first = parsed[0];
  else if (typeof parsed === "object" && parsed !== null)
    first = Object.values(parsed)[0];
  if (first === undefined) return new Set();
  if (!isPackEntry(first))
    throw new Error("npm pack output has no list of packed files");
  return new Set(
    first.files.map((file) => file.path.replace(/^package\//, "")),
  );
}
