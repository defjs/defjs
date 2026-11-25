import {
  buildApplication,
  buildRouteMap,
  ExitCode,
  help,
  run,
  text_en,
  version,
} from "@stricli/core";
import type { StricliProcess } from "@stricli/core";
import { openapiRoutes } from "../commands/openapi/route.ts";
import { CLI_VERSION } from "../version.ts";
import type { DefjsCliContext } from "./context.ts";
import { CliError, errorMessage, formatDiagnostic } from "./diagnostics.ts";
import type { CliIo } from "./types.ts";

function formatCliException(error: unknown): string {
  if (error instanceof CliError) {
    const lines = error.diagnostics.map((d) => formatDiagnostic(d));
    lines.push(error.message);
    return lines.join("\n");
  }
  return errorMessage(error);
}

export function normalizeExitCode(
  code: number | string | null | undefined,
): number {
  if (typeof code !== "number") {
    return 0;
  }
  if (code === ExitCode.UnknownCommand || code === ExitCode.InvalidArgument) {
    return 2;
  }
  return code < 0 ? 1 : code;
}

const rootRoutes = buildRouteMap({
  routes: {
    openapi: openapiRoutes,
  },
  docs: {
    brief: "Development-time CLI and OpenAPI generator for Defjs",
  },
});

const app = buildApplication<DefjsCliContext>(
  rootRoutes,
  {
    name: "defjs",
    scanner: { caseStyle: "allow-kebab-for-camel" },
    documentation: {
      caseStyle: "convert-camel-to-kebab",
      disableAnsiColor: true,
    },
    localization: {
      text: {
        ...text_en,
        exceptionWhileRunningCommand: (error) => formatCliException(error),
      },
    },
    determineExitCode: (error) =>
      error instanceof CliError ? error.exitCode : 1,
  },
  {
    help: help({
      brief: text_en.briefs.help,
      alias: "h",
      defaultForRouteMap: true,
      includeHidden: false,
      formatting: {
        caseStyle: "convert-camel-to-kebab",
        useAliasInUsageLine: false,
        onlyRequiredInUsageLine: false,
      },
    }),
    version: version({
      brief: text_en.briefs.version,
      alias: "v",
      info: { currentVersion: CLI_VERSION },
    }),
  },
);

export async function executeCli(
  argv: readonly string[],
  io: CliIo,
): Promise<number> {
  const proc: StricliProcess = {
    stdout: { write: (text) => io.stdout(text) },
    stderr: { write: (text) => io.stderr(text) },
  };
  await run(app, argv, { process: proc, io });
  return normalizeExitCode(proc.exitCode);
}
