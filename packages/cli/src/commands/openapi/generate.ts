import type { GenerateOpenApiOptions, OpenApiGenerateResult } from "./types.ts";

/**
 * Generates Defjs request, event-stream, and schema modules from a single OpenAPI target.
 *
 * @param options - Generation target, working directory, check mode, and optional custom `fetch`.
 * @returns Summary of written, skipped, deleted, unchanged, drifted files, and diagnostics.
 * @group cli
 */
export async function generateOpenApi(
  options: GenerateOpenApiOptions,
): Promise<OpenApiGenerateResult> {
  const { generateOpenApiImpl } = await import("./generate_impl.ts");
  return generateOpenApiImpl(options);
}
