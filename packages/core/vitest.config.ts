import { defineConfig, type ViteUserConfig as UserConfig } from "vitest/config";
import {
  specExclude,
  specInclude,
  type Runtime,
} from "../../test/spec-matrix.ts";
import { coverageSettings, reporters } from "../../test/vitest-shared.ts";
import { globalSetupPath, packageRoot } from "./test/shared.ts";

export function baseConfig(runtime?: Runtime): UserConfig {
  return {
    root: packageRoot,
    test: {
      name: "core-plain",
      include: specInclude(runtime),
      exclude: specExclude(runtime),
      globalSetup: globalSetupPath,
      reporters,
      coverage: coverageSettings({
        reportsDirectory: `${packageRoot}/coverage/${runtime ?? "plain"}`,
      }),
    },
  };
}

export default defineConfig(baseConfig());
