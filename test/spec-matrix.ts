export type Runtime = "chrome" | "firefox" | "node" | "bun";

const runtimes: readonly Runtime[] = ["chrome", "firefox", "node", "bun"];

const sourceExclude: readonly string[] = [
  "**/node_modules/**",
  "**/dist/**",
  "**/coverage/**",
  "**/test-out/**",
];

// Every spec under `dirs`. A runtime-specific spec matches the same pattern,
// so `specExclude` is what selects the runtime.
export function specInclude(dirs: readonly string[] = ["**"]): string[] {
  return dirs.map((dir) => `${dir}/*.spec.{ts,tsx}`);
}

export function specExclude(runtime: Runtime): string[] {
  const suffixes = [...runtimes.filter((name) => name !== runtime), "type"];
  return [...sourceExclude, `**/*.{${suffixes.join(",")}}.spec.{ts,tsx}`];
}
