import { chmod } from "node:fs/promises";
import { defineConfig } from "tsdown";
import { libraryConfig } from "../../tsdown.shared.ts";
import manifest from "./package.json" with { type: "json" };

export default defineConfig({
  ...libraryConfig(
    manifest,
    { index: "src/cli.ts" },
    { bin: { defjs: "./index.js" } },
  ),
  platform: "node",
  fixedExtension: false,
  minify: true,
  banner: { js: "#!/usr/bin/env node" },
  deps: {
    alwaysBundle: [/.*/],
    neverBundle: [/^node:/],
    onlyBundle: false,
  },
  outputOptions: {
    codeSplitting: false,
  },
  onSuccess: async ({ outDir }) => {
    await chmod(`${outDir}/index.js`, 0o755);
  },
});
