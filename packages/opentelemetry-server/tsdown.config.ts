import { defineConfig } from "tsdown";
import { libraryConfig } from "../../tsdown.shared.ts";
import manifest from "./package.json" with { type: "json" };

export default defineConfig({
  ...libraryConfig(manifest, { index: "src/index.ts" }),
  deps: {
    neverBundle: [
      "@defjs/core",
      "@opentelemetry/api",
      "@opentelemetry/api-logs",
      "@opentelemetry/core",
    ],
  },
});
