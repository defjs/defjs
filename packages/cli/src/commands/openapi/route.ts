import { buildCommand, buildRouteMap } from "@stricli/core";
import type { DefjsCliContext } from "../../runtime/context.ts";
import {
  OPENAPI_ERROR_STRATEGIES,
  OPENAPI_GENERATION_MODES,
  OPENAPI_MIXED_2XX_STRATEGIES,
  OPENAPI_OUTPUT_FORMATS,
} from "./constants.ts";
import type { OpenApiGenerateFlags } from "./generate_impl.ts";

const generateCommand = buildCommand<OpenApiGenerateFlags, [], DefjsCliContext>(
  {
    docs: {
      brief: "Generate stateless ESM @defjs/core operations and structs",
    },
    parameters: {
      flags: {
        config: {
          kind: "parsed",
          parse: String,
          optional: true,
          placeholder: "path",
          brief: "Path to defjs.config.{ts,mts,mjs,js}",
        },
        input: {
          kind: "parsed",
          parse: String,
          optional: true,
          placeholder: "path|url",
          brief: "OpenAPI YAML/JSON/TS source path or URL",
        },
        output: {
          kind: "parsed",
          parse: String,
          optional: true,
          placeholder: "dir",
          brief: "Output directory for generated files",
        },
        format: {
          kind: "enum",
          values: OPENAPI_OUTPUT_FORMATS,
          optional: true,
          brief: "Output format (default: ts)",
        },
        mode: {
          kind: "enum",
          values: OPENAPI_GENERATION_MODES,
          optional: true,
          brief: "Sync mode (default: sync)",
        },
        errorStrategy: {
          kind: "enum",
          values: OPENAPI_ERROR_STRATEGIES,
          optional: true,
          brief: "Error strategy (default: none)",
        },
        "mixed-2xx": {
          kind: "enum",
          values: OPENAPI_MIXED_2XX_STRATEGIES,
          optional: true,
          brief: "Mixed 2xx handling (default: omit)",
        },
        check: {
          kind: "boolean",
          default: false,
          brief: "Exit with code 1 if generated files are out of date",
        },
      },
      aliases: {
        c: "config",
        i: "input",
        o: "output",
        f: "format",
        m: "mode",
      },
    },
    loader: async () => (await import("./generate_impl.ts")).runOpenApiGenerate,
  },
);

export const openapiRoutes = buildRouteMap({
  routes: {
    generate: generateCommand,
  },
  docs: {
    brief: "Generate stateless ESM @defjs/core definitions from OpenAPI specs",
  },
});
