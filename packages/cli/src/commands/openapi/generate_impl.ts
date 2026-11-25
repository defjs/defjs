import { resolve } from "pathe";
import { applyGeneratedFiles } from "../../codegen/fs_sync.ts";
import { discoverConfigFile, loadDefjsConfig } from "../../config/loader.ts";
import type { DefjsCliContext } from "../../runtime/context.ts";
import { CliError, formatDiagnostic } from "../../runtime/diagnostics.ts";
import type { CliIo } from "../../runtime/types.ts";
import { requireOpenApiTargets } from "./config.ts";
import { attachDiagnostics, planGeneratedFiles } from "./emitter/plan.ts";
import { lowerOpenApiDocument } from "./ir/lower.ts";
import { loadOpenApiDocument } from "./parser/scalar.ts";
import type {
  GenerateOpenApiOptions,
  OpenApiErrorStrategy,
  OpenApiGenerateResult,
  OpenApiGenerationMode,
  OpenApiMixed2xxStrategy,
  OpenApiOutputFormat,
  OpenApiTargetConfig,
} from "./types.ts";

export interface OpenApiGenerateFlags {
  readonly config?: string;
  readonly input?: string;
  readonly output?: string;
  readonly format?: OpenApiOutputFormat;
  readonly mode?: OpenApiGenerationMode;
  readonly errorStrategy?: OpenApiErrorStrategy;
  readonly "mixed-2xx"?: OpenApiMixed2xxStrategy;
  readonly check: boolean;
}

export async function generateOpenApiImpl(
  options: GenerateOpenApiOptions,
): Promise<OpenApiGenerateResult> {
  const cwd = options.cwd ?? process.cwd();
  const target = options.target;
  const format = target.output.format ?? "ts";
  const mode = target.mode ?? "sync";
  const errorStrategy = target.errorStrategy ?? "none";
  const mixed2xxStrategy = target.mixed2xxStrategy ?? "omit";
  const coreImport = target.output.coreImport ?? "@defjs/core";
  const outDir = resolve(cwd, target.output.dir);

  const parsed = await loadOpenApiDocument({
    input: target.input,
    cwd,
    fetch: options.fetch,
  });

  const bundle = lowerOpenApiDocument(parsed.document, parsed.refMeta, {
    errorStrategy,
    mixed2xxStrategy,
    include: target.include,
    exclude: target.exclude,
  });

  const planned = planGeneratedFiles(bundle, {
    mode,
    format,
    coreImport,
  });
  const emitted = applyGeneratedFiles(outDir, planned, {
    mode,
    check: options.check ?? false,
  });

  return attachDiagnostics(
    emitted,
    bundle.diagnostics,
    bundle.operations.length,
    bundle.schemas.length,
  );
}

function applyOverrides(
  target: OpenApiTargetConfig,
  flags: OpenApiGenerateFlags,
): OpenApiTargetConfig {
  return {
    ...target,
    input: flags.input ?? target.input,
    output: {
      ...target.output,
      dir: flags.output ?? target.output.dir,
      ...(flags.format !== undefined
        ? { format: flags.format }
        : target.output.format !== undefined
          ? { format: target.output.format }
          : {}),
    },
    ...(flags.mode !== undefined
      ? { mode: flags.mode }
      : target.mode !== undefined
        ? { mode: target.mode }
        : {}),
    ...(flags.errorStrategy !== undefined
      ? { errorStrategy: flags.errorStrategy }
      : target.errorStrategy !== undefined
        ? { errorStrategy: target.errorStrategy }
        : {}),
    ...(flags["mixed-2xx"] !== undefined
      ? { mixed2xxStrategy: flags["mixed-2xx"] }
      : target.mixed2xxStrategy !== undefined
        ? { mixed2xxStrategy: target.mixed2xxStrategy }
        : {}),
  };
}

async function resolveCliTargets(
  flags: OpenApiGenerateFlags,
  cwd: string,
): Promise<readonly OpenApiTargetConfig[]> {
  if (flags.config !== undefined) {
    const config = await loadDefjsConfig(resolve(cwd, flags.config));
    return requireOpenApiTargets(config).map((target) =>
      applyOverrides(target, flags),
    );
  }

  if (flags.input !== undefined && flags.output !== undefined) {
    return [
      applyOverrides(
        { input: flags.input, output: { dir: flags.output } },
        flags,
      ),
    ];
  }

  const discovered = discoverConfigFile(cwd);
  if (discovered !== undefined) {
    const config = await loadDefjsConfig(discovered);
    return requireOpenApiTargets(config).map((target) =>
      applyOverrides(target, flags),
    );
  }

  if (flags.input !== undefined || flags.output !== undefined) {
    throw new CliError(
      "Both --input and --output are required when no defjs.config.* file is present",
      2,
    );
  }

  throw new CliError(
    "No defjs.config.{ts,mts,mjs,js} found and neither --input nor --output was provided",
    2,
  );
}

async function executeOpenApiGenerate(
  flags: OpenApiGenerateFlags,
  io: CliIo,
): Promise<number> {
  const cwd = io.cwd ?? process.cwd();
  const targets = await resolveCliTargets(flags, cwd);
  let hasDrift = false;

  for (const target of targets) {
    const result = await generateOpenApiImpl({
      target,
      cwd,
      check: flags.check,
      fetch: io.fetch,
    });
    for (const diagnostic of result.diagnostics) {
      io.stderr(`${formatDiagnostic(diagnostic)}\n`);
    }
    if (flags.check) {
      if (result.drifted.length > 0) {
        hasDrift = true;
        io.stderr(
          `Out of sync in ${result.outDir}:\n${result.drifted.map((f) => `  - ${f}`).join("\n")}\n`,
        );
      } else {
        io.stdout(
          `Up to date: ${result.outDir} (${result.operationCount} operations, ${result.schemaCount} schemas)\n`,
        );
      }
    } else {
      io.stdout(
        `Generated ${result.operationCount} operations and ${result.schemaCount} schemas in ${result.outDir} (written: ${result.written.length}, unchanged: ${result.unchanged.length}, skipped: ${result.skipped.length}, deleted: ${result.deleted.length})\n`,
      );
    }
  }

  return hasDrift ? 1 : 0;
}

export async function runOpenApiGenerate(
  this: DefjsCliContext,
  flags: OpenApiGenerateFlags,
): Promise<void> {
  this.process.exitCode = await executeOpenApiGenerate(flags, this.io);
}
