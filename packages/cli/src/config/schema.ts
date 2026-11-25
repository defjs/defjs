import { getDotPath, object, optional, safeParse } from "valibot";
import { createOpenApiConfigSchema } from "../commands/openapi/config.ts";
import { CliError } from "../runtime/diagnostics.ts";
import type { DefjsConfig } from "./types.ts";

export const DEFAULT_CONFIG_FILES = [
  "defjs.config.ts",
  "defjs.config.mts",
  "defjs.config.mjs",
  "defjs.config.js",
] as const;

function createDefjsConfigSchema() {
  return object({
    openapi: optional(createOpenApiConfigSchema()),
  });
}

export function parseDefjsConfig(raw: unknown): DefjsConfig {
  const parsed = safeParse(createDefjsConfigSchema(), raw);
  if (!parsed.success) {
    const issue = parsed.issues[0];
    const dotPath = getDotPath(issue);
    const location = dotPath ? ` at ${dotPath}` : "";
    throw new CliError(`Invalid configuration${location}: ${issue.message}`, 1);
  }
  return parsed.output;
}
