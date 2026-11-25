import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function isDirectExecution(
  argvEntry: string | undefined,
  moduleUrl: string,
): boolean {
  if (argvEntry === undefined || argvEntry === "") {
    return false;
  }
  try {
    return realpathSync(argvEntry) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
