import { defineConfig } from "vitest/config";
import { specExclude, specInclude } from "./test/spec-matrix.ts";
import { reporters, serverProject } from "./test/vitest-shared.ts";

const { runtime, test } = serverProject("root", "bun");

export default defineConfig({
  root: import.meta.dirname,
  test: {
    ...test,
    include: specInclude(["test/**"]),
    exclude: specExclude(runtime),
    globalSetup: `${import.meta.dirname}/test/runtime-guard-setup.ts`,
    reporters,
    coverage: { enabled: false },
  },
});
