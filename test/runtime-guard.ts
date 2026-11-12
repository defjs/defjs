type MainRuntime = "node" | "bun";

// The main Vitest process of every project runs on Bun, the browser projects
// included; only the `*-node` projects run on Node.js.
export function expectedRuntime(projectName: string): MainRuntime {
  return projectName.endsWith("-node") ? "node" : "bun";
}

export function assertRuntime(
  expected: MainRuntime,
  onBun: boolean = process.versions.bun !== undefined,
): void {
  if (expected === "node" && onBun) {
    throw new Error(
      'This project must run on Node.js; use "node --run unit:node".',
    );
  }
  if (expected === "bun" && !onBun) {
    throw new Error("This project must run on Bun (main process).");
  }
}
