import type { ViteUserConfig as UserConfig } from "vitest/config";
import { specExclude, specInclude } from "../../test/spec-matrix.ts";
import {
  coverageSettings,
  reporters,
  type RuntimeProject,
} from "../../test/vitest-shared.ts";
import { globalSetupPath, packageRoot } from "./test/shared.ts";

export function baseConfig({ runtime, test }: RuntimeProject): UserConfig {
  return {
    root: packageRoot,
    test: {
      ...test,
      include: specInclude(),
      exclude: specExclude(runtime),
      globalSetup: globalSetupPath,
      reporters,
      coverage: coverageSettings({
        reportsDirectory: `${packageRoot}/coverage/${runtime}`,
      }),
    },
  };
}
