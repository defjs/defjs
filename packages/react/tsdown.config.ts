import { defineConfig } from "tsdown";
import { libraryConfig } from "../../tsdown.shared.ts";
import manifest from "./package.json" with { type: "json" };

export default defineConfig({
  ...libraryConfig(manifest, { index: "src/index.ts" }),
  banner: { js: "'use client';" },
  deps: { neverBundle: ["react", "@defjs/core"] },
});
