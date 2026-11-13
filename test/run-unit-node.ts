import { spawnSync } from "node:child_process";
import { basename } from "node:path";

// Runs `unit:node` in every directory, also after a failure, and returns the
// exit code: 1 when a run failed or ended without an exit status.
export function runUnitNode(
  dirs: readonly string[],
  execute: (dir: string) => number | null = nodeRun,
): number {
  const statuses = dirs.map((dir) => {
    console.log(`unit:node ${basename(dir)}`);
    return execute(dir);
  });
  return statuses.every((status) => status === 0) ? 0 : 1;
}

function nodeRun(dir: string): number | null {
  return spawnSync(process.execPath, ["--run", "unit:node"], {
    cwd: dir,
    stdio: "inherit",
  }).status;
}
