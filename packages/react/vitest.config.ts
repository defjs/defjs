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
    resolve: {
      alias: {
        "@defjs/core": `${packageRoot}/../core/src`,
      },
      dedupe: ["react", "react-dom", "react-dom/client"],
    },
    optimizeDeps: {
      include: ["react", "react-dom/client", "@testing-library/react"],
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
