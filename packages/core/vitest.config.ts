import { defineConfig, type ViteUserConfig as UserConfig } from "vitest/config";
import {
  specExclude,
  specInclude,
  type Runtime,
} from "../../test/spec-matrix.ts";
import { coverageSettings, reporters } from "../../test/vitest-shared.ts";
import { globalSetupPath, packageRoot } from "./test/shared.ts";
import { readRound13Settings } from "./test/round13-settings.ts";

export function baseConfig(runtime?: Runtime): UserConfig {
  return {
    root: packageRoot,
    test: {
      name: "core-plain",
      include: specInclude(runtime),
      exclude: specExclude(runtime),
      globalSetup: globalSetupPath,
      reporters,
      provide: { round13: readRound13Settings(process.env) },
      coverage: coverageSettings({
        reportsDirectory: `${packageRoot}/coverage/${runtime ?? "plain"}`,
      }),
    },
  };
}

export default defineConfig(baseConfig());
