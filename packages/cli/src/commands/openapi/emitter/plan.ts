import type {
  EmitFilesResult,
  GeneratedFile,
} from "../../../codegen/fs_sync.ts";
import type { CliDiagnostic } from "../../../runtime/types.ts";
import type { LoweredBundle } from "../ir/types.ts";
import type { OpenApiGenerationMode, OpenApiOutputFormat } from "../types.ts";
import { renderBundleDtsFiles } from "./render_dts.ts";
import { renderBundleCodeFiles } from "./render_ts.ts";

export function planGeneratedFiles(
  bundle: LoweredBundle,
  options: {
    readonly mode: OpenApiGenerationMode;
    readonly format: OpenApiOutputFormat;
    readonly coreImport: string;
  },
): GeneratedFile[] {
  return [
    ...renderBundleCodeFiles(bundle, options),
    ...renderBundleDtsFiles(bundle, options),
  ];
}

export function attachDiagnostics(
  emitResult: EmitFilesResult,
  diagnostics: readonly CliDiagnostic[],
  operationCount: number,
  schemaCount: number,
) {
  return {
    ...emitResult,
    diagnostics,
    operationCount,
    schemaCount,
  };
}
