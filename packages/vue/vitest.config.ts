import type { ViteUserConfig as UserConfig } from "vitest/config";
import "../../test/loopback-proxy-bypass.ts";
import { specExclude, specInclude } from "../../test/spec-matrix.ts";
import {
  coverageSettings,
  reporters,
  type RuntimeProject,
} from "../../test/vitest-shared.ts";

const packageRoot = import.meta.dirname;

export function baseConfig({ runtime, test }: RuntimeProject): UserConfig {
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
      ...test,
      include: specInclude(),
      exclude: specExclude(runtime),
      globalSetup: `${packageRoot}/../../test/browser-api-server-setup.ts`,
      reporters,
      coverage: coverageSettings({
        reportsDirectory: `${packageRoot}/coverage/${runtime}`,
      }),
    },
  };
}
