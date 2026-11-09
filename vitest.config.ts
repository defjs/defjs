import { defineConfig, type ViteUserConfig as UserConfig } from "vitest/config";
import { specExclude, specInclude, type Runtime } from "./test/spec-matrix.ts";
import { reporters } from "./test/vitest-shared.ts";

export function baseConfig(runtime?: Runtime): UserConfig {
  return {
    root: import.meta.dirname,
    test: {
      name: "root-plain",
      include: specInclude(runtime, ["test/**"]),
      exclude: specExclude(runtime),
      globalSetup: `${import.meta.dirname}/test/runtime-guard-setup.ts`,
      reporters,
      coverage: { enabled: false },
    },
  };
}

export default defineConfig(baseConfig());
