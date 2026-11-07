/** A unique directory under the platform temporary root. */
export function tempDirectory(prefix: string): string {
  const root = (Bun.env["TMPDIR"] ?? "/tmp").replace(/\/+$/, "");
  const path = `${root}/${prefix}-${crypto.randomUUID()}`;
  Bun.spawnSync(["mkdir", "-p", path]);
  return path;
}

/** Removes a directory and its contents. */
export function removeDirectory(path: string): void {
  Bun.spawnSync(["rm", "-rf", path]);
}
