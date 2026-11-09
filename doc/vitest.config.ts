import { defineConfig, type ViteUserConfig as UserConfig } from "vitest/config";
import { specExclude, specInclude, type Runtime } from "../test/spec-matrix.ts";
import { coverageSettings, reporters } from "../test/vitest-shared.ts";

export const docRoot = import.meta.dirname;

export function baseConfig(runtime?: Runtime): UserConfig {
  return {
    root: docRoot,
    resolve: { tsconfigPaths: true },
    test: {
      name: "doc-plain",
      include: specInclude(runtime, ["{app,scripts,examples}/**"]),
      exclude: specExclude(runtime),
      globalSetup: `${docRoot}/../test/runtime-guard-setup.ts`,
      reporters,
      coverage: {
        ...coverageSettings({
          reportsDirectory: `${docRoot}/coverage/${runtime ?? "plain"}`,
          extraExclude: ["app/lib/source.ts", "**/*.d.ts"],
        }),
        include: ["app/lib/**/*.ts", "app/data/**/*.ts", "scripts/**/*.ts"],
      },
    },
  };
}

export default defineConfig(baseConfig());
