import { isDirectExecution } from "./runtime/entrypoint.ts";
import { runCli } from "./runtime/run.ts";

export * from "./public_api.ts";

if (isDirectExecution(process.argv[1], import.meta.url)) {
  void runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
