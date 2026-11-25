import {
  array,
  check,
  custom,
  nonEmpty,
  object,
  optional,
  picklist,
  pipe,
  safeParse,
  string,
  transform,
  union,
} from "valibot";
import type { DefjsConfig } from "../../config/types.ts";
import {
  CliError,
  isRecord,
  isUnknownFunction,
} from "../../runtime/diagnostics.ts";
import {
  OPENAPI_ERROR_STRATEGIES,
  OPENAPI_GENERATION_MODES,
  OPENAPI_MIXED_2XX_STRATEGIES,
  OPENAPI_OUTPUT_FORMATS,
} from "./constants.ts";
import type {
  OpenApiDocumentObject,
  OpenApiInput,
  OpenApiTargetConfig,
} from "./types.ts";

function createNonEmptyStringSchema() {
  return pipe(
    string(),
    check((value) => value.trim() !== "", "expected non-empty string"),
  );
}

function createDocumentObjectSchema() {
  return custom<OpenApiDocumentObject>(isRecord, "expected document object");
}

function validateLoaderResult(value: unknown): string | OpenApiDocumentObject {
  const parsed = safeParse(
    union([string(), createDocumentObjectSchema()]),
    value,
  );
  if (!parsed.success) {
    throw new CliError(
      "OpenAPI loader function must resolve to a string or document object",
      1,
    );
  }
  return parsed.output;
}

export function createOpenApiConfigSchema() {
  const nonEmptyString = createNonEmptyStringSchema();
  const loaderSchema = pipe(
    custom<(...args: readonly unknown[]) => unknown>(
      isUnknownFunction,
      "expected loader function",
    ),
    transform(
      (fn): OpenApiInput =>
        () =>
          Promise.resolve(fn()).then(validateLoaderResult),
    ),
  );
  const targetSchema = object({
    input: union([string(), createDocumentObjectSchema(), loaderSchema]),
    output: object({
      dir: nonEmptyString,
      format: optional(picklist(OPENAPI_OUTPUT_FORMATS)),
      coreImport: optional(nonEmptyString),
    }),
    mode: optional(picklist(OPENAPI_GENERATION_MODES)),
    errorStrategy: optional(picklist(OPENAPI_ERROR_STRATEGIES)),
    mixed2xxStrategy: optional(picklist(OPENAPI_MIXED_2XX_STRATEGIES)),
    include: optional(array(string())),
    exclude: optional(array(string())),
  });

  return union([
    pipe(
      array(targetSchema),
      nonEmpty('Config "openapi" list must not be empty'),
    ),
    targetSchema,
  ]);
}

function isTargetArray(
  value: OpenApiTargetConfig | readonly OpenApiTargetConfig[],
): value is readonly OpenApiTargetConfig[] {
  return Array.isArray(value);
}

export function requireOpenApiTargets(
  config: DefjsConfig,
): readonly OpenApiTargetConfig[] {
  if (config.openapi === undefined) {
    throw new CliError('Configuration does not define an "openapi" section', 1);
  }
  return isTargetArray(config.openapi) ? config.openapi : [config.openapi];
}
