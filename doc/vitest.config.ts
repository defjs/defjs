import type { ViteUserConfig as UserConfig } from "vitest/config";
import { specExclude, specInclude } from "../test/spec-matrix.ts";
import {
  coverageSettings,
  reporters,
  type RuntimeProject,
} from "../test/vitest-shared.ts";

const docRoot = import.meta.dirname;

export function baseConfig({ runtime, test }: RuntimeProject): UserConfig {
  return {
    root: docRoot,
    resolve: { tsconfigPaths: true },
    test: {
      ...test,
      include: specInclude(["{app,scripts,examples}/**"]),
      exclude: specExclude(runtime),
      globalSetup: `${docRoot}/../test/runtime-guard-setup.ts`,
      reporters,
      coverage: {
        ...coverageSettings({
          reportsDirectory: `${docRoot}/coverage/${runtime}`,
          extraExclude: ["app/lib/source.ts", "**/*.d.ts"],
        }),
        include: ["app/lib/**/*.ts", "app/data/**/*.ts", "scripts/**/*.ts"],
      },
    },
  };
}
