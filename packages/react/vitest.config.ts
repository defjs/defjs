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
