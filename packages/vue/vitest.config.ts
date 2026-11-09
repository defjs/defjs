import { defineConfig, type ViteUserConfig as UserConfig } from "vitest/config";
import {
  specExclude,
  specInclude,
  type Runtime,
} from "../../test/spec-matrix.ts";
import { coverageSettings, reporters } from "../../test/vitest-shared.ts";
import { packageRoot } from "./test/shared.ts";

export function baseConfig(runtime?: Runtime): UserConfig {
  return {
    root: packageRoot,
    define: {
      __VUE_OPTIONS_API__: "true",
      __VUE_PROD_DEVTOOLS__: "false",
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
    },
    resolve: {
      alias: {
        "@defjs/core": `${packageRoot}/../core/src`,
      },
    },
    test: {
      include: specInclude(runtime),
      exclude: specExclude(runtime),
      globalSetup: `${packageRoot}/../../test/browser-api-server-setup.ts`,
      reporters,
      coverage: coverageSettings({
        reportsDirectory: `${packageRoot}/coverage/${runtime ?? "plain"}`,
      }),
    },
  };
}

export default defineConfig(baseConfig());
