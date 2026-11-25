import type { OpenApiTargetConfig } from "../commands/openapi/types.ts";

/**
 * Root configuration accepted by {@link defineConfig} in `defjs.config.ts`.
 *
 * @group cli
 */
export interface DefjsConfig {
  /** One or more OpenAPI generation targets. */
  readonly openapi?: OpenApiTargetConfig | readonly OpenApiTargetConfig[];
}
