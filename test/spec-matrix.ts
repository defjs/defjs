export type Runtime = "chrome" | "firefox" | "node" | "bun";

export const runtimes: readonly Runtime[] = [
  "chrome",
  "firefox",
  "node",
  "bun",
];

export const sourceExclude: readonly string[] = [
  "**/node_modules/**",
  "**/dist/**",
  "**/coverage/**",
  "**/test-out/**",
];

export function specInclude(
  runtime: Runtime | undefined,
  dirs?: readonly string[],
): string[] {
  const roots = dirs ?? ["**"];
  const patterns: string[] = [];
  for (const dir of roots) {
    patterns.push(`${dir}/*.spec.{ts,tsx}`);
    if (runtime !== undefined) {
      patterns.push(`${dir}/*.${runtime}.spec.{ts,tsx}`);
    }
  }
  return patterns;
}

export function specExclude(runtime: Runtime | undefined): string[] {
  const suffixes = [...runtimes.filter((name) => name !== runtime), "type"];
  return [...sourceExclude, `**/*.{${suffixes.join(",")}}.spec.{ts,tsx}`];
}
