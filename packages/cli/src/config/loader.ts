import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "pathe";
import {
  CliError,
  errorMessage,
  isRecord,
  isUnknownFunction,
} from "../runtime/diagnostics.ts";
import { DEFAULT_CONFIG_FILES, parseDefjsConfig } from "./schema.ts";
import type { DefjsConfig } from "./types.ts";

let loadNonce = 0;

export function extractModuleDefault(mod: unknown): unknown {
  return isRecord(mod) && "default" in mod ? mod["default"] : mod;
}

export async function loadModuleDefaultExport(
  filePath: string,
): Promise<unknown> {
  if (!existsSync(filePath)) {
    throw new CliError(`Module file not found: ${filePath}`, 1);
  }
  try {
    loadNonce += 1;
    const url = `${pathToFileURL(filePath).href}?defjs_reload=${loadNonce}`;
    const mod: unknown = await import(url);
    return extractModuleDefault(mod);
  } catch (error) {
    throw new CliError(
      `Failed to load module ${filePath}: ${errorMessage(error)}`,
      1,
      [],
      { cause: error },
    );
  }
}

export function discoverConfigFile(cwd: string): string | undefined {
  for (const filename of DEFAULT_CONFIG_FILES) {
    const candidate = resolve(cwd, filename);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export async function loadDefjsConfig(
  configPath: string,
): Promise<DefjsConfig> {
  const exported = await loadModuleDefaultExport(configPath);
  const resolved = isUnknownFunction(exported) ? await exported() : exported;
  return parseDefjsConfig(resolved);
}
