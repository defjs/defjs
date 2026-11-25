import type { DefjsConfig } from "./types.ts";

/**
 * Identity configuration helper that provides type safety for `defjs.config.ts`.
 *
 * @param config - Defjs CLI configuration object.
 * @returns The same configuration object unchanged.
 * @group cli
 */
export function defineConfig(config: DefjsConfig): DefjsConfig {
  return config;
}
