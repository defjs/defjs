export type ExpectedRuntime = "bun" | "node" | "browser-main" | "any";

export function assertRuntime(
  expected: ExpectedRuntime,
  versions?: { readonly bun?: string },
): void {
  if (expected === "any") {
    return;
  }
  const resolved = versions ?? process.versions;
  const onBun = resolved.bun !== undefined;
  if (expected === "node") {
    if (onBun) {
      throw new Error(
        'This project must run on Node.js; use "node --run unit:node".',
      );
    }
    return;
  }
  if (!onBun) {
    throw new Error("This project must run on Bun (main process).");
  }
}

export function expectedRuntime(projectName: string): ExpectedRuntime {
  const suffix = projectName.slice(projectName.lastIndexOf("-") + 1);
  switch (suffix) {
    case "node":
      return "node";
    case "bun":
      return "bun";
    case "chrome":
    case "firefox":
      return "browser-main";
    case "plain":
      return "any";
    default:
      throw new Error(`Unknown project runtime: ${projectName}`);
  }
}
